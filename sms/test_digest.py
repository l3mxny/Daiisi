import unittest
from datetime import date

from digest import (
    FieldState,
    action_for,
    compose_digest,
    compose_digest_report,
    gsm7_length,
    segment_count,
    stress_score,
    to_gsm7,
)

TODAY = date(2026, 9, 19)


def fs(name="F", pct=50, dry=0, trend="stable", rain=30.0, fc=0.0, km=12.0):
    return FieldState(name, rain, pct, dry, fc, trend, km)


def dry_field(i):
    # i-th field: increasingly wet percentile, all IRRIGATE 3D (pct 11..22 -> 12..20 hit)
    return fs(f"Field{i:02d}", pct=1 + i, dry=8, trend="falling")


class DigestTests(unittest.TestCase):
    def check(self, fields, **kw):
        r = compose_digest_report(fields, today=TODAY, **kw)
        self.assertEqual(to_gsm7(r.text), r.text)  # round-trips unchanged
        self.assertEqual(r.chars, len(r.text))
        return r

    def test_zero_actionable(self):
        r = self.check([fs("A", pct=60), fs("B", pct=45, dry=3)])
        self.assertEqual(r.text, "Good morning! FarmOS 19Sep: all fields OK. No action.")
        self.assertEqual(r.segments, 1)
        self.assertEqual(compose_digest([], today=TODAY), r.text)

    def test_one_actionable(self):
        r = self.check([fs("North Plot", pct=6, dry=12, trend="falling"), fs("B", pct=60)])
        self.assertEqual(
            r.text, "Good morning! FarmOS 19Sep: 1 field needs action.\n1.North Plot very dry IRRIGATE NOW"
        )
        self.assertEqual(r.segments, 1)

    def test_twelve_actionable(self):
        fields = [fs(f"Field{i:02d}", pct=1 + i, dry=8, trend="falling") for i in range(12)]
        fields.reverse()  # input order must not matter
        r = self.check(fields)
        lines = r.text.split("\n")
        self.assertEqual(lines[0], "Good morning! FarmOS 19Sep: 12 fields need action.")
        self.assertEqual(lines[-1], "+9 more.")
        self.assertEqual(len(lines), 1 + 3 + 1)
        # pct<=10 -> NOW tier, driest first
        self.assertEqual(
            [ln.split(" ")[0] for ln in lines[1:4]],
            ["1.Field00", "2.Field01", "3.Field02"],
        )

    def test_tier_order_beats_score(self):
        inspect = fs("Insp", pct=None, dry=0, trend="falling")
        now = fs("Now", pct=10, dry=7, trend="stable")
        lines = compose_digest([inspect, now], today=TODAY).split("\n")
        self.assertTrue(lines[1].endswith("IRRIGATE NOW"))
        self.assertTrue(lines[2].endswith("INSPECT"))

    def test_inspect_led_digest_capped_at_three(self):
        fields = [fs(f"F{i}", pct=None, dry=i, trend="falling") for i in range(6)]
        lines = self.check(fields, max_lines=5).text.split("\n")
        self.assertEqual(len(lines), 1 + 3 + 1)
        self.assertEqual(lines[-1], "+3 more.")

    def test_curly_apostrophe_and_em_dash(self):
        r = self.check([fs("Mom’s Field — East \U0001F33E", pct=5, dry=9)])
        self.assertNotIn("’", r.text)
        self.assertNotIn("—", r.text)
        self.assertTrue(all(ord(c) < 128 for c in r.text))
        self.assertEqual(r.segments, 1)  # not UCS-2 / not blown up
        self.assertLessEqual(gsm7_length(r.text), 160)
        self.assertIn("1.Mom's Field - East very dry IRRIGATE NOW", r.text)

    def test_percentile_none(self):
        base = dict(dry=12, trend="falling")
        with_station = fs("Backed", pct=30, **base)
        no_station = fs("Unbacked", pct=None, **base)
        self.assertLess(stress_score(no_station), stress_score(with_station))
        r = self.check([no_station])
        self.assertIn("1.Unbacked no rain ahead IRRIGATE 3D", r.text)
        both = compose_digest([no_station, with_station], today=TODAY).split("\n")
        self.assertIn("Backed", both[1])
        self.assertIn("Unbacked", both[2])

    def test_full_name_not_truncated(self):
        r = self.check([fs("Old Mill Road North Plot", pct=5, dry=9)])
        self.assertIn("1.Old Mill Road North Plot very dry", r.text)

    def test_inspect_reason_is_crops_fading(self):
        r = self.check([fs("Back Forty", pct=None, dry=0, trend="falling")])
        self.assertIn("crops fading INSPECT", r.text)

    def test_score_ordering(self):
        bad = fs(pct=6, dry=12, trend="falling")
        mild = fs(pct=40, dry=2, trend="stable")
        self.assertGreater(stress_score(bad), 3 * stress_score(mild))
        self.assertLess(stress_score(fs(trend="rising")), stress_score(fs(trend="stable")))
        self.assertEqual(stress_score(fs(dry=16)), stress_score(fs(dry=30)))  # cap

    def test_actions(self):
        self.assertEqual(action_for(fs(pct=10, dry=7)), "IRRIGATE NOW")
        self.assertEqual(action_for(fs(pct=10, dry=6)), "IRRIGATE 3D")
        self.assertEqual(action_for(fs(pct=None, dry=10)), "IRRIGATE 3D")
        self.assertEqual(action_for(fs(pct=40, trend="falling")), "INSPECT")
        self.assertIsNone(action_for(fs(pct=40, dry=9, trend="stable")))

    def test_to_gsm7(self):
        self.assertEqual(to_gsm7("a–b—c“q” ‘s’ 20°C…"), "a-b-c\"q\" 's' 20C...")
        self.assertEqual(to_gsm7("x\r\ny❤z"), "x\r\nyz")

    def test_multi_segment_reported(self):
        long_text = "a" * 161
        self.assertEqual(segment_count(long_text), 2)
        self.assertEqual(segment_count("a" * 160), 1)
        self.assertEqual(segment_count("a" * 306), 2)
        self.assertEqual(segment_count("{" * 80), 1)  # extension chars cost 2
        self.assertEqual(segment_count("{" * 81), 2)


if __name__ == "__main__":
    unittest.main()
