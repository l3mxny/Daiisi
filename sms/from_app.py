"""Turn the FarmOS app's /api/field response for a map plot into an SMS-ready FieldState.

Everything here comes from the data the app pulled for that location (Open-Meteo weather,
Sentinel-2 NDVI); nothing is hard-coded per plot. Shape reference: lib/types.ts (FieldApiResponse).
"""

from __future__ import annotations

from digest import FieldState

# The app has no station percentile, only rain30 / (5-year normal) = rainAnomalyRatio. The digest
# logic speaks percentiles, so map the ratio onto a percentile-like number. The anchors line up
# with the app's own thresholds (0.5 = "well below normal"); the number itself is never shown
# to the farmer, it only selects "very dry" / "dry" and feeds the ranking score.
_RATIO_TO_PERCENTILE = [(0.0, 0), (0.5, 10), (0.75, 20), (1.0, 50), (1.5, 80), (2.0, 95)]

_NDVI_TREND = {"declining": "falling", "improving": "rising"}  # "stable"/"unknown" -> "stable"


def rain_ratio_to_percentile(ratio: float) -> int:
    """Piecewise-linear map of rain/normal onto 0-95. Monotonic and continuous."""
    if ratio <= 0:
        return 0
    for (x0, y0), (x1, y1) in zip(_RATIO_TO_PERCENTILE, _RATIO_TO_PERCENTILE[1:]):
        if ratio <= x1:
            return round(y0 + (y1 - y0) * (ratio - x0) / (x1 - x0))
    return _RATIO_TO_PERCENTILE[-1][1]


def field_from_app(label: str, response: dict) -> FieldState:
    """Build a FieldState from one /api/field JSON response, using `label` as the plot name."""
    try:
        weather = response["weather"]
        signature = response["stressEvent"]["signature"]
        rain30 = weather["rain30"]
        forecast = weather["forecastRain16"]
    except KeyError as exc:
        raise ValueError(f"App response for {label!r} is missing {exc}") from exc

    ratio = signature.get("rainAnomalyRatio")  # None when no climate normal was available
    percentile = None if ratio is None else rain_ratio_to_percentile(ratio)

    # When Sentinel fails the app swaps in fixture NDVI from a different place. Never act on it.
    trend = "stable" if response.get("usedFallback") else _NDVI_TREND.get(signature.get("ndviTrend"), "stable")

    # Older responses predate dryDaysAhead; 0 means "no dry spell claimed".
    dry_days = int(weather.get("dryDaysAhead", 0))

    return FieldState(label, rain30, percentile, dry_days, forecast, trend)
