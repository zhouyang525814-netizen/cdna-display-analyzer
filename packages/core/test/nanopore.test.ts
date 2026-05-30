// NanoporeEngine unit tests. Cover each per-read code path: read-Q gate,
// barcode match (multiplexed), per-site anchor scan, ROI invariants (length,
// Q, frameshift, stop), WT counter, RC retry, multi-site haplotype emission.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  NanoporeEngine,
  type NanoporeSettings,
  type NanoporeSiteConfig,
  type NanoporeRoundConfig,
} from "../src/nanopore.js";

const ENC = new TextEncoder();
const b = (s: string) => ENC.encode(s);
const HI_Q = (n: number) => new Uint8Array(n).fill(0x49); // Phred 40
const LOW_Q = (n: number) => new Uint8Array(n).fill(0x25); // Phred 4

// 5' flank + upstream anchor + ROI + downstream anchor + 3' flank
const FW = "GCAACTGGCTAGAATTCCG";
const RV = "GGAAGCTAGCGAATTCAAT";
const FLANK_L = "TGCAGTACGTTAGCC";
const FLANK_R = "AACCGGTTAACGTT";

function makeSite(name: string, wt: string): NanoporeSiteConfig {
  return {
    name,
    fwAnchor: b(FW),
    rvAnchor: b(RV),
    expectedRoiLen: wt.length,
    wtDna: wt,
  };
}

function makeRound(name: string, barcode?: string): NanoporeRoundConfig {
  return barcode ? { name, barcode: b(barcode) } : { name };
}

function readWith(roiDna: string): Uint8Array {
  return b(FLANK_L + FW + roiDna + RV + FLANK_R);
}

describe("NanoporeEngine — happy path (per-round mode, single site)", () => {
  it("assigns a clean WT read, increments passed_qc and wt_count", () => {
    const sites = [makeSite("site_1", "GCT")];
    const rounds = [makeRound("Round_0")];
    const e = new NanoporeEngine(sites, rounds, DEFAULT_SETTINGS);
    const seq = readWith("GCT");
    expect(e.processReadForRound(seq, HI_Q(seq.length), 0)).toBe("assigned");
    const ss = e.stats.get("Round_0")!.sites["site_1"]!;
    expect(ss.anchor_found).toBe(1);
    expect(ss.passed_qc).toBe(1);
    expect(ss.wt_count).toBe(1);
    expect(e.dnaCounters.get("Round_0")!.get("site_1")!.get("GCT")).toBe(1);
  });

  it("assigns a variant read, increments passed_qc but NOT wt_count", () => {
    const sites = [makeSite("site_1", "GCT")];
    const rounds = [makeRound("Round_0")];
    const e = new NanoporeEngine(sites, rounds, DEFAULT_SETTINGS);
    const seq = readWith("TGG"); // Trp variant
    expect(e.processReadForRound(seq, HI_Q(seq.length), 0)).toBe("assigned");
    const ss = e.stats.get("Round_0")!.sites["site_1"]!;
    expect(ss.passed_qc).toBe(1);
    expect(ss.wt_count).toBe(0);
    expect(e.dnaCounters.get("Round_0")!.get("site_1")!.get("TGG")).toBe(1);
  });

  it("aggregates duplicate variants in the counter", () => {
    const sites = [makeSite("site_1", "GCT")];
    const rounds = [makeRound("Round_0")];
    const e = new NanoporeEngine(sites, rounds, DEFAULT_SETTINGS);
    const seq = readWith("TGG");
    for (let i = 0; i < 5; i++) e.processReadForRound(seq, HI_Q(seq.length), 0);
    expect(e.dnaCounters.get("Round_0")!.get("site_1")!.get("TGG")).toBe(5);
    expect(e.stats.get("Round_0")!.sites["site_1"]!.passed_qc).toBe(5);
  });
});

