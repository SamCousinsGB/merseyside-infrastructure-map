#!/usr/bin/env node
/**
 * build_lv_tiles.mjs - slice the downloaded LV GeoJSON into a Mapbox Vector
 * Tile pyramid (tiles/lv/{z}/{x}/{y}.pbf) using geojson-vt + vt-pbf.
 *
 * Two layers go into each tile:
 *   lv  - LV cables   (LineString, styled by capacity RAG status)
 *   tx  - transformers (Point)
 *
 * Tiles are generated for native zooms MINZOOM..MAXZOOM only; the map
 * over-zooms them client-side (Leaflet.VectorGrid) up to the map maxZoom, so a
 * modest native range keeps the file count and repo size sane while still
 * looking crisp when you zoom into a street. Only non-empty tiles are written.
 *
 * Usage:
 *   node build_lv_tiles.mjs --cables=lv_cables.geojson [--tx=lv_transformers.geojson]
 *        [--outdir=tiles/lv] [--minzoom=12] [--maxzoom=14]
 */
import fs from "node:fs";
import path from "node:path";
import geojsonvt from "geojson-vt";
import vtpbf from "vt-pbf";

const arg = (k, d) => {
  const m = process.argv.find((a) => a.startsWith(`--${k}=`));
  return m ? m.slice(k.length + 3) : d;
};
const CABLES = arg("cables", "lv_cables.geojson");
const TXIN = arg("tx", null);
const OUTDIR = arg("outdir", "tiles/lv");
const MINZOOM = Number(arg("minzoom", "14"));
const MAXZOOM = Number(arg("maxzoom", "15"));

const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

function bounds(fc) {
  let minx = 180,
    miny = 90,
    maxx = -180,
    maxy = -90;
  const scan = (c) => {
    if (typeof c[0] === "number") {
      if (c[0] < minx) minx = c[0];
      if (c[0] > maxx) maxx = c[0];
      if (c[1] < miny) miny = c[1];
      if (c[1] > maxy) maxy = c[1];
      return;
    }
    c.forEach(scan);
  };
  for (const f of fc.features) if (f.geometry) scan(f.geometry.coordinates);
  return [minx, miny, maxx, maxy];
}

console.log(`Reading ${CABLES} ...`);
const cables = JSON.parse(fs.readFileSync(CABLES, "utf8"));
console.log(`  ${cables.features.length} cable features`);
const tx = TXIN ? JSON.parse(fs.readFileSync(TXIN, "utf8")) : { type: "FeatureCollection", features: [] };
if (TXIN) console.log(`  ${tx.features.length} transformer features`);

const [minx, miny, maxx, maxy] = bounds(cables);
console.log(`Bounds lon[${minx.toFixed(3)}..${maxx.toFixed(3)}] lat[${miny.toFixed(3)}..${maxy.toFixed(3)}]`);

// indexMaxZoom left at the geojson-vt default (5): deeper tiles are generated
// on demand by getTile() rather than eagerly indexing the whole pyramid, which
// keeps memory sane for the full ~1.5M-feature region.
const opts = { maxZoom: MAXZOOM, tolerance: 3, extent: 4096, buffer: 64 };
console.log("Indexing cables (geojson-vt) ...");
const lvIdx = geojsonvt(cables, opts);
const txIdx = tx.features.length ? geojsonvt(tx, opts) : null;

fs.rmSync(OUTDIR, { recursive: true, force: true });
let written = 0,
  bytes = 0;
for (let z = MINZOOM; z <= MAXZOOM; z++) {
  const x0 = lon2x(minx, z),
    x1 = lon2x(maxx, z);
  const y0 = lat2y(maxy, z),
    y1 = lat2y(miny, z);
  let zc = 0;
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const lv = lvIdx.getTile(z, x, y);
      const t = txIdx ? txIdx.getTile(z, x, y) : null;
      const layers = {};
      if (lv && lv.features.length) layers.lv = lv;
      if (t && t.features.length) layers.tx = t;
      if (!Object.keys(layers).length) continue;
      const buf = vtpbf.fromGeojsonVt(layers, { version: 2 });
      const dir = path.join(OUTDIR, String(z), String(x));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${y}.pbf`), buf);
      written++;
      bytes += buf.length;
      zc++;
    }
  }
  console.log(`  z${z}: ${zc} tiles`);
}

fs.writeFileSync(
  path.join(OUTDIR, "meta.json"),
  JSON.stringify(
    {
      source: "SP Energy Networks ConnectMore (lv_cables_map_view, lv_transformers_map_view)",
      generated: "build_lv_tiles.mjs",
      minzoom: MINZOOM,
      maxzoom: MAXZOOM,
      bounds: [minx, miny, maxx, maxy],
      layers: { lv: "LV cables", tx: "LV transformers" },
      cables: cables.features.length,
      transformers: tx.features.length,
    },
    null,
    2
  )
);
console.log(`Wrote ${written} tiles, ${(bytes / 1e6).toFixed(1)} MB total, into ${OUTDIR}`);
