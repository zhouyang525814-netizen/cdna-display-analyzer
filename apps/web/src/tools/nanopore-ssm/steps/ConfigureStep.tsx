// Nanopore SSM — Configure step. Inputs:
//   - reference amplicon (shared across all sites + rounds)
//   - one or more variable sites, each with its own anchor pair (Nanopore
//     reads can span 1–100 kb so sites may be far apart)
//   - selection rounds (multiplexed: per-round barcode; per-round: per-round file)
//   - advanced QC defaults
//
// The "site" abstraction is what handles both single-codon SSM (1 site, 3 bp ROI)
// and distant double-site SSM (2 sites, each with its own anchors). Per-site
// counts are always emitted; linked-haplotype counts are emitted when ≥2 sites
// AND all sites extract successfully from the same read.

import { useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Cloud,
  FileText,
  FileUp,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  canContinueFromConfigure,
  findAllSitesInReference,
  useNanoporeStore,
  type DriveFileRef,
} from "@/state/useNanoporeStore";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  DriveAuthProvider,
  isDriveSignedIn,
} from "@/adapters/DriveAuthProvider";
import { showDrivePicker } from "@/adapters/DrivePicker";
import {
  LIMITS,
  peekFastq,
  sanitizeDna,
  sanitizeRoundName,
  validateFastqFileSync,
} from "@/lib/validation";

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;
const ANCHOR_MAX = 100;
const BARCODE_MAX = 32;
const SITE_NAME_MAX = 50;

function sanitizeSiteName(s: string): string {
  return s.replace(/[^a-zA-Z0-9_]/g, "").slice(0, SITE_NAME_MAX);
}

