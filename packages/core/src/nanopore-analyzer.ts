// Nanopore SSM analyzer — converts the engine's per-site DNA counters +
// haplotype counters into two CSVs:
//
//   enrichment_per_site.csv (long format):
//     Site, Variant_AA, Dominant_DNA, GC_Percent,
//     Count_<round>, RPM_<round>, Rank_<round>,
//     Enrich_Global_<round>, Fitness_vs_WT_<round>
//   (iterates over rounds; one row per (site, AA-variant))
//
//   enrichment_haplotype.csv (only when ≥2 sites + reportHaplotype was on):
//     Haplotype_AA, Haplotype_DNA, GC_Percent,
//     Count_<round>, RPM_<round>, Rank_<round>,
//     Enrich_Global_<round>, Fitness_vs_WT_<round>
//
// Metrics:
//   - RPM denominator is per-site `passed_qc` (analyzer is the only consumer
//     of this counter — total_reads isn't tracked because RC-retry would
//     double-count it).
//   - Enrich_Global_<round> = log2((RPM_round + 1) / (RPM_round_0 + 1))
//   - Fitness_vs_WT_<round> = log2( ((count + 1) / (wt_count_round + 1)) /
//                                   ((count_round_0 + 1) / (wt_count_round_0 + 1)) )
//     (DiMSum / Enrich2 convention; pseudocount 1.0 on every term so the
//     formula is defined even when a variant or WT has zero reads in a round)
//
// Sort order: per-site rows sort by Site (input order), then within each
// site by Fitness_vs_WT_<lastRound> desc with Variant_AA asc as the
// tiebreaker (stable sort). Haplotype rows sort the same way over the
// joined-codon AA string.

import { calculateGc, translateDna } from "./dna.js";
import { serializeCsv, type AnalyzerRow, type ColumnSpec, type RowValue } from "./analyzer.js";
import type { NanoporeRoundStats } from "./nanopore.js";

const PSEUDO = 1.0;

export interface NanoporeAnalyzerInput {
  /** Round insertion order. Used for column ordering AND as the reference
   *  round (index 0) for `Enrich_Global_*` and `Fitness_vs_WT_*`. */
  roundNames: ReadonlyArray<string>;
  siteNames: ReadonlyArray<string>;
  dnaCounters: ReadonlyMap<string, ReadonlyMap<string, ReadonlyMap<string, number>>>;
  haplotypeCounters: ReadonlyMap<string, ReadonlyMap<string, number>>;
  stats: ReadonlyMap<string, NanoporeRoundStats>;
  /** WT DNA per site, used both as the per-site WT match and (in joined form)
   *  as the haplotype WT denominator. */
  sites: ReadonlyArray<{ name: string; wtDna: string }>;
  /** Off by default — only emits haplotype CSV when the engine was configured
   *  with this on AND ≥2 sites are configured. */
  emitHaplotype: boolean;
}

export interface NanoporeAnalyzerRow {
  [key: string]: RowValue;
}

export interface NanoporeAnalyzerOutput {
  perSiteRows: NanoporeAnalyzerRow[];
  haplotypeRows: NanoporeAnalyzerRow[];
  perSiteColumns: ColumnSpec[];
  haplotypeColumns: ColumnSpec[];
  /** Per-line parts (each entry terminated with "\n"). Pass directly to
   *  `new Blob(parts, …)` for downloads; or `parts.join("")` for inspection.
   *  Avoids the V8 ~537 MB single-string ceiling on multi-GB runs. */
  perSiteCsvParts: string[];
  /** Empty array when haplotype output is disabled or empty. */
  haplotypeCsvParts: string[];
}

interface AaAgg {
  aa: string;
  dnaTotals: Map<string, number>; // dna → total count across rounds (for picking dominant)
  perRound: Map<string, number>;  // round → summed count for this AA at this site
}

