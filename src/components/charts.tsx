"use client";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface Point {
  t: string;
  v: number;
}

const tick = { fill: "var(--text-3)", fontSize: 11 };

export function Sparkline({ data, positive }: { data: Point[]; positive: boolean }) {
  if (data.length < 2) return null;
  const color = positive ? "var(--gain)" : "var(--loss)";
  return (
    <div className="h-10 w-full" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`sg-${positive}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={`url(#sg-${positive})`} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function HistoryChart({ data, label, levels = [], height = 260 }: { data: Point[]; label: string; levels?: { y: number; label: string; tone: "gain" | "loss" | "accent" }[]; height?: number }) {
  if (data.length < 2) return <p className="text-sm text-text-3">Not enough history to chart.</p>;
  return (
    <figure>
      <figcaption className="sr-only">{label}</figcaption>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="t" tick={tick} tickLine={false} axisLine={{ stroke: "var(--line)" }} minTickGap={40} tickFormatter={(t: string) => t.slice(5)} />
            <YAxis tick={tick} tickLine={false} axisLine={false} width={64} domain={["auto", "auto"]} tickFormatter={(v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 2 })} />
            <Tooltip
              contentStyle={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12 }}
              labelStyle={{ color: "var(--text-2)" }}
              formatter={(v) => [Number(v).toLocaleString("en-IN", { maximumFractionDigits: 4 }), label]}
            />
            {levels.map((l) => (
              <ReferenceLine key={l.label} y={l.y} stroke={`var(--${l.tone})`} strokeDasharray="4 4" label={{ value: l.label, fill: `var(--${l.tone})`, fontSize: 10, position: "insideTopRight" }} />
            ))}
            <Line type="monotone" dataKey="v" stroke="var(--chart-1)" strokeWidth={1.75} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