export function ConfigureStep() {
  const pipelineMode = useNanoporeStore((s) => s.pipelineMode);
  const referenceSeq = useNanoporeStore((s) => s.referenceSeq);
  const setReferenceSeq = useNanoporeStore((s) => s.setReferenceSeq);
  const sites = useNanoporeStore((s) => s.sites);
  const addSite = useNanoporeStore((s) => s.addSite);
  const removeSite = useNanoporeStore((s) => s.removeSite);
  const updateSite = useNanoporeStore((s) => s.updateSite);
  const rounds = useNanoporeStore((s) => s.rounds);
  const addRound = useNanoporeStore((s) => s.addRound);
  const removeRound = useNanoporeStore((s) => s.removeRound);
  const updateRound = useNanoporeStore((s) => s.updateRound);
  const reportHaplotype = useNanoporeStore((s) => s.reportHaplotype);
  const setReportHaplotype = useNanoporeStore((s) => s.setReportHaplotype);
  const minMeanPhredRead = useNanoporeStore((s) => s.minMeanPhredRead);
  const setMinMeanPhredRead = useNanoporeStore((s) => s.setMinMeanPhredRead);
  const minMeanPhredRoi = useNanoporeStore((s) => s.minMeanPhredRoi);
  const setMinMeanPhredRoi = useNanoporeStore((s) => s.setMinMeanPhredRoi);
  const goNext = useNanoporeStore((s) => s.goNext);
  const goPrev = useNanoporeStore((s) => s.goPrev);

  const canContinue = useNanoporeStore(canContinueFromConfigure);
  const refSanitizedLen = referenceSeq.replace(/[^ACGTNacgtn]/g, "").length;
  // Pure function via useMemo — calling it as a Zustand selector returns a
  // new object reference on every store update and trips Zustand v5's
  // getSnapshot caching, blanking the page.
  const alignment = useMemo(
    () => findAllSitesInReference(sites, referenceSeq),
    [sites, referenceSeq],
  );

  // Multiplexed-mode barcode uniqueness check (inline warning per row).
  const dupBarcodes = (() => {
    if (pipelineMode !== "multiplexed") return new Set<string>();
    const counts = new Map<string, number>();
    for (const r of rounds) {
      const b = r.barcode.toUpperCase();
      if (b) counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    return new Set(Array.from(counts.entries()).filter(([_, n]) => n > 1).map(([b]) => b));
  })();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reference amplicon</CardTitle>
          <CardDescription>
            Paste the WT amplicon DNA covering all variable sites. The engine
            uses regions matching the reference exactly as the WT baseline for
            modeling basecaller error.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="np-ref">Reference (single sequence)</Label>
          <Textarea
            id="np-ref"
            rows={4}
            value={referenceSeq}
            onChange={(e) => setReferenceSeq(sanitizeDna(e.target.value, LIMITS.REFERENCE_MAX))}
            placeholder="ACGT...  (paste WT amplicon spanning every variable site)"
            className="font-mono text-xs"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Plain ACGT, 30–50,000 bp. Current: {refSanitizedLen.toLocaleString()} bp.</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Variable sites</CardTitle>
            <CardDescription>
              Each site is one anchor-bounded variable region. Use one site for
              single-codon SSM or a tight window; add more sites for spatially
              separated saturated positions. Nanopore reads can span all of them.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={addSite}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add site
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {sites.map((site, i) => {
            const align = alignment.sites[i];
            return (
              <div key={site.id} className="rounded-md border bg-muted/20 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                      {i + 1}
                    </span>
                    <Input
                      className="h-8 w-44 text-sm"
                      value={site.name}
                      onChange={(e) => updateSite(site.id, { name: sanitizeSiteName(e.target.value) })}
                      placeholder="site name"
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground"
                    disabled={sites.length <= 1}
                    onClick={() => removeSite(site.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor={`fw-${site.id}`} className="text-xs">
                      Upstream anchor (5′ flank, 12–30 bp)
                    </Label>
                    <Input
                      id={`fw-${site.id}`}
                      value={site.fwAnchor}
                      onChange={(e) => updateSite(site.id, { fwAnchor: sanitizeDna(e.target.value, ANCHOR_MAX) })}
                      className="font-mono text-xs"
                      placeholder="e.g. GCAACTGGCTAGAATTCCG"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`rv-${site.id}`} className="text-xs">
                      Downstream anchor (3′ flank, 12–30 bp)
                    </Label>
                    <Input
                      id={`rv-${site.id}`}
                      value={site.rvAnchor}
                      onChange={(e) => updateSite(site.id, { rvAnchor: sanitizeDna(e.target.value, ANCHOR_MAX) })}
                      className="font-mono text-xs"
                      placeholder="e.g. GGAAGCTAGCGAATTCAAT"
                    />
                  </div>
                </div>

                {align && (
                  <div className="mt-2 text-xs">
                    {align.ok ? (
                      <span className="text-muted-foreground">
                        ROI in reference: {align.roiLen} bp ({Math.floor(align.roiLen / 3)} codon
                        {align.roiLen === 3 ? "" : "s"}) at positions {align.fwStart + site.fwAnchor.length}–{align.rvStart - 1}
                        {align.message ? <span className="ml-2 text-warning">· {align.message}</span> : null}
                      </span>
                    ) : align.message ? (
                      <span className="text-warning">⚠ {align.message}</span>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}

          {alignment.overlapError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
              ⚠ {alignment.overlapError}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Output</CardTitle>
          <CardDescription>
            What the analyzer will emit at the end of the run.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-start gap-2">
            <Badge variant="outline" className="border-success text-success">
              always
            </Badge>
            <div>
              <div className="font-medium">Per-site enrichment</div>
              <div className="text-xs text-muted-foreground">
                One CSV row per (site, variant). Independent counts at each site.
              </div>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <label className="mt-0.5 flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={reportHaplotype && sites.length >= 2}
                disabled={sites.length < 2}
                onChange={(e) => setReportHaplotype(e.target.checked)}
                className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"
              />
            </label>
            <div>
              <div className="font-medium">
                Linked haplotype counts{" "}
                {sites.length < 2 ? (
                  <Badge variant="outline" className="ml-1 text-[10px]">
                    needs ≥2 sites
                  </Badge>
                ) : null}
              </div>
              <div className="text-xs text-muted-foreground">
                Combined-codon string per read (e.g. <span className="font-mono">GCT_TGG</span>) — only counted
                when every site extracts cleanly from the same read. Preserves
                linkage information for epistasis analysis.
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Selection rounds</CardTitle>
            <CardDescription>
              {pipelineMode === "multiplexed"
                ? "Each round needs a unique barcode prefix (at the 5′ end of each read). The engine assigns reads to rounds by barcode, then extracts every site from each read."
                : "Each round needs its own FASTQ. Pick local or from Drive."}
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={addRound}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add round
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {rounds.map((r, i) => (
            <div key={r.id} className="rounded-md border bg-muted/20 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                    {i}
                  </span>
                  <Input
                    className="h-8 w-44 text-sm"
                    value={r.name}
                    onChange={(e) => updateRound(r.id, { name: sanitizeRoundName(e.target.value) })}
                  />
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  disabled={rounds.length <= 1}
                  onClick={() => removeRound(r.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>

              {pipelineMode === "multiplexed" ? (
                <div className="space-y-1.5">
                  <Label htmlFor={`bc-${r.id}`} className="text-xs">
                    Barcode (3–12 bp prefix at the 5′ end of each read)
                  </Label>
                  <Input
                    id={`bc-${r.id}`}
                    value={r.barcode}
                    onChange={(e) => updateRound(r.id, { barcode: sanitizeDna(e.target.value, BARCODE_MAX) })}
                    className="font-mono text-xs"
                    placeholder="e.g. ACGTA"
                  />
                  {r.barcode && dupBarcodes.has(r.barcode.toUpperCase()) ? (
                    <p className="text-xs text-destructive">
                      Duplicate barcode — each round must have a unique barcode.
                    </p>
                  ) : null}
                </div>
              ) : (
                <RoundFilePicker
                  file={r.file}
                  driveRef={r.driveRef}
                  onPickLocal={(f) => updateRound(r.id, { file: f, driveRef: null })}
                  onPickDrive={(d) => updateRound(r.id, { file: null, driveRef: d })}
                  onClear={() => updateRound(r.id, { file: null, driveRef: null })}
                />
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Advanced (optional)</CardTitle>
          <CardDescription>
            Sensible defaults for SUP-basecalled R10.4 reads. Override only if you know
            what you're doing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="qread" className="text-xs">
                Min mean read Q
              </Label>
              <Input
                id="qread"
                type="number"
                value={minMeanPhredRead}
                onChange={(e) => setMinMeanPhredRead(Number(e.target.value) || 0)}
                className="font-mono text-xs"
                min={0}
                max={40}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qroi" className="text-xs">
                Min mean ROI Q
              </Label>
              <Input
                id="qroi"
                type="number"
                value={minMeanPhredRoi}
                onChange={(e) => setMinMeanPhredRoi(Number(e.target.value) || 0)}
                className="font-mono text-xs"
                min={0}
                max={40}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={goPrev}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button onClick={goNext} disabled={!canContinue}>
          Continue
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function RoundFilePicker({
  file,
  driveRef,
  onPickLocal,
  onPickDrive,
  onClear,
}: {
  file: File | null;
  driveRef: DriveFileRef | null;
  onPickLocal: (f: File) => void;
  onPickDrive: (d: DriveFileRef) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [drivePicking, setDrivePicking] = useState(false);
  const driveConfigured = !!(CLIENT_ID && API_KEY);
  const driveSignedIn = isDriveSignedIn();

  const handleLocal = async (f: File) => {
    setError(null);
    setWarning(null);
    const sync = validateFastqFileSync(f);
    if (!sync.ok) {
      setError(sync.reason ?? "File rejected.");
      return;
    }
    const peek = await peekFastq(f);
    if (!peek.ok && peek.level === "error") {
      setError(peek.reason ?? "File rejected.");
      return;
    }
    if (peek.level === "warning" && peek.reason) setWarning(peek.reason);
    onPickLocal(f);
  };

  const handleDrive = async () => {
    setError(null);
    setWarning(null);
    if (!CLIENT_ID || !API_KEY) {
      setError("Drive isn't configured (missing OAuth client ID or API key).");
      return;
    }
    const auth = new DriveAuthProvider({ clientId: CLIENT_ID });
    if (!auth.isSignedIn()) {
      setError(
        "Not signed in to Drive — sign in via Sources → Drive tab first, then come back.",
      );
      return;
    }
    try {
      setDrivePicking(true);
      const token = await auth.getToken();
      const projectNumber = CLIENT_ID.split("-")[0]!;
      const picked = await showDrivePicker({
        oauthToken: token,
        apiKey: API_KEY,
        appId: projectNumber,
      });
      if (picked.length === 0) return;
      const first = picked[0]!;
      onPickDrive({ id: first.id, name: first.name, sizeBytes: first.sizeBytes });
    } catch (e) {
      setError(`Drive pick failed: ${(e as Error).message}`);
    } finally {
      setDrivePicking(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">FASTQ for this round</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
          <FileUp className="mr-1.5 h-3.5 w-3.5" />
          {file ? "Replace local…" : "Pick local…"}
        </Button>
        {driveConfigured && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!driveSignedIn || drivePicking}
            onClick={() => void handleDrive()}
            title={driveSignedIn ? "Pick a FASTQ from your Drive" : "Sign in via Sources first"}
          >
            <Cloud className="mr-1.5 h-3.5 w-3.5" />
            {drivePicking ? "Opening…" : driveRef ? "Replace Drive…" : "Pick from Drive…"}
          </Button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".fastq,.fq"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleLocal(f);
            if (inputRef.current) inputRef.current.value = "";
          }}
        />
        {file && (
          <>
            <FileText className="h-3.5 w-3.5 text-primary" />
            <span className="truncate font-mono text-xs" title={file.name}>
              {file.name}
            </span>
            <Button type="button" size="sm" variant="ghost" onClick={onClear}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
        {driveRef && (
          <>
            <Cloud className="h-3.5 w-3.5 text-primary" />
            <span className="truncate font-mono text-xs" title={driveRef.name}>
              {driveRef.name}
            </span>
            <Button type="button" size="sm" variant="ghost" onClick={onClear}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {warning && <p className="text-xs text-warning">{warning}</p>}
    </div>
  );
}
