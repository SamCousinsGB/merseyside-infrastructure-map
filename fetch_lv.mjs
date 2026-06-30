#!/usr/bin/env node
/**
 * fetch_lv.mjs - download the SP Manweb LV (low-voltage) network from the
 * SP Energy Networks "ConnectMore" GeoServer (public WFS, no auth) as GeoJSON.
 *
 *   Source : https://connectmore-heatmap-geo-blue.azurewebsites.net/geoserver
 *            workspace "connectmore-costestimator"
 *   Layers : lv_cables_map_view        (LV cables, ~1.47M LineStrings in-region)
 *            lv_transformers_map_view   (LV distribution transformers, points)
 *
 * The whole region is ~1.5M features, so we fetch over a spatial grid of small
 * bboxes (fast, parallel, no costly deep paging) and de-duplicate the cables
 * that straddle cell boundaries by their stable `id`. Geometry is WGS84
 * (EPSG:4326) lon/lat - directly Leaflet-ready. Output is reduced to the few
 * attributes the map uses and coordinates are rounded to 5 dp (~1 m).
 *
 * Usage:
 *   node fetch_lv.mjs --bbox=minLat,minLon,maxLat,maxLon --out=lv_cables.geojson
 *                     [--tx=lv_transformers.geojson] [--cell=0.05] [--conc=8]
 */
import fs from "node:fs";

const BASE =
  "https://connectmore-heatmap-geo-blue.azurewebsites.net/geoserver/connectmore-costestimator/ows";
const CABLES = "connectmore-costestimator:lv_cables_map_view";
const TX = "connectmore-costestimator:lv_transformers_map_view";

// ---- args -------------------------------------------------------------------
const arg = (k, d) => {
  const m = process.argv.find((a) => a.startsWith(`--${k}=`));
  return m ? m.slice(k.length + 3) : d;
};
const bbox = (arg("bbox", "52.95,-4.95,53.75,-2.45")).split(",").map(Number);
const [MINLAT, MINLON, MAXLAT, MAXLON] = bbox;
const OUT = arg("out", "lv_cables.geojson");
const TXOUT = arg("tx", null); // omit to skip transformers
const CELL = Number(arg("cell", "0.05")); // degrees
const CONC = Number(arg("conc", "8"));

// ---- WFS helpers ------------------------------------------------------------
function wfsUrl(typeName, b) {
  const [a, c, d, e] = b; // minLat,minLon,maxLat,maxLon
  const p = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: typeName,
    // bbox CRS urn::4326 => axis order is lat,lon (verified against the server)
    bbox: `${a},${c},${d},${e},urn:ogc:def:crs:EPSG::4326`,
    outputFormat: "application/json",
  });
  return `${BASE}?${p}`;
}

async function getJSON(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((res) => setTimeout(res, 800 * (i + 1)));
    }
  }
}

// Fetch one cell; if the server caps the response (returned < matched),
// subdivide into quadrants so nothing is silently dropped.
async function fetchCell(typeName, b, depth = 0) {
  const j = await getJSON(wfsUrl(typeName, b));
  const matched = j.numberMatched ?? j.totalFeatures ?? 0;
  const returned = j.numberReturned ?? (j.features || []).length;
  if (returned < matched && depth < 6) {
    const [a, c, d, e] = b;
    const ml = (a + d) / 2,
      mo = (c + e) / 2;
    const quads = [
      [a, c, ml, mo],
      [a, mo, ml, e],
      [ml, c, d, mo],
      [ml, mo, d, e],
    ];
    let out = [];
    for (const q of quads) out = out.concat(await fetchCell(typeName, q, depth + 1));
    return out;
  }
  return j.features || [];
}

// ---- geometry / property reduction -----------------------------------------
const r5 = (n) => Math.round(n * 1e5) / 1e5;
function roundCoords(c) {
  if (typeof c[0] === "number") return [r5(c[0]), r5(c[1])];
  return c.map(roundCoords);
}
const RAG = { red: "r", amber: "a", green: "g", grey: "x" };

function reduceCable(f) {
  const p = f.properties || {};
  return {
    type: "Feature",
    geometry: { type: f.geometry.type, coordinates: roundCoords(f.geometry.coordinates) },
    properties: {
      rag: RAG[p.rag_status] || "x", // capacity headroom today
      type: p.proxy_type || "", // cable spec
      v: p.operating_voltage || null, // volts
    },
  };
}
function reduceTx(f) {
  const p = f.properties || {};
  return {
    type: "Feature",
    geometry: { type: f.geometry.type, coordinates: roundCoords(f.geometry.coordinates) },
    properties: { name: p.name || "", id: p.id ?? null, rag: RAG[p.rag_status] || "x" },
  };
}

// ---- grid + concurrency -----------------------------------------------------
function grid() {
  const cells = [];
  for (let lat = MINLAT; lat < MAXLAT; lat = +(lat + CELL).toFixed(6)) {
    for (let lon = MINLON; lon < MAXLON; lon = +(lon + CELL).toFixed(6)) {
      cells.push([lat, lon, Math.min(lat + CELL, MAXLAT), Math.min(lon + CELL, MAXLON)]);
    }
  }
  return cells;
}

async function runPool(items, worker) {
  let i = 0;
  const runners = Array.from({ length: CONC }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}

// ---- main -------------------------------------------------------------------
async function harvest(typeName, outPath, reduce, label) {
  const cells = grid();
  const seen = new Set();
  let kept = 0,
    done = 0;
  const ws = fs.createWriteStream(outPath);
  ws.write('{"type":"FeatureCollection","features":[');
  let first = true;
  await runPool(cells, async (cell) => {
    const feats = await fetchCell(typeName, cell);
    for (const f of feats) {
      // de-dup straddlers by source id (present on the raw feature properties)
      const id = f.properties && f.properties.id;
      if (id != null) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      if (!f.geometry) continue;
      ws.write((first ? "" : ",") + JSON.stringify(reduce(f)));
      first = false;
      kept++;
    }
    done++;
    if (done % 25 === 0 || done === cells.length)
      process.stdout.write(`\r  ${label}: ${done}/${cells.length} cells, ${kept} features`);
  });
  ws.write("]}");
  await new Promise((res) => ws.end(res));
  process.stdout.write(`\n  ${label}: wrote ${kept} features -> ${outPath}\n`);
  return kept;
}

console.log(
  `Region bbox lat[${MINLAT}..${MAXLAT}] lon[${MINLON}..${MAXLON}], ${CELL}deg cells, conc=${CONC}`
);
await harvest(CABLES, OUT, reduceCable, "cables");
if (TXOUT) await harvest(TX, TXOUT, reduceTx, "transformers");
console.log("done.");
