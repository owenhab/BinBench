// Turning geometry into files: ASCII STL, 3MF (with Bambu Studio plate tagging), and
// the browser download itself.
import JSZip from 'jszip';
import { type Bin, type Project, binName } from './model';
import {
  type Box2,
  type MeshObject,
  type Plate,
  type Tri,
  type Vec3,
  binTriangles,
  computeBaseplateTiles,
  packPlates,
  placedBinTris,
  tileTriangles,
} from './geometry';

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

// Studio's own files carry this whole block; the Application line is the one that
// matters (its importer sets m_is_bbl_3mf only when the string starts with
// "BambuStudio-", and without that it loads the file as a foreign 3mf, re-centring
// everything on one plate), but the rest costs nothing and keeps us in step with what
// it writes for itself.
function modelMetadata() {
  const day = new Date().toISOString().slice(0, 10);
  return (
    '<metadata name="Application">BambuStudio-02.07.01.62</metadata>' +
    '<metadata name="BambuStudio:3mfVersion">1</metadata>' +
    '<metadata name="CreationDate">' + day + '</metadata>' +
    '<metadata name="ModificationDate">' + day + '</metadata>' +
    '<metadata name="Copyright"></metadata>' +
    '<metadata name="Description"></metadata>' +
    '<metadata name="Designer"></metadata>' +
    '<metadata name="License"></metadata>' +
    '<metadata name="Title"></metadata>'
  );
}

function build3MFModelXML(objects: MeshObject[]) {
  const resources: string[] = [];
  const build: string[] = [];
  objects.forEach((obj) => {
    const vtx: string[] = [], tri: string[] = [];
    // Weld the corners. STL is a bag of loose facets and our triangles arrive the same
    // way, but 3MF is indexed: give every triangle three vertices of its own and no
    // two of them share one, so a slicer counts every edge as open — Bambu reports
    // "3 × triangles open edges" and sends you off to repair the model. Welding on the
    // printed coordinate makes the match exact, since that is what lands in the file.
    const index = new Map<string, number>();
    const at = (p: Vec3) => {
      const x = p[0].toFixed(4), y = p[1].toFixed(4), z = p[2].toFixed(4);
      const k = x + ' ' + y + ' ' + z;
      let i = index.get(k);
      if (i === undefined) {
        i = index.size;
        index.set(k, i);
        vtx.push(`<vertex x="${x}" y="${y}" z="${z}"/>`);
      }
      return i;
    };
    obj.tris.forEach((t) => {
      const a = at(t[0]), b = at(t[1]), c = at(t[2]);
      // a triangle whose corners weld together has no area left to print
      if (a !== b && b !== c && a !== c) tri.push(`<triangle v1="${a}" v2="${b}" v3="${c}"/>`);
    });
    resources.push(
      `<object id="${obj.id}" type="model"><mesh><vertices>${vtx.join('')}</vertices><triangles>${tri.join('')}</triangles></mesh></object>`,
    );
    const [tx, ty, tz] = obj.transform || [0, 0, 0];
    build.push(
      `<item objectid="${obj.id}" transform="1 0 0 0 1 0 0 0 1 ${tx.toFixed(3)} ${ty.toFixed(3)} ${tz.toFixed(3)}" printable="1"/>`,
    );
  });
  return `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">${modelMetadata()}<resources>${resources.join('')}</resources><build>${build.join('')}</build></model>`;
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

// Bambu Studio lays its plates out in world space in a grid — ceil(sqrt(n)) columns
// wide, each cell one bed plus a fifth of a bed of gap, rows running back in −Y — and
// stores every object at its plate-local position plus that plate's origin. Put an
// object anywhere else and Studio opens it straddling a plate boundary, which is what
// a plain "spread them along X" layout does. From BambuStudio's own
// PartPlateList::compute_shape_position / plate_stride_x.
const PLATE_GAP = 1 / 5;
export function plateOrigin(index: number, count: number, bed: { x: number; y: number }) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  return {
    x: (index % cols) * bed.x * (1 + PLATE_GAP),
    y: -Math.floor(index / cols) * bed.y * (1 + PLATE_GAP),
  };
}
/** Centre a w×d footprint on the bed, so nothing sits against the plate edge. */
export function centreOnBed(bed: { x: number; y: number }, w: number, d: number) {
  return { x: Math.max(0, (bed.x - w) / 2), y: Math.max(0, (bed.y - d) / 2) };
}

