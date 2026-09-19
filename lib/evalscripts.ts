// Sentinel-2 L2A evalscripts. Kept as plain strings since they're shipped
// verbatim in Process/Statistics request bodies (see fixtures/*.json).

export const TRUE_COLOR_EVALSCRIPT = `//VERSION=3
function setup() { return { input: ["B02","B03","B04"], output: { bands: 3 } }; }
function evaluatePixel(s) { return [s.B04 * 2.5, s.B03 * 2.5, s.B02 * 2.5]; }`;

// Masks SCL 3 (cloud shadow), 8 (cloud medium prob), 9 (cloud high prob),
// 10 (thin cirrus), 11 (snow/ice) and paints those pixels fully transparent
// (alpha 0) instead of black, so the basemap shows through instead of a
// black square over masked-out areas.
export const NDVI_COLOR_EVALSCRIPT = `//VERSION=3
function setup() {
  return {
    input: ["B04", "B08", "SCL", "dataMask"],
    output: { bands: 4 }
  };
}

var ramp = [
  [-1.0, [139, 69, 19]],
  [0.0, [206, 184, 139]],
  [0.2, [255, 255, 191]],
  [0.4, [217, 239, 139]],
  [0.6, [102, 189, 99]],
  [0.8, [26, 152, 80]],
  [1.0, [0, 90, 50]]
];

function colorize(ndvi) {
  for (var i = 0; i < ramp.length - 1; i++) {
    var v0 = ramp[i][0], c0 = ramp[i][1];
    var v1 = ramp[i + 1][0], c1 = ramp[i + 1][1];
    if (ndvi >= v0 && ndvi <= v1) {
      var t = (ndvi - v0) / (v1 - v0);
      return [
        c0[0] + t * (c1[0] - c0[0]),
        c0[1] + t * (c1[1] - c0[1]),
        c0[2] + t * (c1[2] - c0[2])
      ];
    }
  }
  return ndvi < ramp[0][0] ? ramp[0][1] : ramp[ramp.length - 1][1];
}

function evaluatePixel(s) {
  var badSCL = [3, 8, 9, 10, 11].indexOf(s.SCL) !== -1;
  var masked = s.dataMask !== 1 || badSCL;
  if (masked) {
    return [0, 0, 0, 0];
  }
  var ndvi = (s.B08 - s.B04) / (s.B08 + s.B04 + 1e-6);
  ndvi = Math.max(-1, Math.min(1, ndvi));
  var rgb = colorize(ndvi);
  return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, 1];
}`;

// Statistics API: NDVI mean/stats over time, masking the same SCL classes.
// Note the evalscript lives nested inside `aggregation`, not top-level
// (unlike Process), and outputs an `ndvi` band plus a `dataMask` band used
// by the API to compute sampleCount/noDataCount.
export const NDVI_STATS_EVALSCRIPT = `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B04", "B08", "SCL", "dataMask"] }],
    output: [
      { id: "ndvi", bands: 1, sampleType: "FLOAT32" },
      { id: "dataMask", bands: 1 }
    ]
  };
}
function evaluatePixel(s) {
  var bad = [3, 8, 9, 10, 11].indexOf(s.SCL) !== -1;
  return {
    ndvi: [(s.B08 - s.B04) / (s.B08 + s.B04)],
    dataMask: [(s.dataMask === 1 && !bad) ? 1 : 0]
  };
}`;
