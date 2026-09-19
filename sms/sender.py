"""Twilio delivery and send-gating for the FarmOS SMS digest.

digest.py is treated as fixed; this module only wraps compose_digest_report.
Dry run is the default everywhere: no network call and no credentials needed.
Credentials come from environment variables only and are never logged.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import tempfile
import time
from dataclasses import dataclass, field as dc_field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

from from_app import PlotDetails
from digest import (
    INSPECT,
    IRRIGATE_3D,
    IRRIGATE_NOW,
    DigestResult,
    FieldState,
    action_for,
    compose_digest_report,
)

log = logging.getLogger("farmos.sms")

E164_RE = re.compile(r"^\+[1-9]\d{6,14}$")  # + country code + digits, 7-15 digits total
ENV_VARS = ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER")
HTTP_TIMEOUT_S = 10
RETRY_BACKOFF_S = 2.0


class InvalidPhoneNumber(ValueError):
    pass


class ConfigError(RuntimeError):
    pass


class SendFailed(RuntimeError):
    def __init__(self, message: str, code: int | None = None):
        super().__init__(message)
        self.code = code


def validate_e164(number: str | None) -> str:
    if not isinstance(number, str) or not E164_RE.match(number):
        raise InvalidPhoneNumber(
            f"{number!r} is not E.164. Use a leading +, the country code, then digits "
            "only, e.g. +254712345678 (not 0712345678, no spaces or dashes)."
        )
    return number


# --- Twilio client -----------------------------------------------------------


def make_client():
    """Build a Twilio client from the environment. Raises ConfigError if unset."""
    missing = [v for v in ENV_VARS if not os.environ.get(v)]
    if missing:
        raise ConfigError(f"Missing environment variables: {', '.join(missing)}")
    from twilio.http.http_client import TwilioHttpClient
    from twilio.rest import Client

    return Client(
        os.environ["TWILIO_ACCOUNT_SID"],
        os.environ["TWILIO_AUTH_TOKEN"],
        http_client=TwilioHttpClient(timeout=HTTP_TIMEOUT_S),
    )


# --- Sending -----------------------------------------------------------------


@dataclass
class SendResult:
    sid: str | None  # None in dry run
    body: str
    chars: int
    segments: int
    dry_run: bool


def _friendly(code: int | None, msg: str, to: str) -> str:
    if code == 21608:
        return (
            f"Twilio trial account: {to} is not verified. Verify it in the console "
            "(Phone Numbers > Manage > Verified Caller IDs) or upgrade the account."
        )
    if code == 21211:
        return f"Twilio rejected {to} as an invalid 'to' number."
    if code == 21610:
        return f"{to} has unsubscribed (replied STOP). Do not message them until they reply START."
    if code == 572006:
        return (
            "Twilio trial accounts can only send Twilio's predefined templates, not custom text "
            "like the digest. Upgrade the account in the Twilio console to send it."
        )
    return f"Twilio error {code}: {msg}"


def _is_transient(exc: Exception) -> bool:
    import requests
    from twilio.base.exceptions import TwilioRestException

    if isinstance(exc, TwilioRestException):
        return exc.status >= 500
    return isinstance(exc, (requests.exceptions.Timeout, requests.exceptions.ConnectionError))


def send_message(
    report: DigestResult,
    to_number: str | None,
    dry_run: bool = True,
    client=None,
    sleep: Callable[[float], None] = time.sleep,
) -> SendResult:
    """Send (or dry-run print) an already composed digest."""
    if to_number is not None or not dry_run:
        validate_e164(to_number)  # before any API call

    if dry_run:
        print(f"--- DRY RUN (not sent){f' to {to_number}' if to_number else ''} ---")
        print(report.text)
        print(f"--- {report.chars} chars, {report.segments} segment(s) ---")
        return SendResult(None, report.text, report.chars, report.segments, True)

    from twilio.base.exceptions import TwilioRestException

    client = client or make_client()
    from_number = validate_e164(os.environ.get("TWILIO_FROM_NUMBER"))
    for attempt in (1, 2):
        try:
            msg = client.messages.create(body=report.text, from_=from_number, to=to_number)
            return SendResult(msg.sid, report.text, report.chars, report.segments, False)
        except Exception as exc:  # narrowed below; anything else propagates
            if attempt == 1 and _is_transient(exc):
                log.warning("Transient send error (%s); retrying once", type(exc).__name__)
                sleep(RETRY_BACKOFF_S)
                continue
            if isinstance(exc, TwilioRestException):
                message = _friendly(exc.code, exc.msg, to_number)
                log.error("Twilio error %s: %s", exc.code, exc.msg)
                raise SendFailed(message, exc.code) from exc
            if _is_transient(exc):
                log.error("Network error after retry: %s", type(exc).__name__)
                raise SendFailed(f"Network error sending to {to_number}: {type(exc).__name__}") from exc
            raise
    raise AssertionError("unreachable")


def send_digest(
    fields: list[FieldState],
    to_number: str | None,
    dry_run: bool = True,
    client=None,
    today: date | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> SendResult:
    """Compose the digest and send it. Dry run by default: no network, no credentials."""
    return send_message(compose_digest_report(fields, today=today), to_number, dry_run, client, sleep)


# --- Gating ------------------------------------------------------------------

_ACTION_SEVERITY = {IRRIGATE_NOW: "urgent", IRRIGATE_3D: "warn", INSPECT: "watch"}
SEVERITY_LEVEL = {"watch": 1, "warn": 2, "urgent": 3}
COOLDOWN = {"urgent": timedelta(days=1), "warn": timedelta(days=3), "watch": timedelta(days=7)}
MAX_COOLDOWN = timedelta(days=14)  # repeats of an unchanged message back off up to this
PERSIST_DAYS = 2  # consecutive actionable daily runs before a non-urgent alert goes out


def top_severity(fields: list[FieldState]) -> str | None:
    sevs = [_ACTION_SEVERITY[a] for f in fields if (a := action_for(f)) is not None]
    return max(sevs, key=SEVERITY_LEVEL.__getitem__) if sevs else None


def body_hash(body: str) -> str:
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


_DATE_TAG = re.compile(r"FarmOS \d{2}[A-Za-z]{3}")  # the "FarmOS 19Sep" date in digest.py's header


def content_hash(body: str) -> str:
    """Hash of the body without its date, so the same message on a new day compares equal."""
    return body_hash(_DATE_TAG.sub("FarmOS", body))


class JsonStateStore:
    """Per-farmer send state (last_sent_at, last_top_severity, last_body_hash, ...) in a JSON file."""

    def __init__(self, path: str | os.PathLike):
        self.path = Path(path)

    def _load(self) -> dict:
        try:
            return json.loads(self.path.read_text())
        except FileNotFoundError:
            return {}

    def _save(self, data: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=self.path.parent, prefix=".state-")
        with os.fdopen(fd, "w") as fh:
            json.dump(data, fh, indent=2)
        os.replace(tmp, self.path)  # atomic

    def get(self, farmer_id: str) -> dict | None:
        return self._load().get(farmer_id)

    def observe(self, farmer_id: str, day: date, severity: str | None, commit: bool = True) -> int:
        """Consecutive days (ending at `day`) with something actionable. Idempotent within a day."""
        data = self._load()
        st = data.get(farmer_id, {})
        if severity is None:
            streak = 0
        elif st.get("last_obs_day") == day.isoformat():
            streak = st.get("streak", 1)
        elif st.get("last_obs_day") == (day - timedelta(days=1)).isoformat():
            streak = st.get("streak", 0) + 1
        else:
            streak = 1
        if commit:
            data.setdefault(farmer_id, {}).update(streak=streak, last_obs_day=day.isoformat())
            self._save(data)
        return streak

    def record(self, farmer_id: str, sent_at: datetime, severity: str, body: str, repeat_count: int = 0) -> None:
        data = self._load()
        data.setdefault(farmer_id, {}).update(
            last_sent_at=sent_at.isoformat(),
            last_top_severity=severity,
            last_body_hash=body_hash(body),
            last_content_hash=content_hash(body),
            repeat_count=repeat_count,
        )
        self._save(data)


@dataclass
class Decision:
    send: bool
    reason: str
    repeat_count: int = 0  # consecutive unchanged repeats sent so far, drives the back-off


def decide(
    state: dict | None,
    severity: str | None,
    body: str,
    now: datetime,
    streak: int = 1,
    persist_days: int = 1,
) -> Decision:
    if severity is None:
        return Decision(False, "no action needed")
    if severity != "urgent" and streak < persist_days:  # urgent is never delayed
        return Decision(False, f"waiting for confirmation ({streak}/{persist_days} days)")
    if state is None or "last_sent_at" not in state:
        return Decision(True, "first digest")
    last = state["last_top_severity"]
    if SEVERITY_LEVEL[severity] > SEVERITY_LEVEL[last]:
        return Decision(True, f"escalated {last} -> {severity}")
    same = content_hash(body) == state.get("last_content_hash")
    repeats = state.get("repeat_count", 0) if same else 0
    cooldown = min(COOLDOWN[severity] * 2**repeats, MAX_COOLDOWN)  # 3d -> 6d -> 12d -> 14d
    age = now - datetime.fromisoformat(state["last_sent_at"])
    if age >= cooldown:
        return Decision(True, f"{cooldown.days}d cooldown elapsed", repeats + 1 if same else 0)
    kind = "same message as last time" if same else "no escalation"
    return Decision(False, f"{kind}, within {cooldown.days}d {severity} cooldown")


# --- Pipeline ----------------------------------------------------------------


@dataclass
class Farmer:
    id: str
    name: str
    fields: list[FieldState]
    phone: str | None = None
    details: dict[str, PlotDetails] = dc_field(default_factory=dict)  # by plot name; carried, not scored


@dataclass
class Outcome:
    farmer: str
    segments: int
    status: str  # "sent" | "suppressed" | "failed" | "dry-run"
    reason: str = ""
    sid: str | None = None

    def line(self) -> str:
        tail = f" ({self.reason})" if self.reason else ""
        return f"{self.farmer}: {self.segments} seg, {self.status}{tail}"


def run_farmers(
    farmers: list[Farmer],
    store: JsonStateStore,
    dry_run: bool = True,
    to_override: str | None = None,
    client=None,
    now: datetime | None = None,
    today: date | None = None,
    sleep: Callable[[float], None] = time.sleep,
    persist_days: int = PERSIST_DAYS,
) -> list[Outcome]:
    """Compose, gate and send one digest per farmer. One farmer's failure never stops the rest."""
    now = now or datetime.now(timezone.utc)
    if not dry_run and client is None:
        client = make_client()  # fail fast, before any farmer is processed

    outcomes: list[Outcome] = []
    for farmer in farmers:
        report = compose_digest_report(farmer.fields, today=today)
        severity = top_severity(farmer.fields)
        streak = store.observe(farmer.id, now.date(), severity, commit=not dry_run)
        decision = decide(store.get(farmer.id), severity, report.text, now, streak, persist_days)

        if not decision.send:
            outcomes.append(Outcome(farmer.name, report.segments, "suppressed", decision.reason))
            continue

        to = to_override or farmer.phone
        try:
            result = send_message(report, to, dry_run, client, sleep)
        except (SendFailed, InvalidPhoneNumber) as exc:
            log.error("Send failed for %s: %s", farmer.name, exc)
            outcomes.append(Outcome(farmer.name, report.segments, "failed", str(exc)))
            continue

        if dry_run:  # never write state in a dry run, or a demo would suppress the real send
            outcomes.append(Outcome(farmer.name, report.segments, "dry-run", f"would send: {decision.reason}"))
        else:
            store.record(farmer.id, now, severity, report.text, decision.repeat_count)
            outcomes.append(Outcome(farmer.name, report.segments, "sent", decision.reason, result.sid))
    return outcomes
