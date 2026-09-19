"""Replay historical weather + NDVI day by day through the real digest and gating logic.

No waiting, no network, no credentials: each historical day is a simulated "morning run"
that sees only data available up to that day, and the same decide()/compose code the live
sender uses decides whether a text would have gone out.

    python3 simulate.py                       # uses ../fixtures/*.json
    python3 simulate.py --quiet               # only the messages and the summary

Simplifications (see the printed notes): no ISD station history exists in the fixtures, so
percentile is None; the "forecast" is the actual weather that followed (a perfect forecast).
"""

from __future__ import annotations

import argparse
import itertools
import json
import math
import statistics
import tempfile
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from digest import FieldState, compose_digest_report
from sender import PERSIST_DAYS, Decision, JsonStateStore, decide, top_severity

FIXTURES = Path(__file__).parent.parent / "fixtures"
RAIN_WINDOW = 30  # days of observed rain needed before a day can be simulated
FORECAST_WINDOW = 16
DRY_MM = 1.0  # a day under this counts as dry
NDVI_WINDOW = 14  # days of satellite passes used for the trend
NDVI_STALE = 10  # newest clear pass older than this -> no NDVI signal
NDVI_DELTA = 0.03  # net change over the window needed to call falling / rising


def load_precip(path: Path) -> dict[date, float | None]:
    daily = json.loads(path.read_text())["daily"]
    return {date.fromisoformat(t): p for t, p in zip(daily["time"], daily["precipitation_sum"])}


def load_ndvi(path: Path) -> dict[date, float]:
    """Clear-sky NDVI means by scene date; cloud-blocked scenes are dropped."""
    out: dict[date, float] = {}
    for item in json.loads(path.read_text())["data"]:
        outputs = item.get("outputs")
        if not outputs:
            continue
        stats = outputs["ndvi"]["bands"]["B0"]["stats"]
        try:
            mean = float(stats["mean"])  # Sentinel Hub sends the string "NaN" for cloud-blocked scenes
        except (TypeError, ValueError):
            continue
        if math.isnan(mean) or stats["noDataCount"] >= stats["sampleCount"]:
            continue
        out[date.fromisoformat(item["interval"]["from"][:10])] = mean
    return out


def ndvi_trend(day: date, ndvi: dict[date, float]) -> str:
    """Robust slope over the last NDVI_WINDOW days of clear passes (median of pairwise slopes,
    so one odd reading can't tilt it). 'stable' when data is thin or stale."""
    obs = sorted((d, v) for d, v in ndvi.items() if 0 <= (day - d).days < NDVI_WINDOW)
    if len(obs) < 3 or (day - obs[-1][0]).days > NDVI_STALE:
        return "stable"
    slope = statistics.median((v2 - v1) / (d2 - d1).days for (d1, v1), (d2, v2) in itertools.combinations(obs, 2))
    change = slope * NDVI_WINDOW
    if change <= -NDVI_DELTA:
        return "falling"
    return "rising" if change >= NDVI_DELTA else "stable"


def field_state(day: date, precip: dict[date, float | None], ndvi: dict[date, float], name: str) -> FieldState | None:
    """What the morning run on `day` would know. None if there isn't 30 days of rain history yet."""
    past = [precip.get(day - timedelta(d)) for d in range(1, RAIN_WINDOW + 1)]
    if any(p is None for p in past):
        return None
    ahead = [precip.get(day + timedelta(d)) for d in range(FORECAST_WINDOW)]
    dry = 0
    for p in ahead:
        if p is None or p >= DRY_MM:
            break
        dry += 1
    forecast = sum(p for p in ahead if p is not None)
    return FieldState(name, sum(past), None, dry, forecast, ndvi_trend(day, ndvi), None)


@dataclass
class Row:
    day: date
    field: FieldState
    severity: str | None
    decision: Decision
    body: str
    segments: int


def simulate(
    precip: dict[date, float | None], ndvi: dict[date, float], name: str = "Plot", persist_days: int = PERSIST_DAYS
) -> list[Row]:
    first, last = min(precip), max(precip) - timedelta(days=FORECAST_WINDOW - 1)
    rows: list[Row] = []
    with tempfile.TemporaryDirectory() as tmp:
        store = JsonStateStore(Path(tmp) / "state.json")
        day = first
        while day <= last:
            fs = field_state(day, precip, ndvi, name)
            if fs is not None:
                now = datetime(day.year, day.month, day.day, 8, tzinfo=timezone.utc)
                report = compose_digest_report([fs], today=day)
                sev = top_severity([fs])
                streak = store.observe("sim", day, sev)
                decision = decide(store.get("sim"), sev, report.text, now, streak, persist_days)
                if decision.send:
                    store.record("sim", now, sev, report.text, decision.repeat_count)
                rows.append(Row(day, fs, sev, decision, report.text, report.segments))
            day += timedelta(days=1)
    return rows


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--weather", type=Path, default=FIXTURES / "weather-sample.json")
    ap.add_argument("--ndvi", type=Path, default=FIXTURES / "ndvi-sample.json")
    ap.add_argument("--name", default="Plot")
    ap.add_argument("--persist-days", type=int, default=PERSIST_DAYS, help="consecutive days before a non-urgent alert")
    ap.add_argument("--quiet", action="store_true", help="skip the day-by-day table")
    args = ap.parse_args(argv)

    rows = simulate(load_precip(args.weather), load_ndvi(args.ndvi), args.name, args.persist_days)
    if not rows:
        print("Not enough history to simulate (need 30 days of observed rain).")
        return

    if not args.quiet:
        print(f"{'date':<11}{'rain30':>7}{'dry':>5}  {'ndvi':<8}{'top':<8}decision")
        for r in rows:
            f = r.field
            verdict = ("SEND: " if r.decision.send else "-- ") + r.decision.reason
            print(f"{r.day}{f.rain_30d_mm:6.1f}mm{f.dry_days_ahead:4d}d  {f.ndvi_trend:<8}{r.severity or '-':<8}{verdict}")

    sent = [r for r in rows if r.decision.send]
    print(f"\n=== Messages that would have been sent ({len(sent)}) ===")
    for r in sent:
        print(f"\n[{r.day}] {r.decision.reason} ({r.segments} seg)\n{r.body}")

    actionable = [r for r in rows if r.severity]
    flips = sum(1 for a, b in zip(rows, rows[1:]) if a.severity != b.severity)
    print(f"\n=== Summary: {rows[0].day} to {rows[-1].day} ({len(rows)} days) ===")
    print(f"days with something actionable: {len(actionable)}")
    print(f"texts sent with gating:         {len(sent)}  (naive 'text every actionable day' = {len(actionable)})")
    print(f"days the top severity changed:  {flips}  (high = flapping around a threshold)")
    print("notes: percentile is None (no station history in fixtures); forecast = actual weather that followed.")


if __name__ == "__main__":
    main()