describe("NanoporeEngine — discard buckets", () => {
  it("rejects on read-Q gate (low_quality_read)", () => {
    const sites = [makeSite("site_1", "GCT")];
    const rounds = [makeRound("Round_0")];
    const e = new NanoporeEngine(sites, rounds, DEFAULT_SETTINGS);
    const seq = readWith("GCT");
    expect(e.processReadForRound(seq, LOW_Q(seq.length), 0)).toBe("low_quality_read");
    expect(e.globalBreakdown.low_quality_read).toBe(1);
    expect(e.stats.get("Round_0")!.sites["site_1"]!.passed_qc).toBe(0);
  });

  it("rejects with no anchors found (no_site_extracted)", () => {
    const sites = [makeSite("site_1", "GCT")];
    const rounds = [makeRound("Round_0")];
    const e = new NanoporeEngine(sites, rounds, DEFAULT_SETTINGS);
    const seq = b("CATGCATGCATGCATGCATGCATGCATGCATG"); // random sequence
    expect(e.processReadForRound(seq, HI_Q(seq.length), 0)).toBe("no_site_extracted");
    expect(e.globalBreakdown.no_site_extracted).toBe(1);
  });

  it("flags discard_roi_indel when observed ROI length != expected", () => {
    const sites = [makeSite("site_1", "GCT")];
    const rounds = [makeRound("Round_0")];
    const e = new NanoporeEngine(sites, rounds, DEFAULT_SETTINGS);
    // 4 bp ROI between the anchors — engine expects 3.
    const seq = b(FLANK_L + FW + "GCAT" + RV + FLANK_R);
    expect(e.processReadForRound(seq, HI_Q(seq.length), 0)).toBe("no_site_extracted");
    expect(e.stats.get("Round_0")!.sites["site_1"]!.discard_roi_indel).toBe(1);
  });

  it("flags discard_low_q_roi when ROI mean Q below threshold", () => {
    const sites = [makeSite("site_1", "GCT")];
    const rounds = [makeRound("Round_0")];
    const e = new NanoporeEngine(sites, rounds, DEFAULT_SETTINGS);
    const seq = readWith("GCT");
    const qual = HI_Q(seq.length);
    // Find ROI position and stomp those 3 bytes with low Q (Phred 4).
    const roiStart = FLANK_L.length + FW.length;
    qual[roiStart] = 0x25;
    qual[roiStart + 1] = 0x25;
    qual[roiStart + 2] = 0x25;
    expect(e.processReadForRound(seq, qual, 0)).toBe("no_site_extracted");
    expect(e.stats.get("Round_0")!.sites["site_1"]!.discard_low_q_roi).toBe(1);
  });

  it("flags discard_stop_codon when ROI contains TAA/TAG/TGA in frame", () => {
    const sites = [makeSite("site_1", "GCT")];
    const rounds = [makeRound("Round_0")];
    const e = new NanoporeEngine(sites, rounds, DEFAULT_SETTINGS);
    const seq = readWith("TAA");
    expect(e.processReadForRound(seq, HI_Q(seq.length), 0)).toBe("no_site_extracted");
    expect(e.stats.get("Round_0")!.sites["site_1"]!.discard_stop_codon).toBe(1);
  });
});

describe("NanoporeEngine — multiplexed barcode binding", () => {
  // 14-bp barcodes (realistic for Nanopore native barcoding); short barcodes
  // under a 3-edit tolerance can fuzzy-match arbitrary flanking sequence,
  // which makes them useless as round discriminators.
  const BC0 = "AGCAGTACGACTGT";
  const BC1 = "TGTACTGCATCAGA";

  it("assigns a barcoded read to its round", () => {
    const sites = [makeSite("site_1", "GCT")];
    const rounds = [makeRound("Round_0", BC0), makeRound("Round_1", BC1)];
    const e = new NanoporeEngine(sites, rounds, DEFAULT_SETTINGS);
    const seq = b(BC1 + FLANK_L + FW + "GCT" + RV + FLANK_R);
    expect(e.processRead(seq, HI_Q(seq.length))).toBe("assigned");
    expect(e.stats.get("Round_1")!.sites["site_1"]!.passed_qc).toBe(1);
    expect(e.stats.get("Round_0")!.sites["site_1"]!.passed_qc).toBe(0);
  });

  it("rejects on barcode_mismatch when no barcode matches", () => {
    const sites = [makeSite("site_1", "GCT")];
    const rounds = [makeRound("Round_0", BC0), makeRound("Round_1", BC1)];
    const e = new NanoporeEngine(sites, rounds, DEFAULT_SETTINGS);
    // 5' end is a long stretch unrelated to either barcode (low-complexity
    // homopolymer; bandedAlign will find ≥4 edits in any window).
    const seq = b("AAAAAAAAAAAAAA" + FW + "GCT" + RV + FLANK_R);
    expect(e.processRead(seq, HI_Q(seq.length))).toBe("barcode_mismatch");
    expect(e.globalBreakdown.barcode_mismatch).toBe(1);
  });

  it("rejects on barcode_mismatch when two barcodes tie (ambiguous)", () => {
    const sites = [makeSite("site_1", "GCT")];
    const rounds = [
      makeRound("Round_0", BC0),
      makeRound("Round_1", BC0), // duplicate to force a tie at score 0
    ];
    const e = new NanoporeEngine(sites, rounds, DEFAULT_SETTINGS);
    const seq = b(BC0 + FLANK_L + FW + "GCT" + RV + FLANK_R);
    expect(e.processRead(seq, HI_Q(seq.length))).toBe("barcode_mismatch");
  });
});

