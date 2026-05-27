// Volcano plot — log2 fold change (X) vs −log10(BH-adjusted p-value) (Y).
// Each point is one peptide; points in the upper-right corner are both
// significantly enriched (low FDR) and strongly enriched (high log2FC).
//
// Two panels: stepwise (R_{i} vs R_{i-1}) and global (R_last vs R_0) — the
// global panel only appears when ≥ 3 rounds are present, otherwise it's just
// a duplicate of the single stepwise comparison.
//
// Thresholds:
//   - FDR < 0.05   → significant (horizontal cutoff line)
//   - |log2FC| > 1 → ≥ 2× enriched (vertical cutoff line)
// Points clearing both are coloured red; everything else is muted grey.

import { useMemo } from "react";
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer, Cell,
} from "recharts";
import type { PeptideRecord } from "./csvParse";
import { computeEnrichmentTests } from "./stats";
import { ChartPanel } from "./ChartPanel";

const FDR_THRESHOLD = 0.05;
const LFC_THRESHOLD = 1;
const MAX_POINTS_PER_PANEL = 5000;

interface VolcanoPoint {
  x: number; // log2 fold change
  y: number; // -log10(FDR)
  peptide: string;
  fdr: number;
  significant: boolean;
}

interface Panel {
  title: string;
  significantCount: number;
  totalPlotted: number;
  totalAvailable: number;
  points: VolcanoPoint[];
}

function buildPanel(
  rows: ReadonlyArray<PeptideRecord>,
  src: string,
  dest: string,
  label: string,
  totalsByRound: Record<string, number>,
): Panel {
  const tests = computeEnrichmentTests(
    rows,
    src,
    dest,
    totalsByRound[src] ?? 0,
    totalsByRound[dest] ?? 0,
  );
  let sig = 0;
  const allPoints: VolcanoPoint[] = tests.map((t) => {
    const significant = t.fdr < FDR_THRESHOLD && t.log2FC > LFC_THRESHOLD;
    if (significant) sig++;
    return {
      x: t.log2FC,
      y: -Math.log10(Math.max(t.fdr, 1e-300)),
      peptide: t.peptide,
      fdr: t.fdr,
      significant,
    };
  });

  // Keep all the significant points (they're the publication payload) and
  // subsample the rest so Recharts stays responsive on dense libraries.
  let points = allPoints;
  if (allPoints.length > MAX_POINTS_PER_PANEL) {
    const sigPts = allPoints.filter((p) => p.significant);
    const rest = allPoints.filter((p) => !p.significant);
    const tail = MAX_POINTS_PER_PANEL - sigPts.length;
    if (tail > 0 && rest.length > tail) {
      const stride = Math.max(1, Math.floor(rest.length / tail));
      const sampled: VolcanoPoint[] = [];
      for (let i = 0; i < rest.length && sampled.length < tail; i += stride) {
        sampled.push(rest[i]!);
      }
      points = [...sigPts, ...sampled];
    } else {
      points = [...sigPts, ...rest];
    }
  }

  return {
    title: `${label}: ${dest} vs ${src}`,
    significantCount: sig,
    totalPlotted: points.length,
    totalAvailable: allPoints.length,
    points,
  };
}

interface Props {
  rows: ReadonlyArray<PeptideRecord>;
  /** Round name → passed_qc total. The p-value's library-size denominator
   *  comes from here, NOT from summing the (possibly capped) rows. */
  totalsByRound: Record<string, number>;
  roundNames: ReadonlyArray<string>;
}

