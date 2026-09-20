// String similarity for matching a name the farmer SAID against the names of their fields. Speech
// recognition mangles names ("north plot" -> "North Platte", "east strip" -> "e strip"), so this needs to be
// forgiving. It is the same measure as Python's difflib.SequenceMatcher.ratio() (Ratcliff/Obershelp), so
// scores mean the same as difflib.get_close_matches, which the design was written against.

export function normalizeName(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Number of matching characters: the longest common block, plus recursively the matches on each side of it.
function matchingCharacters(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;
  let best = 0;
  let endA = 0;
  let endB = 0;
  let previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const current = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        current[j] = previous[j - 1] + 1;
        if (current[j] > best) {
          best = current[j];
          endA = i;
          endB = j;
        }
      }
    }
    previous = current;
  }
  if (best === 0) return 0;
  return (
    best +
    matchingCharacters(a.slice(0, endA - best), b.slice(0, endB - best)) +
    matchingCharacters(a.slice(endA), b.slice(endB))
  );
}

// 0 (nothing in common) to 1 (identical), after lower-casing and dropping punctuation.
export function similarity(a: string, b: string): number {
  const x = normalizeName(a);
  const y = normalizeName(b);
  const total = x.length + y.length;
  if (total === 0) return 1;
  return (2 * matchingCharacters(x, y)) / total;
}

// Candidates scoring at least `cutoff`, best first (like difflib.get_close_matches).
export function closeMatches<T>(word: string, candidates: T[], label: (item: T) => string, cutoff = 0.6): Array<{ item: T; score: number }> {
  return candidates
    .map((item) => ({ item, score: similarity(word, label(item)) }))
    .filter((m) => m.score >= cutoff)
    .sort((a, b) => b.score - a.score);
}
