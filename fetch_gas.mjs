#!/usr/bin/env node
/**
 * fetch_gas.mjs - download Cadent's gas distribution network ("Gas Pipe
 * Infrastructure - GPI Open") for the region as GeoJSON.
 *
 *   Source  : https://cadentgas.opendatasoft.com  (Opendatasoft Explore API v2.1)
 *   Dataset : gas-pipe-infrastructure-gpi_open
 *   Licence : Open Government Licence v3.0
 *   Content : low-pressure (<=75 mbarg) and medium-pressure (>75 mbarg, <=2 barg)
 *             mains, service pipes and risers across all Cadent networks.
 *             ~2.28M records nationally; only Cadent's North West network falls
 *             inside this map's bbox (North Wales is Wales & West Utilities, so
 *             the western half of the region legitimately comes back empty).
 *
 * The portal requires a free account: records are gated even though the licence
 * is open. Supply an API key (Account -> API keys on the portal) via, in order
 * of precedence:
 *     --key=<key>            (avoid: lands in your shell history)
 *     $CADENT_API_KEY
 *     .cadent_key            (a one-line file in the repo root; git-ignored)
 * The key is sent as an Authorization header, never in the query string, and is
 * never echoed to stdout.
 *
 * The whole region is far too big for one export, so we walk a spatial grid:
 * each cell is counted first via the records API, and any cell over --max is
 * split into quadrants before exporting. That way nothing is silently truncated
 * by a server-side cap. Geometry is WGS84 (EPSG:4326) lon/lat - directly
 * Leaflet-ready. Output keeps only the attributes the map uses, with
 * coordinates rounded to 5 dp (~1 m).
 *
 * Usage:
 *   node fetch_gas.mjs [--bbox=minLat,minLon,maxLat,maxLon] [--out=gas_pipes.geojson]
 *                      [--cell=0.05] [--conc=6] [--max=40000]
 */
import fs from "node:fs";

const DATASET = "gas-pipe-infrastructure-gpi_open";

// ---- args -------------------------------------------------------------------
const arg = (k, d) => {
  const m = process.argv.find((a) => a.startsWith(`--${k}=`));
  return m ? m.slice(k.length + 3) : d;
};
// --base exists so the fetcher can be pointed at a local mock (see the smoke
// test) and so a portal move doesn't require a code change.
const BASE = arg("base", "https://cadentgas.opendatasoft.com/api/explore/v2.1/catalog/datasets");
const bbox = (arg("bbox", "52.95,-4.95,53.75,-2.45")).split(",").map(Number);
const [MINLAT, MINLON, MAXLAT, MAXLON] = bbox;
const OUT = arg("out", "gas_pipes.geojson");
const CELL = Number(arg("cell", "0.05")); // degrees
const CONC = Number(arg("conc", "6"));
const MAXCELL = Number(arg("max", "40000")); // split a cell above this many records

// ---- api key ----------------------------------------------------------------
function apiKey() {
  const fromArg = arg("key", null);
  if (fromArg) return fromArg.trim();
  if (process.env.CADENT_API_KEY) return process.env.CADENT_API_KEY.trim();
  try {
    const k = fs.readFileSync(".cadent_key", "utf8").trim();
    if (k) return k;
  } catch {}
  console.error(
    "No API key. Cadent gates record downloads behind a free account even though\n" +
      "GPI Open is OGL v3.0. Create a key at https://cadentgas.opendatasoft.com\n" +
      "(Account -> API keys), then either:\n" +
      "  echo YOUR_KEY > .cadent_key        # git-ignored\n" +
      "  $env:CADENT_API_KEY='YOUR_KEY'     # PowerShell\n"
  );
  process.exit(1);
}
const KEY = apiKey();
const HEADERS = { Authorization: `Apikey ${KEY}`, "User-Agent": "merseyside-infrastructure-map" };

// Never let the key reach a log line, even via an error containing the URL.
const scrub = (s) => String(s).split(KEY).join("<key>");

// ---- http -------------------------------------------------------------------
async function getJSON(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: HEADERS });
      if (r.status === 401 || r.status === 403)
        throw new Error(`HTTP ${r.status} - the API key was rejected (check it is active)`);
      if (r.status === 429) throw new Error("HTTP 429 rate-limited");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i === tries - 1) throw new Error(scrub(e.message));
      await new Promise((res) => setTimeout(res, 900 * (i + 1)));
    }
  }
}

// ODS filter language: in_bbox(field, latMin, lonMin, latMax, lonMax)
const whereFor = (b) => `in_bbox(geo_shape, ${b[0]}, ${b[1]}, ${b[2]}, ${b[3]})`;

