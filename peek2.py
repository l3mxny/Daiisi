import json, datetime
d = json.load(open("fixtures/weather-sample.json"))["daily"]
today = datetime.date.today().isoformat()
past = [(t, p, e) for t, p, e in zip(d["time"], d["precipitation_sum"], d["et0_fao_evapotranspiration"]) if t < today]
fut  = [(t, p) for t, p in zip(d["time"], d["precipitation_sum"]) if t >= today]
last30 = past[-30:]
print("30d rain:", round(sum(p for _, p, _ in last30), 1), "mm")
print("30d ET0: ", round(sum(e for _, _, e in last30), 1), "mm")
print("deficit: ", round(sum(p - e for _, p, e in last30), 1), "mm")
print("16d rain:", round(sum(p for _, p in fut), 1), "mm")