export function runNanoporeAnalyzer(input: NanoporeAnalyzerInput): NanoporeAnalyzerOutput {
  const perSiteRows: NanoporeAnalyzerRow[] = [];
  for (const siteName of input.siteNames) {
    perSiteRows.push(...aggregatePerSite(input, siteName));
  }

  const perSiteColumns = buildPerSiteColumns(input.roundNames);
  // serializeCsv's input type is tied to cDNA's AnalyzerRow shape, but it
  // only ever does column-by-name lookups, so the per-site rows (different
  // schema, same index-signature shape) work fine. Cast at the boundary.
  const perSiteCsvParts = serializeCsv(perSiteRows as unknown as AnalyzerRow[], perSiteColumns);

  const wantHaplotype = input.emitHaplotype && input.siteNames.length >= 2;
  let haplotypeRows: NanoporeAnalyzerRow[] = [];
  let haplotypeColumns: ColumnSpec[] = [];
  let haplotypeCsvParts: string[] = [];
  if (wantHaplotype) {
    haplotypeRows = aggregateHaplotypes(input);
    haplotypeColumns = buildHaplotypeColumns(input.roundNames);
    haplotypeCsvParts =
      haplotypeRows.length > 0
        ? serializeCsv(haplotypeRows as unknown as AnalyzerRow[], haplotypeColumns)
        : [];
  }

  return {
    perSiteRows,
    haplotypeRows,
    perSiteColumns,
    haplotypeColumns,
    perSiteCsvParts,
    haplotypeCsvParts,
  };
}

// --- Per-site aggregation ---------------------------------------------------

function aggregatePerSite(input: NanoporeAnalyzerInput, siteName: string): NanoporeAnalyzerRow[] {
  // Collapse DNA → AA, tracking dominant DNA per AA and per-round count.
  const aaMap = new Map<string, AaAgg>();
  for (const round of input.roundNames) {
    const siteDna = input.dnaCounters.get(round)?.get(siteName);
    if (!siteDna) continue;
    for (const [dna, count] of siteDna) {
      const aa = translateDna(dna);
      let agg = aaMap.get(aa);
      if (!agg) {
        agg = { aa, dnaTotals: new Map(), perRound: new Map() };
        aaMap.set(aa, agg);
      }
      agg.dnaTotals.set(dna, (agg.dnaTotals.get(dna) ?? 0) + count);
      agg.perRound.set(round, (agg.perRound.get(round) ?? 0) + count);
    }
  }

  // RPM denominator per round = passed_qc for this site in that round.
  const denom = new Map<string, number>();
  for (const round of input.roundNames) {
    const ss = input.stats.get(round)?.sites?.[siteName];
    denom.set(round, ss?.passed_qc ?? 0);
  }

  // WT count per round = count of the WT DNA in dnaCounters.
  const site = input.sites.find((s) => s.name === siteName);
  const wtDna = site?.wtDna ?? "";
  const wtCounts = new Map<string, number>();
  for (const round of input.roundNames) {
    const siteDna = input.dnaCounters.get(round)?.get(siteName);
    wtCounts.set(round, siteDna?.get(wtDna) ?? 0);
  }

  // Per-round rank: sort AAs by count desc and assign 1..N.
  const ranks = computeRanks(aaMap, input.roundNames);

  const firstRound = input.roundNames[0]!;
  const lastRound = input.roundNames[input.roundNames.length - 1]!;

  const rows: NanoporeAnalyzerRow[] = [];
  for (const agg of aaMap.values()) {
    const dominantDna = pickDominant(agg.dnaTotals);
    const row: NanoporeAnalyzerRow = {
      Site: siteName,
      Variant_AA: agg.aa,
      Dominant_DNA: dominantDna,
      GC_Percent: calculateGc(dominantDna),
    };
    const c0 = agg.perRound.get(firstRound) ?? 0;
    const denom0 = denom.get(firstRound) ?? 0;
    const rpm0 = denom0 > 0 ? (c0 / denom0) * 1e6 : 0;
    const wt0 = wtCounts.get(firstRound) ?? 0;
    for (const round of input.roundNames) {
      const c = agg.perRound.get(round) ?? 0;
      const denomR = denom.get(round) ?? 0;
      const rpm = denomR > 0 ? (c / denomR) * 1e6 : 0;
      const wtR = wtCounts.get(round) ?? 0;
      row[`Count_${round}`] = c;
      row[`RPM_${round}`] = rpm;
      row[`Rank_${round}`] = ranks.get(round)!.get(agg.aa) ?? "";
      row[`Enrich_Global_${round}`] = Math.log2((rpm + PSEUDO) / (rpm0 + PSEUDO));
      row[`Fitness_vs_WT_${round}`] = Math.log2(
        ((c + PSEUDO) / (wtR + PSEUDO)) / ((c0 + PSEUDO) / (wt0 + PSEUDO)),
      );
    }
    rows.push(row);
  }

  // Sort: Fitness_vs_WT of last round desc, then Variant_AA asc (stable).
  const fitKey = `Fitness_vs_WT_${lastRound}`;
  rows.sort((a, b) => {
    const fa = (a[fitKey] as number) ?? 0;
    const fb = (b[fitKey] as number) ?? 0;
    if (fb !== fa) return fb - fa;
    return String(a.Variant_AA).localeCompare(String(b.Variant_AA));
  });
  return rows;
}

