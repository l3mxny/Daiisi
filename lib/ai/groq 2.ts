const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

// A reasoning model — most of the token budget can go to its internal
// reasoning trace before it writes an answer. A low max_tokens truncates it
// mid-thought with empty content; reasoning_effort: "low" keeps that trace
// short so a modest token budget is still enough for the actual answer.
const MODEL = "openai/gpt-oss-20b";
const MAX_TOKENS = 700;

export async function generateText(systemPrompt: string, userPrompt: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set");
  }

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: MAX_TOKENS,
      reasoning_effort: "low",
      temperature: 0.4,
    }),
  });

  if (!res.ok) {
    throw new Error(`Groq request failed: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  const content: string | undefined = json.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`Groq returned no content (finish_reason: ${json.choices?.[0]?.finish_reason})`);
  }
  return content.trim();
}
