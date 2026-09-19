"""SMS digest formatter for FarmOS.

Pure functions: field data in, SMS-ready string out. No network, no SMS provider.
The output is guaranteed GSM-7 (never UCS-2) and reports its segment count.
"""

from __future__ import annotations

import math
import unicodedata
from dataclasses import dataclass
from datetime import date
from typing import NamedTuple

# --- GSM-7 -------------------------------------------------------------------

# GSM 03.38 basic character set (ESC 0x1B omitted; it only introduces extensions).
_GSM7_BASIC = frozenset(
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?"
    "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"
)
# Extension table: valid GSM-7, but each costs 2 septets (ESC + char).
_GSM7_EXT = frozenset("^{}\\[~]|€\f")

_TYPOGRAPHIC = str.maketrans(
    {
        "—": "-",  # em dash
        "–": "-",  # en dash
        "−": "-",  # minus sign
        "‘": "'",
        "’": "'",
        "‚": "'",
        "‛": "'",
        "“": '"',
        "”": '"',
        "„": '"',
        "…": "...",  # ellipsis
        " ": " ",  # nbsp
        "°": "",  # degree symbol: strip
    }
)

SINGLE_SEGMENT = 160
MULTI_SEGMENT = 153  # concatenated segments lose 7 septets to the UDH


def _in_gsm7(ch: str) -> bool:
    return ch in _GSM7_BASIC or ch in _GSM7_EXT


def to_gsm7(text: str) -> str:
    """Map typographic characters to ASCII, then drop anything outside GSM-7."""
    out: list[str] = []
    for ch in text.translate(_TYPOGRAPHIC):
        if _in_gsm7(ch):
            out.append(ch)
            continue
        # Fold unsupported accented letters (ç -> c); drops emoji and the rest.
        folded = unicodedata.normalize("NFKD", ch)
        folded = "".join(c for c in folded if not unicodedata.combining(c))
        out.extend(c for c in folded if _in_gsm7(c))
    return "".join(out)


def gsm7_length(text: str) -> int:
    """Length in septets (extension characters count double)."""
    return sum(2 if ch in _GSM7_EXT else 1 for ch in text)


def segment_count(text: str) -> int:
    """SMS segments needed for text. Text must already be GSM-7."""
    n = gsm7_length(text)
    if n == 0:
        return 0
    return 1 if n <= SINGLE_SEGMENT else math.ceil(n / MULTI_SEGMENT)


# --- Input -------------------------------------------------------------------


@dataclass
class FieldState:
    name: str  # farmer's label, e.g. "North Plot"
    rain_30d_mm: float  # observed 30-day rainfall
    percentile: int | None  # percentile of that total at nearest reliable ISD station
    dry_days_ahead: int  # consecutive forecast days with <1mm rain
    forecast_rain_mm: float  # total forecast rain over the window
    ndvi_trend: str  # "falling" | "stable" | "rising"
    station_km: float | None = None  # distance to the ISD station used; not used in scoring


# --- Ranking -----------------------------------------------------------------

W_PERCENTILE = 40.0  # max contribution, at the 0th percentile
W_DRY_DAYS = 30.0  # max contribution, at >= DRY_DAYS_CAP dry days
DRY_DAYS_CAP = 16
NDVI_POINTS = {"falling": 25.0, "stable": 0.0, "rising": -5.0}
NO_STATION_FACTOR = 0.7  # less confident without a station -> scale down


def stress_score(f: FieldState) -> float:
    """Continuous stress score; higher = more stressed."""
    score = 0.0
    if f.percentile is not None:
        gap = max(0, 50 - f.percentile) / 50  # only the gap below the median counts
        score += W_PERCENTILE * gap
    score += W_DRY_DAYS * min(max(f.dry_days_ahead, 0), DRY_DAYS_CAP) / DRY_DAYS_CAP
    score += NDVI_POINTS.get(f.ndvi_trend, 0.0)
    if f.percentile is None:
        score *= NO_STATION_FACTOR
    return score


# --- Actions -----------------------------------------------------------------

IRRIGATE_NOW = "IRRIGATE NOW"
IRRIGATE_3D = "IRRIGATE 3D"
INSPECT = "INSPECT"

_TIER = {IRRIGATE_NOW: 0, IRRIGATE_3D: 1, INSPECT: 2}


def action_for(f: FieldState) -> str | None:
    p = f.percentile
    if p is not None and p <= 10 and f.dry_days_ahead >= 7:
        return IRRIGATE_NOW
    if f.dry_days_ahead >= 10 or (p is not None and p <= 20):
        return IRRIGATE_3D
    if f.ndvi_trend == "falling":
        return INSPECT
    return None


# --- Digest ------------------------------------------------------------------

_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
DEFAULT_MAX_LINES = 3
MAX_LINES_LOW_URGENCY = 3
DEFAULT_GREETING = "Good morning!"


class DigestResult(NamedTuple):
    text: str
    chars: int
    segments: int


def _clean_name(name: str) -> str:
    return " ".join(to_gsm7(name).split())  # collapse newlines/tabs inside a name


def _reason(f: FieldState, action: str) -> str:
    """One plain-words reason; the exact numbers live in the app."""
    if action == INSPECT:
        return "crops fading"
    if f.percentile is not None and f.percentile <= 10:
        return "very dry"
    if f.percentile is not None and f.percentile <= 20:
        return "dry"
    return "no rain ahead"


def _date_tag(d: date) -> str:
    return f"{d.day:02d}{_MONTHS[d.month - 1]}"


def compose_digest_report(
    fields: list[FieldState],
    max_lines: int = DEFAULT_MAX_LINES,
    today: date | None = None,
    greeting: str = DEFAULT_GREETING,
) -> DigestResult:
    """Build the digest and report its character and segment counts."""
    tag = _date_tag(today or date.today())
    hello = f"{greeting} " if greeting else ""
    actionable = [(f, a) for f in fields if (a := action_for(f)) is not None]

    if not actionable:
        text = to_gsm7(f"{hello}FarmOS {tag}: all fields OK. No action.")
        return DigestResult(text, len(text), segment_count(text))

    # Most urgent tier first, then by continuous score within the tier.
    actionable.sort(key=lambda fa: (_TIER[fa[1]], -stress_score(fa[0])))

    # Noise control: a digest led by INSPECT is low urgency, keep it short.
    if actionable[0][1] == INSPECT:
        max_lines = min(max_lines, MAX_LINES_LOW_URGENCY)

    shown = actionable[:max_lines]
    n = len(actionable)
    lines = [f"{hello}FarmOS {tag}: {n} field{'s' if n != 1 else ''} need{'' if n != 1 else 's'} action."]
    for rank, (f, action) in enumerate(shown, 1):
        lines.append(f"{rank}.{_clean_name(f.name)} {_reason(f, action)} {action}")
    if n > len(shown):
        lines.append(f"+{n - len(shown)} more.")

    text = to_gsm7("\n".join(lines))
    return DigestResult(text, len(text), segment_count(text))


def compose_digest(
    fields: list[FieldState],
    max_lines: int = DEFAULT_MAX_LINES,
    today: date | None = None,
    greeting: str = DEFAULT_GREETING,
) -> str:
    return compose_digest_report(fields, max_lines, today, greeting).text
