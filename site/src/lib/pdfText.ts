// Client-side PDF -> plain text with Mozilla's pdf.js. The file never leaves
// the browser: it's read as an ArrayBuffer, getTextContent() runs per page,
// the lines are stitched back together. Used by the profile résumé import
// (docs/APPLICANT-TOOLKIT-PLAN.md, Phase 1).
//
// pdf.js (and its worker) are ~1 MB and only needed the moment someone picks
// a PDF, so everything is dynamically imported inside extractPdfText — it
// stays out of the SSR module graph and the initial page bundle entirely.

interface PdfTextItem {
  str?: string;
  hasEOL?: boolean;
  transform?: number[];
  width?: number;
}

let pdfjsReady: Promise<typeof import("pdfjs-dist")> | null = null;

function loadPdfjs(): Promise<typeof import("pdfjs-dist")> {
  if (!pdfjsReady) {
    pdfjsReady = (async () => {
      const pdfjs = await import("pdfjs-dist");
      const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    })();
  }
  return pdfjsReady;
}

/** Extract the text of every page, in reading order, with line breaks kept
 *  where pdf.js reports them (or where the vertical position jumps). Throws
 *  if the file isn't a readable PDF — the caller turns that into a message. */
export async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise;
  try {
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let text = "";
      let lastY: number | null = null;
      let lastEndX: number | null = null;
      for (const raw of content.items as PdfTextItem[]) {
        const s = raw.str ?? "";
        const x = raw.transform?.[4] ?? null;
        const y = raw.transform?.[5] ?? null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 3 && !text.endsWith("\n")) {
          text += "\n";
        } else if (text && !text.endsWith("\n")) {
          // Same visual line. A wide horizontal gap means two columns
          // (résumés right-align dates / locations) — emit a double space so
          // the parser can split on it; a normal inter-word gap gets one.
          if (lastEndX !== null && x !== null && x - lastEndX > 14 && !text.endsWith("  ")) {
            text += text.endsWith(" ") ? " " : "  ";
          } else if (!text.endsWith(" ") && !s.startsWith(" ")) {
            text += " ";
          }
        }
        text += s;
        if (raw.hasEOL && !text.endsWith("\n")) text += "\n";
        lastY = y;
        if (x !== null) lastEndX = x + (raw.width ?? 0);
      }
      pages.push(text);
      page.cleanup();
    }
    return pages
      .join("\n\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } finally {
    // Destroying the loading task tears down the document and its worker.
    await task.destroy();
  }
}
