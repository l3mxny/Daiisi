// The accuracy guard on the AI take. The two "bad" texts are real answers the model gave for this app's own
// data: it rounded 18.5 mm to 20, called 110 what was 108.76, and said "15% below normal" when rain was
// 19% of normal (81% below).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { allowedNumbers, checkAnswer, groundedFallback, ungroundedNumbers, verdictConflict } from "../lib/ai/grounding.ts";

const event = (over = {}) => ({
  id: "e", fieldId: "f", fieldName: "test9/19", crop: "maize", weekStart: "2026-09-20", severity: "ok",
  waterRatio: 0.17009930121368153, rain30: 18.5, et030: 108.76, forecastRain16: 173.8, heatDays7: 0,
  rain30Normal: 99.9, rainAnomalyRatio: 0.18513885, ndviMean: 0.9167525917, ndviDelta: 0.0689, ndviTrend: "improving",
  cloudCover: 17.46, daysSinceClear: 2, seasonalOutlook: null, summary: "", aiRecommendation: null, ...over,
});

const BAD = "**No action needed right now.** The field has received 20 mm of rain in the past 30 days, replacing only 18 % of the 110 mm evapotranspiration, and is still 15 % below the 5-year average for this period. However, a forecast of 173 mm of rain in the next 16 days will likely replenish the deficit. NDVI is 0.917 and improving.";
const GOOD = "**No action needed right now.** Rain was 18.5 mm against 108.76 mm of crop water use (17%), which is 81% below normal, but 173.8 mm is forecast in the next 16 days. NDVI is 0.917 and rising.";

describe("figures in the AI take", () => {
  it("catches the rounded and inverted figures the model really produced", () => {
    const bad = ungroundedNumbers(BAD, allowedNumbers(event(), [], []));
    assert.deepEqual(bad.sort((a, b) => a - b), [15, 20, 110]);
  });

  it("accepts an answer that uses the given figures, including the ratio as a percentage and the gap to normal", () => {
    assert.deepEqual(ungroundedNumbers(GOOD, allowedNumbers(event(), [], [])), []);
  });

  it("does not treat dates as figures, and figures in the farmer's own notes count as given", () => {
    const notes = [{ detail: "irrigated 40 mm on Tuesday" }];
    assert.deepEqual(ungroundedNumbers("Since 2026-09-17 you added 40 mm.", allowedNumbers(event(), [], notes)), []);
    assert.deepEqual(ungroundedNumbers("You added 45 mm.", allowedNumbers(event(), [], notes)), [45]);
  });
});

describe("the verdict", () => {
  it("the priority line cannot say the opposite of the rules", () => {
    assert.match(verdictConflict("**No action needed right now.** All fine.", "act"), /verdict is ACT/);
    assert.match(verdictConflict("High priority — irrigate within 2 days.", "ok"), /verdict is OK/);
    assert.equal(verdictConflict("No action needed right now.", "ok"), null);
    assert.equal(verdictConflict("High priority — irrigate within 2 days.", "act"), null);
    assert.equal(verdictConflict("Keep an eye on it.", "watch"), null);
  });
});

describe("checkAnswer and the fallback", () => {
  it("flags the bad answer and passes the good one", () => {
    assert.ok(checkAnswer(BAD, event(), [], []));
    assert.equal(checkAnswer(GOOD, event(), [], []), null);
  });

  it("the plain text built from the data always passes its own check", () => {
    for (const severity of ["ok", "watch", "act"]) {
      for (const e of [event({ severity }), event({ severity, ndviMean: null, ndviTrend: "unknown", rain30: 0, et030: 182.31, forecastRain16: 5.93 })]) {
        assert.equal(checkAnswer(groundedFallback(e), e, [], []), null, severity);
      }
    }
    assert.match(groundedFallback(event({ severity: "act" })), /^\*\*Act now\.\*\*/);
  });
});

describe("the farmer's own details", () => {
  it("the crop's age counts as a given figure, so 'planted 63 days ago' is not flagged", async () => {
    const { cropAgeDays } = await import("../lib/ai/grounding.ts");
    const planted = new Date(Date.now() - 63 * 86_400_000).toISOString().slice(0, 10);
    assert.equal(cropAgeDays(planted), 63);
    assert.equal(cropAgeDays(null), null);
    assert.equal(cropAgeDays("2999-01-01"), null, "a date in the future is not an age");
    const e = event({ plantedOn: planted });
    assert.deepEqual(ungroundedNumbers("The maize is about 9 weeks old, planted 63 days ago.", allowedNumbers(e, [], [])), []);
    assert.deepEqual(ungroundedNumbers("The maize is 40 days old.", allowedNumbers(e, [], [])), [40]);
  });
});

describe("causal claims about past weeks", () => {
  it("flags certainty and cause, allows plain description of what happened", async () => {
    const { causalClaim } = await import("../lib/ai/grounding.ts");
    assert.ok(causalClaim("Similar conditions last year recovered without irrigation, so hold off."));
    assert.ok(causalClaim("Irrigation worked last time, so irrigate now."));
    assert.ok(causalClaim("This proves the field will recover."));
    assert.equal(causalClaim("In a similar week last time the field improved."), null);
    assert.equal(causalClaim("Rain of 89.5 mm is forecast, and NDVI is 0.917 and improving."), null);
  });
});

describe("invented actions in past weeks", () => {
  it("flags 'improved after irrigation' unless a past record actually mentions irrigation", async () => {
    const { causalClaim } = await import("../lib/ai/grounding.ts");
    const none = [{ summary: "Maize field: ACT. Rainfall replaced 17% of water lost.", verdict: "improved" }];
    const logged = [{ summary: "Farmer irrigated. Rainfall replaced 17% of water lost.", verdict: "improved" }];
    assert.ok(causalClaim("In a similar week last year the field improved after irrigation.", none));
    assert.ok(causalClaim("Similar deficits improved with irrigation.", none));
    assert.equal(causalClaim("In a similar week last year the field improved after irrigation.", logged), null);
    assert.equal(causalClaim("In a similar week last year the field improved.", none), null);
  });
});

describe("when the farmer's actions happened", () => {
  it("'irrigated today' is flagged unless a note is dated today", async () => {
    const { staleTimeClaim } = await import("../lib/ai/grounding.ts");
    const old = [{ eventDate: "2026-09-17" }];
    assert.ok(staleTimeClaim("The field has just been irrigated today and NDVI is up.", old, "2026-09-20"));
    assert.ok(staleTimeClaim("Today you irrigated the north plot.", old, "2026-09-20"));
    assert.equal(staleTimeClaim("The field has just been irrigated today.", [{ eventDate: "2026-09-20" }], "2026-09-20"), null);
    assert.equal(staleTimeClaim("You irrigated 3 days ago. Rain is forecast today.", old, "2026-09-20"), null);
  });
});
