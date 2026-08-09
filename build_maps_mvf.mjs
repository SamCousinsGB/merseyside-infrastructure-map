#!/usr/bin/env node
/**
 * build_maps_mvf.mjs - convert MAPS Viewer `.mvf` tiles into the committed
 * WGS84 GeoJSON tile tree under tiles/mapsgeo/, classified by pressure tier.
 *
 * It reads .mvf tiles from a directory YOU point it at (local/mvf.config.json,
 * which is git-ignored because the path is machine-specific). It downloads
 * nothing and contacts no network.
 *
 * NOTE ON WHAT THIS WRITES. Output lands in tiles/mapsgeo/ and IS committed, so
 * the map loads it like any other layer with no setup step. That is a deliberate
 * choice by the repo owner, who holds the rights to this data. It also means the
 * usual rule applies: anything in tiles/mapsgeo/ is part of the deploy. If this
 * repo ever gets a GitHub Pages site, Pages is public even from a private repo
 * on the Free plan - so that is the moment to re-check the licence, not now.
 * Data that must NOT be published belongs in local/ instead (see local/README).
 *
 * ---------------------------------------------------------------------------
 * The format, for whoever maintains this next
 * ---------------------------------------------------------------------------
 * A `.mvf` tile is a binary CGM (Computer Graphics Metafile, WebCGM profile)
 * with the first 512 bytes lightly obfuscated. The obfuscation is a byte-pair
 * swap plus a bitwise NOT, i.e. `plain[i] = ~raw[i ^ 1]`. Undo that and the
 * metafile descriptor reads as text:
 *
 *   "ProfileId:WebCGM","ProfileEd:1.0","ColourClass:Colour",
 *   "Source:NG,GDFO,1.0.0","Date:20260604","Facet:SJ3490NE",
 *   "Xmin:334500","Ymin:390500","Xmax:335000","Ymax:391000"
 *
 * so every tile states its own EPSG:27700 bounding box - georeferencing needs
 * no external index. From byte 512 on, the picture body is *plain* CGM.
 *
 * Content is organised with CGM application structures (APS):
 *
 *   BEGIN APS "21000" type "layer"      <- LayerName gives the pressure tier
 *     APS ATTR LayerName = "Low Pressure Mains & Plant"
 *     BEGIN APS "21001001" type "grobject"
 *       APS ATTR Name      = "312138385"        <- asset id
 *       APS ATTR ScreenTip = "63MM PE (IN 8\" CI)"  <- diameter + material
 *       POLYLINE ...                            <- the pipe itself
 *
 * Layer ids are a stable vocabulary across the dataset:
 *
 *   1000  OS As Built Geography                  background mapping (skipped)
 *   3000  Notes            4000  Dimensions      annotation      (skipped)
 *   6000  Mains Identifiers                      annotation      (skipped)
 *   21000 Low Pressure Mains & Plant             -> LP
 *   22000 Medium Pressure Mains & Plant          -> MP
 *   23000 Intermediate Pressure Mains & Plant    -> IP
 *   24000 Local High Pressure Mains & Plant      -> HPL
 *   25000 National High Pressure Mains & Plant   -> HPN
 *
 * Coordinates are VDC integers over the extent declared in the header (0..16000
 * across a 500 m tile, i.e. 31.25 mm per unit), so
 *   easting = Xmin + vdcX * (Xmax - Xmin) / vdcWidth.
 *
 * Usage:
 *   node build_maps_mvf.mjs [--src=DIR] [--bbox=minE,minN,maxE,maxN] [--all]
 *
 * Config (git-ignored) can live in local/mvf.config.json instead:
 *   { "source": "C:/path/to/MapsViewerJuly2026", "bbox": [320000,377000,357000,422000] }
 */
import fs from "node:fs";
import path from "node:path";
import { TIERS, ORDER } from "./gas_tiers.mjs";
import { writeTiles } from "./tile_geojson.mjs";

