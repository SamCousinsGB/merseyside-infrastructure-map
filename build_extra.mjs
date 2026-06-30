#!/usr/bin/env node
/**
 * build_extra.mjs - turn the raw Overpass dumps (osm_pipelines.json,
 * osm_industrial.json from fetch_extra.mjs) into extra_infra.geojson, which the
 * map fetches at runtime and merges into the layers (de-duplicated by OSM id).
 *
 *   pipelines   -> existing Gas / Oil & chemicals / Water / Sewage categories,
 *                  classified by substance (or name for the big named lines)
 *   tank farms  -> new "Industrial" category (storage tanks >=200 m2 or with an
 *                  industrial content tag; small/agricultural tanks dropped)
 *   gas holders -> Industrial          chimneys      -> Industrial
 *   power stations (power=plant) -> Industrial        weirs -> Water
 *
 * Usage: node build_extra.mjs [pipes=osm_pipelines.json] [indus=osm_industrial.json] [out=extra_infra.geojson]
 */
import fs from "node:fs";

const PIPES = process.argv[2] || "osm_pipelines.json";
const INDUS = process.argv[3] || "osm_industrial.json";
const OUT = process.argv[4] || "extra_infra.geojson";

const load = (p) => JSON.parse(fs.readFileSync(p, "utf8")).elements || [];
const KEEP = ["name", "operator", "substance", "content", "location", "voltage", "ref",
  "man_made", "power", "waterway", "plant:source", "generator:source", "start_date"];
const small = (t) => Object.fromEntries(KEEP.filter((k) => k in t).map((k) => [k, t[k]]));
const osmUrl = (e) => `https://www.openstreetmap.org/${e.type}/${e.id}`;
const feat = (geom, p) => ({ type: "Feature", geometry: geom, properties: p });

// ----- geometry helpers ------------------------------------------------------
const ring = (g) => {
  const r = g.map((n) => [n.lon, n.lat]);
  if (r.length && (r[0][0] !== r.at(-1)[0] || r[0][1] !== r.at(-1)[1])) r.push(r[0]);
  return r;
};
function areaM2(g) {
  if (!g || g.length < 3) return 0;
  let a = 0; const R = 6378137, toR = Math.PI / 180;
  for (let i = 0, n = g.length; i < n; i++) {
    const p1 = g[i], p2 = g[(i + 1) % n];
    a += (p2.lon - p1.lon) * toR * (2 + Math.sin(p1.lat * toR) + Math.sin(p2.lat * toR));
  }
  return Math.abs((a * R * R) / 2);
}
function centroid(e) {
  // node, way (geometry), or relation (members with geometry)
  if (e.type === "node") return [e.lon, e.lat];
  let pts = [];
  if (e.geometry) pts = e.geometry;
  else if (e.members) for (const m of e.members) {
    if (m.geometry) pts = pts.concat(m.geometry);
    else if (m.lat != null) pts.push({ lat: m.lat, lon: m.lon });
  }
  if (!pts.length) return null;
  const x = pts.reduce((s, p) => s + p.lon, 0) / pts.length;
  const y = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  return [x, y];
}

