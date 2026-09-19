"""Compose the FarmOS SMS digest per farmer and print it (default) or send it.

    python send_alerts.py --dry-run                     (default; no network, no credentials)
    python send_alerts.py --send --to +15551234567      (real send; needs TWILIO_* env vars)

Credentials are read from environment variables only. To use .env.local:
    set -a; source ../.env.local; set +a
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from digest import FieldState
from from_app import field_from_app
from sender import PERSIST_DAYS, ConfigError, Farmer, InvalidPhoneNumber, JsonStateStore, run_farmers, validate_e164

HERE = Path(__file__).parent


def load_field(entry: dict) -> FieldState:
    """A plot is either explicit FieldState keys or {"name": ..., "app_response": <saved /api/field JSON>}."""
    if "app_response" in entry:
        return field_from_app(entry["name"], entry["app_response"])
    return FieldState(**entry)


def load_farmers(path: Path) -> list[Farmer]:
    data = json.loads(path.read_text())
    return [
        Farmer(
            id=f["id"],
            name=f["name"],
            phone=f.get("phone"),
            fields=[load_field(fs) for fs in f["fields"]],
        )
        for f in data["farmers"]
    ]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="print only (default)")
    mode.add_argument("--send", action="store_true", help="really send through Twilio")
    ap.add_argument("--to", help="E.164 number; overrides every farmer's phone (dev testing)")
    ap.add_argument("--persist-days", type=int, default=PERSIST_DAYS, help="consecutive days before a non-urgent alert")
    ap.add_argument("--input", type=Path, default=HERE / "farmers.sample.json")
    ap.add_argument("--state", type=Path, default=HERE / ".digest_state.json")
    args = ap.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    dry_run = not args.send
    try:
        if args.to:
            validate_e164(args.to)
        farmers = load_farmers(args.input)
        outcomes = run_farmers(farmers, JsonStateStore(args.state), dry_run=dry_run, to_override=args.to, persist_days=args.persist_days)
    except (InvalidPhoneNumber, ConfigError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    print("\nSummary" + (" (dry run, nothing sent)" if dry_run else ""))
    for o in outcomes:
        print("  " + o.line())
    return 1 if any(o.status == "failed" for o in outcomes) else 0


if __name__ == "__main__":
    sys.exit(main())