// Bambu Studio's own addition to the 3MF: a side file saying which objects belong on
// which plate. Slicers that don't know it ignore it and just see all the objects,
// which is why the plates are also spread out in space rather than piled on origin.
function bambuPlateConfig(objects: MeshObject[]) {
  const IDENTITY16 = '1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1';
  let s = '<?xml version="1.0" encoding="UTF-8"?>\n<config>\n';
  objects.forEach((o) => {
    const name = xmlEsc(o.name || '');
    const faces = o.tris.length;
    s +=
      '  <object id="' + o.id + '">\n' +
      '    <metadata key="name" value="' + name + '"/>\n' +
      '    <metadata key="extruder" value="1"/>\n' +
      '    <metadata face_count="' + faces + '"/>\n' +
      '    <part id="' + o.id + '" subtype="normal_part">\n' +
      '      <metadata key="name" value="' + name + '"/>\n' +
      '      <metadata key="matrix" value="' + IDENTITY16 + '"/>\n' +
      '      <mesh_stat face_count="' + faces + '" edges_fixed="0" degenerate_facets="0"' +
      ' facets_removed="0" facets_reversed="0" backwards_edges="0"/>\n' +
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
        '    <metadata key="locked" value="false"/>\n' +
        '    <metadata key="filament_map_mode" value="Auto For Flush"/>\n';
      byPlate.get(pn)!.forEach((o) => {
        s +=
          '    <model_instance>\n' +
          '      <metadata key="object_id" value="' + o.id + '"/>\n' +
          '      <metadata key="instance_id" value="0"/>\n' +
          // Studio gives every instance one of these; it only has to be unique
          '      <metadata key="identify_id" value="' + o.id * 10 + '"/>\n' +
          '    </model_instance>\n';
      });
      s += '  </plate>\n';
    });
  // Studio repeats each instance's placement here; its own files always carry it
  s += '  <assemble>\n';
  objects.forEach((o) => {
    const [tx, ty, tz] = o.transform || [0, 0, 0];
    s +=
      '   <assemble_item object_id="' + o.id + '" instance_id="0" transform="1 0 0 0 1 0 0 0 1 ' +
      tx.toFixed(3) + ' ' + ty.toFixed(3) + ' ' + tz.toFixed(3) + '" offset="0 0 0" />\n';
  });
  s += '  </assemble>\n';
  return s + '</config>\n';
}

/** Every bin across every packed plate in one 3MF. Returns a status message. */
export async function downloadAllPlates3MF(p: Project): Promise<{ msg: string; err: boolean }> {
  if (!p.bins.length) return { msg: 'No bins to export yet.', err: true };
  const plates = packPlates(p);
  const objects: MeshObject[] = [];
  let id = 0, oversize = 0;
  plates.forEach((plate, k) => {
    const live = plate.filter((pl) => !pl.oversize);
    oversize += plate.length - live.length;
    // the packed bins start at the near corner, so shift the whole lot to the middle
    // of the bed before dropping it on its plate
    const packW = live.reduce((m, pl) => Math.max(m, pl.x + pl.w), 0);
    const packD = live.reduce((m, pl) => Math.max(m, pl.y + pl.d), 0);
    const mid = centreOnBed(p.bed, packW, packD);
    const org = plateOrigin(k, plates.length, p.bed);
    live.forEach((pl) => {
      objects.push({
        id: ++id,
        plate: k,
        name: binName(pl.bin) + ' (plate ' + (k + 1) + ')',
        tris: placedBinTris(p, pl),
        transform: [org.x + mid.x + pl.x, org.y + mid.y + pl.y, 0],
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

/** Every baseplate section in one 3MF, lying flat — one section per plate rather than
 *  piled into a stack. The same file for anyone who would rather print the sections a
 *  plate at a time than run the stack with supports. */
export async function downloadAllSections3MF(p: Project): Promise<{ msg: string; err: boolean }> {
  const { tiles, plate } = computeBaseplateTiles(p);
  if (!tiles.length) return { msg: 'There are no baseplate sections to export.', err: true };
  const objects: MeshObject[] = tiles.map((tile, k) => {
    const org = plateOrigin(k, tiles.length, p.bed);
    const mid = centreOnBed(p.bed, tile.x1 - tile.x0, tile.y1 - tile.y0);
    return {
      id: k + 1,
      plate: k,
      name: 'Baseplate section ' + (k + 1),
      tris: tileTriangles(p, tile, plate),
      transform: [org.x + mid.x, org.y + mid.y, 0] as [number, number, number],
    };
  });
  await download3MF(objects, safeFileName(p.projectName) + '_baseplates', {
    'Metadata/model_settings.config': bambuPlateConfig(objects),
  });
  return { msg: tiles.length + ' section(s) in one file, one to a plate, lying flat — no supports needed.', err: false };
}

export function downloadPlate3MF(p: Project, plateIdx: number) {
  const plate = (packPlates(p)[plateIdx] || []).filter((pl) => !pl.oversize);
  const mid = centreOnBed(
    p.bed,
    plate.reduce((m, pl) => Math.max(m, pl.x + pl.w), 0),
    plate.reduce((m, pl) => Math.max(m, pl.y + pl.d), 0),
  );
  const objects = plate.map((pl, i) => ({
    id: i + 1,
    tris: placedBinTris(p, pl),
    transform: [mid.x + pl.x, mid.y + pl.y, 0] as [number, number, number],
  }));
  return download3MF(objects, 'plate_' + (plateIdx + 1));
}

/** One baseplate section on its own, sitting in the middle of the bed. */
export function downloadSection3MF(p: Project, tile: Box2, plate: Plate, idx: number) {
  const mid = centreOnBed(p.bed, tile.x1 - tile.x0, tile.y1 - tile.y0);
  return download3MF(
    [{ id: 1, tris: tileTriangles(p, tile, plate), transform: [mid.x, mid.y, 0] }],
    'baseplate_plate_' + (idx + 1),
  );
}
