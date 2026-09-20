import { NextResponse } from "next/server";
import { generateAiRecommendation } from "@/lib/ai/recommendation";

export async function GET(_req: Request, ctx: RouteContext<"/api/stress-events/[id]/recommendation">) {
  const { id } = await ctx.params;
  try {
    const recommendation = await generateAiRecommendation(id);
    return NextResponse.json({ recommendation });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[recommendation] failed:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