async function countCell(b) {
  const p = new URLSearchParams({ where: whereFor(b), limit: "0" });
  const j = await getJSON(`${BASE}/${DATASET}/records?${p}`);
  return j.total_count ?? 0;
}

async function exportCell(b) {
  const p = new URLSearchParams({
    where: whereFor(b),
    select: "geo_shape,type,pressure,material,diameter,diam_unit,asset_id,ag_ind,inst_date",
  });
  const j = await getJSON(`${BASE}/${DATASET}/exports/geojson?${p}`);
  return j.features || [];
}

// Count first, split if the cell is too heavy, then export the leaves.
async function harvestCell(b, depth, sink) {
  const n = await countCell(b);
  if (n === 0) return 0;
  if (n > MAXCELL && depth < 8) {
    const [a, c, d, e] = b;
    const ml = (a + d) / 2,
      mo = (c + e) / 2;
    const quads = [
      [a, c, ml, mo],
      [a, mo, ml, e],
      [ml, c, d, mo],
      [ml, mo, d, e],
    ];
    let tot = 0;
    for (const q of quads) tot += await harvestCell(q, depth + 1, sink);
    return tot;
  }
  const feats = await exportCell(b);
  // A short return against a known count means the server capped us; split.
  if (feats.length < n && depth < 8) {
    const [a, c, d, e] = b;
    const ml = (a + d) / 2,
      mo = (c + e) / 2;
    let tot = 0;
    for (const q of [
      [a, c, ml, mo],
      [a, mo, ml, e],
      [ml, c, d, mo],
      [ml, mo, d, e],
    ])
      tot += await harvestCell(q, depth + 1, sink);
    return tot;
  }
  return sink(feats);
}

// ---- geometry / property reduction -----------------------------------------
const r5 = (n) => Math.round(n * 1e5) / 1e5;
function roundCoords(c) {
  if (typeof c[0] === "number") return [r5(c[0]), r5(c[1])];
  return c.map(roundCoords);
}

// DD - Type (from the Cadent data catalogue) -> single-char code
const TYPE = {
  "main pipe": "m",
  "service pipe": "s",
  "riser pipe": "r",
  "nts transmission pipe": "n",
  "lts transmission pipe": "l",
  unknown: "u",
};
const truthy = (v) => v === true || /^(t|true|y|yes|1)$/i.test(String(v ?? ""));

function reducePipe(f) {
  const p = f.properties || {};
  const yr = p.inst_date ? Number(String(p.inst_date).slice(0, 4)) : null;
  return {
    type: "Feature",
    geometry: { type: f.geometry.type, coordinates: roundCoords(f.geometry.coordinates) },
    properties: {
      t: TYPE[String(p.type || "").trim().toLowerCase()] || "u", // pipe type
      p: p.pressure || "", // LP | MP
      m: p.material || "", // DD - Pipe Material code
      d: p.diameter == null ? null : Number(p.diameter),
      du: p.diam_unit || "", // MM | I | UN
      ag: truthy(p.ag_ind) ? 1 : 0, // above ground?
      yr: Number.isFinite(yr) ? yr : null, // install year
    },
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
console.log(
  `Region bbox lat[${MINLAT}..${MAXLAT}] lon[${MINLON}..${MAXLON}], ${CELL}deg cells, ` +
    `conc=${CONC}, split above ${MAXCELL} records/cell`
);

const cells = grid();
const seen = new Set(); // de-dup pipes straddling cell boundaries, by asset_id
const byType = new Map();
let kept = 0,
  done = 0;

const ws = fs.createWriteStream(OUT);
ws.write('{"type":"FeatureCollection","features":[');
let first = true;

const sink = (feats) => {
  let n = 0;
  for (const f of feats) {
    if (!f.geometry) continue;
    const id = f.properties && f.properties.asset_id;
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    const red = reducePipe(f);
    byType.set(red.properties.t, (byType.get(red.properties.t) || 0) + 1);
    ws.write((first ? "" : ",") + JSON.stringify(red));
    first = false;
    kept++;
    n++;
  }
  return n;
};

await runPool(cells, async (cell) => {
  try {
    await harvestCell(cell, 0, sink);
  } catch (e) {
    console.error(`\n  cell [${cell}] failed: ${scrub(e.message)}`);
  }
  done++;
  if (done % 10 === 0 || done === cells.length)
    process.stdout.write(`\r  pipes: ${done}/${cells.length} cells, ${kept} features`);
});

ws.write("]}");
await new Promise((res) => ws.end(res));

const LABEL = { m: "mains", s: "services", r: "risers", n: "NTS", l: "LTS", u: "unknown" };
const breakdown = [...byType.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `${LABEL[k] || k} ${v}`)
  .join(", ");
process.stdout.write(`\n  wrote ${kept} features -> ${OUT}\n  ${breakdown}\n`);
console.log("done.");
