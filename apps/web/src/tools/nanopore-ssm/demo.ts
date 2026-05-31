// Tutorial demo data for the Nanopore SSM tool. Mirrors the cDNA demo's
// pattern: a fetch from /sample-data/*.fastq (the same FASTQs the core
// 2-site smoke test uses, bundled as static assets in apps/web/public/) +
// a pre-built config the Sources step pre-fills into the store.

import type { NanoporeSite, NanoporeRoundForm } from "@/state/useNanoporeStore";

// Reference + anchors come from 00_material/test_nanopore/expected_counts.json
// (1-site fixture). Easy starter — single codon at WT Ala, 3 selection rounds.
export const NP_DEMO_REFERENCE =
  "TGCAGTACGTTAGCCAGTCTGAAGCATGTCAGGTCAGTGT" +
  "GCAACTGGCTAGAATTCCG" + "GCT" + "GGAAGCTAGCGAATTCAAT" +
  "AACCGGTTAACGTTCAGCATGCATGCATGCATGCATGCAT";

export const NP_DEMO_SITES: ReadonlyArray<Omit<NanoporeSite, "id">> = [
  {
    name: "site_1",
    fwAnchor: "GCAACTGGCTAGAATTCCG",
    rvAnchor: "GGAAGCTAGCGAATTCAAT",
  },
];

/** Round metadata only — the per-round FASTQ files are loaded asynchronously
 *  via loadDemoFastqs() below and merged in by the Sources step's tutorial
 *  loader. */
export const NP_DEMO_ROUNDS: ReadonlyArray<Omit<NanoporeRoundForm, "id" | "file" | "driveRef">> = [
  { name: "Round_0", barcode: "" },
  { name: "Round_1", barcode: "" },
  { name: "Round_2", barcode: "" },
];

const FASTQ_FILES = [
  { round: "Round_0", url: "/sample-data/nanopore_round0.fastq", filename: "nanopore_round0.fastq" },
  { round: "Round_1", url: "/sample-data/nanopore_round1.fastq", filename: "nanopore_round1.fastq" },
  { round: "Round_2", url: "/sample-data/nanopore_round2.fastq", filename: "nanopore_round2.fastq" },
];

export interface DemoFastqBundle {
  round: string;
  file: File;
}

/** Fetch all per-round demo FASTQs and wrap them in browser File objects. */
export async function loadDemoFastqs(): Promise<DemoFastqBundle[]> {
  const out: DemoFastqBundle[] = [];
  for (const f of FASTQ_FILES) {
    const res = await fetch(f.url);
    if (!res.ok) {
      throw new Error(`Failed to load demo FASTQ ${f.filename}: HTTP ${res.status}`);
    }
    const blob = await res.blob();
    out.push({
      round: f.round,
      file: new File([blob], f.filename, { type: "application/octet-stream" }),
    });
  }
  return out;
}
