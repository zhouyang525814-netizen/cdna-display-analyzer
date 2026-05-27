// Thin wrapper that gives any chart a PNG/SVG download affordance pinned to
// the bottom-right corner. Wrap each ResponsiveContainer (or custom SVG) in
// one of these.
//
// Usage:
//   <ChartPanel filename="rank-abundance" className="h-[300px]">
//     <ResponsiveContainer>… </ResponsiveContainer>
//   </ChartPanel>

import { useRef, type ReactNode } from "react";
import { Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { exportChartAsPng, exportChartAsSvg } from "./chartExport";

interface Props {
  children: ReactNode;
  filename: string;
  className?: string;
}

export function ChartPanel({ children, filename, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} className={cn("group/chart relative", className)}>
      {children}
      <div className="pointer-events-none absolute bottom-1 right-1 z-10 flex gap-1 opacity-70 transition-opacity hover:opacity-100 group-hover/chart:opacity-100">
        <button
          type="button"
          className="pointer-events-auto inline-flex h-6 items-center gap-1 rounded border border-border bg-background/85 px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-background hover:text-foreground"
          onClick={() => {
            void exportChartAsPng(ref.current, filename);
          }}
          title="Download chart as PNG (raster, 2× scale)"
        >
          <Download className="h-3 w-3" /> PNG
        </button>
        <button
          type="button"
          className="pointer-events-auto inline-flex h-6 items-center gap-1 rounded border border-border bg-background/85 px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-background hover:text-foreground"
          onClick={() => exportChartAsSvg(ref.current, filename)}
          title="Download chart as SVG (vector, editable in Illustrator/Inkscape)"
        >
          <Download className="h-3 w-3" /> SVG
        </button>
      </div>
    </div>
  );
}
