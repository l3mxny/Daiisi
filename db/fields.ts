import { getDb } from "./index";
import type { Bbox } from "@/lib/geo";

export interface FieldRow {
  id: string;
  phone: string;
  name: string;
  crop: string;
  soilType: string | null;
  plantedOn: string | null;
  bbox: Bbox;
  createdAt: string;
}

function toFieldRow(row: {
  id: string;
  phone: string;
  name: string;
  crop: string;
  soil_type: string | null;
  planted_on: string | null;
  bbox_west: number;
  bbox_south: number;
  bbox_east: number;
  bbox_north: number;
  created_at: string;
}): FieldRow {
  return {
    id: row.id,
    phone: row.phone,
    name: row.name,
    crop: row.crop,
    soilType: row.soil_type,
    plantedOn: row.planted_on,
    bbox: [row.bbox_west, row.bbox_south, row.bbox_east, row.bbox_north],
    createdAt: row.created_at,
  };
}

// Upsert on the client-generated plot id, since the field may already exist
// (e.g. saving again after editing its bbox/details before a real "update"
// flow exists). phone is only set on insert — re-saving never reassigns
// ownership of an existing field.
export async function upsertField(input: {
  id: string;
  phone: string;
  name: string;
  crop: string;
  soilType: string | null;
  plantedOn: string | null;
  bbox: Bbox;
}): Promise<FieldRow> {
  const db = getDb();
  const [west, south, east, north] = input.bbox;
  const { rows } = await db.query(
    `INSERT INTO fields (id, phone, name, crop, soil_type, planted_on, bbox_west, bbox_south, bbox_east, bbox_north)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       crop = EXCLUDED.crop,
       soil_type = EXCLUDED.soil_type,
       planted_on = EXCLUDED.planted_on,
       bbox_west = EXCLUDED.bbox_west,
       bbox_south = EXCLUDED.bbox_south,
       bbox_east = EXCLUDED.bbox_east,
       bbox_north = EXCLUDED.bbox_north
     RETURNING *`,
    [input.id, input.phone, input.name, input.crop, input.soilType, input.plantedOn, west, south, east, north]
  );
  return toFieldRow(rows[0]);
}

// Used by the weekly background job, which iterates every farmer's fields.
export async function listFields(): Promise<FieldRow[]> {
  const db = getDb();
  const { rows } = await db.query("SELECT * FROM fields ORDER BY created_at ASC");
  return rows.map(toFieldRow);
}

export async function listFieldsByPhone(phone: string): Promise<FieldRow[]> {
  const db = getDb();
  const { rows } = await db.query("SELECT * FROM fields WHERE phone = $1 ORDER BY created_at ASC", [phone]);
  return rows.map(toFieldRow);
}

export async function getFieldById(id: string): Promise<FieldRow | null> {
  const db = getDb();
  const { rows } = await db.query("SELECT * FROM fields WHERE id = $1", [id]);
  return rows[0] ? toFieldRow(rows[0]) : null;
}

// Scoped by phone so one farmer can't delete another's field even by
// guessing an id.
export async function deleteField(id: string, phone: string): Promise<boolean> {
  const db = getDb();
  const { rowCount } = await db.query("DELETE FROM fields WHERE id = $1 AND phone = $2", [id, phone]);
  return (rowCount ?? 0) > 0;
}
