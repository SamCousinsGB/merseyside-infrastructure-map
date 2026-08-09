/**
 * tile_geojson.mjs - bin GeoJSON features into a sparse slippy-map tile tree,
 * the same scheme build_gas_tiles.mjs and build_lv_geojson_tiles.mjs use.
 *
 * A feature is written into every cell its bounding box touches, so nothing
 * drops out at a tile edge; the runtime de-duplicates by `id`. The grid zoom is
 * a parameter rather than a constant because tier density varies by an order of
 * magnitude - a z14 grid that suits HP produces 1.5 MB LP tiles.
 */
import fs from "node:fs";
import path from "node:path";

export const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
export const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

export function bboxOf(geom) {
  let a = 180, b = 90, c = -180, d = -90;
  const visit = (co) => {
    if (typeof co[0] === "number") {
      if (co[0] < a) a = co[0];
      if (co[0] > c) c = co[0];
      if (co[1] < b) b = co[1];
      if (co[1] > d) d = co[1];
    } else for (const x of co) visit(x);
  };
  if (!geom || !geom.coordinates) return null;
  visit(geom.coordinates);
  return c < a ? null : [a, b, c, d];
}

/** Write `feats` into `dir` as {x}/{y}.json on a zoom-`grid` tile grid. */
export function writeTiles(feats, dir, grid) {
  fs.rmSync(dir, { recursive: true, force: true });
  const cells = new Map();
  let id = 0;
  for (const f of feats) {
    const bb = bboxOf(f.geometry);
    if (!bb) continue;
    f.id = ++id;
    const x0 = lon2x(bb[0], grid), x1 = lon2x(bb[2], grid);
    const y0 = lat2y(bb[3], grid), y1 = lat2y(bb[1], grid);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const k = x + "/" + y;
        let arr = cells.get(k);
        if (!arr) cells.set(k, (arr = []));
        arr.push(f);
      }
  }
  let bytes = 0, max = 0;
  for (const [k, arr] of cells) {
    const [x, y] = k.split("/");
    const d = path.join(dir, x);
    fs.mkdirSync(d, { recursive: true });
    const json = JSON.stringify({ type: "FeatureCollection", features: arr });
    fs.writeFileSync(path.join(d, y + ".json"), json);
    bytes += json.length;
    if (json.length > max) max = json.length;
  }
  return { cells: cells.size, mb: +(bytes / 1e6).toFixed(1), maxkb: Math.round(max / 1024) };
}