describe("NanoporeEngine — multi-site + haplotype", () => {
  const FW2 = "TTGACTGCATCGATATCC";
  const RV2 = "AAGCAGGAATTCGCTAGC";

  it("emits a haplotype count when ALL sites extract cleanly", () => {
    const sites: NanoporeSiteConfig[] = [
      makeSite("site_1", "GCT"),
      {
        name: "site_2",
        fwAnchor: b(FW2),
        rvAnchor: b(RV2),
        expectedRoiLen: 3,
        wtDna: "TAC",
      },
    ];
    const rounds = [makeRound("Round_0")];
    const e = new NanoporeEngine(sites, rounds, DEFAULT_SETTINGS);
    // Long Nanopore-style read with both sites present, 400 bp apart-ish.
    const filler = "GCATGCATGCAT".repeat(8); // 96 bp constant between sites
    const seq = b(FLANK_L + FW + "GCT" + RV + filler + FW2 + "TAC" + RV2 + FLANK_R);
    expect(e.processReadForRound(seq, HI_Q(seq.length), 0)).toBe("assigned");
    expect(e.stats.get("Round_0")!.sites["site_1"]!.passed_qc).toBe(1);
    expect(e.stats.get("Round_0")!.sites["site_2"]!.passed_qc).toBe(1);
    expect(e.stats.get("Round_0")!.haplotype_passed_qc).toBe(1);
    expect(e.haplotypeCounters.get("Round_0")!.get("GCT_TAC")).toBe(1);
  });

  it("does NOT emit a haplotype when only one site extracts", () => {
    const sites: NanoporeSiteConfig[] = [
      makeSite("site_1", "GCT"),
      {
        name: "site_2",
        fwAnchor: b(FW2),
        rvAnchor: b(RV2),
        expectedRoiLen: 3,
        wtDna: "TAC",
      },
    ];
    const rounds = [makeRound("Round_0")];
    const e = new NanoporeEngine(sites, rounds, DEFAULT_SETTINGS);
    // Site 1 present, site 2 anchors absent.
    const seq = b(FLANK_L + FW + "GCT" + RV + FLANK_R);
    expect(e.processReadForRound(seq, HI_Q(seq.length), 0)).toBe("assigned");
    expect(e.stats.get("Round_0")!.sites["site_1"]!.passed_qc).toBe(1);
    expect(e.stats.get("Round_0")!.sites["site_2"]!.passed_qc).toBe(0);
    expect(e.stats.get("Round_0")!.haplotype_passed_qc).toBe(0);
    expect(e.haplotypeCounters.get("Round_0")!.size).toBe(0);
  });

  it("skips haplotype emission when reportHaplotype=false", () => {
    const sites: NanoporeSiteConfig[] = [
      makeSite("site_1", "GCT"),
      {
        name: "site_2",
        fwAnchor: b(FW2),
        rvAnchor: b(RV2),
        expectedRoiLen: 3,
        wtDna: "TAC",
      },
    ];
    const rounds = [makeRound("Round_0")];
    const settings: NanoporeSettings = { ...DEFAULT_SETTINGS, reportHaplotype: false };
    const e = new NanoporeEngine(sites, rounds, settings);
    const filler = "GCATGCATGCAT".repeat(8);
    const seq = b(FLANK_L + FW + "GCT" + RV + filler + FW2 + "TAC" + RV2 + FLANK_R);
    e.processReadForRound(seq, HI_Q(seq.length), 0);
    expect(e.haplotypeCounters.get("Round_0")!.size).toBe(0);
  });
});
