// Nanopore site-saturation-mutagenesis tool — placeholder.
//
// This is intentionally a stub today: the tool slot is reserved in the
// registry + header switcher so the architecture is verified end-to-end,
// but the actual fuzzy-anchor engine + Nanopore-specific QC are deferred
// until the QC design is locked down (Nanopore error rates differ per
// chemistry and per basecaller version — the right QC thresholds need
// real data + calibration).
//
// When the engine lands, this file will look like cdna-display/index.ts:
//   - import each step component from ./steps/
//   - wire them in the canonical order
//   - bind the per-tool store hook in useCurrentStep / useSetStep

import { Microscope } from "lucide-react";
import type { Tool } from "@/tools/types";
import { ComingSoonStep } from "./steps/ComingSoonStep";

export const nanoporeSsmTool: Tool = {
  id: "nanopore-ssm",
  name: "Nanopore SSM Analyzer",
  shortName: "Nanopore",
  description:
    "Browser-native site-saturation-mutagenesis variant counting from Nanopore reads (coming soon).",
  icon: Microscope,
  steps: [
    {
      id: "coming-soon",
      label: "Coming soon",
      blurb: "In development",
      Component: ComingSoonStep,
    },
  ],
};
