import { describe, expect, it } from "vitest";
import { bandedAlign, bandedAlignAscii } from "../src/banded-align.js";

describe("bandedAlign — exact matches", () => {
  it("finds an exact match at position 0", () => {
    const r = bandedAlignAscii("ACGTACGT", "ACGT", 0, 0);
    expect(r.found).toBe(true);
    expect(r.start).toBe(0);
    expect(r.end).toBe(4);
    expect(r.score).toBe(0);
  });

  it("finds an exact match in the middle of a longer haystack", () => {
    const r = bandedAlignAscii("NNNNNACGTACGTNNNNN", "ACGTACGT", 0, 0);
    expect(r.found).toBe(true);
    expect(r.start).toBe(5);
    expect(r.end).toBe(13);
    expect(r.score).toBe(0);
  });

  it("returns earliest position on multiple exact matches", () => {
    const r = bandedAlignAscii("ACGTACGT", "ACGT", 0, 0);
    expect(r.start).toBe(0); // not 4
  });

  it("returns not-found when the needle is absent and no edits allowed", () => {
    const r = bandedAlignAscii("AAAAAA", "GGGG", 0, 0);
    expect(r.found).toBe(false);
  });
});

describe("bandedAlign — substitutions", () => {
  it("finds a 1-sub match with maxSubs=1", () => {
    // Needle ACGT vs haystack window ACCT (sub at position 2)
    const r = bandedAlignAscii("NNNACCTNNN", "ACGT", 1, 0);
    expect(r.found).toBe(true);
    expect(r.start).toBe(3);
    expect(r.score).toBe(1);
  });

  it("rejects a 2-sub match when maxSubs=1, maxIndels=0", () => {
    // ACGT vs AGCT has 2 substitutions (positions 1,2)
    const r = bandedAlignAscii("AGCT", "ACGT", 1, 0);
    expect(r.found).toBe(false);
  });

  it("accepts a 2-sub match when maxSubs=2", () => {
    const r = bandedAlignAscii("AGCT", "ACGT", 2, 0);
    expect(r.found).toBe(true);
    expect(r.score).toBe(2);
  });

  it("prefers a lower-score alignment when both are within tolerance", () => {
    // Needle ACGT. Haystack contains ACGT (exact, score 0) and ACAT (1 sub).
    // Should pick the exact one even though it's later.
    const r = bandedAlignAscii("NACATNACGTN", "ACGT", 1, 0);
    expect(r.score).toBe(0);
    expect(r.start).toBe(6);
  });
});

describe("bandedAlign — indels", () => {
  it("finds a 1-insertion-in-haystack match (haystack longer by 1)", () => {
    // Needle ACGT vs haystack window ACGGT — one base inserted relative to
    // needle. Multiple window lengths (3, 4, 5) all yield score 1 against
    // this haystack; the algorithm picks one of them deterministically.
    const r = bandedAlignAscii("NNNACGGTNNN", "ACGT", 0, 1);
    expect(r.found).toBe(true);
    expect(r.score).toBe(1);
    expect(r.start).toBe(3);
  });

  it("finds a 1-insertion-in-needle match (haystack shorter by 1)", () => {
    // Needle ACGT vs haystack ACT — one deletion in haystack.
    const r = bandedAlignAscii("NNNACTNNN", "ACGT", 0, 1);
    expect(r.found).toBe(true);
    expect(r.score).toBe(1);
    expect(r.end - r.start).toBe(3); // window of length m-1
  });

  it("rejects a 2-indel match when maxIndels=1", () => {
    // Needle ACGT vs haystack AC — two deletions.
    const r = bandedAlignAscii("NNNACNNN", "ACGT", 0, 1);
    expect(r.found).toBe(false);
  });
});

describe("bandedAlign — combined errors", () => {
  it("accepts 2 subs + 1 indel with budget=3", () => {
    // Needle ACGTACGT (8 bp). Haystack window ATTTACGT (2 subs at pos 1,2)
    // followed by ACGTACGTA (1 insertion). Combined budget = 3.
    const r = bandedAlignAscii("ATTTACGTA", "ACGTACGT", 2, 1);
    expect(r.found).toBe(true);
    expect(r.score).toBeLessThanOrEqual(3);
  });

  it("rejects when total edits exceed maxSubs + maxIndels", () => {
    // 3 substitutions, budget 2 (2 subs + 0 indels via maxSubs=1 maxIndels=1).
    const r = bandedAlignAscii("ATTTACGT", "ACCCACGT", 1, 1);
    expect(r.found).toBe(false);
  });
});

describe("bandedAlign — realistic Nanopore-anchor cases", () => {
  it("locates a 19-bp anchor in a 50-bp window with 1 sub + 1 indel", () => {
    const anchor = "GCAACTGGCTAGAATTCCG";
    // Insert a base into the anchor and substitute one — simulate Nanopore
    // error in a flank.
    const noisy = "GCAACTGGCTAGAA" + "A" + "TTCCG"; // 1 insertion
    const noisier = noisy.replace("CTAGAA", "CCAGAA"); // 1 substitution
    const haystack = "TGCAGTACGTTAGCC" + noisier + "AACGGTT";
    const r = bandedAlignAscii(haystack, anchor, 2, 1);
    expect(r.found).toBe(true);
    expect(r.score).toBeLessThanOrEqual(2);
  });

  it("finds the anchor at the very start of the haystack", () => {
    const anchor = "GCAACTGGCTAGAATTCCG";
    const r = bandedAlignAscii(anchor + "AAAAA", anchor, 0, 0);
    expect(r.start).toBe(0);
    expect(r.score).toBe(0);
  });

  it("finds the anchor at the very end of the haystack", () => {
    const anchor = "GCAACTGGCTAGAATTCCG";
    const r = bandedAlignAscii("AAAAA" + anchor, anchor, 0, 0);
    expect(r.start).toBe(5);
    expect(r.end).toBe(5 + anchor.length);
  });
});

describe("bandedAlign — edge cases", () => {
  it("returns not-found for empty needle", () => {
    const r = bandedAlignAscii("ACGT", "", 0, 0);
    expect(r.found).toBe(false);
  });

  it("returns not-found for empty haystack", () => {
    const r = bandedAlignAscii("", "ACGT", 0, 0);
    expect(r.found).toBe(false);
  });

  it("returns not-found when haystack shorter than min match length", () => {
    // Needle 10 bp, maxIndels 1 → minimum match length 9, haystack 5.
    const r = bandedAlignAscii("ACGTA", "ACGTACGTAC", 5, 1);
    expect(r.found).toBe(false);
  });

  it("accepts Uint8Array inputs directly (not just ASCII strings)", () => {
    const haystack = new Uint8Array([65, 67, 71, 84, 65, 67, 71, 84]); // ACGTACGT
    const needle = new Uint8Array([65, 67, 71, 84]); // ACGT
    const r = bandedAlign(haystack, needle, 0, 0);
    expect(r.found).toBe(true);
    expect(r.start).toBe(0);
  });
});
