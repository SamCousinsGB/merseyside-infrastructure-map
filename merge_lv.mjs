#!/usr/bin/env node
/**
 * merge_lv.mjs - merge the ~1.47M ~2 m LV cable segments into continuous
 * polylines, so the LV layer renders as real vector geometry (like the map's
 * other layers) instead of blurry raster tiles.
 *
 * Segments are bucketed by (rag, type, v) - i.e. same capacity status, cable
 * spec and voltage - then greedily chained end-to-end via an exact (5 dp)
 * endpoint hash. Each merged polyline gets a stable integer `id` (used at
 * runtime to de-duplicate features that span more than one tile).
 *
 * Usage: node merge_lv.mjs [in=lv_cables.geojson] [out=lv_cables_merged.geojson]
 */
import fs from "node:fs";

const IN = process.argv[2] || "lv_cables.geojson";
const OUT = process.argv[3] || "lv_cables_merged.geojson";

console.log(`reading ${IN} ...`);
const fc = JSON.parse(fs.readFileSync(IN, "utf8"));
const F = fc.features;
console.log(`  ${F.length} segments`);

const epKey = (c) => c[0].toFixed(5) + "," + c[1].toFixed(5);

// group segment indices by (rag|type|v)
const buckets = new Map();
for (let i = 0; i < F.length; i++) {
  if (!F[i].geometry || F[i].geometry.type !== "LineString") continue;
  const p = F[i].properties || {};
  const k = (p.rag || "x") + "|" + (p.type || "") + "|" + (p.v == null ? "" : p.v);
  let a = buckets.get(k);
  if (!a) buckets.set(k, (a = []));
  a.push(i);
}
console.log(`  ${buckets.size} (rag,type,v) buckets`);

const used = new Uint8Array(F.length);
const out = [];
let id = 1;

for (const [k, idxs] of buckets) {
  // endpoint -> segment indices sharing that exact endpoint (within this bucket)
  const ep = new Map();
  const add = (kk, i) => {
    let a = ep.get(kk);
    if (!a) ep.set(kk, (a = []));
    a.push(i);
  };
  for (const i of idxs) {
    const cs = F[i].geometry.coordinates;
    add(epKey(cs[0]), i);
    add(epKey(cs[cs.length - 1]), i);
  }

  const parts = k.split("|");
  const rag = parts[0];
  const type = parts[1];
  const v = parts[2] === "" ? null : Number(parts[2]);

  for (const start of idxs) {
    if (used[start]) continue;
    used[start] = 1;
    const coords = F[start].geometry.coordinates.slice();

    // grow from both ends along shared exact endpoints
    const extend = (atTail) => {
      for (;;) {
        const endPt = atTail ? coords[coords.length - 1] : coords[0];
        const kk = epKey(endPt);
        const cand = ep.get(kk);
        if (!cand) break;
        let next = -1;
        for (const j of cand) if (!used[j]) { next = j; break; }
        if (next < 0) break;
        used[next] = 1;
        let nc = F[next].geometry.coordinates;
        if (epKey(nc[0]) !== kk) nc = nc.slice().reverse(); // orient: nc[0] == endPt
        if (atTail) for (let t = 1; t < nc.length; t++) coords.push(nc[t]);
        else for (let t = 1; t < nc.length; t++) coords.unshift(nc[t]);
      }
    };
    extend(true);
    extend(false);

    out.push({
      type: "Feature",
      id: id++,
      properties: { rag, type, v },
      geometry: { type: "LineString", coordinates: coords },
    });
  }
}

console.log(`  merged -> ${out.length} polylines (ratio ${(F.length / out.length).toFixed(2)}x)`);

const ws = fs.createWriteStream(OUT);
ws.write('{"type":"FeatureCollection","features":[');
for (let i = 0; i < out.length; i++) ws.write((i ? "," : "") + JSON.stringify(out[i]));
ws.write("]}");
await new Promise((r) => ws.end(r));
console.log(`wrote ${OUT}`);
