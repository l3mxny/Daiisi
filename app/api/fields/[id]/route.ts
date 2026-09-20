import { NextRequest, NextResponse } from "next/server";
import { deleteField } from "@/db/fields";
import { normalizePhone } from "@/lib/phone";

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/fields/[id]">) {
  const { id } = await ctx.params;
  const phone = normalizePhone(req.nextUrl.searchParams.get("phone") ?? "");
  if (!phone) {
    return NextResponse.json({ error: "A valid phone query param is required" }, { status: 400 });
  }

  const deleted = await deleteField(id, phone);
  if (!deleted) {
    return NextResponse.json({ error: "Field not found for this phone number" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
