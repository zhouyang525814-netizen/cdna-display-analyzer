// Shared CSV parser for the visualization components. Walks the analyzer's
// Master_Enrichment_Matrix.csv once, returning a typed array of peptide
// records along with the discovered round names. The CSV is already sorted
// (analyzer step) so the first N records are the top-N by global enrichment.
//
// We parse line-by-line via indexOf rather than csv.split("\n") so we never
// allocate the full N-row array of substrings when the caller only wants a
// prefix.

export interface PeptideRecord {
  peptide: string;
  gc: number;
  dominantDna: string;
  /** Round name → raw count for this peptide. */
  count: Record<string, number>;
  /** Round name → reads per million (counts normalised by passed_qc). */
  rpm: Record<string, number>;
  /** Enrich_Stepwise_<roundB>_vs_<roundA>, indexed by the destination round. */
  stepwise: Record<string, number>;
  /** Enrich_Global_<roundN>_vs_<round0>, indexed by the destination round. */
  global: Record<string, number>;
}

export interface ParsedMatrix {
  rows: PeptideRecord[];
  /** Round names extracted from the column headers, in input order. */
  roundNames: string[];
}

/** Walk the CSV up to `limit` data rows (or to end if limit omitted). */
export function parseEnrichmentMatrix(csv: string, limit?: number): ParsedMatrix {
  const empty: ParsedMatrix = { rows: [], roundNames: [] };
  if (!csv) return empty;

  const headerEnd = csv.indexOf("\n");
  if (headerEnd === -1) return empty;
  const headers = csv.slice(0, headerEnd).split(",");

  const pepCol = headers.indexOf("Peptide_Seq");
  const gcCol = headers.indexOf("GC_Percent");
  const dnaCol = headers.indexOf("Dominant_DNA_Seq");

  // Column-name maps for the per-round series so we don't re-scan headers
  // for every row.
  const countCols: { round: string; idx: number }[] = [];
  const rpmCols: { round: string; idx: number }[] = [];
  const stepwiseCols: { dest: string; idx: number }[] = [];
  const globalCols: { dest: string; idx: number }[] = [];
  const roundNamesSet = new Set<string>();

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i]!;
    if (h.startsWith("Count_")) {
      const round = h.slice("Count_".length);
      countCols.push({ round, idx: i });
      roundNamesSet.add(round);
    } else if (h.startsWith("RPM_")) {
      const round = h.slice("RPM_".length);
      rpmCols.push({ round, idx: i });
      roundNamesSet.add(round);
    } else if (h.startsWith("Enrich_Stepwise_")) {
      // Header pattern: Enrich_Stepwise_<dest>_vs_<src>. We key by dest.
      const rest = h.slice("Enrich_Stepwise_".length);
      const sepIdx = rest.indexOf("_vs_");
      const dest = sepIdx === -1 ? rest : rest.slice(0, sepIdx);
      stepwiseCols.push({ dest, idx: i });
    } else if (h.startsWith("Enrich_Global_")) {
      const rest = h.slice("Enrich_Global_".length);
      const sepIdx = rest.indexOf("_vs_");
      const dest = sepIdx === -1 ? rest : rest.slice(0, sepIdx);
      globalCols.push({ dest, idx: i });
    }
  }

  const roundNames = Array.from(roundNamesSet);

  const rows: PeptideRecord[] = [];
  let lineStart = headerEnd + 1;
  while (limit === undefined || rows.length < limit) {
    const lineEnd = csv.indexOf("\n", lineStart);
    const end = lineEnd === -1 ? csv.length : lineEnd;
    if (end <= lineStart) {
      if (lineEnd === -1) break;
      lineStart = lineEnd + 1;
      continue;
    }
    const cells = csv.slice(lineStart, end).split(",");
    const rec: PeptideRecord = {
      peptide: cells[pepCol] ?? "",
      gc: Number(cells[gcCol] ?? "0"),
      dominantDna: cells[dnaCol] ?? "",
      count: {},
      rpm: {},
      stepwise: {},
      global: {},
    };
    for (const { round, idx } of countCols) {
      rec.count[round] = Number(cells[idx] ?? "0");
    }
    for (const { round, idx } of rpmCols) {
      rec.rpm[round] = Number(cells[idx] ?? "0");
    }
    for (const { dest, idx } of stepwiseCols) {
      const v = cells[idx];
      if (v != null && v !== "") rec.stepwise[dest] = Number(v);
    }
    for (const { dest, idx } of globalCols) {
      const v = cells[idx];
      if (v != null && v !== "") rec.global[dest] = Number(v);
    }
    rows.push(rec);
    if (lineEnd === -1) break;
    lineStart = lineEnd + 1;
  }

  return { rows, roundNames };
}

