#!/usr/bin/env node
/**
 * build_gas_local.mjs - one-click builder for a LOCAL, colour-by-pressure gas
 * view (HP / IP / MP / LP). Reads any GeoJSON you have put in local/source/,
 * classifies each feature by pressure tier, and writes colour-coded per-tier
 * files plus a local/manifest.json that the map picks up.
 *
 * IMPORTANT, by design:
 *   - It only reads files you place in local/source/. It does NOT fetch, decrypt,
 *     download or convert anything - producing that GeoJSON from a source you are
 *     entitled to use is yours to do, on your machine.
 *   - Everything it writes lives under local/, which is git-ignored in full. So
 *     nothing this script produces is ever committed, pushed, or published -
 *     regardless of whether the repo is public or private. It is a LOCAL viewer,
 *     not a publisher.
 *
 * Input GeoJSON must be WGS84 (EPSG:4326) lon/lat. Pressure is sniffed from any
 * property whose name looks like pressure/tier/barg, accepting either codes
 * (HP/IP/MP/LP) or a numeric barg value. Anything unrecognised is drawn grey.
 *
 * Usage: node build_gas_local.mjs      (or just double-click setup.bat)
 */
import fs from "node:fs";
import path from "node:path";

const LOCAL = "local";
const SRC = path.join(LOCAL, "source");

// tier -> style. Darker/heavier as pressure rises, matching the map's own scheme.
const TIERS = {
  HP: { color: "#5A1A1A", weight: 4, label: "HP · High pressure (>7 barg)" },
  IP: { color: "#9A3412", weight: 3, label: "IP · Intermediate (>2, ≤7 barg)" },
  MP: { color: "#B4530A", weight: 2.4, label: "MP · Medium (>75 mbarg, ≤2 barg)" },
  LP: { color: "#E8730C", weight: 1.8, label: "LP · Low (≤75 mbarg)" },
  UN: { color: "#9AA0A6", weight: 1.6, label: "Unknown pressure" },
};
const ORDER = ["HP", "IP", "MP", "LP", "UN"];

// Classify a feature's pressure tier from its properties. Handles the common
// Cadent/OSM field names and both coded and numeric-barg values.
function tierOf(props) {
  const p = props || {};
  for (const k of Object.keys(p)) {
    if (!/press|tier|barg/i.test(k)) continue;
    const v = String(p[k]).toUpperCase().trim();
    if (/\bHP\b|HIGH/.test(v)) return "HP";
    if (/\bIP\b|INTERMEDIATE/.test(v)) return "IP";
    if (/\bMP\b|MEDIUM/.test(v)) return "MP";
    if (/\bLP\b|LOW/.test(v)) return "LP";
    const num = parseFloat(v.replace(/[^0-9.]/g, ""));
    if (!Number.isNaN(num) && /barg|bar|press/i.test(k)) {
      if (num > 7) return "HP";
      if (num > 2) return "IP";
      if (num > 0.075) return "MP";
      return "LP";
    }
  }
  return "UN";
}

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
    console.log("Drop your WGS84 GeoJSON export(s) there and run again.");
    return;
  }

  const byTier = { HP: [], IP: [], MP: [], LP: [], UN: [] };
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

  const layers = [];
  for (const tier of ORDER) {
    const feats = byTier[tier];
    if (!feats.length) continue;
    const file = `gas_${tier.toLowerCase()}.geojson`;
    fs.writeFileSync(
      path.join(LOCAL, file),
      JSON.stringify({ type: "FeatureCollection", features: feats })
    );
    layers.push({
      id: `gas-${tier.toLowerCase()}`,
      label: TIERS[tier].label,
      file,
      group: "gas",
      color: TIERS[tier].color,
      weight: TIERS[tier].weight,
    });
    console.log(`  ${tier}: ${feats.length} features -> local/${file}`);
  }

  fs.writeFileSync(
    path.join(LOCAL, "manifest.json"),
    JSON.stringify({ layers }, null, 2)
  );
  console.log(`\nWrote local/manifest.json (${layers.length} colour-coded pressure layers).`);
  console.log("Serve the map locally (setup.bat does this) and toggle them under Gas.");
}

main();
