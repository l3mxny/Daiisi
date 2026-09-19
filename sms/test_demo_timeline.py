import contextlib
import io
import unittest
from datetime import date

from demo_timeline import run


class DemoTimelineTests(unittest.TestCase):
    def test_story_sends_on_the_expected_days(self):
        with contextlib.redirect_stdout(io.StringIO()):
            sent = run(date(2026, 9, 19), persist_days=2, step=False, delay=0)
        days = [i + 1 for i, s in enumerate(sent) if s]
        self.assertEqual(days, [3, 4, 6, 7])  # confirmed dip, escalation to warn, urgent, urgent reminder


if __name__ == "__main__":
    unittest.main()
