import { NextResponse } from "next/server";
import { generateAiRecommendation } from "@/lib/ai/recommendation";
import { retrieveSimilarEvents } from "@/lib/retrieval";

// Satellite, weather and AI calls can be slow on a cold start; Vercel cuts a function off at this many seconds.
export const maxDuration = 60;

export async function GET(_req: Request, ctx: RouteContext<"/api/stress-events/[id]/recommendation">) {
  const { id } = await ctx.params;
  try {
    // Evidence is fetched independently of whether the recommendation text
    // itself was cached, so the UI always has something to show for "based
    // on N similar past situations" even on a repeat view.
    const [recommendation, evidence] = await Promise.all([generateAiRecommendation(id), retrieveSimilarEvents(id, 3)]);
    return NextResponse.json({ recommendation, evidence });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[recommendation] failed:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