// ----- pipelines -------------------------------------------------------------
function pipeCat(t) {
  const s = (t.substance || "").toLowerCase();
  if (/gas/.test(s)) return "gas";
  if (/oil|fuel|diesel|kerosene|petrol|ethylene|propylene|chemical|brine|steam|naphtha/.test(s)) return "fuel";
  if (/^(water|rainwater|potable|raw_water)$/.test(s)) return "water";
  if (/sewage|wastewater|effluent/.test(s)) return "sewage";
  if (!s) { // no substance: classify the big named lines, else drop
    const n = (t.name || "").toLowerCase();
    if (/aqueduct|big pipe|water main|raw water/.test(n)) return "water";
    if (/ethylene|nwep|rsep|tpep|scmp|brine|petrochem|naphtha|olefin/.test(n)) return "fuel";
    if (/\bgas\b/.test(n)) return "gas";
    return null; // unlabelled — skip
  }
  return "fuel"; // any other named substance -> chemicals
}
const out = [];
for (const e of load(PIPES)) {
  if (e.type !== "way" || !e.geometry || e.geometry.length < 2) continue;
  const t = e.tags || {};
  const cat = pipeCat(t);
  if (!cat) continue;
  const s = t.substance || "";
  out.push(feat(
    { type: "LineString", coordinates: e.geometry.map((n) => [n.lon, n.lat]) },
    {
      id: `${e.type}/${e.id}`, osm: osmUrl(e), name: t.name || "",
      cat, kind: s ? `${s} pipeline` : (t.name ? "pipeline" : "pipeline"),
      ug: /underground|underwater/.test(t.location || ""), tags: small(t),
    }
  ));
}
const pipeN = out.length;

// ----- industrial structures + weirs ----------------------------------------
const INDUSTRIAL_CONTENT = /oil|fuel|diesel|kerosene|petrol|lpg|gas|chemical|jet|avgas|oxygen|ethylene|naphtha|bitumen/i;
let tanks = 0, holders = 0, chimneys = 0, plants = 0, weirs = 0;
for (const e of load(INDUS)) {
  const t = e.tags || {};
  const mm = t.man_made, isPlant = t.power === "plant", isWeir = t.waterway === "weir";
  const closed = e.geometry && e.geometry.length > 3;
  const poly = closed ? { type: "Polygon", coordinates: [ring(e.geometry)] } : null;
  const c = centroid(e); const pt = c ? { type: "Point", coordinates: c } : null;

  if (mm === "storage_tank" || mm === "tank") {
    const a = e.geometry ? areaM2(e.geometry) : 0;
    const indus = a >= 200 || INDUSTRIAL_CONTENT.test(t.content || t.substance || "");
    if (!indus) continue; // drop small/agricultural tanks
    out.push(feat(poly || pt, { id: `${e.type}/${e.id}`, osm: osmUrl(e), name: t.name || "",
      cat: "industrial", kind: t.content ? `${t.content} tank` : "storage tank", ug: false, tags: small(t) }));
    tanks++;
  } else if (mm === "gasometer") {
    out.push(feat(poly || pt, { id: `${e.type}/${e.id}`, osm: osmUrl(e), name: t.name || "",
      cat: "industrial", kind: "gas holder", ug: false, tags: small(t) }));
    holders++;
  } else if (mm === "chimney") {
    if (!pt) continue;
    out.push(feat(pt, { id: `${e.type}/${e.id}`, osm: osmUrl(e), name: t.name || "",
      cat: "industrial", kind: "chimney", ug: false, tags: small(t) }));
    chimneys++;
  } else if (isPlant) {
    const src = t["plant:source"] || t["generator:source"] || "";
    out.push(feat(poly || pt, { id: `${e.type}/${e.id}`, osm: osmUrl(e), name: t.name || "",
      cat: "industrial", kind: src ? `${src} power station` : "power station", ug: false, tags: small(t) }));
    plants++;
  } else if (isWeir) {
    if (e.type === "way" && e.geometry) out.push(feat({ type: "LineString", coordinates: e.geometry.map((n) => [n.lon, n.lat]) },
      { id: `${e.type}/${e.id}`, osm: osmUrl(e), name: t.name || "", cat: "water", kind: "weir", ug: false, tags: small(t) }));
    weirs++;
  }
}

fs.writeFileSync(OUT, JSON.stringify({ type: "FeatureCollection", features: out }));
const byCat = {};
for (const f of out) byCat[f.properties.cat] = (byCat[f.properties.cat] || 0) + 1;
console.log(`pipelines kept: ${pipeN} | tanks: ${tanks} holders: ${holders} chimneys: ${chimneys} plants: ${plants} weirs: ${weirs}`);
console.log(`extra_infra.geojson: ${out.length} features by cat ${JSON.stringify(byCat)}`);