// --- Haplotype aggregation ------------------------------------------------

function aggregateHaplotypes(input: NanoporeAnalyzerInput): NanoporeAnalyzerRow[] {
  // Collapse joined-DNA → joined-AA, tracking dominant DNA + per-round count.
  // joined_dna = "GCT_TGG" etc., split on "_" to translate each codon.
  const aaMap = new Map<string, AaAgg>();
  for (const round of input.roundNames) {
    const counter = input.haplotypeCounters.get(round);
    if (!counter) continue;
    for (const [joinedDna, count] of counter) {
      const aa = joinedDna.split("_").map(translateDna).join("_");
      let agg = aaMap.get(aa);
      if (!agg) {
        agg = { aa, dnaTotals: new Map(), perRound: new Map() };
        aaMap.set(aa, agg);
      }
      agg.dnaTotals.set(joinedDna, (agg.dnaTotals.get(joinedDna) ?? 0) + count);
      agg.perRound.set(round, (agg.perRound.get(round) ?? 0) + count);
    }
  }

  // RPM denominator = haplotype_passed_qc per round.
  const denom = new Map<string, number>();
  for (const round of input.roundNames) {
    denom.set(round, input.stats.get(round)?.haplotype_passed_qc ?? 0);
  }

  // WT haplotype DNA = joined wtDna of each site (in siteNames order).
  const siteByName = new Map(input.sites.map((s) => [s.name, s] as const));
  const wtJoinedDna = input.siteNames
    .map((n) => siteByName.get(n)?.wtDna ?? "")
    .join("_");
  const wtCounts = new Map<string, number>();
  for (const round of input.roundNames) {
    wtCounts.set(round, input.haplotypeCounters.get(round)?.get(wtJoinedDna) ?? 0);
  }

  const ranks = computeRanks(aaMap, input.roundNames);

  const firstRound = input.roundNames[0]!;
  const lastRound = input.roundNames[input.roundNames.length - 1]!;

  const rows: NanoporeAnalyzerRow[] = [];
  for (const agg of aaMap.values()) {
    const dominantDna = pickDominant(agg.dnaTotals);
    // For haplotype GC%, calculate on the joined DNA WITHOUT underscores.
    const flatDna = dominantDna.replaceAll("_", "");
    const row: NanoporeAnalyzerRow = {
      Haplotype_AA: agg.aa,
      Haplotype_DNA: dominantDna,
      GC_Percent: calculateGc(flatDna),
    };
    const c0 = agg.perRound.get(firstRound) ?? 0;
    const denom0 = denom.get(firstRound) ?? 0;
    const rpm0 = denom0 > 0 ? (c0 / denom0) * 1e6 : 0;
    const wt0 = wtCounts.get(firstRound) ?? 0;
    for (const round of input.roundNames) {
      const c = agg.perRound.get(round) ?? 0;
      const denomR = denom.get(round) ?? 0;
      const rpm = denomR > 0 ? (c / denomR) * 1e6 : 0;
      const wtR = wtCounts.get(round) ?? 0;
      row[`Count_${round}`] = c;
      row[`RPM_${round}`] = rpm;
      row[`Rank_${round}`] = ranks.get(round)!.get(agg.aa) ?? "";
      row[`Enrich_Global_${round}`] = Math.log2((rpm + PSEUDO) / (rpm0 + PSEUDO));
      row[`Fitness_vs_WT_${round}`] = Math.log2(
        ((c + PSEUDO) / (wtR + PSEUDO)) / ((c0 + PSEUDO) / (wt0 + PSEUDO)),
      );
    }
    rows.push(row);
  }

  const fitKey = `Fitness_vs_WT_${lastRound}`;
  rows.sort((a, b) => {
    const fa = (a[fitKey] as number) ?? 0;
    const fb = (b[fitKey] as number) ?? 0;
    if (fb !== fa) return fb - fa;
    return String(a.Haplotype_AA).localeCompare(String(b.Haplotype_AA));
  });
  return rows;
}

