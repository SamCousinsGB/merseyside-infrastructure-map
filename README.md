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
| **Water** | Reservoirs, dams, water treatment works, water towers, clean-water pumping stations |
| **Sewage** | Wastewater treatment works + sewage pumping stations |
| **Pipes** | Gas, oil, water and petrochemical pipelines |

Switchable basemaps: Street (OSM), Satellite, Satellite + labels, Topographic,
and a clean Carto style.

## Rebuilding

The published `index.html` is fully self-contained (all data is embedded). To
regenerate it from the source data:

```bash
python final_map.py   # reads the *.geojson / *.json inputs, writes index.html
```

### Source data
- `spen_complete_revert.geojson`, `current_power.geojson` — `power=*` features
- `merseyrail_rail.json` — `railway=rail` + `electrified=rail` (raw Overpass)
- `infra_geom.json` — reservoirs / dams / pipelines (raw Overpass geometry)
- `infra_probe.json` — treatment works / towers / pumping stations (centroids)

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
- Basemap tiles © Esri / Maxar (imagery), © CARTO, © OpenTopoMap (CC-BY-SA).
