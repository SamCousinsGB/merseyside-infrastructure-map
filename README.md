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

**Every layer starts switched off**, so the map opens on a clean basemap and you
add only what you want. Nothing is fetched for a layer until you enable it — a
cold load makes no tile requests at all. Tapping a group's row toggles the whole
group; the chevron expands it for the individual layers.

Two display options in the Power drawer are **on** from the start, so they apply
the moment you switch a power layer on: **HV labels (kV / MW)** and **Colour
cables by capacity**. Labels follow their own layer — substation and line labels
need the HV network on, station "Name 1380 MW" labels need Power stations on.

| Layer | Contents |
|-------|----------|
| **Power → HV** | High-voltage network: substations, overhead lines, underground cables and power stations (SP Manweb / OSM) |
| **Power → LV** | SP Manweb **low-voltage** cables + distribution transformers (optionally shaded by spare network capacity) |
| **Trains** | Merseyrail electrified third rail + its six 750 V DC traction supply points |
| **Water** | Reservoirs, dams, weirs, treatment works, towers, pumping stations, water mains/aqueducts and water tanks |
| **Sewage** | Wastewater treatment works, sewage pumping stations and sewage pipelines/tanks |
| **Gas** | High-pressure **transmission (NTS/LTS)**, Cadent **mains**, **service pipes**, **above-ground sites** and **above-ground pipes**, plus OSM gas pipelines and gas holders |
| **Oil & chemicals** | Oil/fuel/ethylene/petrochemical pipelines (NWEP/RSEP/TPEP, Stanlow), tank farms (Stanlow/Tranmere/Eastham) and works chimneys |

The **LV network** is the real distribution low-voltage network from SP Energy
Networks (not OSM). Transformers appear from zoom 14 and cables from **zoom 16**
(street level) — there is far too much to show region-wide. The ~1.47M source
cable segments are merged into continuous polylines and drawn as real,
full-precision vectors for the current viewport, so they stay crisp at every
zoom. Cables are shaded by capacity headroom (**green** = spare, **amber** =
limited, **red** = at/near capacity, **grey** = not assessed); switch
**"Colour cables by capacity"** off to draw them all in one colour instead.
Transformers are yellow markers. Click a transformer for "LV transformer" + its
capacity, or a cable for its type, voltage and capacity.

The **gas mains and service pipes** are Cadent's real distribution network (not
OSM), served from committed tiles the same way as the LV cables. **Mains** appear
from **zoom 14**; **service pipes** — the last-mile connections into individual
premises — only appear from **zoom 17**, since they are street-level clutter at
any wider view.

Pipes are **coloured by pressure tier** (orange = low, ≤75 mbarg; dark red =
medium, ≤2 barg), with a legend in the Gas drawer — the same treatment the LV
cables get for capacity. Switch **"Colour pipes by pressure"** off to fall back
to one colour per pipe type. Colour encodes pressure, line weight encodes type,
so the two read independently. Click a pipe for its pressure tier, material,
diameter, install year and whether it is above or below ground.

**Above-ground sites** (1,360 in region) and **above-ground pipes** (266) come
from two further Cadent open datasets. The sites are what Cadent describe as
"assets that sit above ground … usually assets that reduce the pressure of gas" —
governors and pressure-reduction installations, the green cabinets and fenced
compounds you walk past. The pipes are the runs that surface to cross a river,
bridge or ravine, so they are drawn **solid and heavier** — the one place on this
map where "solid = overground" is literally true of a gas pipe. Both are small
enough to ship as whole GeoJSON files rather than tiles, and both lead their
popup with Street View, because unlike everything else here you can actually go
and look at them.

Two caveats on the sites, both checked against the API rather than assumed:

- The open tier gives **every** site the identical description `"Above Ground
  Site"`. It does not say which are governors, which are valve compounds, and so
  on — so neither does the map. The popup says "typically a pressure-reduction
  installation", not "this is a governor".
- The **Shared** twin of that dataset (`agis-above-ground-asset-shared`) has an
  identical schema and identical record count. It is the same data behind a data
  sharing agreement, so there is nothing to gain by using it.

The above-ground pipes are **not** duplicates of the `ag_ind=True` pipes in GPI
Open: sampled locations carry an above-ground pipe here while GPI marks all 46
pipes at the same spot as buried. The two are complementary.

