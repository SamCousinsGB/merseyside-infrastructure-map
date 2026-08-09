# `local/` — private, unpublished overlays

Everything in this directory is **git-ignored** (except this README and
`manifest.example.json`). It is the place to view map layers on your own machine
that must **not** be published to the public site — data you are licensed to see
but not to redistribute.

Nothing here is committed, so nothing here can leak into the public GitHub Pages
deploy. On the deploy there is no `local/manifest.json`, so the map adds no local
layers at all — not even an empty toggle.

## One-click (recommended)

1. Put your GeoJSON export(s) — HP/IP/MP/LP, mixed together is fine — in
   `local/source/`.
2. Double-click **`setup.bat`** in the repo root.

It classifies every feature by pressure tier, writes a colour-coded layer per
tier (HP darkest → LP lightest, unknown grey), then serves the map locally and
opens it. The layers appear under **Gas**. Re-run any time your source changes.

`setup.bat` → `build_gas_local.mjs` only *reads* what you place in `local/source/`
and *writes* into `local/`. It never downloads, decrypts or commits anything.
Pressure is read from any property named like `pressure` / `tier` / `barg`,
accepting codes (`HP`/`IP`/`MP`/`LP`) or a numeric barg value.

## Manual / custom manifest

1. Copy the example manifest:

   ```bash
   cp local/manifest.example.json local/manifest.json
   ```

2. Drop your GeoJSON files in `local/` and list them in `local/manifest.json`.
   Each entry:

   | field    | meaning                                                        |
   |----------|----------------------------------------------------------------|
   | `id`     | short unique id (used for the toggle key)                      |
   | `label`  | name shown in the layer control                               |
   | `file`   | filename inside `local/` (e.g. `hp_network.geojson`)           |
   | `group`  | which group to attach to (`gas`, `power`, `water`, …; default `gas`) |
   | `color`  | line/point colour (hex)                                        |
   | `weight` | line weight (default 3)                                       |
   | `dash`   | `true` to force a dashed line; otherwise features with `ug: true` are dashed |

   Files must be WGS84 (EPSG:4326) lon/lat GeoJSON — the same as everything else
   the map loads. Popups list each feature's properties, so put whatever
   attributes you want to see in there.

3. Serve the map locally and the layers appear under their group:

   ```bash
   python -m http.server 8000
   # open http://localhost:8000
   ```

## What this is not

This mechanism only *renders* files you place here. It does not fetch, decrypt,
or convert anything — producing the GeoJSON from whatever source you are entitled
to use is up to you, and stays on your machine. If a dataset's licence does not
permit publication, keep it here and it never will be.
