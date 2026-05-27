// SVG → SVG file and SVG → PNG export helpers for the chart cards.
//
// The challenge: our chart SVGs use `fill="hsl(var(--primary))"` etc., which
// resolve only because the SVG is rendered inside the page and inherits the
// :root CSS variables. Once you serialize the SVG and load it as an <img>, the
// CSS-variable context is lost and the image renders with broken colors.
//
// Fix: walk the live SVG before serialising, read each element's *computed*
// style for the visual properties we care about, and write those concrete
// values onto a CLONED SVG via setAttribute. The clone is fully self-contained
// and renders correctly anywhere.

const STYLE_PROPS = [
  "fill",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-opacity",
  "fill-opacity",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
] as const;

const SVG_NS = "http://www.w3.org/2000/svg";

function inlineComputedStyles(originalRoot: SVGElement, cloneRoot: SVGElement): void {
  // Walk both trees in lockstep — cloneNode preserves order, so a pre-order
  // walk visits the same nodes at the same indices.
  const origAll: Element[] = [originalRoot, ...originalRoot.querySelectorAll("*")];
  const cloneAll: Element[] = [cloneRoot, ...cloneRoot.querySelectorAll("*")];
  for (let i = 0; i < origAll.length; i++) {
    const orig = origAll[i]!;
    const cl = cloneAll[i] as SVGElement | undefined;
    if (!cl) continue;
    const cs = window.getComputedStyle(orig);
    for (const prop of STYLE_PROPS) {
      const val = cs.getPropertyValue(prop);
      if (val && val !== "") {
        cl.setAttribute(prop, val);
      }
    }
  }
}

/** Clone an SVG with all computed styles inlined as attributes, set explicit
 *  width/height (Recharts uses 100% which doesn't render as Image), and add a
 *  white background so PNG exports don't go transparent on the body. */
function prepareSvgForExport(svg: SVGSVGElement): {
  clone: SVGSVGElement;
  width: number;
  height: number;
} {
  const rect = svg.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", SVG_NS);
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  // Preserve any existing viewBox; if missing, synthesize one so vectorial
  // editors can scale the image without redoing layout.
  if (!clone.getAttribute("viewBox")) {
    clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }
  inlineComputedStyles(svg, clone);

  // White background rectangle inserted at index 0 so it renders below
  // everything else. Without this, PNG exports look washed-out on dark
  // viewers and PowerPoint shows the page-background colour.
  const bg = document.createElementNS(SVG_NS, "rect");
  bg.setAttribute("x", "0");
  bg.setAttribute("y", "0");
  bg.setAttribute("width", "100%");
  bg.setAttribute("height", "100%");
  bg.setAttribute("fill", "white");
  clone.insertBefore(bg, clone.firstChild);

  return { clone, width, height };
}

function svgToBlob(clone: SVGSVGElement): Blob {
  const xml = new XMLSerializer().serializeToString(clone);
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n${xml}`;
  return new Blob([doc], { type: "image/svg+xml;charset=utf-8" });
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so Safari doesn't cancel the download mid-flight.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function findSvg(container: HTMLElement | null): SVGSVGElement | null {
  if (!container) return null;
  return container.querySelector("svg") as SVGSVGElement | null;
}

export function exportChartAsSvg(container: HTMLElement | null, filename: string): void {
  const svg = findSvg(container);
  if (!svg) {
    console.warn("[chartExport] no <svg> found inside container");
    return;
  }
  const { clone } = prepareSvgForExport(svg);
  const blob = svgToBlob(clone);
  triggerDownload(blob, `${filename}.svg`);
}

const PNG_SCALE = 2; // 2× for retina / print-friendly output

export async function exportChartAsPng(
  container: HTMLElement | null,
  filename: string,
): Promise<void> {
  const svg = findSvg(container);
  if (!svg) {
    console.warn("[chartExport] no <svg> found inside container");
    return;
  }
  const { clone, width, height } = prepareSvgForExport(svg);
  const blob = svgToBlob(clone);
  const url = URL.createObjectURL(blob);

  try {
    const img = new Image();
    img.decoding = "sync";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Failed to load serialised SVG as image"));
      img.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = width * PNG_SCALE;
    canvas.height = height * PNG_SCALE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    // White background fallback (the clone already has one, but belt-and-braces).
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(PNG_SCALE, PNG_SCALE);
    ctx.drawImage(img, 0, 0);

    await new Promise<void>((resolve, reject) => {
      canvas.toBlob((pngBlob) => {
        if (!pngBlob) {
          reject(new Error("canvas.toBlob returned null"));
          return;
        }
        triggerDownload(pngBlob, `${filename}.png`);
        resolve();
      }, "image/png");
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