In this region the mains network merges to ~170k polylines: 157k mains and 13k
services, 161k low-pressure and 9.5k medium-pressure. Material is mostly
polyethylene (145k) with the iron legacy still visible — 7.9k cast iron, 4.5k
spun iron, 4.2k ductile iron, and 162 asbestos. Install dates run 1850–2026
(median 1991). Note that diameters come in **mixed units** — 134k in millimetres
and 37k in inches — which Cadent's own catalogue flags; the map keeps the unit
alongside the value rather than converting, and never merges pipes across
differing diameter units.

This is Cadent's **GPI Open** dataset, which is the low-pressure (≤75 mbarg) and
medium-pressure (>75 mbarg, ≤2 barg) network only. Cadent's intermediate- and
high-pressure data is published separately as a **"Shared"** dataset requiring a
data sharing agreement, so it is deliberately *not* used here — this map is
public, and a sharing agreement does not carry a right to republish.

The **high-pressure transmission network** (NTS/LTS backbone) is instead shown
from **OpenStreetMap** (`usage=transmission`, ODbL), drawn as a heavy dark line —
dashed where buried. It is the only openly-republishable source for the HP
routes, since Cadent's own IP/HP data is the Shared dataset above. Coverage is
**partial** — what OSM contributors have traced, not a complete asset register —
so read it as "known HP corridors", not all of them. ~88 km in region. These
lines also appear, undistinguished, in the general **Pipelines** layer (which
shows every substance-tagged OSM gas line); the Transmission toggle pulls the
high-pressure subset out on its own.

Note this HP layer does **not** connect to every above-ground site: the site in
Aintree, for instance, is fed by an intermediate/high-pressure main that is in
neither GPI Open nor OSM (the nearest mapped transmission line is ~10 km away).
A pressure-reduction site must be fed at higher pressure than it outputs, so its
inlet is exactly the tier the open data omits.

Switchable basemaps: Street (OSM), Satellite, Satellite + labels, Topographic,
and a clean Carto style.

## Rebuilding

`index.html` loads the OSM-derived layer data from `data.json` at runtime; the LV
and gas networks read committed GeoJSON tiles under `tiles/lvgeo/`,
`tiles/gasgeo/` and `lv_transformers.geojson` (transformers). Smoke-test the page
after any edit:

```bash
node test_map.js index.html  # runs the page JS against the real committed data
```

The test mocks just enough Leaflet and DOM to execute the page, resolves its
`fetch()`es against the real files on disk, and pretends every layer is on at
street zoom — so the tile render paths and their style/popup callbacks actually
run. It fails if the page reports an error or draws nothing. Set `ZOOM=n` to
check a different band (e.g. `ZOOM=13` should fetch no tiles at all).

> **`final_map.py` is stale.** It still carries the older template that inlined
> the feature data (`const data=__DATA__`), whereas the deployed `index.html` has
> since moved to async `fetch('data.json')` + `initData()`. It also needs source
> inputs that are git-ignored, so it will not run from a fresh clone. **Edit
> `index.html` directly** — it is the file that ships. Gas-layer changes have been
> applied to both to stop the two drifting further apart, but the two files are
> not otherwise interchangeable.

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

### Cadent gas network tiles
Same shape as the LV build, from Cadent's open data portal. The licence is open
(OGL v3.0) but the portal still gates record downloads behind a **free account**,
so you need an API key (portal → Account → API keys):

```bash
echo YOUR_KEY > .cadent_key
```

`.cadent_key` is git-ignored; `$CADENT_API_KEY` and `--key=` also work. The key
goes in an `Authorization` header, never the query string, and is scrubbed from
any error output. Then:

```bash
node fetch_gas.mjs --out=gas_pipes.geojson                      # bbox-gridded download
node merge_gas.mjs gas_pipes.geojson gas_pipes_merged.geojson   # chain pipes into polylines
node build_gas_tiles.mjs gas_pipes_merged.geojson tiles/gasgeo  # bin into z14 cells
```

`fetch_gas.mjs` walks the region as a grid, **counting each cell first** and
splitting it into quadrants when it exceeds `--max` (default 40k), so a
server-side cap can never silently truncate the download. `merge_gas.mjs` chains
pipes into continuous polylines, bucketed on the full attribute set so a merged
line is always homogeneous — install year is excluded from the bucket key (it is
often inferred or defaulted in the source and would shatter otherwise continuous
mains) and the oldest year along a chain wins. `build_gas_tiles.mjs` writes
**two** trees, `tiles/gasgeo/main/` and `tiles/gasgeo/svc/`, so the mains view
never pulls the much larger service geometry.

