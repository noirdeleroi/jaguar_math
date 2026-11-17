import { mathjax } from "@mathjax/src/js/mathjax.js";
import { TeX } from "@mathjax/src/js/input/tex.js";
import { SVG } from "@mathjax/src/js/output/svg.js";
import { liteAdaptor } from "@mathjax/src/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "@mathjax/src/js/handlers/html.js";
import { MathJaxNewcmFont } from "@mathjax/mathjax-newcm-font/js/svg.js";
import "@mathjax/src/js/input/tex/ams/AmsConfiguration.js";
import "@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js";
import "@mathjax/src/js/util/asyncLoad/esm.js";
import sharp from "sharp";
import { type PDFDocument, type PDFFont, type PDFImage, type PDFPage, rgb } from "pdf-lib";

export type MathTextPart = { text: string; math: boolean; display?: boolean };

// Unmatched dollars are currency, not delimiters. In particular, "$90 and
// $120" must not become one equation. Escaped dollars are always literal.
export function splitPdfMath(value: string): MathTextPart[] {
  const parts: MathTextPart[] = [];
  const pattern = /(?<!\\)(\$\$[\s\S]+?\$\$|\$[^$\n]+?(?<!\\)\$)|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]/g;
  let start = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    const token = match[0];
    if (token.startsWith("$") && /^\d[\d,.]*\s+(?:[a-zA-Z]{2,}\b|$)/.test(token.slice(1, -1)) && /\s\$$/.test(token)) {
      // Reconsider the closing dollar as a possible math opener, e.g.
      // "Pay $90 and solve $x^2=4$.".
      pattern.lastIndex = match.index + 1;
      continue;
    }
    if (match.index! > start) parts.push({ text: value.slice(start, match.index), math: false });
    const display = token.startsWith("$$") || token.startsWith("\\[");
    const delimiter = token.startsWith("$$") || token.startsWith("\\") ? 2 : 1;
    parts.push({ text: token.slice(delimiter, -delimiter), math: true, display });
    start = match.index! + token.length;
  }
  if (start < value.length) parts.push({ text: value.slice(start), math: false });
  return parts;
}

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const mathDocument = mathjax.document("", {
  InputJax: new TeX({
    packages: ["base", "ams", "newcommand"],
    formatError: (_jax: unknown, error: Error) => { throw error; },
    maxBuffer: 20_000,
  }),
  OutputJax: new SVG({ fontCache: "none", fontData: MathJaxNewcmFont, linebreaks: { inline: false } }),
});

type Formula = { png: Buffer; width: number; ascent: number; descent: number };
// Only formula images are shared; student identities and answer keys never are.
const formulas = new Map<string, Promise<Formula>>();
async function formula(tex: string, display: boolean): Promise<Formula> {
  const key = `${display}:${tex}`;
  const existing = formulas.get(key);
  if (existing) return existing;
  const pending = (async () => {
    const node = await mathjax.handleRetriesFor(() => mathDocument.convert(tex, { display, em: 1000, ex: 450 }));
    const markup = adaptor.outerHTML(node);
    const source = markup.match(/<svg[\s\S]*<\/svg>/)?.[0];
    if (!source || source.includes("data-mjx-error")) throw new Error("A paper formula could not be typeset.");
    const viewBox = source.match(/viewBox="([^"]+)"/)?.[1].split(/\s+/).map(Number);
    if (!viewBox || viewBox.length !== 4 || viewBox.some((n) => !Number.isFinite(n)) || viewBox[2] <= 0 || viewBox[3] <= 0) throw new Error("A paper formula has invalid dimensions.");
    const [, top, width, height] = viewBox;
    // 432 dpi at the normal 10.5pt body size, including real fraction bars and
    // superscripts. Outlined glyphs need no browser, network, or system fonts.
    const scale = 10.5 * 6 / 1000;
    const svg = source.replace(/width="[^"]*"/, `width="${Math.ceil(width * scale)}"`)
      .replace(/height="[^"]*"/, `height="${Math.ceil(height * scale)}"`)
      .replaceAll("currentColor", "#172522");
    return { png: await sharp(Buffer.from(svg)).png().toBuffer(), width: width / 1000, ascent: -top / 1000, descent: (height + top) / 1000 };
  })();
  if (formulas.size >= 768) formulas.delete(formulas.keys().next().value!);
  formulas.set(key, pending);
  try { return await pending; } catch (error) { formulas.delete(key); throw error; }
}