// Output goes into the committed tile tree, exactly like tiles/gasgeo and
// tiles/lvgeo: the map loads these as ordinary layers with no setup step.
const OUT_DIR = path.join("tiles", "mapsgeo");
const CONFIG = path.join("local", "mvf.config.json");

// Above this many features a tier is tiled rather than written whole.
const TILE_THRESHOLD = 8000;

// Merseyside + immediate hinterland, in EPSG:27700 metres. Wirral/Southport/
// St Helens all fall inside this; it is a superset of the map's opening view.
const DEFAULT_BBOX = [320000, 377000, 357000, 422000];

// Layer id -> pressure tier. Names are matched too (see tierFromLayer) so a
// re-issue that renumbers layers still classifies correctly.
const LAYER_TIER = {
  21000: "LP",
  22000: "MP",
  23000: "IP",
  24000: "HPL",
  25000: "HPN",
};

// Recorded once per output file rather than on every feature.
const TIER_LAYER_NAME = {
  LP: "Low Pressure Mains & Plant",
  MP: "Medium Pressure Mains & Plant",
  IP: "Intermediate Pressure Mains & Plant",
  HPL: "Local High Pressure Mains & Plant",
  HPN: "National High Pressure Mains & Plant",
};

// ---------------------------------------------------------------------------
// CLI / config
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    let m;
    if ((m = a.match(/^--src=(.+)$/))) out.source = m[1];
    else if ((m = a.match(/^--bbox=(.+)$/))) out.bbox = m[1].split(",").map(Number);
    else if (a === "--all") out.all = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else console.log(`  ! ignoring unknown argument ${a}`);
  }
  return out;
}

function loadConfig() {
  if (!fs.existsSync(CONFIG)) return {};
  try {
    return JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  } catch {
    console.log(`  ! ${CONFIG} is not valid JSON - ignoring it`);
    return {};
  }
}

// Find the DATA/GAS/NG tile root under whatever the user pointed us at, so
// either the disc root or the tile directory itself works.
function findTileRoot(src) {
  const candidates = [
    src,
    path.join(src, "DATA", "GAS", "NG"),
    path.join(src, "DATA", "GAS"),
    path.join(src, "GAS", "NG"),
    path.join(src, "NG"),
  ];
  for (const c of candidates) {
    if (!fs.existsSync(c)) continue;
    if (hasMvf(c, 3)) return c;
  }
  return null;
}

