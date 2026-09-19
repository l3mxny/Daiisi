"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { NdviPoint } from "@/lib/sentinelHub";

export default function NdviChart({ data }: { data: NdviPoint[] }) {
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
          tickFormatter={(d: string) => d.slice(5)}
          minTickGap={20}
        />
        <YAxis domain={[0, 1]} tick={{ fontSize: 10 }} width={36} />
        <Tooltip formatter={(value) => (typeof value === "number" ? value.toFixed(3) : value)} />
        <Line type="monotone" dataKey="mean" stroke="#16a34a" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
