import { NextRequest, NextResponse } from "next/server";
import { createIntervention, listInterventionsForStressEvent } from "@/db/interventions";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  if (!body || typeof body.stressEventId !== "string" || typeof body.action !== "string" || !body.action.trim()) {
    return NextResponse.json({ error: "stressEventId and action are required" }, { status: 400 });
  }

  const intervention = await createIntervention({
    stressEventId: body.stressEventId,
    action: body.action,
    notes: typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null,
  });

  return NextResponse.json(intervention);
}

export async function GET(req: NextRequest) {
  const stressEventId = req.nextUrl.searchParams.get("stressEventId");
  if (!stressEventId) {
    return NextResponse.json({ error: "stressEventId query param is required" }, { status: 400 });
  }
  const interventions = await listInterventionsForStressEvent(stressEventId);
  return NextResponse.json(interventions);
}
