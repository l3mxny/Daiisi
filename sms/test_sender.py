import contextlib
import io
import os
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

from twilio.base.exceptions import TwilioRestException

import sender
from digest import FieldState
from sender import (
    Farmer,
    InvalidPhoneNumber,
    JsonStateStore,
    SendFailed,
    run_farmers,
    send_digest,
    validate_e164,
)

T0 = datetime(2026, 9, 19, 8, 0, tzinfo=timezone.utc)
TODAY = date(2026, 9, 19)
TO = "+254712345678"
FROM_ENV = {"TWILIO_ACCOUNT_SID": "ACtest", "TWILIO_AUTH_TOKEN": "secret-token", "TWILIO_FROM_NUMBER": "+15550001111"}


def fs(name, pct, dry, trend="stable"):
    return FieldState(name, 10.0, pct, dry, 0.0, trend, 5.0)


URGENT = [fs("North Plot", 6, 12, "falling")]  # IRRIGATE NOW
WARN = [fs("Riverside", 14, 3)]  # IRRIGATE 3D
WATCH = [fs("Back Forty", 40, 0, "falling")]  # INSPECT
QUIET = [fs("Wet Meadow", 85, 0, "rising")]


def ok_client(sid="SM1"):
    client = MagicMock()
    client.messages.create.return_value.sid = sid
    return client


def twilio_error(code, status=400):
    return TwilioRestException(status, "/Messages", f"error {code}", code=code)


class SenderTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.store = JsonStateStore(os.path.join(tmp.name, "state.json"))
        env = patch.dict(os.environ, FROM_ENV)
        env.start()
        self.addCleanup(env.stop)

    def run_once(self, farmers, client, now=T0, persist_days=1, **kw):
        return run_farmers(farmers, self.store, dry_run=False, to_override=TO, client=client,
                           now=now, today=TODAY, sleep=lambda s: None, persist_days=persist_days, **kw)

    # --- dry run -----------------------------------------------------------

    def test_dry_run_makes_no_client_call_and_needs_no_credentials(self):
        client = ok_client()
        out = io.StringIO()
        with patch.dict(os.environ, {}, clear=True), patch.object(sender, "make_client") as mk, \
                contextlib.redirect_stdout(out):
            result = send_digest(URGENT, TO, client=client, today=TODAY)  # dry_run defaults to True
        client.messages.create.assert_not_called()
        mk.assert_not_called()
        self.assertTrue(result.dry_run)
        self.assertIsNone(result.sid)
        printed = out.getvalue()
        self.assertIn(result.body, printed)
        self.assertIn(f"{result.chars} chars, {result.segments} segment(s)", printed)

    def test_dry_run_pipeline_writes_no_state(self):
        with contextlib.redirect_stdout(io.StringIO()):
            outs = run_farmers([Farmer("a", "A", URGENT)], self.store, now=T0, today=TODAY)
        self.assertEqual(outs[0].status, "dry-run")
        self.assertIsNone(self.store.get("a"))

    # --- E.164 -------------------------------------------------------------

    def test_non_e164_rejected_before_any_api_call(self):
        client = ok_client()
        for bad in ("0712345678", "254712345678", "+1 555 123 4567", "+", "", None):
            with self.assertRaises(InvalidPhoneNumber):
                send_digest(URGENT, bad, dry_run=False, client=client, today=TODAY)
        client.messages.create.assert_not_called()
        self.assertEqual(validate_e164("+254712345678"), "+254712345678")

    def test_send_returns_sid_and_body_sent(self):
        client = ok_client("SM42")
        result = send_digest(URGENT, TO, dry_run=False, client=client, today=TODAY)
        self.assertEqual(result.sid, "SM42")
        client.messages.create.assert_called_once_with(body=result.body, from_="+15550001111", to=TO)

    def test_bad_number_for_one_farmer_does_not_stop_the_rest(self):
        client = ok_client()
        farmers = [Farmer("a", "A", URGENT, phone="0712345678"), Farmer("b", "B", URGENT, phone=TO)]
        outs = run_farmers(farmers, self.store, dry_run=False, client=client, now=T0,
                           today=TODAY, sleep=lambda s: None)
        self.assertEqual([o.status for o in outs], ["failed", "sent"])
        self.assertEqual(client.messages.create.call_count, 1)

    # --- gating ------------------------------------------------------------

    def test_repeat_within_cooldown_is_suppressed(self):
        client = ok_client()
        farmers = [Farmer("a", "A", WARN)]
        self.assertEqual(self.run_once(farmers, client)[0].status, "sent")
        outs = self.run_once(farmers, client, now=T0 + timedelta(days=2, hours=23))
        self.assertEqual(outs[0].status, "suppressed")
        self.assertIn("3d warn cooldown", outs[0].reason)
        self.assertEqual(client.messages.create.call_count, 1)

    def test_cooldown_lengths_by_severity(self):
        for fields, days in ((URGENT, 1), (WARN, 3), (WATCH, 7)):
            with self.subTest(days=days):
                store = JsonStateStore(self.store.path.with_name(f"s{days}.json"))
                client = ok_client()
                farmers = [Farmer("a", "A", fields)]
                kw = dict(dry_run=False, to_override=TO, client=client, today=TODAY, sleep=lambda s: None, persist_days=1)
                run_farmers(farmers, store, now=T0, **kw)
                early = run_farmers(farmers, store, now=T0 + timedelta(days=days) - timedelta(minutes=1), **kw)
                late = run_farmers(farmers, store, now=T0 + timedelta(days=days), **kw)
                self.assertEqual(early[0].status, "suppressed")
                self.assertEqual(late[0].status, "sent")

    def test_escalation_overrides_cooldown(self):
        client = ok_client()
        self.run_once([Farmer("a", "A", WATCH)], client)
        outs = self.run_once([Farmer("a", "A", URGENT)], client, now=T0 + timedelta(hours=1))
        self.assertEqual(outs[0].status, "sent")
        self.assertIn("escalated watch -> urgent", outs[0].reason)
        self.assertEqual(client.messages.create.call_count, 2)
        self.assertEqual(self.store.get("a")["last_top_severity"], "urgent")

    def test_no_actionable_fields_sends_nothing(self):
        client = ok_client()
        outs = self.run_once([Farmer("a", "A", QUIET)], client)
        self.assertEqual((outs[0].status, outs[0].reason), ("suppressed", "no action needed"))
        client.messages.create.assert_not_called()

    def test_state_has_the_three_fields(self):
        self.run_once([Farmer("a", "A", WARN)], ok_client())
        self.assertTrue({"last_sent_at", "last_top_severity", "last_body_hash"} <= set(self.store.get("a")))

    def test_non_urgent_needs_two_consecutive_days(self):
        client = ok_client()
        farmers = [Farmer("a", "A", WARN)]
        day1 = self.run_once(farmers, client, persist_days=2)
        self.assertEqual((day1[0].status, day1[0].reason), ("suppressed", "waiting for confirmation (1/2 days)"))
        self.assertEqual(self.run_once(farmers, client, persist_days=2, now=T0 + timedelta(hours=2))[0].status, "suppressed")  # same day, not a 2nd day
        day2 = self.run_once(farmers, client, persist_days=2, now=T0 + timedelta(days=1))
        self.assertEqual(day2[0].status, "sent")
        self.assertEqual(client.messages.create.call_count, 1)

    def test_gap_day_resets_the_streak(self):
        client = ok_client()
        self.run_once([Farmer("a", "A", WARN)], client, persist_days=2)
        self.run_once([Farmer("a", "A", QUIET)], client, persist_days=2, now=T0 + timedelta(days=1))
        outs = self.run_once([Farmer("a", "A", WARN)], client, persist_days=2, now=T0 + timedelta(days=2))
        self.assertEqual(outs[0].status, "suppressed")
        self.assertEqual(client.messages.create.call_count, 0)

    def test_urgent_is_never_delayed(self):
        outs = self.run_once([Farmer("a", "A", URGENT)], ok_client(), persist_days=2)
        self.assertEqual(outs[0].status, "sent")

    def test_unchanged_repeats_back_off(self):
        client = ok_client()
        farmers = [Farmer("a", "A", WARN)]
        sent = [d for d in range(0, 20) if self.run_once(farmers, client, now=T0 + timedelta(days=d))[0].status == "sent"]
        self.assertEqual(sent, [0, 3, 9])  # 3d, then 6d, then 12d gaps

    # --- errors ------------------------------------------------------------

    def test_21608_caught_and_loop_continues(self):
        client = MagicMock()
        client.messages.create.side_effect = [twilio_error(21608), MagicMock(sid="SM2")]
        farmers = [Farmer("a", "A", URGENT), Farmer("b", "B", URGENT)]
        with self.assertLogs("farmos.sms", "ERROR") as logs:
            outs = self.run_once(farmers, client)
        self.assertEqual([o.status for o in outs], ["failed", "sent"])
        self.assertIn("not verified", outs[0].reason)
        self.assertIn("21608", "".join(logs.output))
        self.assertNotIn("secret-token", "".join(logs.output))
        self.assertNotIn("last_sent_at", self.store.get("a"))  # failed sends are retried next run
        self.assertIsNotNone(self.store.get("b"))

    def test_specific_error_messages(self):
        for code, needle in ((21211, "invalid"), (21610, "unsubscribed")):
            client = MagicMock()
            client.messages.create.side_effect = twilio_error(code)
            outs = self.run_once([Farmer(f"f{code}", "F", URGENT)], client)
            self.assertEqual(outs[0].status, "failed")
            self.assertIn(needle, outs[0].reason)
            self.assertEqual(client.messages.create.call_count, 1)  # 4xx is not retried

    def test_retry_once_on_5xx_then_succeed(self):
        client = MagicMock()
        client.messages.create.side_effect = [twilio_error(20500, 503), MagicMock(sid="SM3")]
        sleeps = []
        result = send_digest(URGENT, TO, dry_run=False, client=client, today=TODAY, sleep=sleeps.append)
        self.assertEqual(result.sid, "SM3")
        self.assertEqual(client.messages.create.call_count, 2)
        self.assertEqual(len(sleeps), 1)

    def test_give_up_after_one_retry(self):
        client = MagicMock()
        client.messages.create.side_effect = twilio_error(20500, 500)
        with self.assertRaises(SendFailed):
            send_digest(URGENT, TO, dry_run=False, client=client, today=TODAY, sleep=lambda s: None)
        self.assertEqual(client.messages.create.call_count, 2)

    def test_retry_on_network_timeout(self):
        import requests

        client = MagicMock()
        client.messages.create.side_effect = [requests.exceptions.Timeout(), MagicMock(sid="SM4")]
        result = send_digest(URGENT, TO, dry_run=False, client=client, today=TODAY, sleep=lambda s: None)
        self.assertEqual(result.sid, "SM4")

    def test_missing_credentials_fail_fast(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(sender.ConfigError):
                run_farmers([Farmer("a", "A", URGENT)], self.store, dry_run=False, now=T0)


if __name__ == "__main__":
    unittest.main()
