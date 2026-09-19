import json
d = json.load(open("fixtures/ndvi-sample.json"))
for i in d["data"]:
    day = i["interval"]["from"][:10]
    out = i.get("outputs")
    if not out:
        print(day, "no outputs")
        continue
    s = out["ndvi"]["bands"]["B0"]["stats"]
    print(day, "mean:", s["mean"], "| sd:", s["stDev"], "| n:", s.get("sampleCount"), "| nodata:", s.get("noDataCount"))
