# Merseyside & North Wales infrastructure map

An interactive Leaflet map of utility and transport infrastructure across the
SP Manweb region (Merseyside, Wirral, Cheshire and North Wales), built from
OpenStreetMap-derived data.

**Live map:** https://samcousinsgb.github.io/merseyside-infrastructure-map/

## Layers

A custom control (top-right) groups the layers and switches basemaps. **Power**
is an expandable group holding the **HV** and **LV** electricity networks; the
other utilities and transport toggle individually. Lines are coloured per
category; **solid = overground, dashed = underground / tunnel.**

| Layer | Contents |
|-------|----------|
| **Power → HV** | High-voltage network: substations, overhead lines and underground cables (SP Manweb, from OSM) |
| **Power → LV** | SP Manweb **low-voltage** cables + distribution transformers (optionally shaded by spare network capacity) |
| **Trains** | Merseyrail electrified third rail + its six 750 V DC traction supply points |
| **Water** | Reservoirs, dams, water treatment works, towers, clean-water pumping stations, and **water pipelines** |
| **Sewage** | Wastewater treatment works + sewage pumping stations |
| **Gas** | Gas pipelines |
| **Oil & chemicals** | Oil, fuel and petrochemical pipelines (e.g. Stanlow) |

The **LV network** is the real distribution low-voltage network from SP Energy
Networks (not OSM). It is **off by default**; transformers appear from zoom 14
and cables from **zoom 16** (street level) — there is far too much to show
region-wide. The ~1.47M source cable segments are merged into continuous
polylines and drawn as real, full-precision vectors for the current viewport, so
they stay crisp at every zoom. Cables are a single colour by default; toggle
**"Colour cables by capacity"** to shade them by capacity headroom (**green** =
spare, **amber** = limited, **red** = at/near capacity, **grey** = not assessed).
Transformers are yellow markers. Click a transformer for "LV transformer" + its
capacity, or a cable for its type, voltage and capacity.

Switchable basemaps: Street (OSM), Satellite, Satellite + labels, Topographic,
and a clean Carto style.

## Rebuilding

`index.html` embeds the OSM-derived layer data; the LV network instead reads the
committed GeoJSON tiles under `tiles/lvgeo/` (cables) and `lv_transformers.geojson`
(transformers). To regenerate the page:

```bash
python final_map.py          # reads the *.geojson / *.json inputs, writes index.html
node test_map.js index.html  # smoke-test: runs the page JS against the real data
```

> `final_map.py` is the canonical page template. If Python isn't available, apply
> the same template edits directly to `index.html` (the deployed file).

### LV network tiles
Built once from SP Energy Networks' public ConnectMore WFS and committed, so the
live map never depends on their server. Node only — no npm deps, no Python/GDAL:

```bash
node fetch_lv.mjs --out=lv_cables.geojson --tx=lv_transformers.geojson  # WFS download
node merge_lv.mjs lv_cables.geojson lv_cables_merged.geojson            # ~1.47M segments -> ~310k polylines
node build_lv_geojson_tiles.mjs lv_cables_merged.geojson tiles/lvgeo    # bin into z14 GeoJSON cells
```

`fetch_lv.mjs` downloads the region over a grid of WFS bbox requests (raw cable
GeoJSON is git-ignored). `merge_lv.mjs` chains the ~2 m segments into continuous
polylines per (capacity, cable type, voltage). `build_lv_geojson_tiles.mjs` bins
them into `tiles/lvgeo/{x}/{y}.json` on a zoom-14 grid; at runtime the map fetches
only the cells in view and draws them as crisp `L.geoJSON` canvas polylines.

### Source data
- `spen_complete_revert.geojson`, `current_power.geojson` — `power=*` features
- `merseyrail_rail.json` — `railway=rail` + `electrified=rail` (raw Overpass)
- `infra_geom.json` — reservoirs / dams / pipelines (raw Overpass geometry)
- `infra_probe.json` — treatment works / towers / pumping stations (centroids)
- `tiles/lvgeo/`, `lv_transformers.geojson` — LV cables + transformers from SP Energy
  Networks ConnectMore (`connectmore-costestimator:lv_cables_map_view`, `lv_transformers_map_view`)

## Notes & caveats
- **Sewers are not mapped** — they are essentially absent from OpenStreetMap
  (underground, unsurveyable). Sewage appears only via treatment works and
  pumping stations.
- Pipelines are limited to those with a known `substance` tag ("major" lines).
- OSM coverage is partial; this reflects what is mapped, not a complete asset
  register.

## Attribution
- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright)
  contributors, licensed under [ODbL](https://opendatacommons.org/licenses/odbl/).
- LV network data © [SP Energy Networks](https://www.spenergynetworks.co.uk/),
  via their ConnectMore interactive map. Reproduced here for personal,
  non-commercial reference; subject to SP Energy Networks' terms of use.
- Basemap tiles © Esri / Maxar (imagery), © CARTO, © OpenTopoMap (CC-BY-SA).
