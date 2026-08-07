#!/usr/bin/env node
/**
 * fetch_gas_sites.mjs - download Cadent's ABOVE-GROUND gas infrastructure for
 * the region: the sites (governors / pressure-reduction installations) and the
 * above-ground pipe runs.
 *
 *   Source  : https://cadentgas.opendatasoft.com  (Opendatasoft Explore API v2.1)
 *   Licence : Open Government Licence v3.0 (both datasets)
 *   Datasets:
 *     above-ground-infrastructure-assets-open  9,464 points nationally
 *       Cadent: "assets that sit above ground ... usually assets that reduce the
 *       pressure of gas so the relevant pressure of gas is sent to the right
 *       locations" - i.e. governors / pressure-reduction sites.
 *     agp-above-ground-pipes-open              2,013 linestrings nationally
 *       Pipes that run above ground to cross a river, bridge or ravine.
 *
 * These are small (~1.4k + ~270 features in-region), so unlike the mains they
 * are written as plain committed GeoJSON and drawn in one go - no tile pyramid.
 *
 * Two things worth knowing about the source, both verified against the API:
 *   - Every site carries the SAME description, the literal string "Above Ground
 *     Site". The open tier does not say which are governors, which are valve
 *     compounds, and so on, so the map cannot either. Do not infer a type.
 *   - The "Shared" twin of the sites dataset (agis-above-ground-asset-shared)
 *     has an identical schema and identical record count. It is the same data
 *     behind a data sharing agreement, so there is nothing to gain by using it
 *     and this map does not.
 *
 * The above-ground pipes are NOT duplicates of GPI Open's ag_ind=True pipes:
 * sampled locations carry above-ground pipes here while GPI marks every pipe at
 * the same spot as below ground. Treat the two as complementary.
 *
 * API key: --key=, $CADENT_API_KEY, or .cadent_key (git-ignored). See fetch_gas.mjs.
 *
 * Usage:
 *   node fetch_gas_sites.mjs [--bbox=minLat,minLon,maxLat,maxLon]
 *                            [--sites=gas_ag_sites.geojson] [--pipes=gas_ag_pipes.geojson]
 */
import fs from "node:fs";

const DATASETS = {
  sites: "above-ground-infrastructure-assets-open",
  pipes: "agp-above-ground-pipes-open",
};

const arg = (k, d) => {
  const m = process.argv.find((a) => a.startsWith(`--${k}=`));
  return m ? m.slice(k.length + 3) : d;
};
const BASE = arg("base", "https://cadentgas.opendatasoft.com/api/explore/v2.1/catalog/datasets");
const bbox = (arg("bbox", "52.95,-4.95,53.75,-2.45")).split(",").map(Number);
const OUT = { sites: arg("sites", "gas_ag_sites.geojson"), pipes: arg("pipes", "gas_ag_pipes.geojson") };

function apiKey() {
  const a = arg("key", null);
  if (a) return a.trim();
  if (process.env.CADENT_API_KEY) return process.env.CADENT_API_KEY.trim();
  try {
    const k = fs.readFileSync(".cadent_key", "utf8").trim();
    if (k) return k;
  } catch {}
  console.error(
    "No API key. Create one at https://cadentgas.opendatasoft.com (Account -> API\n" +
      "keys), then: echo YOUR_KEY > .cadent_key   (git-ignored)"
  );
  process.exit(1);
}
const KEY = apiKey();
const scrub = (s) => String(s).split(KEY).join("<key>");
const HEADERS = { Authorization: `Apikey ${KEY}`, "User-Agent": "merseyside-infrastructure-map" };

async function getJSON(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: HEADERS });
      if (r.status === 401 || r.status === 403)
        throw new Error(`HTTP ${r.status} - the API key was rejected`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i === tries - 1) throw new Error(scrub(e.message));
      await new Promise((res) => setTimeout(res, 900 * (i + 1)));
    }
  }
}

const where = `in_bbox(geo_shape, ${bbox[0]}, ${bbox[1]}, ${bbox[2]}, ${bbox[3]})`;
const r5 = (n) => Math.round(n * 1e5) / 1e5;
const roundCoords = (c) => (typeof c[0] === "number" ? [r5(c[0]), r5(c[1])] : c.map(roundCoords));

async function grab(kind) {
  const ds = DATASETS[kind];
  // count first, so a short export is caught rather than silently accepted
  const cnt = await getJSON(`${BASE}/${ds}/records?${new URLSearchParams({ where, limit: "0" })}`);
  const expected = cnt.total_count ?? 0;

  const p = new URLSearchParams({ where });
  const fc = await getJSON(`${BASE}/${ds}/exports/geojson?${p}`);
  const feats = (fc.features || []).filter((f) => f.geometry);

  const out = feats.map((f) => {
    const q = f.properties || {};
    const props = { id: q.objectid ?? null };
    if (kind === "pipes" && q.shape_length != null) {
      const L = Number(q.shape_length);
      if (Number.isFinite(L)) props.len = Math.round(L * 10) / 10;   // metres
    }
    return {
      type: "Feature",
      geometry: { type: f.geometry.type, coordinates: roundCoords(f.geometry.coordinates) },
      properties: props,
    };
  });

  fs.writeFileSync(OUT[kind], JSON.stringify({ type: "FeatureCollection", features: out }));
  const geoms = [...new Set(out.map((f) => f.geometry.type))].join("/") || "-";
  const flag = out.length === expected ? "" : `  !! expected ${expected}`;
  console.log(`  ${kind}: ${out.length} features (${geoms}) -> ${OUT[kind]}${flag}`);
  return out.length === expected;
}

console.log(`Above-ground gas assets, bbox lat[${bbox[0]}..${bbox[2]}] lon[${bbox[1]}..${bbox[3]}]`);
let ok = true;
for (const kind of Object.keys(DATASETS)) ok = (await grab(kind)) && ok;
if (!ok) {
  console.error("A dataset returned fewer features than its own count reported - not writing off a short download.");
  process.exit(1);
}
console.log("done.");
