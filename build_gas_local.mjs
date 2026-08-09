#!/usr/bin/env node
/**
 * build_gas_local.mjs - one-click builder for a LOCAL, colour-by-pressure gas
 * view. Reads any GeoJSON you have put in local/source/, classifies each feature
 * by pressure tier, and writes colour-coded per-tier layers plus a
 * local/manifest.json that the map picks up.
 *
 * IMPORTANT, by design:
 *   - It only reads files you place in local/source/ (build_maps_mvf.mjs can
 *     put them there for you from MAPS Viewer tiles). It does NOT fetch or
 *     download anything - producing that GeoJSON from a source you are entitled
 *     to use is yours to do, on your machine.
 *   - Everything it writes lives under local/, which is git-ignored in full. So
 *     nothing this script produces is ever committed, pushed, or published -
 *     regardless of whether the repo is public or private. It is a LOCAL viewer,
 *     not a publisher.
 *
 * Input GeoJSON must be WGS84 (EPSG:4326) lon/lat. Pressure is sniffed from any
 * property whose name looks like pressure/tier/barg, accepting either codes
 * (HPN/HPL/HP/IP/MP/LP) or a numeric barg value. Anything unrecognised is grey.
 *
 * Layers bigger than TILE_THRESHOLD features are written as a sparse z14 tile
 * tree instead of one file, because a single 400k-feature GeoJSON is not
 * something a browser will load. The map fetches only the tiles in view.
 *
 * Usage: node build_gas_local.mjs      (or just double-click setup.bat)
 */
import fs from "node:fs";
import path from "node:path";
import { TIERS, ORDER, tierOf } from "./gas_tiers.mjs";
import { writeTiles } from "./tile_geojson.mjs";

const LOCAL = "local";
const SRC = path.join(LOCAL, "source");
const TILES = path.join(LOCAL, "tiles");

// Above this many features a layer is tiled rather than written whole.
const TILE_THRESHOLD = 8000;

// Tier table, classifier and tiling now live in gas_tiers.mjs / tile_geojson.mjs
// so this builder and build_maps_mvf.mjs cannot drift apart on what "IP" means.

function main() {
  if (!fs.existsSync(SRC)) {
    fs.mkdirSync(SRC, { recursive: true });
    console.log(`Created ${SRC}\\`);
    console.log("Put your GeoJSON export(s) in there and run this again (or re-click setup.bat).");
    return;
  }
  const files = fs.readdirSync(SRC).filter((f) => /\.(geo)?json$/i.test(f));
  if (!files.length) {
    console.log(`No GeoJSON found in ${SRC}\\`);
    console.log("Drop your WGS84 GeoJSON export(s) there, or configure local/mvf.config.json");
    console.log("so build_maps_mvf.mjs can produce them from MAPS Viewer tiles.");
    return;
  }

  const byTier = {};
  for (const t of ORDER) byTier[t] = [];
  let total = 0;
  for (const f of files) {
    let fc;
    try {
      fc = JSON.parse(fs.readFileSync(path.join(SRC, f), "utf8"));
    } catch (e) {
      console.log(`  ! skipping ${f}: not valid JSON`);
      continue;
    }
    for (const ft of fc.features || []) {
      if (!ft.geometry) continue;
      byTier[tierOf(ft.properties)].push(ft);
      total++;
    }
  }
  if (!total) {
    console.log("Found files but no usable features. Are they WGS84 GeoJSON FeatureCollections?");
    return;
  }

  // Drop any tile trees from a previous run so a smaller extent cannot leave
  // stale geometry behind.
  fs.rmSync(TILES, { recursive: true, force: true });
  for (const f of fs.readdirSync(LOCAL)) {
    if (/^gas_[a-z]+\.geojson$/i.test(f)) fs.unlinkSync(path.join(LOCAL, f));
  }

  const layers = [];
  for (const tier of ORDER) {
    const feats = byTier[tier];
    if (!feats.length) continue;
    const id = `gas-${tier.toLowerCase()}`;
    const spec = {
      id,
      label: TIERS[tier].label,
      group: "gas",
      color: TIERS[tier].color,
      weight: TIERS[tier].weight,
    };

    if (feats.length > TILE_THRESHOLD) {
      const dir = path.join(TILES, id);
      const grid = TIERS[tier].grid;
      const st = writeTiles(feats, dir, grid);
      spec.tiles = `tiles/${id}`;
      spec.grid = grid;
      spec.minzoom = TIERS[tier].minzoom;
      spec.count = feats.length;
      console.log(
        `  ${tier.padEnd(3)} ${String(feats.length).padStart(7)} features -> ${st.cells} tiles on a z${grid} grid, ${st.mb} MB, biggest ${st.maxkb} KB (from z${spec.minzoom})`
      );
    } else {
      const file = `gas_${tier.toLowerCase()}.geojson`;
      const json = JSON.stringify({ type: "FeatureCollection", features: feats });
      fs.writeFileSync(path.join(LOCAL, file), json);
      spec.file = file;
      spec.count = feats.length;
      console.log(
        `  ${tier.padEnd(3)} ${String(feats.length).padStart(7)} features -> local/${file} (${(json.length / 1e6).toFixed(1)} MB)`
      );
    }
    layers.push(spec);
  }

  fs.writeFileSync(path.join(LOCAL, "manifest.json"), JSON.stringify({ layers }, null, 2));
  console.log(`\nWrote local/manifest.json (${layers.length} colour-coded pressure layers).`);
  console.log("Serve the map locally (setup.bat does this) and toggle them under Gas.");
}

main();