// --- Helpers --------------------------------------------------------------

function pickDominant(dnaTotals: ReadonlyMap<string, number>): string {
  let best = "";
  let bestCount = -1;
  for (const [dna, c] of dnaTotals) {
    if (c > bestCount || (c === bestCount && dna < best)) {
      best = dna;
      bestCount = c;
    }
  }
  return best;
}

function computeRanks(
  aaMap: ReadonlyMap<string, AaAgg>,
  roundNames: ReadonlyArray<string>,
): Map<string, Map<string, number>> {
  const ranksByRound = new Map<string, Map<string, number>>();
  for (const round of roundNames) {
    const sorted = Array.from(aaMap.values())
      .filter((d) => (d.perRound.get(round) ?? 0) > 0)
      .sort((a, b) => {
        const diff = (b.perRound.get(round) ?? 0) - (a.perRound.get(round) ?? 0);
        if (diff !== 0) return diff;
        return a.aa.localeCompare(b.aa);
      });
    const ranks = new Map<string, number>();
    for (let i = 0; i < sorted.length; i++) ranks.set(sorted[i]!.aa, i + 1);
    ranksByRound.set(round, ranks);
  }
  return ranksByRound;
}

function buildPerSiteColumns(roundNames: ReadonlyArray<string>): ColumnSpec[] {
  const cols: ColumnSpec[] = [
    { name: "Site", type: "string" },
    { name: "Variant_AA", type: "string" },
    { name: "Dominant_DNA", type: "string" },
    { name: "GC_Percent", type: "float" },
  ];
  for (const r of roundNames) cols.push({ name: `Count_${r}`, type: "int" });
  for (const r of roundNames) cols.push({ name: `RPM_${r}`, type: "float" });
  for (const r of roundNames) cols.push({ name: `Rank_${r}`, type: "int" });
  for (const r of roundNames) cols.push({ name: `Enrich_Global_${r}`, type: "float" });
  for (const r of roundNames) cols.push({ name: `Fitness_vs_WT_${r}`, type: "float" });
  return cols;
}

function buildHaplotypeColumns(roundNames: ReadonlyArray<string>): ColumnSpec[] {
  const cols: ColumnSpec[] = [
    { name: "Haplotype_AA", type: "string" },
    { name: "Haplotype_DNA", type: "string" },
    { name: "GC_Percent", type: "float" },
  ];
  for (const r of roundNames) cols.push({ name: `Count_${r}`, type: "int" });
  for (const r of roundNames) cols.push({ name: `RPM_${r}`, type: "float" });
  for (const r of roundNames) cols.push({ name: `Rank_${r}`, type: "int" });
  for (const r of roundNames) cols.push({ name: `Enrich_Global_${r}`, type: "float" });
  for (const r of roundNames) cols.push({ name: `Fitness_vs_WT_${r}`, type: "float" });
  return cols;
}