Note that Cadent's North West network covers Merseyside and Cheshire but **not
North Wales** (that is Wales & West Utilities), so the western part of the
region legitimately comes back empty.

The above-ground assets are a separate, much smaller pull — no merge or tiling
step, just two committed GeoJSON files:

```bash
node fetch_gas_sites.mjs     # -> gas_ag_sites.geojson + gas_ag_pipes.geojson
```

It counts each dataset before exporting and **exits non-zero if either export
comes back short of its own reported count**, so a truncated download can't be
committed as if it were complete.

### Source data
- `spen_complete_revert.geojson`, `current_power.geojson` — `power=*` features
- `merseyrail_rail.json` — `railway=rail` + `electrified=rail` (raw Overpass)
- `infra_geom.json` — reservoirs / dams / pipelines (raw Overpass geometry)
- `infra_probe.json` — treatment works / towers / pumping stations (centroids)
- `tiles/lvgeo/`, `lv_transformers.geojson` — LV cables + transformers from SP Energy
  Networks ConnectMore (`connectmore-costestimator:lv_cables_map_view`, `lv_transformers_map_view`)
- `tiles/gasgeo/` — Cadent gas mains + service pipes, from the Cadent open data
  portal (`gas-pipe-infrastructure-gpi_open`)
- `gas_ag_sites.geojson`, `gas_ag_pipes.geojson` — Cadent above-ground sites and
  pipes (`above-ground-infrastructure-assets-open`, `agp-above-ground-pipes-open`)
- `gas_transmission.geojson` — high-pressure transmission pipelines from OSM
  (`man_made=pipeline` + `usage=transmission`); rebuild with `node fetch_gas_transmission.mjs`
- `extra_infra.geojson` — extra OSM infrastructure (full pipeline routes, tank
  farms, gas holders, power stations, chimneys, weirs), fetched at runtime and
  merged into the layers. Rebuild: `node fetch_extra.mjs` then `node build_extra.mjs`

## Notes & caveats
- **Sewers are not mapped** — they are essentially absent from OpenStreetMap
  (underground, unsurveyable). Sewage appears only via treatment works and
  pumping stations.
- Pipelines are limited to those with a known `substance` tag ("major" lines).
- OSM coverage is partial; this reflects what is mapped, not a complete asset
  register.
- The Cadent gas layers are the exception to the point above — they are a real
  asset register, not crowd-sourced. But they are **positionally indicative
  only**: Cadent publish them explicitly *not* for digging purposes, and this map
  rounds coordinates to ~1 m when building tiles. Never dig against them; use
  [LSBUD](https://lsbud.co.uk/).
- **On apparent misalignment against satellite imagery.** Pipes sometimes look
  offset from the aerial basemap. Measured against OSM road centrelines over
  1,103 sampled vertices in Liverpool, the systematic shift is **1.48 m** against
  a random scatter of **±7.5 m** — i.e. there is no meaningful datum or
  projection error in the data. Median distance from a road centreline is
  **4.7 m**, which is simply where mains are: under the carriageway or footway.
  Apparent offsets against aerial imagery are dominated by the imagery's own
  registration error, not by the pipe data. This rules out a *systematic*
  problem; it cannot vouch for any individual pipe.
- Cadent gas pipes are drawn **solid, not dashed**, despite being almost entirely
  buried — the same exception the LV cables make, because a dense street-level
  layer rendered in dashes is unreadable. Each popup states whether the pipe is
  above or below ground.

## Attribution

The live map shows a data credit in the corner; Cadent's licence requires the
exact string **"From Cadent Gas Open Data"**, which the attribution control
carries.

- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright)
  contributors, licensed under [ODbL](https://opendatacommons.org/licenses/odbl/).
  This includes the high-pressure gas **transmission** layer (`usage=transmission`).
- Gas network data — **From Cadent Gas Open Data** ©
  [Cadent Gas Limited](https://cadentgas.opendatasoft.com/), from their open data
  portal. Contains public sector information licensed under the
  [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
  **Not for use in digging practices** — for safe digging, consult
  [LSBUD](https://lsbud.co.uk/).
- LV network data © [SP Energy Networks](https://www.spenergynetworks.co.uk/),
  via their ConnectMore interactive map. Reproduced here for personal,
  non-commercial reference; subject to SP Energy Networks' terms of use.
- Basemap tiles © Esri / Maxar (imagery), © CARTO, © OpenTopoMap (CC-BY-SA).
