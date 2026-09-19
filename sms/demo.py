from datetime import date

from digest import FieldState, action_for, compose_digest_report, stress_score

F = FieldState
fields = [
    F("North Plot", 4.0, 6, 12, 0.0, "falling", 8.0),
    F("Riverside", 12.0, 14, 8, 2.0, "stable", 15.0),
    F("South Acres", 20.0, None, 11, 1.0, "stable", None),
    F("East Street", 25.0, 19, 5, 6.0, "stable", 20.0),
    F("Back Forty", 40.0, None, 0, 0.0, "falling", None),
    F("Mild Field", 45.0, 40, 2, 9.0, "stable", 10.0),
    F("Wet Meadow", 90.0, 85, 0, 30.0, "rising", 9.0),
    F("Mom’s Field — West", 8.0, 9, 9, 0.0, "falling", 11.0),
]

print(f"{'field':<22}{'score':>7}  action")
for f in sorted(fields, key=stress_score, reverse=True):
    print(f"{f.name.encode('ascii', 'replace').decode():<22}{stress_score(f):7.1f}  {action_for(f)}")

r = compose_digest_report(fields, today=date(2026, 9, 19))
print()
print(r.text)
print(f"\n[{r.chars} chars, {r.segments} segment(s)]")
