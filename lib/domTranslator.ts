import {
  cachedTranslation,
  chunkStrings,
  rememberTranslations,
  requestTranslations,
  shouldTranslate,
  splitPadding,
  type TargetLanguage,
} from "./autoTranslate";

// Translates the text already on the page, in place, and keeps translating as the app adds more
// (results loading, panels opening). The components are not touched: their English text is swapped
// for the translation, and the English original is remembered so we can swap it back.
//
// Skipped on purpose: anything inside translate="no" (the SMS preview, language names), the map,
// SVG charts, code, inputs, and pure numbers or dates.

export type TranslationStatus = "idle" | "translating" | "done" | "error";

const ATTRIBUTES = ["placeholder", "title", "aria-label", "alt"];
const SKIP = '[translate="no"], .notranslate, .leaflet-container, svg, script, style, noscript, textarea, code, pre, [contenteditable="true"]';
const DEBOUNCE_MS = 250;
const MAX_PASSES = 3;

// The English text of every node we touch, and what we last wrote, so a change made by React
// (new English text) can be told apart from our own edits.
const originalText = new WeakMap<Text, string>();
const appliedText = new WeakMap<Text, string>();
const originalAttr = new WeakMap<Element, Map<string, string>>();
const appliedAttr = new WeakMap<Element, Map<string, string>>();

type Item =
  | { kind: "text"; node: Text; english: string }
  | { kind: "attr"; element: Element; name: string; english: string };

function isSkipped(element: Element | null): boolean {
  return element === null || element.closest(SKIP) !== null;
}

function collect(root: HTMLElement): Item[] {
  const items: Item[] = [];

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (isSkipped(node.parentElement)) continue;
    const raw = node.nodeValue ?? "";
    // If the node still holds our translation, its English original is what we saved; otherwise
    // React has written fresh English text and that is the new original.
    const english = appliedText.get(node) === raw && originalText.has(node) ? originalText.get(node)! : raw;
    originalText.set(node, english);
    if (shouldTranslate(english)) items.push({ kind: "text", node, english });
  }

  const selector = ATTRIBUTES.map((a) => `[${a}]`).join(",");
  for (const element of root.querySelectorAll(selector)) {
    if (isSkipped(element)) continue;
    for (const name of ATTRIBUTES) {
      const raw = element.getAttribute(name);
      if (raw === null) continue;
      const applied = appliedAttr.get(element)?.get(name);
      const saved = originalAttr.get(element)?.get(name);
      const english = applied === raw && saved !== undefined ? saved : raw;
      if (!originalAttr.has(element)) originalAttr.set(element, new Map());
      originalAttr.get(element)!.set(name, english);
      if (shouldTranslate(english)) items.push({ kind: "attr", element, name, english });
    }
  }
  return items;
}

function apply(items: Item[], target: TargetLanguage): void {
  for (const item of items) {
    const translated = cachedTranslation(target, splitPadding(item.english).core);
    if (translated === undefined) continue;
    if (item.kind === "text") {
      const { lead, trail } = splitPadding(item.english);
      const value = lead + translated + trail;
      item.node.nodeValue = value;
      appliedText.set(item.node, value);
    } else {
      item.element.setAttribute(item.name, translated);
      if (!appliedAttr.has(item.element)) appliedAttr.set(item.element, new Map());
      appliedAttr.get(item.element)!.set(item.name, translated);
    }
  }
}

// Puts the original English back on everything we translated.
export function restoreEnglish(): void {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const original = originalText.get(node);
    if (original !== undefined && appliedText.get(node) === node.nodeValue) node.nodeValue = original;
  }
  const selector = ATTRIBUTES.map((a) => `[${a}]`).join(",");
  for (const element of document.body.querySelectorAll(selector)) {
    for (const name of ATTRIBUTES) {
      const applied = appliedAttr.get(element)?.get(name);
      const original = originalAttr.get(element)?.get(name);
      if (applied !== undefined && original !== undefined && element.getAttribute(name) === applied) {
        element.setAttribute(name, original);
      }
    }
  }
}

export function startDomTranslator(target: TargetLanguage, onStatus: (status: TranslationStatus) => void) {
  let stopped = false;
  let failed = false;
  let running = false;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const observer = new MutationObserver(() => {
    if (!failed) schedule();
  });

  function schedule(delay = DEBOUNCE_MS) {
    clearTimeout(timer);
    timer = setTimeout(run, delay);
  }

  async function pass(): Promise<void> {
    for (let i = 0; i < MAX_PASSES && !stopped; i++) {
      const items = collect(document.body);
      const needed = [...new Set(items.map((it) => splitPadding(it.english).core))].filter(
        (text) => cachedTranslation(target, text) === undefined
      );
      if (needed.length > 0) {
        onStatus("translating");
        for (const chunk of chunkStrings(needed)) {
          if (stopped) return;
          rememberTranslations(target, chunk, await requestTranslations(target, chunk));
        }
      }
      if (stopped) return;
      // The page may have changed while we waited, so apply to a fresh look at it.
      apply(collect(document.body), target);
      observer.takeRecords(); // our own edits are not new content
      if (needed.length === 0) return;
    }
  }

  async function run() {
    if (stopped) return;
    if (running) {
      dirty = true;
      return;
    }
    running = true;
    try {
      await pass();
      if (!stopped) onStatus("done");
    } catch {
      failed = true; // don't retry on every page change; a new language pick starts fresh
      if (!stopped) onStatus("error");
    } finally {
      running = false;
      if (dirty && !stopped && !failed) {
        dirty = false;
        schedule();
      }
    }
  }

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ATTRIBUTES,
  });
  setTimeout(() => {
    if (!stopped) onStatus("translating");
  }, 0);
  schedule(0);

  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
      observer.disconnect();
    },
  };
}
