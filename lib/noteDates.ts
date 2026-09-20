// Turns the date words a farmer SAID ("yesterday", "Tuesday", "last week", "May 12") into a real date,
// relative to when the note was CAPTURED, not when it happened to be processed. Done in code rather than
// by the language model, which is unreliable at date arithmetic; the model only picks out the phrase.
// Everything works on plain calendar dates (no time zones), in the farmer's local time.

export interface CalendarDate {
  year: number;
  month: number; // 1-12
  day: number;
}

const DAY_MS = 86_400_000;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

export function toIso(d: CalendarDate): string {
  return `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

function toUtcMs(d: CalendarDate): number {
  return Date.UTC(d.year, d.month - 1, d.day);
}

function fromUtcMs(ms: number): CalendarDate {
  const date = new Date(ms);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export function addDays(d: CalendarDate, days: number): CalendarDate {
  return fromUtcMs(toUtcMs(d) + days * DAY_MS);
}

function weekdayOf(d: CalendarDate): number {
  return new Date(toUtcMs(d)).getUTCDay(); // 0 = Sunday
}

function isRealDate(d: CalendarDate): boolean {
  const check = fromUtcMs(toUtcMs(d));
  return check.year === d.year && check.month === d.month && check.day === d.day;
}

// The farmer's local calendar date at the moment of capture. `tzOffsetMinutes` is JavaScript's
// Date.getTimezoneOffset() from the browser (minutes UTC is ahead of local time; 240 for US Eastern in summer).
export function captureDate(capturedAtIso: string, tzOffsetMinutes: number): CalendarDate {
  const utcMs = new Date(capturedAtIso).getTime();
  return fromUtcMs(utcMs - tzOffsetMinutes * 60_000);
}

export function weekdayName(d: CalendarDate): string {
  return WEEKDAYS[weekdayOf(d)].replace(/^./, (c) => c.toUpperCase());
}

export interface ResolvedDate {
  date: CalendarDate;
  assumed: boolean; // true when nothing usable was spoken and `today` was filled in
}

export function resolveSpokenDate(text: string | null | undefined, today: CalendarDate): ResolvedDate {
  const assumeToday: ResolvedDate = { date: today, assumed: true };
  if (!text || !text.trim()) return assumeToday;
  const t = text.toLowerCase().replace(/[.,!?]/g, " ").replace(/\s+/g, " ").trim();

  const iso = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const d = { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
    if (isRealDate(d)) return { date: d, assumed: false };
  }

  if (/\bday before yesterday\b/.test(t)) return { date: addDays(today, -2), assumed: false };
  if (/\b(yesterday|last night)\b/.test(t)) return { date: addDays(today, -1), assumed: false };
  if (/\b(today|this morning|this afternoon|this evening|tonight|earlier today)\b/.test(t)) return { date: today, assumed: false };

  const ago = t.match(/\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+(day|days|week|weeks)\s+ago\b/);
  if (ago) {
    const n = /^\d+$/.test(ago[1]) ? Number(ago[1]) : NUMBER_WORDS[ago[1]];
    return { date: addDays(today, -n * (ago[2].startsWith("week") ? 7 : 1)), assumed: false };
  }
  if (/\blast week\b/.test(t)) return { date: addDays(today, -7), assumed: false };

  const weekday = t.match(new RegExp(`\\b(last\\s+)?(${WEEKDAYS.join("|")})\\b`));
  if (weekday) {
    let back = (weekdayOf(today) - WEEKDAYS.indexOf(weekday[2]) + 7) % 7; // most recent one on or before today
    if (weekday[1] && back === 0) back = 7; // "last Tuesday", said on a Tuesday, is a week ago
    return { date: addDays(today, -back), assumed: false };
  }

  // "May 12", "May 12th", "12 May", "the 12th of May" (a month spelled out or abbreviated to three letters)
  const monthPattern = MONTHS.map((m) => `${m}|${m.slice(0, 3)}${m === "september" ? "|sept" : ""}`).join("|");
  const monthFirst = t.match(new RegExp(`\\b(${monthPattern})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`));
  const dayFirst = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${monthPattern})\\b`));
  const parts = monthFirst ? { month: monthFirst[1], day: monthFirst[2] } : dayFirst ? { month: dayFirst[2], day: dayFirst[1] } : null;
  if (parts) {
    const month = MONTHS.findIndex((m) => m.startsWith(parts.month.slice(0, 3))) + 1;
    let candidate: CalendarDate = { year: today.year, month, day: Number(parts.day) };
    if (isRealDate(candidate)) {
      // A month/day that hasn't happened yet this year must mean last year (notes describe the past).
      if (toUtcMs(candidate) > toUtcMs(today) + DAY_MS) candidate = { ...candidate, year: today.year - 1 };
      if (isRealDate(candidate)) return { date: candidate, assumed: false };
    }
  }

  return assumeToday;
}
