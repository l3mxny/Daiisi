"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { NdviPoint } from "@/lib/sentinelHub";
import { getWeekStart } from "@/lib/week";

// One point per week (average of that week's readings, labelled by the week's Sunday). Display only: the
// analysis still uses the raw series, and nothing a farmer logs (notes) feeds into this chart.
function toWeekly(data: NdviPoint[]): NdviPoint[] {
  const weeks = new Map<string, number[]>();
  for (const p of data) {
    const week = getWeekStart(new Date(`${p.date.slice(0, 10)}T00:00:00Z`));
    weeks.set(week, [...(weeks.get(week) ?? []), p.mean]);
  }
  return [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, means]) => ({ ...p0(date), mean: means.reduce((a, b) => a + b, 0) / means.length }));
}
const p0 = (date: string) => ({ date }) as NdviPoint;

export default function NdviChart({ data: daily }: { data: NdviPoint[] }) {
  const data = toWeekly(daily);
  if (data.length === 0) {
    return <p className="text-sm text-zinc-500">No NDVI data available for this period.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10 }}
          tickFormatter={(d: string) => `wk ${d.slice(5)}`}
          minTickGap={20}
        />
        <YAxis domain={[(min: number) => Math.max(0, Math.floor((min - 0.05) * 20) / 20), (max: number) => Math.min(1, Math.ceil((max + 0.05) * 20) / 20)]} tick={{ fontSize: 10 }} width={36} />
        <Tooltip formatter={(value) => (typeof value === "number" ? value.toFixed(3) : value)} />
        <Line type="monotone" dataKey="mean" stroke="#16a34a" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
