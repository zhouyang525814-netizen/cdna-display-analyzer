// Placeholder landing page for the Nanopore SSM tool until the engine ships.
// Lays out what's planned so the user / collaborators can see the roadmap and
// understand which knobs they'll be configuring once it's live.

import { Microscope, FlaskConical, Brain, FileText } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function ComingSoonStep() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Microscope className="h-5 w-5 text-primary" />
            Nanopore SSM Analyzer — in development
          </CardTitle>
          <CardDescription>
            A sibling tool for 1- and 2-site site-saturation-mutagenesis libraries
            sequenced on Oxford Nanopore. Reuses the analyzer + visualisation
            stack from the cDNA-DISPLAY tool, with a new front-end engine tuned
            for Nanopore-class read length and error profile.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Planned workflow</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3 text-sm">
            <Step
              icon={FileText}
              title="Reference + variable sites"
              body="Paste/upload the WT reference DNA, mark which codon position(s) are saturated, set the flanking-window size used as anchors."
            />
            <Step
              icon={FlaskConical}
              title="Per-condition FASTQs"
              body="Drop one Nanopore FASTQ per condition (naive / selected / replicate). Each file is bound to a condition the same way the cDNA-DISPLAY tool now supports per-round NGS."
            />
            <Step
              icon={Brain}
              title="Fuzzy-anchor variant calling"
              body="For each read: locate the flanking anchors with an edit-distance-tolerant match (typical Nanopore error 1–5%), extract the saturated codons, translate, count. QC by anchor alignment score + read-length consensus, NOT by Phred (Nanopore-Q is less reliable)."
            />
            <Step
              icon={Microscope}
              title="Reuse the analyzer + viz stack"
              body="Once we have variant counts per condition, the existing analyzer.ts (RPM, BH-FDR enrichment) and viz components (volcano, rank-abundance, sequence-logo, …) work unchanged — variants are just AA sequences over a shorter alphabet."
            />
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status</CardTitle>
          <CardDescription>
            Pending: QC threshold calibration (depends on which Nanopore
            chemistry + basecaller version is target), validation dataset,
            agreement on the SSM input schema. The tool slot is reserved in
            the app so the switcher button works today.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 text-xs">
          <Badge variant="outline">Architecture: ready</Badge>
          <Badge variant="outline">Engine: pending</Badge>
          <Badge variant="outline">QC design: pending</Badge>
          <Badge variant="outline">Validation data: pending</Badge>
        </CardContent>
      </Card>
    </div>
  );
}

function Step({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Microscope;
  title: string;
  body: string;
}) {
  return (
    <li className="flex items-start gap-3 rounded-md border bg-muted/30 p-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div>
        <div className="font-medium">{title}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{body}</div>
      </div>
    </li>
  );
}
