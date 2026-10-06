// True-scale paper template of the drawer footprint, tiled across printable sheets.
import { type Project, binsAtLevel } from './model';

export const PAPER = {
  letter: { w: 215.9, h: 279.4, label: 'US Letter' },
  a4: { w: 210, h: 297, label: 'A4' },
} as const;
export type PaperSize = keyof typeof PAPER;
const PAGE_MARGIN = 12; // mm printable margin

const esc = (s: string) => s.replace(/[<>&]/g, '');

export function buildTemplateHTML(p: Project, paperSize: PaperSize, showBins: boolean) {
  const paper = PAPER[paperSize];
  const fine = Math.max(2, p.paperGrid || 10);
  const usableW = paper.w - PAGE_MARGIN * 2;
  const usableH = paper.h - PAGE_MARGIN * 2;
  const cols = Math.ceil(p.drawer.w / usableW);
  const rows = Math.ceil(p.drawer.d / usableH);

  let pages = '';
  let n = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      n++;
      const ox = c * usableW, oy = r * usableH;
      const pw = Math.min(usableW, p.drawer.w - ox);
      const ph = Math.min(usableH, p.drawer.d - oy);
      let svg = '';
      for (let x = Math.ceil(ox / fine) * fine; x <= ox + pw + 0.001; x += fine) {
        const major = Math.abs(x % (fine * 5)) < 0.001;
        svg += `<line x1="${x - ox}" y1="0" x2="${x - ox}" y2="${ph}" stroke="#999" stroke-width="${major ? 0.35 : 0.15}"/>`;
        if (major) svg += `<text x="${x - ox + 0.6}" y="3" font-size="2.6" fill="#c0392b" font-family="monospace">${Math.round(x)}</text>`;
      }
      for (let y = Math.ceil(oy / fine) * fine; y <= oy + ph + 0.001; y += fine) {
        const major = Math.abs(y % (fine * 5)) < 0.001;
        svg += `<line x1="0" y1="${y - oy}" x2="${pw}" y2="${y - oy}" stroke="#999" stroke-width="${major ? 0.35 : 0.15}"/>`;
        if (major) svg += `<text x="0.6" y="${y - oy - 0.8}" font-size="2.6" fill="#c0392b" font-family="monospace">${Math.round(y)}</text>`;
      }
      for (let x = Math.ceil(ox / p.unit) * p.unit; x <= ox + pw + 0.001; x += p.unit)
        svg += `<line x1="${x - ox}" y1="0" x2="${x - ox}" y2="${ph}" stroke="#2c6fb5" stroke-width="0.5"/>`;
      for (let y = Math.ceil(oy / p.unit) * p.unit; y <= oy + ph + 0.001; y += p.unit)
        svg += `<line x1="0" y1="${y - oy}" x2="${pw}" y2="${y - oy}" stroke="#2c6fb5" stroke-width="0.5"/>`;
      if (showBins) {
        binsAtLevel(p, 1).forEach((b) => {
          svg += `<rect x="${b.x - ox}" y="${b.y - oy}" width="${b.w}" height="${b.d}" fill="none" stroke="#111" stroke-width="0.8"/>`;
          (b.dividersX || []).forEach((dv) => {
            svg += `<line x1="${b.x + dv.p - ox}" y1="${b.y + dv.a - oy}" x2="${b.x + dv.p - ox}" y2="${b.y + dv.b - oy}" stroke="#111" stroke-width="0.5" stroke-dasharray="2,1.5"/>`;
          });
          (b.dividersY || []).forEach((dv) => {
            svg += `<line x1="${b.x + dv.a - ox}" y1="${b.y + dv.p - oy}" x2="${b.x + dv.b - ox}" y2="${b.y + dv.p - oy}" stroke="#111" stroke-width="0.5" stroke-dasharray="2,1.5"/>`;
          });
          svg += `<text x="${b.x - ox + 2}" y="${b.y - oy + 5}" font-size="3.4" fill="#111" font-family="sans-serif">${esc(b.label || 'Bin ' + b.id)}</text>`;
        });
      }
      svg += `<rect x="0" y="0" width="${pw}" height="${ph}" fill="none" stroke="#000" stroke-width="0.4" stroke-dasharray="4,2"/>`;

      const cal = n === 1
        ? `<div class="cal"><div class="bar"></div><span>100&nbsp;mm calibration — measure this. If it isn't exactly 100mm, reprint at 100% scale.</span></div>`
        : '';
      pages += `<div class="page">
        <div class="hdr"><b>${esc(p.projectName || 'Drawer')}</b> — sheet ${n} of ${cols * rows} · covers X ${Math.round(ox)}–${Math.round(ox + pw)}mm, Y ${Math.round(oy)}–${Math.round(oy + ph)}mm · drawer ${p.drawer.w}×${p.drawer.d}mm</div>
        ${cal}
        <svg width="${pw}mm" height="${ph}mm" viewBox="0 0 ${pw} ${ph}" xmlns="http://www.w3.org/2000/svg">${svg}</svg>
      </div>`;
    }
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(p.projectName || 'Drawer')} — 1:1 template</title>
  <style>
    @page { size: ${paperSize === 'a4' ? 'A4' : 'letter'}; margin: ${PAGE_MARGIN}mm; }
    body{ margin:0; font-family:sans-serif; }
    .page{ page-break-after:always; break-after:page; }
    .page:last-child{ page-break-after:auto; break-after:auto; }
    .hdr{ font-size:8pt; margin-bottom:2mm; color:#333; }
    .cal{ display:flex; align-items:center; gap:3mm; margin-bottom:2mm; font-size:7pt; color:#c0392b; }
    .cal .bar{ width:100mm; height:2mm; border:0.3mm solid #c0392b; border-top:none; }
    svg{ display:block; }
    .noprint{ padding:10px; background:#eee; font-size:12px; }
    @media print{ .noprint{display:none;} }
  </style></head><body>
  <div class="noprint">Print at <b>100% / Actual size</b> — turn OFF "fit to page" or "shrink to fit". Then verify the 100mm bar on sheet 1 with a ruler.</div>
  ${pages}
  </body></html>`;
}

/** Opens the template in a new window and starts printing. Returns false if blocked. */
export function printTemplate(p: Project, paperSize: PaperSize, showBins: boolean) {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(buildTemplateHTML(p, paperSize, showBins));
  w.document.close();
  setTimeout(() => {
    try {
      w.focus();
      w.print();
    } catch {
      /* the user closed it */
    }
  }, 400);
  return true;
}
