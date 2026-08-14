# Merseyside & North Wales infrastructure map

An interactive Leaflet map of utility and transport infrastructure across the
SP Manweb region (Merseyside, Wirral, Cheshire and North Wales), built from
OpenStreetMap-derived data.

**Live map:** https://samcousinsgb.github.io/merseyside-infrastructure-map/

## Reading the map

Two conventions carry most of the information.

**Voltage is colour *and* weight.** Every power line is graded by the highest
voltage it carries, and the stroke gets heavier as the voltage rises, so the
grading survives greyscale printing and works for anyone who cannot separate the
reds. The key lives in the Power drawer.

| Band | Colour | What it is here |
|------|--------|-----------------|
| HVDC & 600 kV | violet `#6B2FD6` | the Western HVDC Link |
| 275 – 400 kV | red `#C4322A` | National Grid transmission |
| 132 kV | amber `#C9741A` | SP Manweb's sub-transmission network |
| 33 – 66 kV | green `#3E9E5C` | primary distribution |
| 6.6 – 25 kV | steel blue `#4E86B0` | 11 kV distribution |
| LV / not recorded | grey `#8A8F98` | everything below, and anything untagged |

**Solid = overground, dashed = underground.** Dash lengths scale with the stroke,
so a heavy buried cable reads as a dashed line rather than a row of beads.

Weights and marker sizes are graded by zoom: a stroke that is right in a street
is a solid blob across a region, so every weight is quoted for zoom 13 and
scaled from there. Structure that is noise at a regional view is held back until
it means something — pylons from z13 and switches from z15. Power stations can
still orient a regional view, but substation names are deliberately local detail:
transmission sites appear from z14, 132 kV from z15, primary distribution from
z16 and minor sites from z17.

Substations are drawn as their footprint **and** a centre dot. A substation
footprint is ~20 m across, which is sub-pixel at any regional zoom; the dot is
what you see and click at a wide view, and it is what the label hangs off. The
footprint takes over once it has an extent on screen. Power stations get a
generation-source badge — wind, solar, battery, hydro, nuclear, gas, biomass,
coal, waste — sized by output, because a 348 MW wind farm and a gas CCGT are not
the same object.

**Labels** are placed, not just attached: candidates are deduped by name (OSM
splits one 132 kV circuit into dozens of ways, all carrying the same name),
sorted by importance, then placed greedily — measured, tried right/left/above/
below, and dropped if all four positions collide with something already placed
or with the UI panels. So a 1380 MW station never loses its label to an 11 kV
pole-mount. Hovering anything thickens it and shows a one-line readout; clicking
opens a card with the record and Street View / Maps links.

## Layers

A custom control (top-right) groups the layers, switches basemaps and searches.
**Power** is an expandable group holding the **HV** and **LV** electricity
networks; the other utilities and transport toggle individually. Tapping a
group's row toggles the whole group; the chevron expands it for the individual
layers.

The map opens with the **HV network** and **Power stations** on — they are
already-loaded local data, so showing them costs no extra requests, and an empty
basemap is a worse first impression than a slightly busier one. Everything
tiled (LV, gas, services) still starts **off** and fetches nothing until you
enable it.

Two display options in the Power drawer are **on** from the start: **Map labels
(names, kV, MW)** and **Colour cables by capacity**. Labels follow their own
layer — substation and line labels need the HV network on, station
"Name / 1380 MW" labels need Power stations on.

### Search, and sharing a view

