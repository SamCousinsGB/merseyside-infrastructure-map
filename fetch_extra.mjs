#!/usr/bin/env node
/**
 * fetch_extra.mjs - download the extra OSM infrastructure from Overpass:
 *   osm_pipelines.json    every man_made=pipeline (full route geometry)
 *   osm_industrial.json   storage tanks, gas holders, silos, chimneys,
 *                         power plants (power=plant) and weirs
 * over the SP Manweb footprint. build_extra.mjs then classifies/filters these
 * into extra_infra.geojson, which the map loads at runtime.
 *
 * Usage: node fetch_extra.mjs        (then: node build_extra.mjs)
 */
import fs from "node:fs";

const EP = "https://overpass-api.de/api/interpreter";
const BBOX = "52.90,-3.70,53.80,-2.40"; // S,W,N,E - Merseyside/Wirral/Cheshire/Flintshire

async function overpass(query, out) {
  const r = await fetch(EP, { method: "POST", headers: { "Content-Type": "text/plain" }, body: query });
  if (!r.ok) throw new Error(`Overpass HTTP ${r.status} for ${out}`);
  const t = await r.text();
  fs.writeFileSync(out, t);
  console.log(`wrote ${out} (${(t.length / 1e6).toFixed(1)} MB)`);
}

const pipes = `[out:json][timeout:300];( way["man_made"="pipeline"](${BBOX}); ); out geom;`;
const indus = `[out:json][timeout:300];(
  nwr["man_made"="storage_tank"](${BBOX});
  nwr["man_made"="tank"](${BBOX});
  nwr["man_made"="gasometer"](${BBOX});
  nwr["man_made"="silo"](${BBOX});
  nwr["man_made"="chimney"](${BBOX});
  nwr["power"="plant"](${BBOX});
  way["waterway"="weir"](${BBOX});
); out geom;`;

await overpass(pipes, "osm_pipelines.json");
await overpass(indus, "osm_industrial.json");
console.log("done - now run: node build_extra.mjs");
