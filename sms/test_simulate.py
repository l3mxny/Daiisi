import unittest
from datetime import date, timedelta

from simulate import FORECAST_WINDOW, RAIN_WINDOW, field_state, ndvi_trend, simulate

D0 = date(2026, 7, 1)


def precip_series(days, mm=0.0):
    return {D0 + timedelta(d): mm for d in range(days)}


class SimulateTests(unittest.TestCase):
    def test_needs_full_rain_history(self):
        precip = precip_series(RAIN_WINDOW + FORECAST_WINDOW + 5)
        self.assertIsNone(field_state(D0 + timedelta(RAIN_WINDOW - 1), precip, {}, "P"))
        self.assertIsNotNone(field_state(D0 + timedelta(RAIN_WINDOW), precip, {}, "P"))

    def test_ndvi_after_the_day_is_never_used(self):
        day = D0 + timedelta(20)
        past = {day - timedelta(d): 0.6 - 0.01 * (12 - d) for d in (12, 8, 4, 0)}  # falling
        self.assertEqual(ndvi_trend(day, past), "falling")
        future = {**past, day + timedelta(1): 0.9}  # tomorrow's scene must not change today
        self.assertEqual(ndvi_trend(day, future), "falling")

    def test_thin_or_stale_ndvi_gives_no_signal(self):
        day = D0 + timedelta(30)
        self.assertEqual(ndvi_trend(day, {day: 0.5, day - timedelta(3): 0.6}), "stable")  # < 3 passes
        stale = {day - timedelta(d): 0.4 + 0.02 * d for d in (13, 12, 11)}  # newest is 11 days old
        self.assertEqual(ndvi_trend(day, stale), "stable")

    def test_one_odd_reading_does_not_make_a_trend(self):
        day = D0 + timedelta(30)
        obs = {day - timedelta(12): 0.49, day - timedelta(9): 0.48, day - timedelta(5): 0.51,
               day - timedelta(2): 0.40, day: 0.49}  # one low dip, then back to normal
        self.assertEqual(ndvi_trend(day, obs), "stable")

    def test_constant_dry_spell_backs_off_3_6_12_days(self):
        precip = precip_series(RAIN_WINDOW + 20 + FORECAST_WINDOW)  # all dry -> IRRIGATE 3D every day
        rows = simulate(precip, {}, persist_days=1)
        self.assertEqual(len(rows), 21)
        sent = [(r.day - rows[0].day).days for r in rows if r.decision.send]
        self.assertEqual(sent, [0, 3, 9])  # gaps of 3d then 6d; the 12d gap lands past the window

    def test_persistence_delays_the_first_non_urgent_send_a_day(self):
        precip = precip_series(RAIN_WINDOW + 20 + FORECAST_WINDOW)
        rows = simulate(precip, {})  # default persist_days=2
        self.assertEqual([(r.day - rows[0].day).days for r in rows if r.decision.send], [1, 4, 10])
        self.assertIn("waiting for confirmation", rows[0].decision.reason)

    def test_simulation_writes_no_state_outside_temp(self):
        rows = simulate(precip_series(RAIN_WINDOW + FORECAST_WINDOW), {})
        self.assertTrue(rows)  # ran without touching the real state file or the network


if __name__ == "__main__":
    unittest.main()