function hasMvf(dir, depth) {
  if (depth < 0) return false;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const e of entries) {
    if (e.isFile() && e.name.toLowerCase().endsWith(".mvf")) return true;
  }
  for (const e of entries) {
    if (e.isDirectory() && hasMvf(path.join(dir, e.name), depth - 1)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// OS National Grid helpers
// ---------------------------------------------------------------------------
const GRID_LETTERS = "ABCDEFGHJKLMNOPQRSTUVWXYZ"; // no I

// "SJ3490NE" -> { minE, minN, size } in EPSG:27700 metres, or null.
// Two 100 km-square letters, a 4-figure (1 km) reference, then a 500 m quadrant.
function gridRefFromName(name) {
  const m = name.toUpperCase().match(/^([A-Z]{2})(\d{2})(\d{2})(NE|NW|SE|SW)?/);
  if (!m) return null;
  const [, letters, ee, nn, quad] = m;
  const i0 = GRID_LETTERS.indexOf(letters[0]);
  const i1 = GRID_LETTERS.indexOf(letters[1]);
  if (i0 < 0 || i1 < 0) return null;
  // First letter picks a 500 km square, second a 100 km square inside it.
  const e500 = ((i0 % 5) - 2) * 500000;
  const n500 = (3 - Math.floor(i0 / 5)) * 500000;
  const e100 = (i1 % 5) * 100000;
  const n100 = (4 - Math.floor(i1 / 5)) * 100000;
  let minE = e500 + e100 + Number(ee) * 1000;
  let minN = n500 + n100 + Number(nn) * 1000;
  let size = 1000;
  if (quad) {
    size = 500;
    if (quad[0] === "N") minN += 500;
    if (quad[1] === "E") minE += 500;
  }
  return { minE, minN, size };
}

// ---------------------------------------------------------------------------
// OSGB36 (EPSG:27700) -> WGS84 (EPSG:4326)
// Inverse transverse Mercator on Airy 1830, then a Helmert datum shift. This is
// the standard 7-parameter approximation: good to roughly 5 m across GB, which
// is fine for an overlay but is NOT survey grade. (Sub-metre accuracy needs the
// OSTN15 shift grid, which is a large external dataset this repo avoids.)
// ---------------------------------------------------------------------------
const AIRY_A = 6377563.396;
const AIRY_B = 6356256.909;
const WGS_A = 6378137.0;
const WGS_B = 6356752.314245;
const F0 = 0.9996012717;
const LAT0 = (49 * Math.PI) / 180;
const LON0 = (-2 * Math.PI) / 180;
const E0 = 400000;
const N0 = -100000;

function osgbToWgs84(E, N) {
  const a = AIRY_A, b = AIRY_B;
  const e2 = 1 - (b * b) / (a * a);
  const n = (a - b) / (a + b);
  const n2 = n * n, n3 = n2 * n;

  let lat = LAT0;
  let M = 0;
  for (let i = 0; i < 12; i++) {
    lat = (N - N0 - M) / (a * F0) + lat;
    const dLat = lat - LAT0, sLat = lat + LAT0;
    const Ma = (1 + n + 1.25 * n2 + 1.25 * n3) * dLat;
    const Mb = (3 * n + 3 * n2 + 2.625 * n3) * Math.sin(dLat) * Math.cos(sLat);
    const Mc = (1.875 * n2 + 1.875 * n3) * Math.sin(2 * dLat) * Math.cos(2 * sLat);
    const Md = (35 / 24) * n3 * Math.sin(3 * dLat) * Math.cos(3 * sLat);
    M = b * F0 * (Ma - Mb + Mc - Md);
    if (Math.abs(N - N0 - M) < 1e-5) break;
  }

  const sinLat = Math.sin(lat), cosLat = Math.cos(lat), tanLat = Math.tan(lat);
  const t2 = tanLat * tanLat, t4 = t2 * t2, t6 = t4 * t2;
  const nu = (a * F0) / Math.sqrt(1 - e2 * sinLat * sinLat);
  const rho = (a * F0 * (1 - e2)) / Math.pow(1 - e2 * sinLat * sinLat, 1.5);
  const eta2 = nu / rho - 1;

  const nu3 = nu ** 3, nu5 = nu ** 5, nu7 = nu ** 7;
  const VII = tanLat / (2 * rho * nu);
  const VIII = (tanLat / (24 * rho * nu3)) * (5 + 3 * t2 + eta2 - 9 * t2 * eta2);
  const IX = (tanLat / (720 * rho * nu5)) * (61 + 90 * t2 + 45 * t4);
  const secLat = 1 / cosLat;
  const X = secLat / nu;
  const XI = (secLat / (6 * nu3)) * (nu / rho + 2 * t2);
  const XII = (secLat / (120 * nu5)) * (5 + 28 * t2 + 24 * t4);
  const XIIA = (secLat / (5040 * nu7)) * (61 + 662 * t2 + 1320 * t4 + 720 * t6);

  const dE = E - E0, dE2 = dE * dE, dE3 = dE2 * dE, dE4 = dE2 * dE2;
  const dE5 = dE4 * dE, dE6 = dE4 * dE2, dE7 = dE6 * dE;

  const latA = lat - VII * dE2 + VIII * dE4 - IX * dE6;
  const lonA = LON0 + X * dE - XI * dE3 + XII * dE5 - XIIA * dE7;

  return helmertAiryToWgs(latA, lonA);
}

// OSGB36 -> WGS84 Helmert parameters (metres, arc-seconds, ppm).
const TX = 446.448, TY = -125.157, TZ = 542.06;
const RX = (0.1502 / 3600) * (Math.PI / 180);
const RY = (0.247 / 3600) * (Math.PI / 180);
const RZ = (0.8421 / 3600) * (Math.PI / 180);
const S = -20.4894e-6;

function helmertAiryToWgs(lat, lon) {
  const a1 = AIRY_A, b1 = AIRY_B;
  const e2a = 1 - (b1 * b1) / (a1 * a1);
  const sinLat = Math.sin(lat), cosLat = Math.cos(lat);
  const nu = a1 / Math.sqrt(1 - e2a * sinLat * sinLat);
  const H = 0;

  const x1 = (nu + H) * cosLat * Math.cos(lon);
  const y1 = (nu + H) * cosLat * Math.sin(lon);
  const z1 = ((1 - e2a) * nu + H) * sinLat;

  const x2 = TX + x1 * (1 + S) - y1 * RZ + z1 * RY;
  const y2 = TY + x1 * RZ + y1 * (1 + S) - z1 * RX;
  const z2 = TZ - x1 * RY + y1 * RX + z1 * (1 + S);

  const a2 = WGS_A, b2 = WGS_B;
  const e2b = 1 - (b2 * b2) / (a2 * a2);
  const p = Math.sqrt(x2 * x2 + y2 * y2);
  let latB = Math.atan2(z2, p * (1 - e2b));
  for (let i = 0; i < 10; i++) {
    const s = Math.sin(latB);
    const nu2 = a2 / Math.sqrt(1 - e2b * s * s);
    const next = Math.atan2(z2 + e2b * nu2 * s, p);
    if (Math.abs(next - latB) < 1e-12) { latB = next; break; }
    latB = next;
  }
  const lonB = Math.atan2(y2, x2);
  // 6 dp is ~0.11 m here - far finer than the ~3 m the Helmert shift itself
  // costs, and it keeps the emitted GeoJSON to a third of full float64 width.
  return [round6((lonB * 180) / Math.PI), round6((latB * 180) / Math.PI)];
}

const round6 = (v) => Math.round(v * 1e6) / 1e6;

// ---------------------------------------------------------------------------
// CGM parsing
// ---------------------------------------------------------------------------
function deobfuscate(raw) {
  const out = Buffer.alloc(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = ~raw[i ^ 1] & 0xff;
  return out;
}

/**
 * Locate the end of the obfuscated header.
 *
 * The obfuscated block is NOT a fixed size - it ends on a CGM element boundary
 * whose offset varies per tile (512 and 520 are the commonest, but 129 distinct
 * lengths show up across the national set). So rather than assume a length, walk
 * the deobfuscated stream until it stops parsing, then take the latest element
 * boundary from which the *raw* bytes parse cleanly all the way to END METAFILE.
 * That end-of-file check is what makes the guess safe: a wrong boundary derails
 * within a few elements.
 *
 * Returns { start, deob } where `start` is the first plain byte (=== raw.length
 * for the handful of tiles that are obfuscated end to end), or null if the tile
 * cannot be parsed either way.
 */
function detectBoundary(raw) {
  const deob = deobfuscate(raw);
  const d = scanElements(deob, 0);
  if (d.clean && d.sawEndMetafile) return { start: raw.length, deob };
  for (let i = d.bounds.length - 1; i >= 0; i--) {
    const b = d.bounds[i];
    if (b < 64) break;
    const r = scanElements(raw, b);
    if (r.clean && r.sawEndMetafile) return { start: b, deob };
  }
  return null;
}

// Walk command headers only, collecting element boundaries and noting whether
// the stream ran to END METAFILE without hitting an impossible element class.
function scanElements(buf, start) {
  let p = start;
  const bounds = [];
  let sawEndMetafile = false;
  while (p + 2 <= buf.length) {
    bounds.push(p);
    const hdr = buf.readUInt16BE(p);
    const cls = (hdr >> 12) & 0xf;
    const id = (hdr >> 5) & 0x7f;
    let q = p + 2;
    let len = hdr & 0x1f;
    if (len === 31) {
      if (q + 2 > buf.length) break;
      len = buf.readUInt16BE(q) & 0x7fff;
      q += 2;
    }
    if (cls > 9 || q + len > buf.length) break;
    if (cls === 0 && id === 2) sawEndMetafile = true;
    p = q + len + (len & 1);
  }
  return { end: p, bounds, sawEndMetafile, clean: p >= buf.length - 2 };
}

// Walk CGM command headers. Long-form lengths carry a partition flag in bit 15;
// these tiles do not use partitioned data, but the flag is masked off anyway.
function* elements(buf, start, end) {
  let p = start;
  const stop = end ?? buf.length;
  while (p + 2 <= stop) {
    const hdr = buf.readUInt16BE(p);
    p += 2;
    const cls = (hdr >> 12) & 0xf;
    const id = (hdr >> 5) & 0x7f;
    let len = hdr & 0x1f;
    if (len === 31) {
      if (p + 2 > stop) return;
      len = buf.readUInt16BE(p) & 0x7fff;
      p += 2;
    }
    if (p + len > stop) return;
    yield { cls, id, len, data: buf.subarray(p, p + len) };
    p += len + (len & 1); // parameters pad to a word boundary
  }
}

function readStr(buf, off) {
  if (off >= buf.length) return ["", off];
  const len = buf[off];
  return [buf.subarray(off + 1, off + 1 + len).toString("latin1"), off + 1 + len];
}

// APS ATTR payload: attribute name, then a length-prefixed structured data
// record holding <type:int16><count:int16> followed by `count` strings.
function readApsAttr(data) {
  const [name, o1] = readStr(data, 0);
  if (o1 >= data.length) return [name, ""];
  const sdrLen = data[o1];
  const sdr = data.subarray(o1 + 1, o1 + 1 + sdrLen);
  if (sdr.length < 4) return [name, ""];
  const count = sdr.readInt16BE(2);
  let o = 4;
  const vals = [];
  for (let i = 0; i < count && o < sdr.length; i++) {
    const [s, next] = readStr(sdr, o);
    vals.push(s);
    o = next;
  }
  return [name, vals.join(" ")];
}

function tierFromLayer(id, name) {
  if (LAYER_TIER[id]) return LAYER_TIER[id];
  const n = (name || "").toUpperCase();
  if (!/MAINS|PLANT|PRESSURE/.test(n)) return null;
  if (/NATIONAL/.test(n) && /HIGH/.test(n)) return "HPN";
  if (/LOCAL/.test(n) && /HIGH/.test(n)) return "HPL";
  if (/HIGH/.test(n)) return "HPL";
  if (/INTERMEDIATE/.test(n)) return "IP";
  if (/MEDIUM/.test(n)) return "MP";
  if (/LOW/.test(n)) return "LP";
  return null;
}

// "125MM PE (IN 6\" CI)" -> { diameter_mm: 125, material: "PE",
//                             inserted_into: '6" CI' }
function parseScreenTip(tip) {
  const out = {};
  if (!tip) return out;
  out.spec = tip;
  const inserted = tip.match(/\(\s*IN\s+([^)]+)\)/i);
  if (inserted) out.inserted_into = inserted[1].trim();
  const head = tip.replace(/\(\s*IN\s+[^)]+\)/i, "").trim();
  let m;
  if ((m = head.match(/^(\d+(?:\.\d+)?)\s*MM\b/i))) out.diameter_mm = Number(m[1]);
  else if ((m = head.match(/^(\d+(?:\.\d+)?)\s*"/))) out.diameter_mm = Math.round(Number(m[1]) * 25.4);
  const mat = head.match(/\b(PE|CI|SI|DI|ST|MS|PVC|AC)\b/i);
  if (mat) out.material = mat[1].toUpperCase();
  return out;
}

// Long-form material names are NOT written per feature - index.html already has
// the same lookup (GAS_MAT) and expands the code at render time.

/**
 * Parse one tile into features. Returns { features, stats }.
 */
function parseTile(file, opts) {
  const raw = fs.readFileSync(file);
  if (raw.length < 64) return null;

  const bound = detectBoundary(raw);
  if (!bound) return null;
  const { start: bodyStart, deob } = bound;
  const head = deob.subarray(0, bodyStart);
  const text = head.toString("latin1");
  const meta = {};
  for (const m of text.matchAll(/"([A-Za-z]+):([^"]*)"/g)) meta[m[1]] = m[2];

  // Georeference from the header, falling back to the filename's grid ref.
  let minE = Number(meta.Xmin), minN = Number(meta.Ymin);
  let maxE = Number(meta.Xmax), maxN = Number(meta.Ymax);
  if (![minE, minN, maxE, maxN].every(Number.isFinite)) {
    const g = gridRefFromName(path.basename(file, path.extname(file)));
    if (!g) return null;
    minE = g.minE; minN = g.minN; maxE = g.minE + g.size; maxN = g.minN + g.size;
  }

  // VDC extent, from the picture descriptor (class 2, id 6). Defaults to the
  // 0..16000 square these tiles use if absent.
  let vx0 = 0, vy0 = 0, vx1 = 16000, vy1 = 16000;
  for (const e of elements(head, 0)) {
    if (e.cls === 2 && e.id === 6 && e.len >= 8) {
      vx0 = e.data.readInt16BE(0); vy0 = e.data.readInt16BE(2);
      vx1 = e.data.readInt16BE(4); vy1 = e.data.readInt16BE(6);
    }
  }
  const sx = (maxE - minE) / (vx1 - vx0 || 1);
  const sy = (maxN - minN) / (vy1 - vy0 || 1);

  // A layer application structure can open inside the obfuscated header block,
  // so scan it first and carry the state into the body.
  const stack = [];
  let layerId = null, layerName = null, tier = null;
  let gr = null; // current grobject
  const features = [];
  let pipes = 0, plant = 0;

  const handle = (e) => {
    const key = `${e.cls}/${e.id}`;
    switch (key) {
      case "0/21": { // BEGIN APPLICATION STRUCTURE
        const [id, o1] = readStr(e.data, 0);
        const [type] = readStr(e.data, o1);
        stack.push({ id, type });
        if (type === "layer") {
          layerId = Number(id);
          layerName = null;
          tier = null;
        } else if (type === "grobject") {
          gr = { id, tip: null };
        }
        break;
      }
      case "0/23": { // END APPLICATION STRUCTURE
        const top = stack.pop();
        if (top && top.type === "grobject") gr = null;
        else if (top && top.type === "layer") { layerId = null; layerName = null; tier = null; }
        break;
      }
      case "9/1": { // APPLICATION STRUCTURE ATTRIBUTE
        const [name, val] = readApsAttr(e.data);
        if (name === "LayerName") {
          layerName = val;
          tier = tierFromLayer(layerId, val);
        } else if (name === "ScreenTip" && gr) {
          gr.tip = val;
        } else if (name === "Name" && gr) {
          gr.name = val;
        }
        break;
      }
      case "4/1":   // POLYLINE
      case "4/2": { // DISJOINT POLYLINE
        if (!tier) break;
        const n = Math.floor(e.len / 4);
        if (n < 2) break;
        const coords = [];
        for (let i = 0; i < n; i++) {
          const vx = e.data.readInt16BE(i * 4);
          const vy = e.data.readInt16BE(i * 4 + 2);
          coords.push(osgbToWgs84(minE + (vx - vx0) * sx, minN + (vy - vy0) * sy));
        }
        // Drop repeated vertices; the source has plenty of zero-length steps.
        const clean = coords.filter((c, i) => i === 0 || c[0] !== coords[i - 1][0] || c[1] !== coords[i - 1][1]);
        if (clean.length < 2) break;
        features.push(makeFeature("LineString", clean, tier, gr, false, meta));
        pipes++;
        break;
      }
      case "4/27": { // POLYSYMBOL - valves, governors, syphons and the like
        if (!tier || !opts.plant) break;
        // <symbol index:int16> then a run of VDC point pairs
        const n = Math.floor((e.len - 2) / 4);
        for (let i = 0; i < n; i++) {
          const vx = e.data.readInt16BE(2 + i * 4);
          const vy = e.data.readInt16BE(2 + i * 4 + 2);
          const pt = osgbToWgs84(minE + (vx - vx0) * sx, minN + (vy - vy0) * sy);
          features.push(makeFeature("Point", pt, tier, gr, true, meta));
          plant++;
        }
        break;
      }
    }
  };

  for (const e of elements(head, 0)) handle(e);
  if (bodyStart < raw.length) for (const e of elements(raw, bodyStart)) handle(e);

  return { features, pipes, plant, facet: meta.Facet || path.basename(file) };
}

// Per-feature properties are kept deliberately lean: at half a million features
// a repeated 40-byte layer name is 20 MB of nothing. Anything constant across a
// tier (source system, layer name) lives on the FeatureCollection instead, and
// anything derivable at render time (the long material name) is left to the map.
function makeFeature(type, coords, tier, gr, isPlant, meta) {
  const props = { pressure: tier, kind: isPlant ? "plant" : "main" };
  if (gr) {
    if (gr.name && gr.name !== "UNKNOWN") props.asset_id = gr.name;
    Object.assign(props, parseScreenTip(gr.tip));
  }
  if (meta.Date) props.surveyed = meta.Date;
  return { type: "Feature", properties: props, geometry: { type, coordinates: coords } };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.toLowerCase().endsWith(".mvf")) out.push(p);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log("Usage: node build_maps_mvf.mjs [--src=DIR] [--bbox=minE,minN,maxE,maxN] [--all]");
    console.log("Or put {\"source\":\"...\",\"bbox\":[...]} in local/mvf.config.json");
    return;
  }
  const cfg = loadConfig();
  const src = args.source || cfg.source;

  if (!src) {
    console.log("No MAPS Viewer source configured.");
    console.log("Either pass --src=\"C:\\path\\to\\MapsViewerJuly2026\"");
    console.log(`or create ${CONFIG} with:  { "source": "C:/path/to/MapsViewerJuly2026" }`);
    console.log("(Skipping - build_gas_local.mjs will still use anything already in local/source/.)");
    return;
  }
  const root = findTileRoot(src);
  if (!root) {
    console.log(`No .mvf tiles found under ${src}`);
    console.log("Point --src at the MAPS disc/folder root or its DATA/GAS/NG directory.");
    return;
  }

  // `all` takes everything the source holds. That is the right mode when the
  // source IS a selection - MAPS Viewer's tile picker installs the squares you
  // chose to C:\MAPS, so pointing at that and taking the lot reproduces your
  // selection exactly, instead of second-guessing it with a rectangle.
  const bbox = args.all || cfg.all ? null : args.bbox || cfg.bbox || DEFAULT_BBOX;
  const plant = cfg.plant !== false;

  console.log(`Source : ${root}`);
  console.log(`Extent : ${bbox ? `E ${bbox[0]}-${bbox[2]}, N ${bbox[1]}-${bbox[3]} (EPSG:27700)` : "everything (--all)"}`);

  const all = walk(root);
  console.log(`Tiles  : ${all.length} found`);

  // Filter on the filename's grid reference - no need to open a file to know
  // where it is.
  const wanted = all.filter((f) => {
    if (!bbox) return true;
    const g = gridRefFromName(path.basename(f, path.extname(f)));
    if (!g) return false;
    return g.minE + g.size > bbox[0] && g.minE < bbox[2] && g.minN + g.size > bbox[1] && g.minN < bbox[3];
  });
  console.log(`         ${wanted.length} inside the extent`);
  if (!wanted.length) {
    console.log("Nothing to do. Widen --bbox, or use --all.");
    return;
  }

  const byTier = { HPN: [], HPL: [], IP: [], MP: [], LP: [] };
  let pipes = 0, plantN = 0, failed = 0, done = 0;

  for (const f of wanted) {
    let r;
    try {
      r = parseTile(f, { plant });
    } catch (e) {
      failed++;
      continue;
    }
    if (!r) { failed++; continue; }
    for (const ft of r.features) {
      const t = ft.properties.pressure;
      if (byTier[t]) byTier[t].push(ft);
    }
    pipes += r.pipes;
    plantN += r.plant;
    done++;
    if (done % 500 === 0) process.stdout.write(`\r  parsed ${done}/${wanted.length} tiles...`);
  }
  process.stdout.write(`\r  parsed ${done}/${wanted.length} tiles      \n`);
  if (failed) console.log(`  (${failed} tiles unreadable or not MVF - skipped)`);

  // Rebuild the output tree from scratch so a re-run with a smaller extent
  // cannot leave stale geometry behind.
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Small tiers are written whole and drawn at every zoom; big ones become a
  // sparse tile tree the map windows to the viewport. meta.json is what the map
  // reads: it needs no code change here to pick up a new tier.
  const layers = [];
  let written = 0;
  for (const tier of ORDER) {
    const feats = byTier[tier];
    if (!feats || !feats.length) continue;
    const t = TIERS[tier];
    const spec = {
      id: `maps-${tier.toLowerCase()}`,
      tier,
      label: t.label,
      color: t.color,
      weight: t.weight,
      count: feats.length,
      layer: TIER_LAYER_NAME[tier] || null,
    };
    if (feats.length > TILE_THRESHOLD) {
      const st = writeTiles(feats, path.join(OUT_DIR, tier.toLowerCase()), t.grid);
      spec.tiles = tier.toLowerCase();
      spec.grid = t.grid;
      spec.minzoom = t.minzoom;
      console.log(
        `  ${tier.padEnd(3)} ${String(feats.length).padStart(7)} features -> ${st.cells} tiles on a z${t.grid} grid, ${st.mb} MB, biggest ${st.maxkb} KB (from z${t.minzoom})`
      );
    } else {
      const file = `${tier.toLowerCase()}.geojson`;
      const json = JSON.stringify({ type: "FeatureCollection", features: feats });
      fs.writeFileSync(path.join(OUT_DIR, file), json);
      spec.file = file;
      console.log(
        `  ${tier.padEnd(3)} ${String(feats.length).padStart(7)} features -> ${OUT_DIR}/${file} (${(json.length / 1e6).toFixed(1)} MB)`
      );
    }
    layers.push(spec);
    written += feats.length;
  }

  if (!written) {
    console.log("\nNo gas features found in that extent - only background mapping.");
    return;
  }

  // WGS84 envelope of everything actually extracted. The map uses this to hide
  // the wider-but-coarser Cadent open-data mains wherever MAPS has better data,
  // so the two never draw the same pipe twice.
  let lo0 = 180, la0 = 90, lo1 = -180, la1 = -90;
  const grow = (co) => {
    if (typeof co[0] === "number") {
      if (co[0] < lo0) lo0 = co[0];
      if (co[0] > lo1) lo1 = co[0];
      if (co[1] < la0) la0 = co[1];
      if (co[1] > la1) la1 = co[1];
    } else for (const x of co) grow(x);
  };
  for (const tier of ORDER) for (const f of byTier[tier] || []) if (f.geometry) grow(f.geometry.coordinates);

  fs.writeFileSync(
    path.join(OUT_DIR, "meta.json"),
    JSON.stringify(
      {
        source: "MAPS Viewer (NG,GDFO)",
        extent27700: bbox,
        bounds: lo1 < lo0 ? null : [lo0, la0, lo1, la1],
        mains: pipes,
        plant: plantN,
        layers,
      },
      null,
      2
    )
  );
  console.log(`\n${written} features (${pipes} mains, ${plantN} plant) -> ${OUT_DIR}/`);
  console.log(`Wrote ${OUT_DIR}/meta.json - the map loads these as ordinary Gas layers.`);
}

main();
