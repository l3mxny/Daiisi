import { NextRequest, NextResponse } from "next/server";
import { retrieveSimilarEvents } from "@/lib/retrieval";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/stress-events/[id]/similar">) {
  const { id } = await ctx.params;
  const k = Number(req.nextUrl.searchParams.get("k") ?? 3);
  const evidence = await retrieveSimilarEvents(id, Number.isFinite(k) ? k : 3);
  return NextResponse.json(evidence);
}
