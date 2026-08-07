#!/usr/bin/env node
/**
 * merge_gas.mjs - chain Cadent's individual pipe records into continuous
 * polylines, so the gas layer renders as real vector geometry (like the map's
 * other layers) and ships far fewer features per tile.
 *
 * Pipes are bucketed by every attribute the map shows - (type, pressure,
 * material, diameter, diameter unit, above-ground) - then greedily chained
 * end-to-end via an exact (5 dp) endpoint hash. Bucketing on the full attribute
 * set means a merged polyline is always homogeneous, so a popup can never
 * report a diameter or material that is wrong for the bit you clicked.
 *
 * Install year is deliberately NOT in the bucket key: it is frequently
 * inferred or defaulted in the source, and including it would shatter otherwise
 * continuous mains. The earliest year across a chain is kept.
 *
 * MultiLineString inputs are exploded into their parts before chaining.
 *
 * Usage: node merge_gas.mjs [in=gas_pipes.geojson] [out=gas_pipes_merged.geojson]
 */
import fs from "node:fs";

const IN = process.argv[2] || "gas_pipes.geojson";
const OUT = process.argv[3] || "gas_pipes_merged.geojson";

console.log(`reading ${IN} ...`);
const fc = JSON.parse(fs.readFileSync(IN, "utf8"));

// explode MultiLineString -> LineString so chaining sees flat geometry
const F = [];
for (const f of fc.features) {
  const g = f.geometry;
  if (!g) continue;
  if (g.type === "LineString") F.push({ p: f.properties || {}, c: g.coordinates });
  else if (g.type === "MultiLineString")
    for (const part of g.coordinates) F.push({ p: f.properties || {}, c: part });
}
console.log(`  ${fc.features.length} records -> ${F.length} linestrings`);

const epKey = (c) => c[0].toFixed(5) + "," + c[1].toFixed(5);
const bucketKey = (p) =>
  [p.t || "u", p.p || "", p.m || "", p.d == null ? "" : p.d, p.du || "", p.ag ? 1 : 0].join("|");

const buckets = new Map();
for (let i = 0; i < F.length; i++) {
  if (F[i].c.length < 2) continue;
  const k = bucketKey(F[i].p);
  let a = buckets.get(k);
  if (!a) buckets.set(k, (a = []));
  a.push(i);
}
console.log(`  ${buckets.size} attribute buckets`);

const used = new Uint8Array(F.length);
const out = [];
let id = 1;

for (const [k, idxs] of buckets) {
  // endpoint -> indices sharing that exact endpoint (within this bucket)
  const ep = new Map();
  const add = (kk, i) => {
    let a = ep.get(kk);
    if (!a) ep.set(kk, (a = []));
    a.push(i);
  };
  for (const i of idxs) {
    add(epKey(F[i].c[0]), i);
    add(epKey(F[i].c[F[i].c.length - 1]), i);
  }

  const [t, p, m, d, du, ag] = k.split("|");

  for (const start of idxs) {
    if (used[start]) continue;
    used[start] = 1;
    const coords = F[start].c.slice();
    let yr = F[start].p.yr ?? null;

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
        let nc = F[next].c;
        if (epKey(nc[0]) !== kk) nc = nc.slice().reverse(); // orient: nc[0] == endPt
        const ny = F[next].p.yr;
        if (ny != null && (yr == null || ny < yr)) yr = ny; // oldest wins
        if (atTail) for (let q = 1; q < nc.length; q++) coords.push(nc[q]);
        else for (let q = 1; q < nc.length; q++) coords.unshift(nc[q]);
      }
    };
    extend(true);
    extend(false);

    out.push({
      type: "Feature",
      id: id++,
      properties: {
        t,
        p,
        m,
        d: d === "" ? null : Number(d),
        du,
        ag: Number(ag),
        yr,
      },
      geometry: { type: "LineString", coordinates: coords },
    });
  }
}

const ratio = out.length ? (F.length / out.length).toFixed(2) : "0";
console.log(`  merged -> ${out.length} polylines (ratio ${ratio}x)`);

const ws = fs.createWriteStream(OUT);
ws.write('{"type":"FeatureCollection","features":[');
for (let i = 0; i < out.length; i++) ws.write((i ? "," : "") + JSON.stringify(out[i]));
ws.write("]}");
await new Promise((r) => ws.end(r));
console.log(`wrote ${OUT}`);
