# `local/` — private preprocessing workspace

Everything in this directory is git-ignored except this note and the example
configuration files. It is safe scratch space for data that must not be
published.

The current production map uses MapLibre and committed protobuf tiles under
`tiles/mvt/`. It deliberately does **not** request `local/manifest.json` or draw
private overlays at runtime; doing so would reintroduce the large browser-side
GeoJSON path removed by the performance rewrite.

`build_gas_local.mjs` and the manifest examples remain useful for classifying a
WGS84 GeoJSON export by pressure while preparing data. Their output stays under
`local/`, but it will not automatically appear in the map.

The MAPS Viewer dataset used by the production map is committed under
`tiles/mapsgeo/`. To rebuild it and the browser-ready vector tiles:

```bash
node build_maps_mvf.mjs --src="C:/path/to/MapsViewerJuly2026"
npm install
npm run build-mvt
```

Double-clicking `setup.bat` now only serves the committed production build. Pass
`--rebuild` when you intentionally need to regenerate `tiles/mvt/` first.