Press **/** (or click the box) to search the ~900 named features — substations,
power stations, works, reservoirs, tank farms and named circuits. Picking a
result switches its layer on if it was off, flies to it and opens its card.

The URL tracks the view: `#12.5/53.41/-2.98/power.hv,power.ps` is the zoom,
centre and the layers that are on, so a link to a particular corner of the
network is a link rather than a paragraph of instructions, and a reload puts you
back where you were.

### Basemaps

Place labels are drawn in their own pane **above** the data. On an ordinary
tiled basemap every town name sits under the network and the network sits on top
of roads it has nothing to do with; splitting the base into ground + labels
gives the infrastructure a quiet canvas and still lets the place names read.

- **Clean** (default) — Carto Positron, desaturated, labels lifted over the data
- **Street** — standard OpenStreetMap
- **Satellite** — Esri World Imagery with light labels over it
- **Terrain** — OpenTopoMap
- **Dark** — Carto dark matter; label haloes and marker plates invert to match

| Layer | Contents |
|-------|----------|
| **Power → HV** | High-voltage network: substations, overhead lines, underground cables and power stations (SP Manweb / OSM) |
| **Power → LV** | SP Manweb **low-voltage** cables + distribution transformers (optionally shaded by spare network capacity) |
| **Trains** | Merseyrail electrified third rail + its six 750 V DC traction supply points |
| **Water** | Reservoirs, dams, weirs, treatment works, towers, pumping stations, water mains/aqueducts and water tanks |
| **Sewage** | Wastewater treatment works, sewage pumping stations and sewage pipelines/tanks |
| **Gas** | Pipes by pressure — **high >7 barg**, **intermediate ≤7**, **medium ≤2**, **low ≤75 mbarg** — plus **services to premises**, **above-ground sites (AGI)**, **above-ground pipes** and gas holders |
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

**The gas drawer is organised by pressure**, because that is the question people
bring to it — what is under this street, and how hard is it pushing. Each toggle
draws from every source that carries that tier, so a switch is a statement about
the gas rather than about where the data came from:

- the **MAPS survey** wherever it reaches (Merseyside through to Chester,
  Warrington and Wigan), with real diameter, material and asset id;
- **Cadent open data** for the same tier, clipped to *outside* the MAPS envelope
  so no pipe is ever drawn twice — the map reads that envelope from
  `tiles/mapsgeo/meta.json`. GPI Open is LP/MP only, so it contributes nothing
  to the high and intermediate toggles;
- **OSM transmission** ways, which are high pressure by definition, so they sit
  inside the High toggle rather than in a separate layer of their own.

Each tier still gates on zoom — high from **z11**, intermediate **z12**, medium
**z13**, and the dense low-pressure network **z15** — so a wide view gives the
strategic picture instead of a solid mat of orange.

**Services to premises** are the last-mile connections into individual
buildings, from **z16**. Note these come *only* from Cadent: the MAPS layer is
"Mains & Plant" and holds no services at all, and Cadent's open service coverage
is partial (~13k in region against ~157k mains), so expect gaps rather than a
service to every house.

**Above-ground sites (AGI)** is one clean layer: site markers, surveyed
boundaries and the source plan labels.

Pipes are **coloured by pressure tier** (orange = low, ≤75 mbarg; through to
near-black for the national transmission network), with a legend in the Gas
drawer — the same treatment the LV cables get for capacity. Switch **"Colour
pipes by pressure"** off to fall back to one colour per pipe type. Colour encodes
pressure, line weight encodes type, so the two read independently. Click a pipe
for its pressure tier, material, diameter, what it was inserted into, and survey
date or install year depending on the source.

**Above-ground sites (AGI)** draws on two sources under one toggle. Cadent's
open dataset (1,360 in region) supplies the filled markers. MAPS finds 457 sites,
of which **223 match a Cadent site** within 30 m. Its 90 label-only overlaps are
suppressed; for the 133 overlaps with a surveyed footprint, the useful outline
and plan label remain but the second marker is removed. That leaves **one marker
per installation**, while still adding **234 genuinely new installations**.
MAPS records these only as OS background annotation (`Gas Gov`, `GVC`, `Gas
Valve Compound`, `Gas Meter House`), never as a gas record, which is why they
were easy to lose entirely.

**247 of them carry their surveyed footprint** and draw as the actual outline
as well as their single marker — median about 10 m² (a governor kiosk), up to
544 m² (a walled
compound). The label is usually set *beside* a kiosk rather than inside it, too
small to letter, so a footprint is matched by containment first and then by
nearest outline within 12 m, rejecting anything under 2 m² or over 4,000 m² as
drawing furniture or the building next door. Plan labels appear from **zoom
17**, and the same wording is searchable. The popup says whether the extent is
surveyed or label-only and quotes the plan rather than paraphrasing.

Matching is deliberately strict: `GAS` and `GOV` as substrings also catch "The
Gas Transportation Company", "AGAS DEVELOPMENTS LTD" and "Government", and
anything noted removed or abandoned is excluded.

The MAPS extract also contains 451k plant symbols. Even the 3,538 within 30 m of
an installation may be buried valves or fittings rather than above-ground
apparatus, so the public map does not draw them. The site marker and surveyed
boundary are the useful, defensible representation; the full plant set remains
in the tiles if a reliable above-ground classifier becomes available.

**Above-ground pipes** (266) come from a further Cadent open dataset. The Cadent
sites are what Cadent describe as
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

The figures below describe the **Cadent open tiles**, which now supply Mains only
outside the MAPS envelope (and still supply Service pipes everywhere). Inside it
the numbers that matter are the MAPS ones: 491k mains and 451k plant across
942k features.

In this region the Cadent network merges to ~170k polylines: 157k mains and 13k
services, 161k low-pressure and 9.5k medium-pressure. Material is mostly
polyethylene (145k) with the iron legacy still visible — 7.9k cast iron, 4.5k
spun iron, 4.2k ductile iron, and 162 asbestos. Install dates run 1850–2026
(median 1991). Note that diameters come in **mixed units** — 134k in millimetres
and 37k in inches — which Cadent's own catalogue flags; the map keeps the unit
alongside the value rather than converting, and never merges pipes across
differing diameter units.

That is Cadent's **GPI Open** dataset, which is the low-pressure (≤75 mbarg) and
medium-pressure (>75 mbarg, ≤2 barg) network only — it carries no IP or HP.
Cadent's intermediate- and high-pressure data is published separately as a
**"Shared"** dataset requiring a data sharing agreement, which does not carry a
right to republish, so it is deliberately *not* used here. The IP and HP tiers
you see come from the MAPS survey instead.

The OSM transmission ways (`usage=transmission`, ODbL) are inside the **High**
toggle — they are the high-pressure end of the same network, and a separate
"Transmission" layer just raised the question of how it differed from Mains.
Coverage is **partial** — what OSM contributors have traced, not a complete asset
register — so read the high-pressure picture as "known HP corridors", not all of
them. ~88 km in region, 45 of its 54 ways outside the MAPS envelope, so it adds
reach rather than duplicating the survey.

Note this HP layer does **not** connect to every above-ground site: the site in
Aintree, for instance, is fed by an intermediate/high-pressure main that is in
neither GPI Open nor OSM (the nearest mapped transmission line is ~10 km away).
A pressure-reduction site must be fed at higher pressure than it outputs, so its
inlet is exactly the tier the open data omits.

(Basemaps are listed under [Reading the map](#basemaps).)

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
check a different band (e.g. `ZOOM=13` should fetch MAPS IP/MP tiles but no
street-level LV, gas services or low-pressure tiles).

> **`final_map.py` is stale.** It still carries the older template that inlined
> the feature data (`const data=__DATA__`), whereas the deployed `index.html` has
> since moved to async `fetch('data.json')` + `initData()`. It also needs source
> inputs that are git-ignored, so it will not run from a fresh clone. **Edit
> `index.html` directly** — it is the file that ships. Gas-layer changes were
> applied to both to stop the two drifting further apart, but the styling and
> labelling rewrite described in [Reading the map](#reading-the-map) exists only
> in `index.html`; the two files are not interchangeable.

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

### MAPS Viewer pressure tiers
`tiles/mapsgeo/` holds the pressure-coded gas network extracted from MAPS Viewer
`.mvf` tiles. This is the layer that carries the **full pressure split**,
including `Local` vs `National` high pressure, which the open Cadent data does
not distinguish. Rebuild:

```bash
node build_maps_mvf.mjs --src="C:/path/to/MapsViewerJuly2026"
```

or put the path in `local/mvf.config.json` (git-ignored, since it is
machine-specific) and just run `node build_maps_mvf.mjs`. Options: `--bbox=minE,minN,maxE,maxN`
in EPSG:27700 (default is Merseyside), or `--all` to take everything the source
holds — which is the right mode when the source is itself a selection, since
MAPS Viewer's tile picker installs the squares you chose to `C:\MAPS`.

A `.mvf` tile is a binary WebCGM metafile behind a light byte obfuscation
(`plain[i] = ~raw[i^1]`) over a variable-length header; the picture body after it
is plain CGM. `build_maps_mvf.mjs` documents the format in full. What it recovers
per pipe: pressure tier (from the CGM layer name), diameter and material (from
the ScreenTip — `125MM PE (IN 6" CI)` is 125 mm polyethylene inserted into a 6"
cast iron main), asset id, and the tile's survey date. Valves, governors and
syphons come out as points.

Each tile declares its own EPSG:27700 extent, so georeferencing needs no external
index; coordinates are converted to WGS84 with a Helmert datum shift. That is
nominally ~5 m (no OSTN15 grid), but measured against the independent Cadent open
data over central Liverpool the median disagreement is **0.3 m**, p90 0.6 m.
Fine for an overlay — **not survey grade, and not a substitute for a LineSearch
enquiry before anyone digs.**

Dense tiers are written as tile trees rather than single files (456k LP features
is not a fetch a browser survives) on a **per-tier grid** — LP on z16, MP on z15,
which caps the worst tile at 154 KB instead of 1.5 MB. `tiles/mapsgeo/meta.json`
tells the map which tiers exist, how they are stored and what zoom each starts
at; adding a tier needs no change to `index.html`.

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

## Private, local-only overlays

The map can show extra layers that exist **only on your machine** and are never
published. Everything under `local/` is git-ignored (except its README and an
example manifest), so it cannot reach the public GitHub Pages deploy — there the
manifest simply 404s and no local layer is added, not even a toggle.

This is for data you are licensed to *view* but not to *republish*. Note that
the MAPS Viewer pressure tiers are **not** here — they are committed under
`tiles/mapsgeo/` and load like any other layer. `local/` is for anything you
want kept out of the repo entirely.

Drop WGS84 GeoJSON into `local/source/` and run `node build_gas_local.mjs` (or
double-click `setup.bat`); it classifies by pressure and emits colour-coded
layers, tiling any too big to fetch whole. Or hand-write `local/manifest.json`
from `local/manifest.example.json`. Both use the same layer format the committed
`tiles/mapsgeo/meta.json` does, so a tier can move between them without a code
change. See [`local/README.md`](local/README.md) for the format.

Nothing here downloads anything. If a dataset's licence forbids publication,
keeping it in `local/` guarantees this repo never carries it — but that is a
technical guarantee about the *repo*, not a licence to hold or share the data,
and it is only as good as the choice to put the data there rather than in
`tiles/`.

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
