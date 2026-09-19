"""Demo: watch the FarmOS text change over a scripted 10-day dry spell.

Uses the real digest, ranking and send-gating code, with a fake clock. Nothing is sent and no
credentials or network are needed.

    python3 demo_timeline.py --step          # press Enter to advance a day (best for a live demo)
    python3 demo_timeline.py --delay 1.5     # auto-advance every 1.5 seconds
    python3 demo_timeline.py                 # print the whole story at once
"""

from __future__ import annotations

import argparse
import tempfile
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from digest import FieldState, compose_digest_report
from sender import PERSIST_DAYS, JsonStateStore, decide, top_severity

# (field name, percentile, dry days ahead, ndvi trend) per field, per day.
STORY: list[tuple[str, list[tuple[str, int | None, int, str]]]] = [
    ("Everything healthy", [("North Plot", 55, 1, "stable"), ("Riverside", 60, 2, "stable"), ("Back Forty", 48, 2, "stable")]),
    ("Back Forty's crops start to dip (first sighting)", [("North Plot", 50, 2, "stable"), ("Riverside", 55, 3, "stable"), ("Back Forty", 45, 3, "falling")]),
    ("Still dipping: confirmed", [("North Plot", 42, 4, "stable"), ("Riverside", 40, 4, "stable"), ("Back Forty", 42, 4, "falling")]),
    ("Riverside turns dry", [("North Plot", 30, 5, "stable"), ("Riverside", 18, 6, "stable"), ("Back Forty", 40, 5, "falling")]),
    ("No change since yesterday", [("North Plot", 25, 6, "stable"), ("Riverside", 17, 7, "stable"), ("Back Forty", 39, 6, "falling")]),
    ("North Plot becomes critical", [("North Plot", 9, 8, "falling"), ("Riverside", 16, 8, "stable"), ("Back Forty", 38, 7, "falling")]),
    ("Still critical: reminder", [("North Plot", 8, 9, "falling"), ("Riverside", 15, 9, "stable"), ("Back Forty", 37, 8, "falling")]),
    ("Still critical: reminder held back", [("North Plot", 7, 10, "falling"), ("Riverside", 14, 10, "stable"), ("Back Forty", 36, 9, "falling")]),
    ("Rain arrives", [("North Plot", 32, 0, "stable"), ("Riverside", 24, 0, "stable"), ("Back Forty", 36, 0, "falling")]),
    ("Recovering", [("North Plot", 45, 0, "rising"), ("Riverside", 40, 0, "rising"), ("Back Forty", 44, 0, "stable")]),
]


def bubble(text: str, meta: str) -> str:
    lines = text.split("\n")
    width = max(len(ln) for ln in lines + [meta])
    edge = "+" + "-" * (width + 2) + "+"
    body = [f"| {ln.ljust(width)} |" for ln in lines]
    return "\n".join([edge, *body, f"| {meta.ljust(width)} |", edge])


def run(start: date, persist_days: int, step: bool, delay: float) -> list[bool]:
    sent_days: list[bool] = []
    with tempfile.TemporaryDirectory() as tmp:
        store = JsonStateStore(Path(tmp) / "state.json")
        for i, (headline, rows) in enumerate(STORY):
            day = start + timedelta(days=i)
            now = datetime(day.year, day.month, day.day, 7, 0, tzinfo=timezone.utc)
            fields = [FieldState(n, 20.0, p, dry, 0.0, ndvi, 8.0) for n, p, dry, ndvi in rows]
            report = compose_digest_report(fields, today=day)
            severity = top_severity(fields)
            streak = store.observe("sam", day, severity)
            decision = decide(store.get("sam"), severity, report.text, now, streak, persist_days)
            if decision.send:
                store.record("sam", now, severity, report.text, decision.repeat_count)

            print(f"\n=== Day {i + 1} - {day:%a %d %b}: {headline} ===")
            print("   (rain rank: low = drier than usual for the month)")
            for n, p, dry, ndvi in rows:
                print(f"   {n:<11} rain rank {p if p is not None else '--':>3}/100   {dry:>2}d without rain ahead   crops {ndvi}")
            if decision.send:
                print(f"\n   TEXT SENT ({decision.reason})")
                print(bubble(report.text, f"{report.chars} chars, {report.segments} segment(s)"))
            else:
                print(f"\n   no text today: {decision.reason}")
            sent_days.append(decision.send)

            if step and i < len(STORY) - 1:
                input("\n   [Enter for next day] ")
            elif delay and i < len(STORY) - 1:
                time.sleep(delay)
    print(f"\n{sum(sent_days)} texts over {len(STORY)} days.")
    return sent_days


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--step", action="store_true", help="wait for Enter between days")
    ap.add_argument("--delay", type=float, default=0.0, help="seconds between days")
    ap.add_argument("--start", type=date.fromisoformat, default=date(2026, 9, 19))
    ap.add_argument("--persist-days", type=int, default=PERSIST_DAYS)
    args = ap.parse_args()
    run(args.start, args.persist_days, args.step, args.delay)


if __name__ == "__main__":
    main()