function plain(value: string) {
  return value.replace(/\\\$/g, "$").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ")
    .replace(/[−–—]/g, "-").replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

type Run = { text?: string; image?: PDFImage; display?: boolean; width: number; ascent: number; descent: number; size: number };
export type RichLine = { runs: Run[]; width: number; ascent: number; height: number };
export type RichBlock = { lines: RichLine[]; height: number; width: number };

export class PdfMathText {
  private images = new Map<string, Promise<PDFImage>>();
  private document: PDFDocument;
  readonly font: PDFFont;
  constructor(document: PDFDocument, font: PDFFont) { this.document = document; this.font = font; }

  async layout(value: string, width: number, size = 10.5): Promise<RichBlock> {
    const lines: RichLine[] = [];
    let runs: Run[] = [];
    let used = 0;
    const flush = () => {
      while (runs.at(-1)?.text?.trim() === "") used -= runs.pop()!.width;
      const ascent = Math.max(size * .8, ...runs.map((r) => r.ascent));
      const descent = Math.max(size * .2, ...runs.map((r) => r.descent));
      lines.push({ runs, width: used, ascent, height: Math.max(size * 1.35, ascent + descent + 3) });
      runs = []; used = 0;
    };
    const add = (run: Run) => {
      if (!runs.length && run.text?.trim() === "") return;
      // A comma or full stop belongs with the preceding word/formula.
      if (used + run.width > width && runs.length > 1 && /^[,.;:!?)]$/.test(run.text ?? "")) {
        const previous = runs.pop()!; used -= previous.width;
        flush(); runs.push(previous); used = previous.width;
      }
      if (used + run.width > width + .01 && runs.length) flush();
      if (!runs.length && run.text?.trim() === "") return;
      runs.push(run); used += run.width;
    };
    const parts = splitPdfMath(value);
    for (const [partIndex, part] of parts.entries()) {
      if (part.math && !/^-?\d+(?:\.\d+)?$/.test(part.text.trim())) {
        if (part.display && runs.length) flush();
        const before = parts[partIndex - 1]?.text.split("\n").at(-1) ?? "";
        const after = parts[partIndex + 1]?.text.split("\n")[0] ?? "";
        const display = Boolean(part.display) || (!before.trim() && /^[\s.,;:!?]*$/.test(after));
        const rendered = await formula(part.text, display);
        const key = `${display}:${part.text}`;
        if (!this.images.has(key)) this.images.set(key, this.document.embedPng(rendered.png));
        const factor = Math.min(size, width / rendered.width);
        add({ image: await this.images.get(key)!, display, width: rendered.width * factor, ascent: rendered.ascent * factor, descent: rendered.descent * factor, size });
        if (part.display) flush();
      } else {
        for (const word of plain(part.text).split(/(\n|[^\S\n]+)/).filter(Boolean)) {
          if (word === "\n") { flush(); continue; }
          const text = /^\s+$/.test(word) ? " " : word;
          // Break long URLs/words rather than letting them overlap the next column.
          let fragment = "";
          for (const char of text) {
            if (fragment && this.font.widthOfTextAtSize(fragment + char, size) > width) {
              add({ text: fragment, width: this.font.widthOfTextAtSize(fragment, size), ascent: size * .8, descent: size * .2, size });
              flush(); fragment = "";
            }
            fragment += char;
          }
          if (fragment) add({ text: fragment, width: this.font.widthOfTextAtSize(fragment, size), ascent: size * .8, descent: size * .2, size });
        }
      }
    }
    if (runs.length) flush();
    return { lines, height: lines.reduce((h, line) => h + line.height, 0), width: Math.max(0, ...lines.map((line) => line.width)) };
  }

  draw(page: PDFPage, block: RichBlock, x: number, top: number, width: number, centerMath = false) {
    let y = top;
    for (const line of block.lines) {
      const equationLine = line.runs.some((run) => run.display) && line.runs.every((run) => run.image || /^[\s.,;:!?]*$/.test(run.text ?? ""));
      let cursor = x + (centerMath && equationLine ? (width - line.width) / 2 : 0);
      const baseline = y - line.ascent;
      for (const run of line.runs) {
        if (run.image) page.drawImage(run.image, { x: cursor, y: baseline - run.descent, width: run.width, height: run.ascent + run.descent });
        else if (run.text) page.drawText(run.text, { x: cursor, y: baseline, font: this.font, size: run.size, color: rgb(.09, .14, .13) });
        cursor += run.width;
      }
      y -= line.height;
    }
  }
}
