// Hamming-distance clustering of the top 200 globally-enriched peptides.
// Two peptides are joined into the same cluster if their Hamming distance
// (number of differing positions, same-length peptides only) is ≤ THRESHOLD.
// We render the resulting clusters as a stacked horizontal bar with one
// segment per cluster — width ∝ cluster size, color rotates through the
// palette. Hovering shows the seed peptide of each cluster.
//
// This gives a compact view of "how convergent is the late-round library?":
// many small clusters → diverse hits; a few large clusters → the selection
// has converged on a few sequence motifs.
//
// Implementation notes:
//   - Pairwise Hamming for 200 × 199 / 2 ≈ 20,000 comparisons of short
//     peptide strings is fast (~5 ms in V8). No worker offload needed.
//   - Peptides of different lengths can't share a cluster (Hamming is
//     undefined for mismatched lengths). They get their own singletons.
//   - Union-find for the clustering; O(α(N) · pairs) which is effectively
//     linear in pairs.

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { PeptideRecord } from "./csvParse";

const HAMMING_THRESHOLD = 2;
const TOP_N = 200;

interface Cluster {
  id: number;
  seedPeptide: string;
  members: string[];
  size: number;
  /** Average global enrichment of cluster members (last round vs first). */
  avgEnrichment: number;
}

class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = new Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]!]!;
      i = this.parent[i]!;
    }
    return i;
  }
  union(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

function hamming(a: string, b: string): number {
  if (a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    if (a.charCodeAt(i) !== b.charCodeAt(i)) {
      d++;
      // Early exit — once we exceed the threshold by more than 2× there's
      // no chance of clustering; small win on long peptides.
      if (d > HAMMING_THRESHOLD * 4) return d;
    }
  }
  return d;
}

function clusterTopPeptides(rows: ReadonlyArray<PeptideRecord>, destRound: string): Cluster[] {
  const top = rows.slice(0, TOP_N);
  const n = top.length;
  if (n === 0) return [];

  const uf = new UnionFind(n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (hamming(top[i]!.peptide, top[j]!.peptide) <= HAMMING_THRESHOLD) {
        uf.union(i, j);
      }
    }
  }

  // Collect members per root.
  const byRoot = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = uf.find(i);
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r)!.push(i);
  }

  const clusters: Cluster[] = [];
  let id = 0;
  for (const [root, idxs] of byRoot) {
    const members = idxs.map((i) => top[i]!.peptide);
    const enrichVals = idxs
      .map((i) => top[i]!.global[destRound])
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const avgEnrichment =
      enrichVals.length > 0 ? enrichVals.reduce((a, b) => a + b, 0) / enrichVals.length : 0;
    clusters.push({
      id: id++,
      seedPeptide: top[root]!.peptide,
      members,
      size: members.length,
      avgEnrichment,
    });
  }

  // Sort by cluster size (largest first), then by enrichment.
  clusters.sort((a, b) => b.size - a.size || b.avgEnrichment - a.avgEnrichment);
  return clusters;
}

const PALETTE = [
  "hsl(173 80% 40%)", // teal (primary)
  "hsl(35 92% 50%)", // orange
  "hsl(280 65% 55%)", // purple
  "hsl(140 60% 45%)", // green
  "hsl(0 75% 60%)", // red
  "hsl(220 70% 55%)", // blue
  "hsl(50 85% 55%)", // yellow
  "hsl(310 60% 55%)", // magenta
];

interface Props {
  rows: ReadonlyArray<PeptideRecord>;
  roundNames: ReadonlyArray<string>;
}

export function HammingClusters({ rows, roundNames }: Props) {
  const destRound = roundNames[roundNames.length - 1] ?? "";

  const clusters = useMemo(
    () => clusterTopPeptides(rows, destRound),
    [rows, destRound],
  );

  if (clusters.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-muted/30 p-8 text-center text-sm text-muted-foreground">
        Not enough peptides to cluster — need at least one row in the matrix.
      </div>
    );
  }

  // Bar-chart shape: one bar per cluster, value = size, sorted desc.
  // Render only the top N clusters to keep the chart readable.
  const VISIBLE = 30;
  const visibleClusters = clusters.slice(0, VISIBLE);
  const tailSize = clusters.slice(VISIBLE).reduce((acc, c) => acc + c.size, 0);
  const data = visibleClusters.map((c, i) => ({
    rank: i + 1,
    size: c.size,
    seed: c.seedPeptide,
    enrich: c.avgEnrichment,
    color: PALETTE[i % PALETTE.length],
  }));
  if (tailSize > 0) {
    data.push({
      rank: VISIBLE + 1,
      size: tailSize,
      seed: `(${clusters.length - VISIBLE} smaller clusters)`,
      enrich: 0,
      color: "hsl(var(--muted-foreground))",
    });
  }

  const totalPeptides = clusters.reduce((acc, c) => acc + c.size, 0);
  const singletons = clusters.filter((c) => c.size === 1).length;
  const largest = clusters[0]!;

  return (
    <div>
      <div className="mb-3 grid grid-cols-3 gap-3 text-xs">
        <div className="rounded-md border bg-muted/30 px-3 py-2">
          <div className="text-muted-foreground">Top-{TOP_N} → clusters (≤ {HAMMING_THRESHOLD} mismatches)</div>
          <div className="mt-0.5 font-mono text-base text-foreground">
            {clusters.length.toLocaleString()}
          </div>
        </div>
        <div className="rounded-md border bg-muted/30 px-3 py-2">
          <div className="text-muted-foreground">Largest cluster</div>
          <div className="mt-0.5 font-mono text-base text-foreground">
            {largest.size} <span className="text-xs text-muted-foreground">members</span>
          </div>
          <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground" title={largest.seedPeptide}>
            seed: {largest.seedPeptide}
          </div>
        </div>
        <div className="rounded-md border bg-muted/30 px-3 py-2">
          <div className="text-muted-foreground">Singletons</div>
          <div className="mt-0.5 font-mono text-base text-foreground">
            {singletons.toLocaleString()}
            <span className="ml-1 text-xs text-muted-foreground">
              ({((singletons / totalPeptides) * 100).toFixed(0)}%)
            </span>
          </div>
        </div>
      </div>

      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 6, right: 12, left: -8, bottom: 26 }}>
            <XAxis
              dataKey="rank"
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              label={{
                value: "Cluster rank (by size)",
                position: "insideBottom",
                offset: -16,
                style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
              }}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              label={{
                value: "Members",
                angle: -90,
                position: "insideLeft",
                offset: 14,
                style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
              }}
              width={40}
            />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--background))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 6,
                fontSize: 11,
              }}
              labelFormatter={(rank) => `Cluster #${rank}`}
              formatter={(value, _key, item) => {
                const payload = (item as { payload?: { seed?: string; enrich?: number } }).payload;
                const seed = payload?.seed ?? "";
                const enrich = payload?.enrich ?? 0;
                const v = Number(value);
                return [
                  `${v} member${v === 1 ? "" : "s"} · seed ${seed}` +
                    (enrich > 0 ? ` · avg enrich ${enrich.toFixed(2)}` : ""),
                  "Cluster",
                ];
              }}
            />
            <Bar dataKey="size">
              {data.map((d, i) => (
                <Cell key={i} fill={d.color ?? "hsl(var(--primary))"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