export interface PerRoundCounts {
  /** Round name → sorted-descending array of per-peptide counts. Length = number
   *  of distinct peptides observed in that round (peptides with count 0 are
   *  excluded). */
  countsByRound: Record<string, number[]>;
  /** Round name → total reads passing QC (= sum of counts). This is the same
   *  value RPM normalisation uses upstream. */
  totalsByRound: Record<string, number>;
  /** Round names in CSV column order. */
  roundNames: string[];
}

/** Streaming pass over the analyzer CSV that pulls *only* the per-round Count
 *  columns into compact number arrays — no PeptideRecord objects, no row cap.
 *  Used by viz components that need to see the full per-round distribution
 *  (rank-abundance, count histogram) without being biased by the matrix sort
 *  + top-N cap that `parseEnrichmentMatrix` uses for the per-peptide UI.
 *
 *  Memory: O(unique peptides × rounds) numbers. For a 500k-peptide library
 *  with 4 rounds that's ~16 MB — fine on commodity hardware. */
export function parsePerRoundCounts(csv: string): PerRoundCounts {
  const empty: PerRoundCounts = { countsByRound: {}, totalsByRound: {}, roundNames: [] };
  if (!csv) return empty;

  const headerEnd = csv.indexOf("\n");
  if (headerEnd === -1) return empty;
  const headers = csv.slice(0, headerEnd).split(",");

  const countCols: { round: string; idx: number }[] = [];
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i]!;
    if (h.startsWith("Count_")) {
      countCols.push({ round: h.slice("Count_".length), idx: i });
    }
  }
  if (countCols.length === 0) return empty;

  const countsByRound: Record<string, number[]> = {};
  const totalsByRound: Record<string, number> = {};
  for (const { round } of countCols) {
    countsByRound[round] = [];
    totalsByRound[round] = 0;
  }

  const maxIdx = countCols.reduce((m, c) => Math.max(m, c.idx), 0);
  const csvLen = csv.length;
  let lineStart = headerEnd + 1;
  while (lineStart < csvLen) {
    const lineEnd = csv.indexOf("\n", lineStart);
    const end = lineEnd === -1 ? csvLen : lineEnd;
    if (end <= lineStart) {
      if (lineEnd === -1) break;
      lineStart = lineEnd + 1;
      continue;
    }
    // Walk commas manually — only collect the cells we actually need. This
    // avoids allocating an N-element array per row when N can be 15+.
    const cellStarts = new Array<number>(maxIdx + 2);
    cellStarts[0] = lineStart;
    let col = 1;
    for (let i = lineStart; i < end && col <= maxIdx + 1; i++) {
      if (csv.charCodeAt(i) === 44) { // ','
        cellStarts[col++] = i + 1;
      }
    }
    cellStarts[col] = end + 1;

    for (const { round, idx } of countCols) {
      const s = cellStarts[idx];
      const e = cellStarts[idx + 1];
      if (s == null || e == null) continue;
      // e is the position *after* the comma → real cell end is e - 1.
      const v = Number(csv.slice(s, e - 1));
      if (Number.isFinite(v) && v > 0) {
        countsByRound[round]!.push(v);
        totalsByRound[round]! += v;
      }
    }

    if (lineEnd === -1) break;
    lineStart = lineEnd + 1;
  }

  for (const round of Object.keys(countsByRound)) {
    countsByRound[round]!.sort((a, b) => b - a);
  }

  return {
    countsByRound,
    totalsByRound,
    roundNames: countCols.map((c) => c.round),
  };
}
