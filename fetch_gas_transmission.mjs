#!/usr/bin/env node
/**
 * fetch_gas_transmission.mjs - download the high-pressure gas TRANSMISSION
 * network (the NTS / LTS backbone) for the region from OpenStreetMap.
 *
 *   Source  : OpenStreetMap via Overpass
 *   Licence : Open Database Licence (ODbL) - © OpenStreetMap contributors
 *   Filter  : man_made=pipeline + substance~gas + usage=transmission
 *
 * Why OSM and not Cadent here: Cadent's own intermediate/high-pressure pipe data
 * ("..._north-west_shared") is a "Shared" dataset behind a data sharing
 * agreement, and the open account cannot read it. OSM's transmission tag is the
 * only openly-republishable source for the HP routes. Coverage is therefore
 * PARTIAL - it is what OSM mappers have traced, not a complete asset register -
 * so treat this as "known HP corridors", not "all of them".
 *
 * These lines are also present, undistinguished, in the general OSM "Pipelines"
 * layer (that layer shows every substance-tagged gas line). This file exists to
 * pull the transmission subset out so it can be drawn as its own heavy layer.
 *
 * Small (tens of ways), so it ships as one committed GeoJSON, no tiling.
 *
 * Usage: node fetch_gas_transmission.mjs [--bbox=S,W,N,E] [--out=gas_transmission.geojson]
 */
import fs from "node:fs";

// Overpass mirrors, tried in order; some 406 requests without a User-Agent.
const EPS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const arg = (k, d) => {
  const m = process.argv.find((a) => a.startsWith(`--${k}=`));
  return m ? m.slice(k.length + 3) : d;
};
const BBOX = arg("bbox", "52.95,-4.95,53.75,-2.45"); // S,W,N,E - the map's footprint
const OUT = arg("out", "gas_transmission.geojson");

const query = `[out:json][timeout:180];
way["man_made"="pipeline"]["substance"~"gas"]["usage"="transmission"](${BBOX});
out geom;`;

async function overpass(q, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    for (const ep of EPS) {
      try {
        const r = await fetch(ep, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "merseyside-infrastructure-map (github.com/SamCousinsGB)",
            Accept: "application/json",
          },
          body: "data=" + encodeURIComponent(q),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status} from ${ep}`);
        const j = await r.json();
        if (!j.elements) throw new Error("no elements in response");
        return j;
      } catch (e) {
        last = e;
        await new Promise((res) => setTimeout(res, 1500));
      }
    }
    await new Promise((res) => setTimeout(res, 3000 * (i + 1)));
  }
  throw last;
}

const r5 = (n) => Math.round(n * 1e5) / 1e5;

console.log(`Fetching OSM gas transmission pipelines, bbox ${BBOX} ...`);
const j = await overpass(query);
const ways = j.elements.filter((e) => e.type === "way" && e.geometry && e.geometry.length >= 2);

const hav = (a, b) => {
  const R = 6371000, t = (x) => (x * Math.PI) / 180;
  const dLat = t(b[1] - a[1]), dLon = t(b[0] - a[0]);
  const q = Math.sin(dLat / 2) ** 2 + Math.cos(t(a[1])) * Math.cos(t(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(q));
};

let totalM = 0;
const feats = ways.map((w) => {
  const t = w.tags || {};
  const coords = w.geometry.map((n) => [r5(n.lon), r5(n.lat)]);
  for (let i = 1; i < coords.length; i++) totalM += hav(coords[i - 1], coords[i]);
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: coords },
    properties: {
      id: `way/${w.id}`,
      osm: `https://www.openstreetmap.org/way/${w.id}`,
      name: t.name || "",
      // buried unless the tags say otherwise; surface/overground lines draw solid
      ug: /underground|underwater/.test(t.location || "") || t.pipeline === "buried",
    },
  };
});

fs.writeFileSync(OUT, JSON.stringify({ type: "FeatureCollection", features: feats }));
console.log(`  wrote ${feats.length} transmission pipelines (${(totalM / 1000).toFixed(1)} km) -> ${OUT}`);
if (!feats.length) {
  console.error("  no features - Overpass may have been busy; try again.");
  process.exit(1);
}
console.log("done.");
