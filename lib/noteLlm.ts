// Groq chat completion, used only to pull a field name, event type and date phrase out of one spoken
// sentence. Server-side only; the key never reaches the browser. Same provider and default model as the
// AI recommendation feature, so there is one vendor to manage.

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-20b";
const MAX_TOKENS = 700; // a reasoning model spends part of this thinking before it answers
const DEFAULT_TIMEOUT_MS = 12_000;

export type LlmCall = (system: string, user: string) => Promise<string>;

// Throws on any failure. The caller treats every failure the same way (fall back to a plain observation),
// so the messages are for logs and never contain the key or the response body.
export async function groqComplete(
  system: string,
  user: string,
  options: { apiKey: string; model?: string; fetchImpl?: typeof fetch; timeoutMs?: number }
): Promise<string> {
  const model = options.model ?? DEFAULT_GROQ_MODEL;
  const res = await (options.fetchImpl ?? fetch)(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0,
      max_tokens: MAX_TOKENS,
      // Only the gpt-oss models take this; it keeps their hidden reasoning short.
      ...(model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {}),
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Groq request failed: ${res.status}`);
  const json: unknown = await res.json().catch(() => null);
  const content = (json as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "") throw new Error("Groq returned no content");
  return content.trim();
}
