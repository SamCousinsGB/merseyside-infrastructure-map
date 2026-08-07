#!/usr/bin/env node
/**
 * build_gas_tiles.mjs - bin the merged Cadent gas polylines into a sparse grid
 * of plain-GeoJSON tiles on a fixed zoom-14 grid, exactly like the LV cables.
 *
 * Mains and service pipes go into SEPARATE tile trees:
 *
 *   tiles/gasgeo/main/{x}/{y}.json   mains (+ any transmission), shown from z14
 *   tiles/gasgeo/svc/{x}/{y}.json    service pipes + risers,      shown from z17
 *
 * Splitting them matters because the two are drawn at different zooms: keeping
 * services out of the mains tiles means a z14 view never downloads geometry it
 * will not draw until z17. (In the Merseyside region mains are actually the
 * heavier half - ~157k polylines / 66 MB against ~13k / 5 MB of services - so
 * the saving runs the other way from what you might expect, but the split is
 * what lets either layer be zoom-gated independently of the other.)
 *
 * A feature is written into every z14 cell its bounding box covers, so
 * polylines never drop out at a tile edge; the runtime de-duplicates by `id`.
 *
 * Usage: node build_gas_tiles.mjs [in=gas_pipes_merged.geojson] [outdir=tiles/gasgeo]
 */
import fs from "node:fs";
import path from "node:path";

const IN = process.argv[2] || "gas_pipes_merged.geojson";
const OUT = process.argv[3] || "tiles/gasgeo";
const Z = 14;
const MAIN_MINZOOM = 14; // mains appear with the rest of the network
const SVC_MINZOOM = 17; // services only at street level

const lon2x = (lon) => Math.floor(((lon + 180) / 360) * 2 ** Z);
const lat2y = (lat) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** Z);
};

console.log(`reading ${IN} ...`);
const fc = JSON.parse(fs.readFileSync(IN, "utf8"));
console.log(`  ${fc.features.length} polylines`);

// service pipes + risers in one tree, everything else (mains, NTS/LTS) in the other
const isService = (f) => f.properties.t === "s" || f.properties.t === "r";

const trees = { main: new Map(), svc: new Map() };
const counts = { main: 0, svc: 0 };
let minx = 180,
  miny = 90,
  maxx = -180,
  maxy = -90;

for (const f of fc.features) {
  const which = isService(f) ? "svc" : "main";
  counts[which]++;
  const cells = trees[which];

  let a = 180,
    b = 90,
    c = -180,
    d = -90; // feature bbox: minLon,minLat,maxLon,maxLat
  for (const p of f.geometry.coordinates) {
    if (p[0] < a) a = p[0];
    if (p[0] > c) c = p[0];
    if (p[1] < b) b = p[1];
    if (p[1] > d) d = p[1];
  }
  if (a < minx) minx = a;
  if (c > maxx) maxx = c;
  if (b < miny) miny = b;
  if (d > maxy) maxy = d;

  const x0 = lon2x(a),
    x1 = lon2x(c),
    y0 = lat2y(d),
    y1 = lat2y(b);
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++) {
      const k = x + "/" + y;
      let arr = cells.get(k);
      if (!arr) cells.set(k, (arr = []));
      arr.push(f);
    }
}

fs.rmSync(OUT, { recursive: true, force: true });
const stats = {};
for (const which of ["main", "svc"]) {
  let files = 0,
    bytes = 0;
  for (const [k, feats] of trees[which]) {
    const [x, y] = k.split("/");
    const dir = path.join(OUT, which, x);
    fs.mkdirSync(dir, { recursive: true });
    const json = JSON.stringify({ type: "FeatureCollection", features: feats });
    fs.writeFileSync(path.join(dir, y + ".json"), json);
    files++;
    bytes += json.length;
  }
  stats[which] = { cells: files, mb: +(bytes / 1e6).toFixed(1), features: counts[which] };
  console.log(
    `  ${which}: ${counts[which]} polylines -> ${files} cells, ${(bytes / 1e6).toFixed(1)} MB`
  );
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(
  path.join(OUT, "meta.json"),
  JSON.stringify({
    grid: Z,
    mainMinzoom: MAIN_MINZOOM,
    svcMinzoom: SVC_MINZOOM,
    bounds: counts.main + counts.svc ? [minx, miny, maxx, maxy] : null,
    ...stats,
  })
);
console.log(`wrote ${OUT}/meta.json`);
