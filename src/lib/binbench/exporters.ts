// Turning geometry into files: ASCII STL, 3MF (with Bambu Studio plate tagging), and
// the browser download itself.
import JSZip from 'jszip';
import { type Bin, type Project, binName } from './model';
import { type MeshObject, type Tri, binTriangles, packPlates, placedBinTris } from './geometry';

export function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

export function safeFileName(s: string, fallback = 'drawer') {
  return (s || fallback).replace(/[^a-z0-9_-]+/gi, '_');
}
export function safeBinName(bin: Bin) {
  return (bin.label || 'bin' + bin.id).replace(/[^a-z0-9_-]+/gi, '_');
}

export function trisToSTL(tris: Tri[], name: string) {
  const parts: string[] = ['solid ' + name + '\n'];
  tris.forEach(([a, b, c]) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    parts.push(`facet normal ${(nx / len).toFixed(4)} ${(ny / len).toFixed(4)} ${(nz / len).toFixed(4)}\nouter loop\n`);
    [a, b, c].forEach((v) => parts.push(`vertex ${v[0].toFixed(4)} ${v[1].toFixed(4)} ${v[2].toFixed(4)}\n`));
    parts.push('endloop\nendfacet\n');
  });
  parts.push('endsolid ' + name + '\n');
  return parts.join('');
}

function build3MFModelXML(objects: MeshObject[]) {
  const resources: string[] = [];
  const build: string[] = [];
  objects.forEach((obj) => {
    const vtx: string[] = [], tri: string[] = [];
    let vi = 0;
    obj.tris.forEach((t) => {
      t.forEach((p) => vtx.push(`<vertex x="${p[0].toFixed(4)}" y="${p[1].toFixed(4)}" z="${p[2].toFixed(4)}"/>`));
      tri.push(`<triangle v1="${vi}" v2="${vi + 1}" v3="${vi + 2}"/>`);
      vi += 3;
    });
    resources.push(
      `<object id="${obj.id}" type="model"><mesh><vertices>${vtx.join('')}</vertices><triangles>${tri.join('')}</triangles></mesh></object>`,
    );
    const [tx, ty, tz] = obj.transform || [0, 0, 0];
    build.push(`<item objectid="${obj.id}" transform="1 0 0 0 1 0 0 0 1 ${tx.toFixed(3)} ${ty.toFixed(3)} ${tz.toFixed(3)}"/>`);
  });
  return `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>${resources.join('')}</resources><build>${build.join('')}</build></model>`;
}

export async function download3MF(objects: MeshObject[], filename: string, extras?: Record<string, string>) {
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="application/xml"/></Types>';
  const rels =
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>';
  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypes);
  zip.file('_rels/.rels', rels);
  zip.file('3D/3dmodel.model', build3MFModelXML(objects));
  if (extras) Object.keys(extras).forEach((path) => zip.file(path, extras[path]));
  const blob = await zip.generateAsync({ type: 'blob' });
  triggerDownload(blob, filename + '.3mf');
}

export function downloadBinSTL(p: Project, bin: Bin) {
  const name = safeBinName(bin) + '_' + bin.w.toFixed(0) + 'x' + bin.d.toFixed(0) + 'x' + bin.heightMM + 'mm';
  triggerDownload(new Blob([trisToSTL(binTriangles(p, bin), name)], { type: 'model/stl' }), name + '.stl');
}

export function downloadBin3MF(p: Project, bin: Bin) {
  return download3MF([{ id: 1, tris: binTriangles(p, bin), transform: [0, 0, 0] }], safeBinName(bin) + '_bin');
}

const xmlEsc = (s: string) =>
  String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);

// Bambu Studio's own addition to the 3MF: a side file saying which objects belong on
// which plate. Slicers that don't know it ignore it and just see all the objects,
// which is why the plates are also spread out in space rather than piled on origin.
function bambuPlateConfig(objects: MeshObject[]) {
  let s = '<?xml version="1.0" encoding="UTF-8"?>\n<config>\n';
  objects.forEach((o) => {
    s +=
      '  <object id="' + o.id + '">\n' +
      '    <metadata key="name" value="' + xmlEsc(o.name || '') + '"/>\n' +
      '    <metadata key="extruder" value="1"/>\n' +
      '    <part id="' + o.id + '" subtype="normal_part">\n' +
      '      <metadata key="name" value="' + xmlEsc(o.name || '') + '"/>\n' +
      '    </part>\n' +
      '  </object>\n';
  });
  const byPlate = new Map<number, MeshObject[]>();
  objects.forEach((o) => {
    const k = o.plate ?? 0;
    if (!byPlate.has(k)) byPlate.set(k, []);
    byPlate.get(k)!.push(o);
  });
  [...byPlate.keys()]
    .sort((a, b) => a - b)
    .forEach((pn) => {
      s +=
        '  <plate>\n' +
        '    <metadata key="plater_id" value="' + (pn + 1) + '"/>\n' +
        '    <metadata key="plater_name" value=""/>\n' +
        '    <metadata key="locked" value="false"/>\n';
      byPlate.get(pn)!.forEach((o) => {
        s +=
          '    <model_instance>\n' +
          '      <metadata key="object_id" value="' + o.id + '"/>\n' +
          '      <metadata key="instance_id" value="0"/>\n' +
          '    </model_instance>\n';
      });
      s += '  </plate>\n';
    });
  return s + '</config>\n';
}

/** Every bin across every packed plate in one 3MF. Returns a status message. */
export async function downloadAllPlates3MF(p: Project): Promise<{ msg: string; err: boolean }> {
  if (!p.bins.length) return { msg: 'No bins to export yet.', err: true };
  const plates = packPlates(p);
  const spread = p.bed.x + 20; // plates side by side for slicers that ignore the tagging
  const objects: MeshObject[] = [];
  let id = 0, oversize = 0;
  plates.forEach((plate, k) => {
    plate.forEach((pl) => {
      if (pl.oversize) {
        oversize++;
        return;
      }
      objects.push({
        id: ++id,
        plate: k,
        name: binName(pl.bin) + ' (plate ' + (k + 1) + ')',
        tris: placedBinTris(p, pl),
        transform: [k * spread + pl.x, pl.y, 0],
      });
    });
  });
  if (!objects.length) return { msg: 'Every bin is too big for the build plate — nothing to export.', err: true };
  await download3MF(objects, safeFileName(p.projectName) + '_all_plates', {
    'Metadata/model_settings.config': bambuPlateConfig(objects),
  });
  return {
    msg:
      objects.length + ' bin(s) across ' + plates.length + ' plate(s) in one file' +
      (oversize ? ' — ' + oversize + ' left out for being bigger than the bed.' : '.'),
    err: oversize > 0,
  };
}

export function downloadPlate3MF(p: Project, plateIdx: number) {
  const plate = packPlates(p)[plateIdx] || [];
  const objects = plate.map((pl, i) => ({ id: i + 1, tris: placedBinTris(p, pl), transform: [pl.x, pl.y, 0] as [number, number, number] }));
  return download3MF(objects, 'plate_' + (plateIdx + 1));
}
