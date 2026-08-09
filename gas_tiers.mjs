/**
 * gas_tiers.mjs - the canonical gas pressure scale, shared by every builder.
 *
 * These hexes are ALSO duplicated in index.html (GAS_COL / GAS_WT), which cannot
 * import a module because it is a static page loading Leaflet from a CDN. Change
 * one and you MUST change the other: the tiers here and the map's own gas layer
 * are drawn on the same canvas, so a colour meaning two different pressures is
 * worse than no colour at all.
 *
 * HPN/HPL split what used to be a single HP tier. MAPS Viewer distinguishes the
 * National (NTS/LTS transmission) high-pressure network from the Local one, and
 * they are very different things to have under a street. HP is kept for sources
 * that only say "high pressure" without saying which - it keeps its historic
 * colour so anything already exported does not silently change meaning.
 *
 * `grid` is the tile-grid zoom used when a tier is big enough to need tiling and
 * `minzoom` the zoom it starts drawing at. Denser tiers get a FINER grid so no
 * single tile is a multi-megabyte download: on a z14 grid the busiest LP tile
 * came to 1.5 MB, which at four tiles a viewport is not a workable fetch.
 */
export const TIERS = {
  HPN: { color: "#3B0D0D", weight: 4.6, grid: 14, minzoom: 11, label: "HP · National transmission (>7 barg)" },
  HPL: { color: "#7A2222", weight: 4.0, grid: 14, minzoom: 11, label: "HP · Local high pressure (>7 barg)" },
  HP:  { color: "#5A1A1A", weight: 4.0, grid: 14, minzoom: 11, label: "HP · High pressure (>7 barg)" },
  IP:  { color: "#9A3412", weight: 3.0, grid: 14, minzoom: 12, label: "IP · Intermediate (>2, ≤7 barg)" },
  MP:  { color: "#B4530A", weight: 2.4, grid: 15, minzoom: 13, label: "MP · Medium (>75 mbarg, ≤2 barg)" },
  LP:  { color: "#E8730C", weight: 1.8, grid: 16, minzoom: 15, label: "LP · Low (≤75 mbarg)" },
  UN:  { color: "#9AA0A6", weight: 1.6, grid: 15, minzoom: 14, label: "Unknown pressure" },
};

export const ORDER = ["HPN", "HPL", "HP", "IP", "MP", "LP", "UN"];

/**
 * Classify a feature's pressure tier from its properties. Handles the common
 * Cadent/MAPS/OSM field names and both coded and numeric-barg values.
 */
export function tierOf(props) {
  const p = props || {};
  for (const k of Object.keys(p)) {
    if (!/press|tier|barg/i.test(k)) continue;
    const v = String(p[k]).toUpperCase().trim();
    // Most specific first: HPN/HPL must win before the bare HP test.
    if (/\bHPN\b/.test(v) || (/NATIONAL/.test(v) && /HIGH/.test(v))) return "HPN";
    if (/\bHPL\b/.test(v) || (/LOCAL/.test(v) && /HIGH/.test(v))) return "HPL";
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
