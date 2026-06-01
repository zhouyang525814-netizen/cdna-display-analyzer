// Comlink-exposed worker module. Vite picks this up via the
//   new Worker(new URL("./pipeline.worker.ts", import.meta.url), { type: "module" })
// invocation in workerClient.ts.
//
// We deliberately construct LocalFastqSource on the worker side so the File
// objects (which are structured-cloneable) cross only once, and the streaming
// reads never have to cross the boundary.

import * as Comlink from "comlink";
import {
  runPipeline,
  runNanoporePipeline,
  type NanoporePipelineProgress,
  type PipelineProgress,
} from "@cdna/core";
import type { IAuthProvider, IFastqSource } from "@cdna/types";
import { LocalFastqSource } from "../adapters/LocalFastqSource";
import { DriveFastqSource } from "../adapters/DriveFastqSource";
import type {
  NanoporeJob,
  NanoporeOutcome,
  PipelineJob,
  PipelineProgressMsg,
  PipelineOutcome,
} from "./types";

const PREVIEW_ROWS = 200;

// Worker-side console.log appears in DevTools under its own thread context;
// every `[worker]` line below shows up when DevTools → Console → "all
// contexts" is selected. This is the single source of truth when debugging
// a stuck pipeline — every long-running step gets logged on entry and exit.
function wlog(msg: string, extra?: unknown): void {
  if (extra !== undefined) {
    console.log(`[worker] ${msg}`, extra);
  } else {
    console.log(`[worker] ${msg}`);
  }
}

// Stub auth provider for the worker side: the main thread fetched a token
// before submitting the job, so we just hand that back. If the token expires
// mid-pipeline we surface the error and the user re-runs (token refresh
// across the worker boundary is a Phase 4+ concern).
function staticAuth(token: string): IAuthProvider {
  return {
    async signIn() {},
    async signOut() {},
    async getToken() {
      return token;
    },
    isSignedIn() {
      return true;
    },
  };
}

// Raw `message` listener BEFORE Comlink.expose — verifies that postMessage
// from the main thread is actually arriving at the worker. If this fires but
// `[worker] run() entered` doesn't, the message is reaching us but Comlink
// isn't dispatching it.
self.addEventListener("message", (event: MessageEvent) => {
  wlog("raw postMessage received", { dataType: typeof event.data, hasPort: event.ports.length });
});

wlog("module loaded — about to call Comlink.expose");

