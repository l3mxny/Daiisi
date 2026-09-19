import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

from digest import compose_digest
from from_app import field_from_app, parse_details, plot_from_app, rain_ratio_to_percentile
from send_alerts import load_farmers


def app_response(rain30=4.0, normal=10.0, dry=12, forecast=0.0, ndvi="declining", fallback=False):
    """Shaped like the app's FieldApiResponse (lib/types.ts)."""
    return {
        "weather": {"rain30": rain30, "et030": 120.0, "waterRatio": 0.03, "forecastRain16": forecast,
                    "daysSinceRain": 6, "dryDaysAhead": dry, "heatDays7": 0},
        "stressEvent": {"signature": {"ndviTrend": ndvi, "rain30Normal": normal,
                                      "rainAnomalyRatio": None if normal is None else rain30 / normal}},
        "usedFallback": fallback,
    }


class FromAppTests(unittest.TestCase):
    def test_ratio_mapping_anchors_and_monotonic(self):
        self.assertEqual([rain_ratio_to_percentile(r) for r in (0, 0.5, 0.75, 1.0, 1.5, 2.0, 5.0)],
                         [0, 10, 20, 50, 80, 95, 95])
        vals = [rain_ratio_to_percentile(r / 20) for r in range(0, 60)]
        self.assertEqual(vals, sorted(vals))

    def test_conversion_uses_the_pulled_data(self):
        f = field_from_app("North Plot", app_response(rain30=4.0, normal=10.0, dry=12, forecast=1.5))
        self.assertEqual((f.name, f.rain_30d_mm, f.dry_days_ahead, f.forecast_rain_mm, f.ndvi_trend),
                         ("North Plot", 4.0, 12, 1.5, "falling"))
        self.assertEqual(f.percentile, 8)  # ratio 0.4 -> between 0 and the 0.5 anchor
        self.assertIsNone(f.station_km)
        self.assertIn("1.North Plot very dry IRRIGATE NOW", compose_digest([f], today=date(2026, 9, 19)))

    def test_fallback_ndvi_is_never_trusted(self):
        f = field_from_app("P", app_response(ndvi="declining", fallback=True))
        self.assertEqual(f.ndvi_trend, "stable")

    def test_no_climate_normal_gives_no_percentile_but_still_formats(self):
        f = field_from_app("P", app_response(normal=None, dry=11, ndvi="stable"))
        self.assertIsNone(f.percentile)
        self.assertIn("1.P no rain ahead IRRIGATE 3D", compose_digest([f], today=date(2026, 9, 19)))

    def test_older_response_without_dry_days(self):
        resp = app_response()
        del resp["weather"]["dryDaysAhead"]
        self.assertEqual(field_from_app("P", resp).dry_days_ahead, 0)

    def test_bad_response_is_a_clear_error(self):
        with self.assertRaisesRegex(ValueError, "missing 'weather'"):
            field_from_app("P", {})

    def test_farmers_file_accepts_saved_app_responses(self):
        data = {"farmers": [{"id": "a", "name": "A", "phone": None, "fields": [
            {"name": "Map Plot", "app_response": app_response()},
            {"name": "Manual", "rain_30d_mm": 1, "percentile": 50, "dry_days_ahead": 0,
             "forecast_rain_mm": 0, "ndvi_trend": "stable"},
        ]}]}
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "f.json"
            p.write_text(json.dumps(data))
            farmers = load_farmers(p)
        self.assertEqual([f.name for f in farmers[0].fields], ["Map Plot", "Manual"])
        self.assertEqual(farmers[0].fields[0].percentile, 8)

    def test_details_are_parsed_and_named(self):
        details = {"name": " North Plot ", "crop": "Maize", "plantedOn": "2026-08-01", "soilType": "Sandy"}
        plot = plot_from_app("Plot 1", app_response(), details)
        self.assertEqual(plot.field.name, "North Plot")  # the farmer's own name wins
        self.assertEqual((plot.details.crop, plot.details.soil_type), ("Maize", "Sandy"))
        self.assertEqual(plot.details.days_since_planted(date(2026, 9, 19)), 49)

    def test_details_are_optional(self):
        plot = plot_from_app("Plot 1", app_response(), None)
        self.assertEqual(plot.field.name, "Plot 1")
        self.assertEqual((plot.details.crop, plot.details.planted_on, plot.details.soil_type), ("", None, None))
        self.assertIsNone(plot.details.days_since_planted(date(2026, 9, 19)))
        self.assertEqual(parse_details({"name": "", "crop": "", "plantedOn": None, "soilType": None}), parse_details(None))

    def test_bad_details_are_clear_errors(self):
        with self.assertRaisesRegex(ValueError, "soilType"):
            parse_details({"soilType": "Silt"})
        with self.assertRaisesRegex(ValueError, "plantedOn"):
            parse_details({"plantedOn": "01/08/2026"})

    def test_details_never_change_the_message(self):
        resp = app_response()
        bare = compose_digest([plot_from_app("P", resp, None).field], today=date(2026, 9, 19))
        rich = compose_digest(
            [plot_from_app("P", resp, {"crop": "Kale", "plantedOn": "2026-09-10", "soilType": "Clay"}).field],
            today=date(2026, 9, 19),
        )
        self.assertEqual(bare, rich)

    def test_farmers_file_carries_details(self):
        data = {"farmers": [{"id": "a", "name": "A", "phone": None, "fields": [
            {"name": "Map Plot", "app_response": app_response(),
             "details": {"name": "North Plot", "crop": "Maize", "plantedOn": "2026-08-01", "soilType": "Loam"}},
            {"name": "Manual", "rain_30d_mm": 1, "percentile": 50, "dry_days_ahead": 0,
             "forecast_rain_mm": 0, "ndvi_trend": "stable", "details": {"crop": "Beans"}},
        ]}]}
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "f.json"
            p.write_text(json.dumps(data))
            farmer = load_farmers(p)[0]
        self.assertEqual([f.name for f in farmer.fields], ["North Plot", "Manual"])
        self.assertEqual((farmer.details["North Plot"].crop, farmer.details["Manual"].crop), ("Maize", "Beans"))


if __name__ == "__main__":
    unittest.main()
