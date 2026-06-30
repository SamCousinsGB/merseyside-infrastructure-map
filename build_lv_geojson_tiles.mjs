#!/usr/bin/env node
/**
 * build_lv_geojson_tiles.mjs - bin the merged LV polylines into a sparse grid
 * of plain-GeoJSON tiles (tiles/lvgeo/{x}/{y}.json) on a fixed zoom-14 grid.
 *
 * The map fetches the few tiles covering the current viewport and renders their
 * features as real L.geoJSON canvas polylines (crisp at every zoom). A feature
 * is written into every z14 cell its bounding box covers, so polylines never
 * drop out at a tile edge; the runtime de-duplicates by feature `id`.
 *
 * Usage: node build_lv_geojson_tiles.mjs [in=lv_cables_merged.geojson] [outdir=tiles/lvgeo]
 */
import fs from "node:fs";
import path from "node:path";

const IN = process.argv[2] || "lv_cables_merged.geojson";
const OUT = process.argv[3] || "tiles/lvgeo";
const Z = 14;
const MINZOOM_SHOW = 16; // map only draws cables from this zoom in

const lon2x = (lon) => Math.floor(((lon + 180) / 360) * 2 ** Z);
const lat2y = (lat) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** Z);
};

console.log(`reading ${IN} ...`);
const fc = JSON.parse(fs.readFileSync(IN, "utf8"));
console.log(`  ${fc.features.length} polylines`);

const cells = new Map(); // "x/y" -> [feature, ...]
let minx = 180, miny = 90, maxx = -180, maxy = -90;
for (const f of fc.features) {
  let a = 180, b = 90, c = -180, d = -90; // feature bbox: minLon,minLat,maxLon,maxLat
  for (const p of f.geometry.coordinates) {
    if (p[0] < a) a = p[0]; if (p[0] > c) c = p[0];
    if (p[1] < b) b = p[1]; if (p[1] > d) d = p[1];
  }
  if (a < minx) minx = a; if (c > maxx) maxx = c;
  if (b < miny) miny = b; if (d > maxy) maxy = d;
  const x0 = lon2x(a), x1 = lon2x(c), y0 = lat2y(d), y1 = lat2y(b);
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++) {
      const k = x + "/" + y;
      let arr = cells.get(k);
      if (!arr) cells.set(k, (arr = []));
      arr.push(f);
    }
}

fs.rmSync(OUT, { recursive: true, force: true });
let files = 0, bytes = 0;
for (const [k, feats] of cells) {
  const [x, y] = k.split("/");
  const dir = path.join(OUT, x);
  fs.mkdirSync(dir, { recursive: true });
  const json = JSON.stringify({ type: "FeatureCollection", features: feats });
  fs.writeFileSync(path.join(dir, y + ".json"), json);
  files++;
  bytes += json.length;
}
fs.writeFileSync(
  path.join(OUT, "meta.json"),
  JSON.stringify({ grid: Z, minzoomShow: MINZOOM_SHOW, bounds: [minx, miny, maxx, maxy], features: fc.features.length, cells: files })
);
console.log(`wrote ${files} cells, ${(bytes / 1e6).toFixed(1)} MB total, into ${OUT}`);
