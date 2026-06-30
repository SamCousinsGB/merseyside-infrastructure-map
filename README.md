# Merseyside & North Wales infrastructure map

An interactive Leaflet map of utility and transport infrastructure across the
SP Manweb region (Merseyside, Wirral, Cheshire and North Wales), built from
OpenStreetMap-derived data.

**Live map:** https://samcousinsgb.github.io/merseyside-infrastructure-map/

## Layers

Each layer toggles independently (top-right control). One colour per category;
**solid lines = overground, dashed lines = underground / tunnel.**

| Layer | Contents |
|-------|----------|
| **Power** | Electricity substations, overhead lines and underground cables (SP Manweb network) |
| **Trains** | Merseyrail electrified third rail + its six 750 V DC traction supply points |
| **Water** | Reservoirs, dams, water treatment works, towers, clean-water pumping stations, and **water pipelines** |
| **Sewage** | Wastewater treatment works + sewage pumping stations |
| **Gas** | Gas pipelines |
| **Oil & chemicals** | Oil, fuel and petrochemical pipelines (e.g. Stanlow) |
| **LV network** | SP Manweb **low-voltage** cables and distribution transformers (~1.5M segments), coloured by spare network capacity |

The **LV network** layer is different from the others: it is the real
distribution low-voltage network from SP Energy Networks (not OSM), served as
local vector tiles. It is **off by default** and only draws from **zoom 14
inwards** (street level) — there is far too much of it to show region-wide.
Cables are coloured by capacity headroom (**green** = spare, **amber** =
limited, **red** = at/near capacity, **grey** = not assessed); transformers are
yellow markers. Click a transformer for "LV transformer" + its capacity, or a
cable for its type, voltage and capacity status.

Switchable basemaps: Street (OSM), Satellite, Satellite + labels, Topographic,
and a clean Carto style.

## Rebuilding

`index.html` embeds all the OSM-derived layer data; the LV network instead reads
the committed vector tiles under `tiles/lv/`. To regenerate:

```bash
python final_map.py          # reads the *.geojson / *.json inputs, writes index.html
node test_map.js index.html  # smoke-test: runs the page JS against the real data
```

### LV network vector tiles
The LV layer is built once from SP Energy Networks' public ConnectMore WFS and
committed as `tiles/lv/{z}/{x}/{y}.pbf`, so the live map never depends on their
server. Node only (no Python/GDAL/tippecanoe needed):

```bash
npm install                                          # geojson-vt + vt-pbf (build only)
node fetch_lv.mjs --out=lv_cables.geojson --tx=lv_transformers.geojson
node build_lv_tiles.mjs --cables=lv_cables.geojson --tx=lv_transformers.geojson
```

`fetch_lv.mjs` downloads the region over a grid of WFS bbox requests; the raw
cable GeoJSON is large and git-ignored, but `lv_transformers.geojson` is
committed (the map loads it at runtime for the clickable transformer markers).
`build_lv_tiles.mjs` slices the cables into the committed tile pyramid (native
zoom 14-15, over-zoomed client-side), loaded with
[Leaflet.VectorGrid](https://github.com/Leaflet/Leaflet.VectorGrid).

### Source data
- `spen_complete_revert.geojson`, `current_power.geojson` — `power=*` features
- `merseyrail_rail.json` — `railway=rail` + `electrified=rail` (raw Overpass)
- `infra_geom.json` — reservoirs / dams / pipelines (raw Overpass geometry)
- `infra_probe.json` — treatment works / towers / pumping stations (centroids)
- `tiles/lv/` — LV cables + transformers from SP Energy Networks ConnectMore
  (`connectmore-costestimator:lv_cables_map_view`, `lv_transformers_map_view`)

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
