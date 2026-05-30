// Nanopore SSM — Preview step. Iterates every configured site and shows where
// its anchor pair lands in the reference, with the ROI between them highlighted.
// Multi-site case: each site's region is annotated with its site number above
// the ruler so the user can confirm sites don't collide.

import { useMemo } from "react";
import { ArrowLeft, ArrowRight, AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  findAllSitesInReference,
  useNanoporeStore,
} from "@/state/useNanoporeStore";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const WRAP = 60;

export function PreviewStep() {
  const sites = useNanoporeStore((s) => s.sites);
  const rounds = useNanoporeStore((s) => s.rounds);
  const referenceSeq = useNanoporeStore((s) => s.referenceSeq);
  const pipelineMode = useNanoporeStore((s) => s.pipelineMode);
  const reportHaplotype = useNanoporeStore((s) => s.reportHaplotype);
  const goNext = useNanoporeStore((s) => s.goNext);
  const goPrev = useNanoporeStore((s) => s.goPrev);

  // Pure function via useMemo — see comment on findAllSitesInReference for why
  // this can't be a Zustand selector under v5.
  const alignment = useMemo(
    () => findAllSitesInReference(sites, referenceSeq),
    [sites, referenceSeq],
  );
  const { ref, sites: siteAligns, overlapError } = alignment;

  // Build the colored ruler — primary on anchors, success on ROIs, plus a
  // line above each site's region with the site number for multi-site cases.
  type ByteRole = "none" | "anchor" | "roi";
  const roleOf = new Uint8Array(ref.length); // 0 none, 1 anchor, 2 roi
  const labelAt = new Map<number, string>(); // start-of-site → "1" / "2" / …

  for (let i = 0; i < sites.length; i++) {
    const a = siteAligns[i];
    const site = sites[i]!;
    if (!a || !a.ok) continue;
    for (let k = a.fwStart; k < a.fwStart + site.fwAnchor.length; k++) roleOf[k] = 1;
    for (let k = a.rvStart; k < a.rvStart + site.rvAnchor.length; k++) roleOf[k] = 1;
    for (let k = a.fwStart + site.fwAnchor.length; k < a.rvStart; k++) roleOf[k] = 2;
    labelAt.set(a.fwStart, String(i + 1));
  }

  const lines: { offset: number; chars: { ch: string; cls: string }[]; markers: string[] }[] = [];
  for (let off = 0; off < ref.length; off += WRAP) {
    const slice = ref.slice(off, off + WRAP);
    const chars = Array.from(slice).map((ch, i) => {
      const role = roleOf[off + i] ?? 0;
      let cls = "text-muted-foreground";
      if (role === 1) cls = "text-primary font-semibold";
      else if (role === 2) cls = "text-success-foreground bg-success rounded-sm px-px";
      return { ch, cls };
    });
    // Marker row above this line — site labels at the start position of each site
    const markers = new Array(slice.length).fill(" ");
    for (const [pos, lbl] of labelAt) {
      if (pos >= off && pos < off + slice.length) markers[pos - off] = lbl;
    }
    lines.push({ offset: off, chars, markers });
  }

  const allOk = sites.length > 0 && siteAligns.every((a) => a.ok) && !overlapError;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Anchor preview · {sites.length} site{sites.length === 1 ? "" : "s"}</CardTitle>
          <CardDescription>
            Each site's anchor pair must be findable in the reference, in order,
            and sites must not overlap. Numbers above the ruler mark each site's start.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {ref.length === 0 ? (
            <div className="rounded-md border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              No reference entered yet. Go back and paste an amplicon on the Configure step.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline" className="border-primary text-primary">
                  Anchors · primary
                </Badge>
                <Badge className="bg-success text-success-foreground hover:bg-success">
                  ROI · highlighted
                </Badge>
                <Badge variant="outline">Reference · {ref.length} bp</Badge>
                <Badge variant="outline">
                  Sites · {siteAligns.filter((a) => a.ok).length} / {sites.length} aligned
                </Badge>
              </div>

              <pre className="overflow-x-auto rounded-md border bg-muted/30 p-3 font-mono text-xs leading-snug">
                {lines.map((ln) => (
                  <div key={ln.offset}>
                    <div className="flex gap-3 text-primary">
                      <span className="w-10 shrink-0 text-right">&nbsp;</span>
                      <span className="whitespace-pre font-semibold">{ln.markers.join("")}</span>
                    </div>
                    <div className="flex gap-3">
                      <span className="w-10 shrink-0 text-right text-muted-foreground/60">
                        {ln.offset}
                      </span>
                      <span>
                        {ln.chars.map((c, i) => (
                          <span key={i} className={c.cls}>
                            {c.ch}
                          </span>
                        ))}
                      </span>
                    </div>
                  </div>
                ))}
              </pre>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {sites.map((site, i) => {
                  const a = siteAligns[i];
                  if (!a) return null;
                  return (
                    <div
                      key={site.id}
                      className={
                        "rounded-md border p-2.5 text-xs " +
                        (a.ok
                          ? "border-success/30 bg-success/5"
                          : "border-warning/30 bg-warning/5")
                      }
                    >
                      <div className="flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
                          {i + 1}
                        </span>
                        <span className="font-medium">{site.name || `site_${i + 1}`}</span>
                        {a.ok ? (
                          <CheckCircle2 className="ml-auto h-3.5 w-3.5 text-success" />
                        ) : (
                          <AlertTriangle className="ml-auto h-3.5 w-3.5 text-warning" />
                        )}
                      </div>
                      <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                        {a.ok
                          ? `ROI = ${a.roiLen} bp (${Math.floor(a.roiLen / 3)} codon${a.roiLen === 3 ? "" : "s"}) @ pos ${a.fwStart + site.fwAnchor.length}–${a.rvStart - 1}`
                          : a.message ?? "Not aligned"}
                      </div>
                      {a.ok && a.message ? (
                        <div className="mt-1 text-[11px] text-warning">{a.message}</div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              {overlapError ? (
                <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{overlapError}</span>
                </div>
              ) : allOk ? (
                <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/5 p-2 text-xs">
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  <span>
                    All sites aligned and non-overlapping. Engine will extract each site
                    independently per read{sites.length >= 2 && reportHaplotype ? ", plus a linked haplotype when all sites succeed" : ""}.
                  </span>
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Rounds — {pipelineMode === "multiplexed" ? "barcoded" : "per file"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1.5 text-sm">
            {rounds.map((r, i) => (
              <li
                key={r.id}
                className="flex items-center gap-2 rounded-md border bg-muted/20 px-2.5 py-1.5"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
                  {i}
                </span>
                <span className="font-medium">{r.name || `Round_${i}`}</span>
                {pipelineMode === "multiplexed" ? (
                  <Badge variant="outline" className="font-mono text-[10px]">
                    barcode: {r.barcode || "—"}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {r.file?.name ?? r.driveRef?.name ?? "no file"}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={goPrev}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button onClick={goNext} disabled={!allOk}>
          Continue
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