export function VolcanoPlot({ rows, totalsByRound, roundNames }: Props) {
  const panels = useMemo<Panel[]>(() => {
    if (rows.length === 0 || roundNames.length < 2) return [];
    const out: Panel[] = [];
    for (let i = 1; i < roundNames.length; i++) {
      out.push(
        buildPanel(rows, roundNames[i - 1]!, roundNames[i]!, "Stepwise", totalsByRound),
      );
    }
    if (roundNames.length >= 3) {
      out.push(
        buildPanel(
          rows,
          roundNames[0]!,
          roundNames[roundNames.length - 1]!,
          "Global",
          totalsByRound,
        ),
      );
    }
    return out;
  }, [rows, totalsByRound, roundNames]);

  if (panels.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-muted/30 p-8 text-center text-sm text-muted-foreground">
        Volcano plot needs ≥ 2 rounds.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {panels.map((p, i) => (
        <VolcanoPanel key={i} panel={p} />
      ))}
    </div>
  );
}

function VolcanoTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: VolcanoPoint }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="rounded-md border bg-background/95 px-2.5 py-2 text-[11px] shadow-md backdrop-blur-sm">
      <div className="break-all font-mono text-xs font-semibold text-foreground">{p.peptide}</div>
      <div className="mt-1 space-y-0.5 text-muted-foreground">
        <div>
          log₂FC ={" "}
          <span className="font-mono tabular-nums text-foreground">{p.x.toFixed(2)}</span>
        </div>
        <div>
          FDR ={" "}
          <span className="font-mono tabular-nums text-foreground">{p.fdr.toExponential(2)}</span>
        </div>
        {p.significant ? (
          <div className="font-medium text-destructive">significant</div>
        ) : null}
      </div>
    </div>
  );
}

function VolcanoPanel({ panel }: { panel: Panel }) {
  const sig = panel.points.filter((p) => p.significant);
  const bg = panel.points.filter((p) => !p.significant);

  const absMaxX = Math.max(2, ...panel.points.map((p) => Math.abs(p.x)));
  const maxY = Math.max(2, ...panel.points.map((p) => p.y));
  const cutoffY = -Math.log10(FDR_THRESHOLD);
  // Slug-safe filename for the download: "Stepwise: R1 vs R0" → "volcano_Stepwise_R1_vs_R0"
  const filename = `volcano_${panel.title.replace(/[^a-zA-Z0-9]+/g, "_")}`;

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between text-xs">
        <span className="font-medium">{panel.title}</span>
        <span className="font-mono text-muted-foreground">
          {panel.significantCount.toLocaleString()} significant ·{" "}
          FDR &lt; {FDR_THRESHOLD} &amp; log₂FC &gt; {LFC_THRESHOLD}
        </span>
      </div>
      <ChartPanel filename={filename} className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 16, bottom: 28, left: 8 }}>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 2" />
            <XAxis
              type="number"
              dataKey="x"
              domain={[-Math.ceil(absMaxX), Math.ceil(absMaxX)]}
              tickFormatter={(v) => Number(v).toFixed(0)}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              label={{
                value: "log₂ fold change",
                position: "insideBottom",
                offset: -14,
                style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
              }}
            />
            <YAxis
              type="number"
              dataKey="y"
              domain={[0, Math.ceil(maxY)]}
              tickFormatter={(v) => Number(v).toFixed(0)}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              label={{
                value: "−log₁₀(FDR)",
                angle: -90,
                position: "insideLeft",
                offset: 14,
                style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
              }}
              width={42}
            />
            <ZAxis range={[16, 16]} />
            <ReferenceLine
              y={cutoffY}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="3 3"
              strokeWidth={1}
            />
            <ReferenceLine
              x={LFC_THRESHOLD}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="3 3"
              strokeWidth={1}
            />
            <Tooltip content={<VolcanoTooltip />} cursor={{ strokeDasharray: "3 3" }} />
            <Scatter
              name="Not significant"
              data={bg}
              fill="hsl(var(--muted-foreground))"
              fillOpacity={0.3}
            />
            <Scatter
              name="Significant"
              data={sig}
              fill="hsl(var(--destructive))"
              fillOpacity={0.85}
            >
              {sig.map((_, i) => (
                <Cell key={i} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </ChartPanel>
    </div>
  );
}
