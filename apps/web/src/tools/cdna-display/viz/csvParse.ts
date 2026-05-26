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