const api = {
  /**
   * Run the pipeline on a mix of local files and Drive files. The progress
   * callback is a Comlink proxy; calling it sends a structured-clone message
   * back to the main thread (one per ~64k records — see core/src/pipeline.ts).
   */
  async run(
    job: PipelineJob,
    onProgress?: (msg: PipelineProgressMsg) => void,
  ): Promise<PipelineOutcome> {
    const log = (m: string, extra?: unknown) => wlog(m, extra);

    try {
      log("run() entered", {
        localFiles: job.localFiles.length,
        driveFiles: job.driveFiles.length,
        rounds: job.rounds.length,
        useWasm: job.useWasm,
      });

      if (job.driveFiles.length > 0 && !job.driveToken) {
        throw new Error("Drive files specified but no OAuth token attached to the job.");
      }
      const auth = job.driveToken ? staticAuth(job.driveToken) : null;

      // Local files come first, then Drive files. Source-index ordering matches
      // the UI display so progress events point at the right name.
      const sources: IFastqSource[] = [
        ...job.localFiles.map((f) => new LocalFastqSource(f)),
        ...job.driveFiles.map((d) =>
          new DriveFastqSource({ id: d.id, name: d.name, sizeBytes: d.sizeBytes }, auth!),
        ),
      ];
      const sourceNames = [
        ...job.localFiles.map((f) => f.name),
        ...job.driveFiles.map((d) => d.name),
      ];
      log(`constructed ${sources.length} sources`, sourceNames);

      let lastReportedSrc = -1;
      const wrappedProgress = (p: PipelineProgress) => {
        // Log when we cross into a new source so the user sees "starting file N"
        if (p.sourceIndex !== lastReportedSrc) {
          lastReportedSrc = p.sourceIndex;
          log(
            `source[${p.sourceIndex}] = ${sourceNames[p.sourceIndex]} — first progress event`,
          );
        }
        onProgress?.({
          sourceIndex: p.sourceIndex,
          fileName: sourceNames[p.sourceIndex] ?? "",
          bytesProcessed: p.bytesProcessed,
          totalBytes: p.totalBytes,
          recordsProcessed: p.recordsProcessed,
        });
      };

      log("calling runPipeline …", {
        mode: job.mode ?? "multiplexed",
        sourceRoundIndices: job.sourceRoundIndices,
      });
      const result = await runPipeline({
        sources,
        rounds: job.rounds,
        settings: job.settings,
        useWasm: job.useWasm,
        onProgress: wrappedProgress,
        ...(job.mode === "per-round" && job.sourceRoundIndices
          ? { sourceRoundIndices: job.sourceRoundIndices }
          : {}),
      });
      log("runPipeline returned", {
        globalUnassigned: result.globalUnassigned,
        roundStats: Array.from(result.stats.entries()).map(([k, v]) => ({
          name: k,
          passed_qc: v.passed_qc,
        })),
      });

      // Flatten Maps → plain records so the postMessage clone succeeds.
      const statsByRound: Record<string, ReturnType<typeof result.stats.get> & {}> = {};
      for (const [name, stat] of result.stats) {
        statsByRound[name] = stat;
      }

      // Wrap the CSV in a Blob so postMessage doesn't deep-copy it. Blobs are
      // structured-cloneable but cross by reference, not value — this matters
      // when the CSV is tens of MB. We pass `csvParts` (a string[] of one
      // entry per line) straight to the Blob constructor: it accepts a list
      // of strings without ever concatenating them into one JS String, so the
      // CSV bytes can total many GB without tripping V8's ~537 MB string-
      // length ceiling.
      const csvParts = result.analyzer?.csvParts ?? null;
      const csvBlob = csvParts ? new Blob(csvParts, { type: "text/csv" }) : null;
      log(`csvParts lines=${csvParts?.length ?? 0} → wrapped as Blob (size=${csvBlob?.size ?? 0})`);

      return {
        runStatsJson: result.runStatsJson,
        csvBlob,
        globalUnassigned: result.globalUnassigned,
        unassignedBreakdown: result.unassignedBreakdown,
        statsByRound,
        roundNames: job.rounds.map((r) => r.name),
      };
    } catch (e: unknown) {
      const err = e as Error;
      const msg = `worker run() threw: ${err.name}: ${err.message}\n${err.stack ?? "(no stack)"}`;
      console.error(`[worker] ${msg}`);
      throw e;
    }
  },

  /**
   * Nanopore SSM run. Same boundary semantics as `run` (Comlink-proxied
   * progress, structured-clone payloads, Blob-wrapped CSVs) but routes to
   * `runNanoporePipeline` with per-site + haplotype output.
   */
  async runNanopore(
    job: NanoporeJob,
    onProgress?: (msg: PipelineProgressMsg) => void,
  ): Promise<NanoporeOutcome> {
    const log = (m: string, extra?: unknown) => wlog(m, extra);

    try {
      log("runNanopore() entered", {
        localFiles: job.localFiles.length,
        driveFiles: job.driveFiles.length,
        sites: job.sites.length,
        rounds: job.rounds.length,
        mode: job.mode ?? "multiplexed",
        useWasm: job.useWasm,
      });

      if (job.driveFiles.length > 0 && !job.driveToken) {
        throw new Error("Drive files specified but no OAuth token attached to the job.");
      }
      const auth = job.driveToken ? staticAuth(job.driveToken) : null;

      const sources: IFastqSource[] = [
        ...job.localFiles.map((f) => new LocalFastqSource(f)),
        ...job.driveFiles.map((d) =>
          new DriveFastqSource({ id: d.id, name: d.name, sizeBytes: d.sizeBytes }, auth!),
        ),
      ];
      const sourceNames = [
        ...job.localFiles.map((f) => f.name),
        ...job.driveFiles.map((d) => d.name),
      ];
      log(`constructed ${sources.length} sources`, sourceNames);

      let lastReportedSrc = -1;
      const wrappedProgress = (p: NanoporePipelineProgress) => {
        if (p.sourceIndex !== lastReportedSrc) {
          lastReportedSrc = p.sourceIndex;
          log(
            `[nanopore] source[${p.sourceIndex}] = ${sourceNames[p.sourceIndex]} — first progress event`,
          );
        }
        onProgress?.({
          sourceIndex: p.sourceIndex,
          fileName: sourceNames[p.sourceIndex] ?? "",
          bytesProcessed: p.bytesProcessed,
          totalBytes: p.totalBytes,
          recordsProcessed: p.recordsProcessed,
        });
      };

      log("calling runNanoporePipeline …");
      const result = await runNanoporePipeline({
        sources,
        reference: job.reference,
        sites: job.sites,
        rounds: job.rounds,
        ...(job.settings ? { settings: job.settings } : {}),
        useWasm: job.useWasm,
        onProgress: wrappedProgress,
        ...(job.mode === "per-round" && job.sourceRoundIndices
          ? { sourceRoundIndices: job.sourceRoundIndices }
          : {}),
      });
      log("runNanoporePipeline returned", {
        sites: result.siteNames.length,
        roundsWithStats: Array.from(result.stats.keys()),
        perSiteRows: result.analyzer.perSiteRows.length,
        haplotypeRows: result.analyzer.haplotypeRows.length,
      });

      // Flatten Map<round, NanoporeRoundStats> → Record. Each value already
      // has `sites: Record<string, NanoporeSiteStats>` so the nested shape
      // is already structurally cloneable.
      const statsByRound: Record<string, ReturnType<typeof result.stats.get> & {}> = {};
      for (const [name, stat] of result.stats) {
        statsByRound[name] = stat;
      }

      // Site → WT DNA map, used by the UI to badge WT rows.
      const resolvedWtBySite: Record<string, string> = {};
      const expectedRoiLenBySite: Record<string, number> = {};
      for (const s of result.resolvedSites) {
        resolvedWtBySite[s.name] = s.wtDna;
        expectedRoiLenBySite[s.name] = s.expectedRoiLen;
      }

      // Same string[] → Blob pattern as the cDNA path: avoids materializing
      // multi-GB CSV text as one JS String.
      const perSiteCsvParts = result.analyzer.perSiteCsvParts;
      const haplotypeCsvParts = result.analyzer.haplotypeCsvParts;
      const perSiteCsvBlob =
        perSiteCsvParts.length > 0 ? new Blob(perSiteCsvParts, { type: "text/csv" }) : null;
      const haplotypeCsvBlob =
        haplotypeCsvParts.length > 0 ? new Blob(haplotypeCsvParts, { type: "text/csv" }) : null;
      log(
        `csv lines: per-site=${perSiteCsvParts.length}, haplotype=${haplotypeCsvParts.length}` +
          ` (sizes: per-site=${perSiteCsvBlob?.size ?? 0}, hap=${haplotypeCsvBlob?.size ?? 0})`,
      );

      return {
        perSiteCsvBlob,
        haplotypeCsvBlob,
        perSiteRowsPreview: result.analyzer.perSiteRows.slice(0, PREVIEW_ROWS),
        haplotypeRowsPreview: result.analyzer.haplotypeRows.slice(0, PREVIEW_ROWS),
        statsByRound,
        globalBreakdown: result.globalBreakdown,
        roundNames: result.roundNames,
        siteNames: result.siteNames,
        resolvedWtBySite,
        expectedRoiLenBySite,
      };
    } catch (e: unknown) {
      const err = e as Error;
      const msg = `worker runNanopore() threw: ${err.name}: ${err.message}\n${err.stack ?? "(no stack)"}`;
      console.error(`[worker] ${msg}`);
      throw e;
    }
  },
};

export type PipelineWorkerApi = typeof api;

try {
  Comlink.expose(api);
  wlog("Comlink.expose() returned successfully");
} catch (e: unknown) {
  console.error("[worker] Comlink.expose() threw:", e);
}

// Critical: signal the main thread that we're fully ready to accept
// messages. With module workers + top-level-await (used by the WASM
// init), messages sent before the worker finishes evaluating its module
// are silently dropped by Chrome. The main thread waits for this signal
// before posting anything; until then it just queues calls.
self.postMessage({ __ready: true, ts: Date.now() });
wlog("__ready signal sent to main thread");
