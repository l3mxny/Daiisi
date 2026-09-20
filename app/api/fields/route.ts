import { NextRequest, NextResponse } from "next/server";
import { upsertField, listFieldsByPhone } from "@/db/fields";
import { normalizePhone } from "@/lib/phone";
import type { Bbox } from "@/lib/geo";

function isValidBbox(value: unknown): value is Bbox {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((n) => typeof n === "number" && Number.isFinite(n)) &&
    value[0] < value[2] &&
    value[1] < value[3]
  );
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const phone = typeof body?.phone === "string" ? normalizePhone(body.phone) : null;

  if (
    !body ||
    !phone ||
    typeof body.id !== "string" ||
    typeof body.name !== "string" ||
    !body.name.trim() ||
    !isValidBbox(body.bbox)
  ) {
    return NextResponse.json({ error: "phone, id, name, and bbox are required" }, { status: 400 });
  }

  const field = await upsertField({
    id: body.id,
    phone,
    name: body.name,
    crop: typeof body.crop === "string" ? body.crop : "",
    soilType: typeof body.soilType === "string" ? body.soilType : null,
    plantedOn: typeof body.plantedOn === "string" ? body.plantedOn : null,
    bbox: body.bbox,
  });

  return NextResponse.json(field);
}

export async function GET(req: NextRequest) {
  const phone = normalizePhone(req.nextUrl.searchParams.get("phone") ?? "");
  if (!phone) {
    return NextResponse.json({ error: "A valid phone query param is required" }, { status: 400 });
  }
  const fields = await listFieldsByPhone(phone);
  return NextResponse.json(fields);
}
