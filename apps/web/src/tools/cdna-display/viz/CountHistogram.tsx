// Per-round histogram of unique-peptide read counts. Selection rounds in
// cDNA-display typically follow a power-law / long-tail distribution: many
// peptides appear once or twice, a few dominate. We bin on log10(count) and
// overlay a Gaussian fit (= log-normal in linear count space) so the user
// can eyeball whether the round has converged on a handful of winners
// (narrow distribution shifted right) or still has a diverse pool (wide,
// left-shifted).
//
// Sparse-data guards:
//   - Rounds with < 5 distinct peptides skip the fit (curve would be noise).
//   - Histograms with 0 bins draw a "no data" placeholder.

import { useMemo } from "react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface Props {
  /** Round name → sorted-descending per-peptide counts. We only need the
   *  counts themselves (not peptide identities) to bin them, so the parser
   *  passes us pure number[] arrays — full library, not top-N sliced. */
  countsByRound: Record<string, number[]>;
  roundNames: ReadonlyArray<string>;
}

interface RoundHistogram {
  round: string;
  /** [{ x: log10-count midpoint, count: # peptides in bin, fit: Gaussian PDF * N }] */
  bins: { x: number; count: number; fit: number }[];
  totalPeptides: number;
  meanLog: number;
  stdLog: number;
}

const BIN_COUNT = 24;

function computeHistogram(round: string, counts: ReadonlyArray<number>): RoundHistogram | null {
  // log10 of the count for each peptide that has at least one read in this round.
  const logs = new Array<number>(counts.length);
  let n = 0;
  for (const c of counts) {
    if (c > 0) logs[n++] = Math.log10(c);
  }
  logs.length = n;
  if (n === 0) return null;

  // Loop-based min/max — Math.min(...logs) overflows the call stack at ~100k
  // elements and we routinely see >500k peptides per round on deep runs.
  let min = logs[0]!;
  let max = logs[0]!;
  for (let i = 1; i < logs.length; i++) {
    const v = logs[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  // Guard: when all peptides have the same count (e.g. all = 1) histogram
  // collapses to one bin; widen artificially so the chart still renders.
  const lo = min === max ? min - 0.5 : min;
  const hi = min === max ? max + 0.5 : max;
  const step = (hi - lo) / BIN_COUNT;

  const binCounts = new Array<number>(BIN_COUNT).fill(0);
  for (const v of logs) {
    let idx = Math.floor((v - lo) / step);
    if (idx === BIN_COUNT) idx = BIN_COUNT - 1; // edge case for max
    if (idx >= 0 && idx < BIN_COUNT) binCounts[idx]!++;
  }

  // Gaussian fit on the log-transformed data.
  const meanLog = logs.reduce((a, b) => a + b, 0) / logs.length;
  const variance =
    logs.reduce((acc, v) => acc + (v - meanLog) * (v - meanLog), 0) / Math.max(1, logs.length - 1);
  const stdLog = Math.sqrt(variance);

  const fitOk = logs.length >= 5 && stdLog > 0;

  const bins = binCounts.map((bc, i) => {
    const x = lo + step * (i + 0.5);
    // Gaussian PDF in log space, scaled to histogram counts (N * step is
    // the area under the binned histogram; PDF * (N * step) ≈ bin count).
    const fit = fitOk
      ? (1 / (stdLog * Math.sqrt(2 * Math.PI))) *
        Math.exp(-0.5 * ((x - meanLog) / stdLog) ** 2) *
        logs.length *
        step
      : 0;
    return { x, count: bc, fit };
  });

  return { round, bins, totalPeptides: logs.length, meanLog, stdLog };
}

export function CountHistogram({ countsByRound, roundNames }: Props) {
  const histos = useMemo(
    () =>
      roundNames
        .map((r) => computeHistogram(r, countsByRound[r] ?? []))
        .filter((h): h is RoundHistogram => h != null),
    [countsByRound, roundNames],
  );

  if (histos.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-muted/30 p-8 text-center text-sm text-muted-foreground">
        No per-round counts available — pipeline returned an empty matrix.
      </div>
    );
  }

  // One small chart per round, stacked vertically for narrow screens, in a
  // grid on wider ones. Each is ~180 px tall, which keeps the page scannable.
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      {histos.map((h) => (
        <div key={h.round}>
          <div className="mb-2 flex items-baseline justify-between text-xs">
            <span className="font-medium">{h.round}</span>
            <span className="font-mono text-muted-foreground">
              N = {h.totalPeptides.toLocaleString()} ·{" "}
              μ(log₁₀) = {h.meanLog.toFixed(2)} ·{" "}
              σ(log₁₀) = {h.stdLog.toFixed(2)}
            </span>
          </div>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={h.bins}
                margin={{ top: 6, right: 12, left: -8, bottom: 4 }}
              >
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 2" vertical={false} />
                <XAxis
                  dataKey="x"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={(v: number) => v.toFixed(1)}
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  label={{
                    value: "log₁₀(reads per peptide)",
                    position: "insideBottom",
                    offset: -2,
                    style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
                  }}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  width={40}
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--background))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 6,
                    fontSize: 11,
                  }}
                  formatter={(v, key) => {
                    const n = Number(v);
                    return key === "fit" ? n.toFixed(1) : String(Math.round(n));
                  }}
                  labelFormatter={(v) => `log₁₀(count) ≈ ${Number(v).toFixed(2)}`}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} verticalAlign="top" height={20} />
                <Bar dataKey="count" name="Peptides" fill="hsl(var(--primary))" fillOpacity={0.7} />
                <Line
                  type="monotone"
                  dataKey="fit"
                  name="Log-normal fit"
                  stroke="hsl(var(--destructive))"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      ))}
    </div>
  );
}
