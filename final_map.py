#!/usr/bin/env python3
"""
Build index.html: a clean, toggleable infrastructure map of the SP Manweb
region (NW England / N Wales), from OSM-derived data.

Layers (each independently toggleable, each a single colour):
  Power    electricity substations, overhead lines and underground cables
  Trains   Merseyrail third rail + its 750 V DC traction supply points
  Water    reservoirs, dams, water treatment works, towers, clean-water pumping
  Sewage   wastewater treatment works + sewage pumping stations
  Pipes    gas / oil / water / petrochemical pipelines

Solid line = overground, dashed line = underground / tunnel.

The LV (low-voltage) network is a separate overlay grouped under "Power" with
the HV network: SP Energy Networks "ConnectMore" cables + transformers. Cables
are full-precision GeoJSON tiles under tiles/lvgeo/ rendered as real canvas
vectors for the viewport (crisp at every zoom); transformers come from
lv_transformers.geojson. Built by fetch_lv.mjs + merge_lv.mjs +
build_lv_geojson_tiles.mjs; coloured by spare network capacity. Not embedded here.

Inputs (OSM snapshots produced earlier in the investigation):
  spen_complete_revert.geojson, current_power.geojson   power=*
  merseyrail_rail.json        railway=rail + electrified=rail (raw Overpass geom)
  infra_geom.json             reservoirs / dams / pipelines (raw Overpass geom)
  infra_probe.json            treatment works / towers / pumping stations (centroids)
"""
import collections
import json

EXCLUDE = {"generator", "pole"}

# Merseyrail 750 V DC traction supply points (OSM substation=traction in the
# Liverpool / Wirral / Southport area).  id -> (short on-map label, popup note).
MERSEYRAIL_TRACTION = {
    "way/1384055089": ("Hillside GSP",
                       "grid supply point - SP Energy Networks 33/11 kV, feeds Merseyrail 750 V DC"),
    "way/1383583325": ("Bromborough GSP",
                       "grid supply point - SP Energy Networks 33/11 kV, feeds Merseyrail"),
    "way/1053005012": ("Hillside DC TSS", "DC traction substation - 750 V third rail"),
    "way/1325268144": ("DC TSS", "DC traction substation - 750 V third rail (approx. Birkenhead)"),
    "way/1196031969": ("DC TSS", "DC traction substation - 750 V third rail (approx. N Liverpool)"),
    "way/1202738879": ("DC TSS", "DC traction substation - 750 V third rail (approx. Wirral)"),
}

RAIL_KEEP = ("name", "ref", "voltage", "electrified", "tunnel", "bridge",
             "usage", "service", "maxspeed", "operator")
INFRA_KEEP = ("name", "operator", "man_made", "substance", "water", "landuse",
              "content", "capacity", "start_date", "waterway", "location", "tunnel")


def feat(geom, **props):
    return {"type": "Feature", "geometry": geom, "properties": props}


def is_underground(p):
    loc = (p.get("location") or "").lower()
    if loc in ("overhead", "overground"):
        return False
    if loc == "underground":
        return True
    return p.get("power") == "cable"


def _small(t, keep):
    return {k: t[k] for k in keep if k in t}


def _ring(geom):
    r = [[g["lon"], g["lat"]] for g in geom]
    if r and r[0] != r[-1]:
        r.append(r[0])
    return r


def _sewage_pump(name):
    n = (name or "").lower()
    return any(h in n for h in ("sewage", "sewer", "waste water", "wastewater", "wwps", "stw"))


# ---------------------------------------------------------------- power -------
def load_power(path, skip_ids=()):
    with open(path, encoding="utf-8") as f:
        fc = json.load(f)
    out = []
    for ft in fc["features"]:
        p = ft["properties"]
        if p.get("power") in EXCLUDE or p["id"] in skip_ids:
            continue
        out.append(feat(ft["geometry"],
                        id=p["id"], osm=p["osm"], name=p.get("name", ""),
                        voltage=p.get("voltage", ""), tags=p.get("tags", {}),
                        cat="power", kind=p.get("power", "power"),
                        ug=is_underground(p)))
    return out


# ---------------------------------------------------------------- trains ------
def load_rail(path="merseyrail_rail.json"):
    with open(path, encoding="utf-8-sig") as f:
        ov = json.load(f)
    out = []
    for el in ov.get("elements", []):
        g = el.get("geometry")
        if not g:
            continue
        t = el.get("tags", {})
        wid = f'way/{el["id"]}'
        out.append(feat({"type": "LineString",
                         "coordinates": [[x["lon"], x["lat"]] for x in g]},
                        id=wid, osm=f"https://www.openstreetmap.org/{wid}",
                        name=t.get("name", ""), voltage=t.get("voltage", ""),
                        tags=_small(t, RAIL_KEEP), cat="train", kind="third rail",
                        ug=t.get("tunnel") in ("yes", "building_passage")))
    return out


def load_traction(path="current_power.geojson"):
    with open(path, encoding="utf-8") as f:
        fc = json.load(f)
    out = []
    for ft in fc["features"]:
        ident = ft["properties"]["id"]
        if ident not in MERSEYRAIL_TRACTION:
            continue
        short, note = MERSEYRAIL_TRACTION[ident]
        p = ft["properties"]
        out.append(feat(ft["geometry"],
                        id=p["id"], osm=p["osm"], name=p.get("name", ""),
                        voltage=p.get("voltage", ""), tags=p.get("tags", {}),
                        cat="train", kind=note, ug=False,
                        traction=True, label=short))
    return out


# -------------------------------------------------- water / sewage / pipes ----
def load_infra(geom_path="infra_geom.json", probe_path="infra_probe.json"):
    out = []
    with open(geom_path, encoding="utf-8-sig") as f:
        for el in json.load(f)["elements"]:
            t = el.get("tags", {})
            oid = f'{el["type"]}/{el["id"]}'
            base = dict(id=oid, osm=f"https://www.openstreetmap.org/{oid}",
                        name=t.get("name", ""), tags=_small(t, INFRA_KEEP))
            if el["type"] == "way":
                g = el.get("geometry")
                if not g:
                    continue
                coords = [[x["lon"], x["lat"]] for x in g]
                if t.get("man_made") == "pipeline":
                    sub = t.get("substance", "")
                    # route pipes into their utility: water -> Water, gas -> Gas,
                    # oil / fuel / petrochemical -> Oil & chemicals
                    if sub in ("water", "rainwater"):
                        pcat = "water"
                    elif sub == "gas":
                        pcat = "gas"
                    else:
                        pcat = "fuel"
                    out.append(feat({"type": "LineString", "coordinates": coords},
                                    **base, cat=pcat, substance=sub,
                                    kind=(f"{sub} pipeline" if sub else "pipeline"),
                                    ug=t.get("location") == "underground"
                                       or t.get("tunnel") in ("yes", "culvert")))
                elif t.get("waterway") == "dam":
                    out.append(feat({"type": "LineString", "coordinates": coords},
                                    **base, cat="water", kind="dam", ug=False))
                else:
                    kind = ("covered reservoir"
                            if t.get("man_made") == "reservoir_covered" else "reservoir")
                    out.append(feat({"type": "Polygon", "coordinates": [_ring(g)]},
                                    **base, cat="water", kind=kind, ug=False))
            elif el["type"] == "relation":
                for m in el.get("members", []):
                    if m.get("role") == "outer" and m.get("geometry"):
                        out.append(feat({"type": "Polygon",
                                         "coordinates": [_ring(m["geometry"])]},
                                        **base, cat="water", kind="reservoir", ug=False))

    with open(probe_path, encoding="utf-8-sig") as f:
        for el in json.load(f)["elements"]:
            t = el.get("tags", {})
            mm = t.get("man_made")
            if mm not in ("water_works", "wastewater_plant", "water_tower", "pumping_station"):
                continue
            c = el.get("center") or {}
            lat, lon = el.get("lat", c.get("lat")), el.get("lon", c.get("lon"))
            if lat is None or lon is None:
                continue
            name = t.get("name", "")
            if mm == "wastewater_plant":
                cat, kind = "sewage", "wastewater treatment works"
            elif mm == "water_works":
                cat, kind = "water", "water treatment works"
            elif mm == "water_tower":
                cat, kind = "water", "water tower"
            elif _sewage_pump(name):
                cat, kind = "sewage", "sewage pumping station"
            else:
                cat, kind = "water", "pumping station"
            oid = f'{el["type"]}/{el["id"]}'
            out.append(feat({"type": "Point", "coordinates": [lon, lat]},
                            id=oid, osm=f"https://www.openstreetmap.org/{oid}",
                            name=name, tags=_small(t, INFRA_KEEP),
                            cat=cat, kind=kind, ug=False))
    return out


def main():
    skip = set(MERSEYRAIL_TRACTION)
    feats = (load_power("spen_complete_revert.geojson")
             + load_power("current_power.geojson", skip)
             + load_rail() + load_traction() + load_infra())
    data = json.dumps({"type": "FeatureCollection", "features": feats})
    with open("index.html", "w", encoding="utf-8") as f:
        f.write(HTML.replace("__DATA__", data))
    cc = collections.Counter(x["properties"]["cat"] for x in feats)
    print(f"index.html: {len(feats)} features {dict(cc)}")


HTML = r"""<!DOCTYPE html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Infrastructure map</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
html,body,#map{height:100%;margin:0}#map{width:100%}
.leaflet-control-layers{display:none}
.fx-deck{
  --bg:#ffffff; --ink:#0f172a; --muted:#64748b; --line:#eef1f5;
  --accent:#6A2FBF; --radius:16px;
  width:236px; background:var(--bg); color:var(--ink);
  border-radius:var(--radius); padding:10px;
  box-shadow:0 6px 26px -6px rgba(15,23,42,.28), 0 2px 6px rgba(15,23,42,.10);
  font:13px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
  -webkit-font-smoothing:antialiased; user-select:none;
  animation:fx-in .28s cubic-bezier(.16,1,.3,1) both;
}
@keyframes fx-in{from{opacity:0;transform:translateY(-8px) scale(.98)}to{opacity:1;transform:none}}
.fx-head{padding:2px 4px 8px}
.fx-title{font-weight:700;letter-spacing:.3px;font-size:13px}
.fx-eyebrow{font-size:9.5px;font-weight:700;letter-spacing:.9px;text-transform:uppercase;
  color:var(--muted);margin:6px 4px 6px}
.fx-seg{display:flex;flex-wrap:wrap;gap:4px;background:#f5f7fa;padding:4px;border-radius:11px}
.fx-base{flex:1 1 auto;border:none;background:transparent;color:var(--muted);
  font:600 11px/1 inherit;padding:6px 7px;border-radius:8px;cursor:pointer;transition:.16s;white-space:nowrap}
.fx-base:hover{color:var(--ink)}
.fx-base.on{background:#fff;color:var(--ink);box-shadow:0 1px 4px rgba(15,23,42,.16)}
.fx-chips{display:flex;flex-direction:column;gap:5px}
.fx-chip{
  --c:#888;position:relative;display:flex;align-items:center;gap:9px;width:100%;
  border:1.5px solid var(--line);background:#fff;border-radius:12px;padding:7px 9px;cursor:pointer;
  color:var(--ink);font:600 12.5px/1 inherit;text-align:left;overflow:hidden;
  transition:transform .12s cubic-bezier(.34,1.56,.64,1),border-color .18s,box-shadow .18s;
}
.fx-chip:hover{border-color:#dfe5ec;box-shadow:0 2px 10px -4px rgba(15,23,42,.22)}
.fx-chip:active{transform:scale(.97)}
.fx-chip:before{content:"";position:absolute;inset:0;border-radius:inherit;background:var(--c);
  opacity:0;transform:scaleX(0);transform-origin:left;
  transition:transform .32s cubic-bezier(.4,0,.2,1),opacity .32s;z-index:0}
.fx-chip.on:before{opacity:.10;transform:scaleX(1)}
.fx-puck{position:relative;z-index:1;flex:0 0 auto;display:grid;place-items:center;
  width:28px;height:28px;border-radius:9px;color:#fff;background:var(--c);transition:.2s}
.fx-puck svg{width:17px;height:17px}
.fx-chip:not(.on) .fx-puck{background:#eef1f5;color:var(--c)}
.fx-chip.on .fx-puck{box-shadow:0 3px 10px -2px var(--c)}
.fx-name{position:relative;z-index:1;flex:1 1 auto}
.fx-name small{font-weight:600;color:var(--muted);font-size:9.5px;margin-left:3px;
  background:#f1f5f9;padding:1px 4px;border-radius:5px;vertical-align:middle}
.fx-bar{position:relative;z-index:1;width:18px;height:4px;border-radius:3px;background:var(--c);opacity:.28;transition:.2s}
.fx-chip.on .fx-bar{display:none}
.fx-tick{position:relative;z-index:1;width:0;color:var(--c);opacity:0;transform:scale(.4);transition:.2s;overflow:hidden}
.fx-tick svg{width:15px;height:15px}
.fx-chip.on .fx-tick{width:15px;opacity:1;transform:scale(1)}
@keyframes fx-pulse{0%{box-shadow:0 0 0 0 var(--c)}100%{box-shadow:0 0 0 8px transparent}}
.fx-chip.pulse .fx-puck{animation:fx-pulse .44s ease-out}
.fx-group{border:1.5px solid var(--line);border-radius:13px;overflow:hidden;transition:border-color .18s}
.fx-group.open{border-color:#dfe5ec}
.fx-group .fx-chip.parent{border:none;border-radius:0;background:transparent}
.fx-group .fx-chip.parent:hover{box-shadow:none;background:#fafbfc}
.fx-group .fx-chip.parent:before{display:none}
.fx-disc{position:relative;z-index:2;flex:0 0 auto;display:grid;place-items:center;
  width:24px;height:24px;border-radius:7px;color:var(--muted);transition:.2s;cursor:pointer}
.fx-disc:hover{background:#f1f5f9;color:var(--ink)}
.fx-disc svg{width:16px;height:16px;transition:transform .26s cubic-bezier(.4,0,.2,1)}
.fx-group.open .fx-disc svg{transform:rotate(180deg)}
.fx-chip.parent .fx-puck{background:#eef1f5;color:var(--c)}
.fx-chip.parent.partial .fx-puck{background:var(--c);color:#fff;opacity:.55}
.fx-chip.parent.on .fx-puck{background:var(--c);color:#fff;opacity:1;box-shadow:0 3px 10px -2px var(--c)}
.fx-subs{height:0;overflow:hidden;box-sizing:border-box;transition:height .28s cubic-bezier(.4,0,.2,1);
  padding:0 8px;background:linear-gradient(#fbfcfe,#fff)}
.fx-group.open .fx-subs{padding-bottom:8px}
.fx-subs .fx-chip{margin-top:6px}
.fx-subs .fx-chip:first-child{margin-top:2px}
.fx-deck button:focus{outline:none}
/* inner LV panel toggles by display (not animated max-height) so the drawer
   always measures the correct height and never clips the capacity controls */
.fx-rag{display:none;flex-direction:column;gap:6px;margin:0 2px}
.fx-rag.is-on{display:flex;margin-top:8px}
.fx-rag-tx{display:flex;align-items:center;gap:6px;font-size:10px;color:var(--muted)}
.fx-rag-tx i{width:9px;height:9px;border-radius:50%;border:1.5px solid;flex:0 0 auto}
.fx-cap{display:flex;align-items:center;gap:8px;width:100%;border:none;background:transparent;
  cursor:pointer;color:var(--ink);font:600 11px/1 inherit;padding:1px 0;text-align:left}
.fx-cap-sw{position:relative;width:26px;height:15px;border-radius:9px;background:#d7dde5;transition:.2s;flex:0 0 auto}
.fx-cap-sw:after{content:"";position:absolute;top:2px;left:2px;width:11px;height:11px;border-radius:50%;
  background:#fff;transition:.2s;box-shadow:0 1px 2px rgba(0,0,0,.3)}
.fx-cap.on .fx-cap-sw{background:var(--accent)}
.fx-cap.on .fx-cap-sw:after{transform:translateX(11px)}
.fx-rag-legend{display:none;flex-direction:column;gap:5px}
.fx-rag.cap-on .fx-rag-legend{display:flex;margin-top:2px}
.fx-rag-bar{height:6px;border-radius:4px;
  background:linear-gradient(90deg,#2E9E5B 0 33%,#E8A317 33% 66%,#D5392B 66%)}
.fx-rag-rows{display:flex;flex-wrap:wrap;gap:4px 11px;font-size:10px;color:var(--muted)}
.fx-rag-rows span{display:inline-flex;align-items:center;gap:5px}
.fx-rag-rows i{width:9px;height:9px;border-radius:50%;flex:0 0 auto}
.lab{background:#15202B;color:#fff;border:none;font:11px/1.2 system-ui;font-weight:600;padding:1px 5px;border-radius:4px;box-shadow:0 1px 2px rgba(0,0,0,.3);white-space:nowrap}
.lvhint{background:rgba(15,32,43,.92);color:#fff;font:600 12.5px/1.3 -apple-system,system-ui,sans-serif;padding:7px 12px;border-radius:9px;box-shadow:0 2px 10px rgba(0,0,0,.3);margin:0 0 8px 8px}
.lab:before{display:none}
.tt{background:#fff;border-radius:9px;box-shadow:0 1px 8px rgba(0,0,0,.22);padding:8px 12px;font:system-ui}
.tt h3{margin:0;font-size:15px;font-weight:600;color:#1a1a1a}
.tt small{color:#888;font-size:11.5px}
.leaflet-popup-content{font:12px/1.45 system-ui;max-height:240px;overflow:auto;margin:11px 13px}
.pt{font-weight:600;text-transform:capitalize;color:#1a1a1a}
.pn{color:#111}.pm{color:#888;margin:1px 0 4px}
.leaflet-popup-content table{border-collapse:collapse;margin-top:5px}
.leaflet-popup-content td{border-top:1px solid #eee;padding:1px 7px 1px 0}.k{color:#999}
.gm{display:flex;gap:14px;margin-top:8px;padding-top:7px;border-top:1px solid #eee}
.gm a{color:#1a73e8;font-weight:600;text-decoration:none;font-size:12px}
.gm a:hover{text-decoration:underline}
/* === ADDITIONS to the existing <style> block ================================
   The existing .fx-* rules are already generic (.fx-group / .fx-subs /
   .fx-chip.parent select by class, colour comes from inline --c), so N stacked
   groups need NO structural change. Keep .fx-rag / .fx-rag.is-on / .fx-cap /
   .fx-rag-legend EXACTLY as they are. Add only the following: */

/* HV-labels toggle: a plain .fx-cap switch that lives in the power drawer ABOVE
   the LV-gated .fx-rag block, so it is always visible (HV is independent of LV). */
.fx-labtog{margin-top:8px}

/* HV permanent-tooltip labels (openinframap-style): small, dark, unobtrusive,
   no bubble chrome, white halo for legibility on any basemap, non-interactive so
   they never intercept clicks/popups. A dedicated class so they don't collide
   with the existing .lab (traction) / .tt (popup) styles. */
.hv-lab{
  background:transparent;border:none;box-shadow:none;padding:0;margin:0;
  color:#1c2733;
  font:600 10.5px/1.1 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
  text-shadow:0 0 2px #fff,0 0 2px #fff,0 0 3px #fff,0 1px 2px #fff;
  white-space:nowrap;pointer-events:none;
}
.hv-lab:before{display:none}                 /* kill Leaflet's tooltip arrow */
.hv-lab.hv-lab-mw{color:#5b1a12}             /* power-station MW labels: oxblood */
.hv-lab.hv-lab-line{color:#3a2350;font-weight:500}  /* line/cable labels: purple, lighter */
</style>
</head><body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const data=__DATA__;
const CAT={
  power :{c:'#6A2FBF',label:'Power'},
  train :{c:'#2B2F36',label:'Trains'},
  water :{c:'#1C8FB0',label:'Water'},
  sewage:{c:'#8A6A45',label:'Sewage'},
  gas   :{c:'#E8730C',label:'Gas'},
  fuel  :{c:'#C026A8',label:'Oil &amp; chemicals'},
};
const ORDER=['power','train','water','sewage','gas','fuel'];
const map=L.map('map',{preferCanvas:true,maxZoom:19});
const bases={
  'Street (OSM)':L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      {maxZoom:19,attribution:'&copy; OpenStreetMap'}),
  'Satellite':L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {maxZoom:19,attribution:'Imagery &copy; Esri, Maxar, Earthstar Geographics'}),
  'Satellite + labels':L.layerGroup([
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {maxZoom:19,attribution:'Imagery &copy; Esri'}),
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        {maxZoom:19,attribution:'Labels &copy; Esri'})]),
  'Topographic':L.tileLayer('https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
      {maxZoom:17,attribution:'&copy; OpenTopoMap (CC-BY-SA)'}),
  'Clean (Carto)':L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      {maxZoom:19,attribution:'&copy; CARTO'}),
};
bases['Street (OSM)'].addTo(map);

// Google Maps + Street View links for a clicked point.
function gmaps(lat,lon){const ll=lat.toFixed(6)+','+lon.toFixed(6);
  return `<div class="gm"><a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${ll}" target="_blank" rel="noopener">Street View</a>`
    +`<a href="https://www.google.com/maps/search/?api=1&query=${ll}" target="_blank" rel="noopener">Google Maps</a></div>`;}
function pop(p){const t=p.tags||{};
  const rows=Object.entries(t).map(([k,v])=>`<tr><td class="k">${k}</td><td>${v}</td></tr>`).join('');
  const meta=[CAT[p.cat].label,p.ug?'underground':null,p.voltage?(p.voltage+' V'):null].filter(Boolean).join(' &middot; ');
  return `<div class="pt">${p.kind||p.cat}</div>`
    +(p.name?`<div class="pn">${p.name}</div>`:'')
    +`<div class="pm">${meta}</div>`
    +`<a href="${p.osm}" target="_blank">${p.id}</a><table>${rows}</table>`;}

function catLayer(cat){const col=CAT[cat].c;
  return L.geoJSON({type:'FeatureCollection',features:data.features.filter(f=>f.properties.cat===cat)},{
    style:f=>{const p=f.properties;
      return{color:col,weight:p.kind==='cable'?3.5:2.5,opacity:.9,
        dashArray:p.ug?'5 5':null,fillColor:col,fillOpacity:.4};},
    pointToLayer:(f,ll)=>L.circleMarker(ll,{radius:5,color:'#fff',weight:1.5,fillColor:col,fillOpacity:.95}),
    onEachFeature:(f,l)=>l.on('click',e=>{
      const ll=e.latlng||(l.getLatLng&&l.getLatLng())||map.getCenter();
      L.popup().setLatLng(ll).setContent(pop(f.properties)+gmaps(ll.lat,ll.lng)).openOn(map);}),
  });}

// ============================================================================
//  SUB-CATEGORY LAYERS  (built BEFORE the control mounts; never undefined)
//  Replaces the old:
//     const layers={}; ORDER.forEach(k=>{layers[k]=catLayer(k);});
//     ...traction markers onto layers.train...
//     ORDER.forEach(k=>layers[k].addTo(map));
//  and the old extra_infra merge block.
//  Each predicate-backed child is its own canvas L.geoJSON reusing catLayer()'s
//  exact style/pointToLayer/click so visuals + popups are byte-identical.
// ============================================================================

// ---- predicates: pure functions of geometry-type + kind (no re-classify) ----
const geomType = f => (f.geometry && f.geometry.type) || '';
const isLine   = f => /LineString/.test(geomType(f));            // LineString | MultiLineString
const kindOf   = f => (f.properties.kind || '').toLowerCase();
const WATER_PIPE = f => isLine(f) && /pipe|aqueduct|main/.test(kindOf(f)) && !/dam/.test(kindOf(f));

// Per-category ordered child predicates. First match wins; the LAST child in
// each category is the catch-all "else", so every cat feature lands in exactly
// one sub-layer and nothing is ever dropped or duplicated.
const SUBPRED = {
  power : { 'power.ps'  : f => /power station/.test(kindOf(f)),
            'power.hv'  : f => true },                                   // else: substation/line/cable/minor_line
  fuel  : { 'fuel.pipe' : f => isLine(f),
            'fuel.tank' : f => true },                                   // else: tanks(Polygon)+chimneys(Point)
  gas   : { 'gas.pipe'  : f => isLine(f),
            'gas.hold'  : f => true },                                   // else: gas holders
  water : { 'water.pipe': f => WATER_PIPE(f),
            'water.site': f => true },                                   // else: reservoirs/dams/works/towers/pumping/tanks/weirs
  sewage: { 'sewage.pipe': f => isLine(f),
            'sewage.site': f => true },                                  // else: works/pumping/tanks
};
const SUBKEYS = {                                  // ordered child keys per cat
  power:['power.ps','power.hv'], fuel:['fuel.pipe','fuel.tank'],
  gas:['gas.pipe','gas.hold'],  water:['water.pipe','water.site'],
  sewage:['sewage.pipe','sewage.site'],
};
// Resolve which child sub-key a feature of category `cat` belongs to (or null).
function subKeyFor(cat, f){
  const preds = SUBPRED[cat]; if(!preds) return null;     // train -> no group
  for(const key of SUBKEYS[cat]){ if(preds[key](f)) return key; }
  return SUBKEYS[cat][SUBKEYS[cat].length-1];             // safety net (never hit: last is else)
}

// ---- factory: identical look & popups as catLayer, seeded with a feature list -
function subLayer(cat, feats){
  const col = CAT[cat].c;
  return L.geoJSON({type:'FeatureCollection',features:feats},{
    style:f=>{const p=f.properties;
      return{color:col,weight:p.kind==='cable'?3.5:2.5,opacity:.9,
        dashArray:p.ug?'5 5':null,fillColor:col,fillOpacity:.4};},
    pointToLayer:(f,ll)=>L.circleMarker(ll,{radius:5,color:'#fff',weight:1.5,fillColor:col,fillOpacity:.95}),
    onEachFeature:(f,l)=>l.on('click',e=>{
      const ll=e.latlng||(l.getLatLng&&l.getLatLng())||map.getCenter();
      L.popup().setLatLng(ll).setContent(pop(f.properties)+gmaps(ll.lat,ll.lng)).openOn(map);}),
  });
}

// ---- build sub-layers (grouped cats) + the flat train layer ------------------
const GROUPED = Object.keys(SUBKEYS);                       // power,fuel,gas,water,sewage
const sub = {};                                            // dotted key -> L.geoJSON
// embedded data already carries power=plant (kind "plant"); skip those so the
// extra_infra power stations (which have name + MW output) are what we render.
const isEmbeddedPlant = f => f.properties.cat==="power" && /plant/.test((f.properties.kind||"").toLowerCase());
GROUPED.forEach(cat=>{
  const buckets = {}; SUBKEYS[cat].forEach(k=>buckets[k]=[]);
  data.features.forEach(f=>{ if(f.properties.cat===cat && !isEmbeddedPlant(f)) buckets[subKeyFor(cat,f)].push(f); });
  SUBKEYS[cat].forEach(k=>{ sub[k] = subLayer(cat, buckets[k]); });
});

// Trains: keep the original single flat layer + its traction markers.
const layers = { train: catLayer('train') };
data.features.filter(f=>f.properties.traction).forEach(f=>{
  const c=L.geoJSON(f).getBounds().getCenter();
  L.circleMarker(c,{radius:7,color:'#15202B',weight:2,fillColor:'#00C2A8',fillOpacity:.95})
    .bindPopup(pop(f.properties)+gmaps(c.lat,c.lng)).addTo(layers.train);
});

// ---- ADD DEFAULT-ON LAYERS: all sub-layers + train. lvNetwork stays OFF. -----
GROUPED.forEach(cat=>SUBKEYS[cat].forEach(k=>sub[k].addTo(map)));
layers.train.addTo(map);

// ---- runtime extra_infra merge: route each feature into its SUB-layer --------
const _extraIds=new Set(data.features.filter(f=>!isEmbeddedPlant(f)).map(f=>f.properties.id));
fetch('extra_infra.geojson').then(r=>r.json()).then(fc=>{
  for(const f of fc.features){
    const p=f.properties; if(_extraIds.has(p.id))continue; _extraIds.add(p.id);
    if(p.cat==='train'){ layers.train.addData(f); continue; }
    const k = subKeyFor(p.cat,f);
    if(k && sub[k]) sub[k].addData(f);          // guarded: never addData on undefined
  }
  // power stations arrive here -> refresh labels if they're currently shown
  if(hvLabelsOn) buildHvLabels();
}).catch(()=>{});

// ---- fitBounds: open on the real Merseyside / N Wales footprint (raw HV bounds
//      include stray Scotland-area features that would zoom out to ~z7).
map.fitBounds([[52.95,-4.90],[53.72,-2.45]]);

// ---- LV (low-voltage) network ------------------------------------------------
// SP Energy Networks "ConnectMore" data, kept local. Two parts, off by default:
//   cables       ~310k merged polylines (from ~1.47M source segments), served as
//                full-precision GeoJSON tiles (tiles/lvgeo/{x}/{y}.json, z14 grid).
//                A viewport-windowed L.geoJSON canvas layer draws only the cables
//                in view, so they are REAL vectors - crisp at every zoom, exactly
//                like the other layers. Shown from zoom 16.
//   transformers 27.6k points from lv_transformers.geojson, fixed-size clickable
//                markers; only the in-view ones exist. Shown from zoom 14.
// Cables are coloured by network capacity headroom (RAG).
const RAGC={r:'#D5392B',a:'#E8A317',g:'#2E9E5B',x:'#9AA0A6'};
const RAGT={r:'at / near capacity',a:'limited spare capacity',g:'spare capacity',x:'not assessed'};

// web-mercator tile maths for the z14 GeoJSON cable grid
const lvLon2x=(lon,z)=>Math.floor((lon+180)/360*Math.pow(2,z));
const lvLat2y=(lat,z)=>{const r=lat*Math.PI/180;return Math.floor((1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*Math.pow(2,z));};
const LV_GRID=14, LV_MINZOOM=16, LV_MAXCACHE=80;
const LV_PLAIN='#22B8D9';                  // default: cables in one colour
let lvByCapacity=false;                     // toggle: colour cables by RAG capacity
function lvCableStyle(f){return{color:lvByCapacity?(RAGC[f.properties.rag]||RAGC.x):LV_PLAIN,weight:1.6,opacity:.9};}
function setLvCapacity(on){lvByCapacity=on; if(lvCableLayer)lvCableLayer.setStyle(lvCableStyle);}
const lvTileCache=new Map();
let lvCableLayer=null, lvRenderToken=0;
function lvCablePopup(e,p){
  L.popup({className:'tt'}).setLatLng(e.latlng).setContent(
    `<div class="pt">LV cable</div><div class="pm">SP Manweb low-voltage network</div>`
    +`<table><tr><td class="k">cable</td><td>${p.type||'-'}</td></tr>`
    +`<tr><td class="k">voltage</td><td>${p.v||230} V</td></tr>`
    +`<tr><td class="k">capacity</td><td>${RAGT[p.rag]||RAGT.x}</td></tr></table>`
    +gmaps(e.latlng.lat,e.latlng.lng)).openOn(map);
}
async function lvFetchTile(x,y){
  const k=x+'/'+y;
  if(lvTileCache.has(k)){const v=lvTileCache.get(k);lvTileCache.delete(k);lvTileCache.set(k,v);return v;}
  let fc={features:[]};
  try{const r=await fetch('tiles/lvgeo/'+x+'/'+y+'.json');if(r.ok)fc=await r.json();}catch(e){}
  lvTileCache.set(k,fc);
  while(lvTileCache.size>LV_MAXCACHE)lvTileCache.delete(lvTileCache.keys().next().value);
  return fc;
}
async function renderLvCables(){
  if(!map.hasLayer(lvNetwork)||map.getZoom()<LV_MINZOOM){ if(lvCableLayer)lvCableLayer.clearLayers(); return; }
  const token=++lvRenderToken;
  const b=map.getBounds().pad(0.2), z=LV_GRID;
  const x0=lvLon2x(b.getWest(),z),x1=lvLon2x(b.getEast(),z),y0=lvLat2y(b.getNorth(),z),y1=lvLat2y(b.getSouth(),z);
  const reqs=[]; for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)reqs.push(lvFetchTile(x,y));
  const fcs=await Promise.all(reqs);
  if(token!==lvRenderToken) return;            // a newer render superseded this one
  const seen=new Set(), feats=[];
  for(const fc of fcs)for(const f of (fc.features||[])){ if(seen.has(f.id))continue; seen.add(f.id); feats.push(f); }
  if(!lvCableLayer){
    // shared (map default) canvas renderer so clicks hit-test across all layers
    lvCableLayer=L.geoJSON(null,{
      style:lvCableStyle,
      onEachFeature:(f,l)=>l.on('click',e=>lvCablePopup(e,f.properties))});
    lvNetwork.addLayer(lvCableLayer);
  }
  lvCableLayer.clearLayers();
  lvCableLayer.addData({type:'FeatureCollection',features:feats});
}

// Transformers: fixed-size, always-clickable markers. Only the in-view ones exist.
const lvTx=L.layerGroup();
let lvTxData=null, lvTxLoading=false;
function txPopup(p,lat,lon){return `<div class="pt">LV transformer</div>`
  +`<div class="pm">distribution substation &middot; ${RAGT[p.rag]||RAGT.x}</div>`
  +(p.id?`<table><tr><td class="k">ref</td><td>${p.id}</td></tr></table>`:'')
  +gmaps(lat,lon);}
function renderLvTx(){
  lvTx.clearLayers();
  if(!lvTxData||!map.hasLayer(lvNetwork)||map.getZoom()<14) return;
  const b=map.getBounds().pad(0.25);
  for(const f of lvTxData.features){
    const c=f.geometry.coordinates;            // [lng,lat]
    if(!b.contains([c[1],c[0]])) continue;
    L.circleMarker([c[1],c[0]],{radius:5,color:'#3A2E00',weight:1.5,fillColor:'#FFC400',fillOpacity:1})
      .bindPopup(txPopup(f.properties||{},c[1],c[0]),{className:'tt'}).addTo(lvTx);
  }
}
function syncLvTx(){
  if(!map.hasLayer(lvNetwork)||map.getZoom()<14){ lvTx.clearLayers(); return; }
  if(lvTxData){ renderLvTx(); return; }
  if(lvTxLoading) return; lvTxLoading=true;
  fetch('lv_transformers.geojson').then(r=>r.json()).then(fc=>{lvTxData=fc;lvTxLoading=false;renderLvTx();}).catch(()=>{lvTxLoading=false;});
}
function syncLv(){ syncLvTx(); renderLvCables(); updateLvHint(); }
const lvNetwork=L.layerGroup([lvTx]);   // cables added lazily into it by renderLvCables
lvNetwork.on('add',syncLv);
lvNetwork.on('remove',()=>{ lvTx.clearLayers(); if(lvCableLayer)lvCableLayer.clearLayers(); updateLvHint(); });
map.on('moveend',syncLv);
// LV only draws when zoomed in (transformers z14+, cables z16+); tell the user so
// it doesn't look broken when toggled on from a wide view.
const lvHint=L.control({position:'bottomleft'});
lvHint.onAdd=()=>{const d=L.DomUtil.create('div','lvhint');d.innerHTML='&#128269; Zoom in to see the LV network';return d;};
function updateLvHint(){
  const show=map.hasLayer(lvNetwork)&&map.getZoom()<14;
  if(show && !lvHint._map) lvHint.addTo(map);
  else if(!show && lvHint._map) lvHint.remove();
}
lvNetwork.addTo(map);   // LV on by default (all sub-categories enabled)

// ---- Layer control: custom "LayerDeck" (Power group -> HV + LV) -------------
const FX = {
  hv:'#6A2FBF', lv:'#22B8D9',
  train:'#2B2F36', water:'#1C8FB0', sewage:'#8A6A45', gas:'#E8730C', fuel:'#C026A8', power:'#6A2FBF',
};
const FX_RAGC = { g:'#2E9E5B', a:'#E8A317', r:'#D5392B', x:'#9AA0A6' };
const ICON = {
  hv:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/></svg>',
  lv:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18h4l2-6 3 9 2-12 2 6h3"/></svg>',
  train:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="13" rx="3"/><path d="M5 11h14M9 20l-2 2M15 20l2 2"/><circle cx="8.5" cy="13" r="1"/><circle cx="15.5" cy="13" r="1"/></svg>',
  water:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.7 6 11a6 6 0 1 0 12 0L12 2.7z"/></svg>',
  sewage:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  gas:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3s5 4.5 5 9a5 5 0 0 1-10 0c0-1.7.8-3.2 1.5-4.2C9.5 9 12 7 12 3z"/></svg>',
  fuel:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v15M3 20h13M14 9h2.5a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V9l-3-3"/></svg>',
  station:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V10l5-3v3l5-3v14M9 21v-4h4v4"/></svg>',
  pipe:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h18M6 9v6M18 9v6"/></svg>',
  tank:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="11" rx="2"/><path d="M4 12h16"/></svg>',
};
const CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
// ============================================================================
//  HV LABELS (openinframap.org style, toggleable, viewport-windowed + zoom-gated)
//   - substations    : "Name 132 kV"      (voltage/1000)
//   - lines/cables    : "Name (132 kV)"
//   - power stations  : "Name  1380 MW"   (tags['plant:output:electricity'])
//  Only NAMED features get a label. OFF by default; built lazily on first enable.
//  Performance: a dedicated pane + L.layerGroup of permanent tooltips, rebuilt on
//  moveend but ONLY for named features in the padded viewport and at zoom >= 13,
//  with a hard cap. This mirrors the existing LV cable/transformer windowing, so
//  even with ~638 named HV features only the dozens on screen ever mount. The
//  moveend handler is a no-op while the toggle is off (zero cost when unused).
//  Place this block ABOVE the `new LeafLayerDeck(...)` call so setHvLabels exists.
// ============================================================================
const HV_LAB_MINZOOM = 13;        // below this: no labels (clean + fast)
const HV_LAB_CAP     = 400;       // hard safety cap on simultaneously-mounted labels
let hvLabelsOn   = false;         // toggle state (also read by the extra_infra merge)
let hvLabelLayer = null;          // L.layerGroup of permanent tooltips (in its own pane)
let hvLabelPane  = null;

function ensureHvPane(){
  if(hvLabelPane) return;
  hvLabelPane = map.createPane('hvLabels');
  hvLabelPane.style.zIndex = 640;            // above overlay/markers, below popups(700)
  hvLabelPane.style.pointerEvents = 'none';
}

// "132000" -> "132 kV" (handles "132000;33000" -> highest). '' if unknown.
function kvText(volts){
  if(!volts) return '';
  const v = String(volts).split(/[;,]/).map(s=>parseInt(s,10)).filter(n=>n>0);
  if(!v.length) return '';
  const kv = Math.max.apply(null, v)/1000;
  return (Math.round(kv*10)/10) + ' kV';
}

// Pull named-feature label descriptors live from the HV + power-station sub-layers,
// so runtime-merged stations are covered. Returns [{ll,text,cls}, ...].
function hvLabelDescriptors(){
  const out = [];
  const pull = (lyr, isStation) => {
    if(!lyr) return;
    lyr.eachLayer(l => {
      const f = l.feature; if(!f) return;
      const p = f.properties; if(!p || !p.name) return;   // only named
      let text, cls;
      if(isStation){
        const mw = (p.tags && p.tags['plant:output:electricity']) || '';
        text = mw ? (p.name + '  ' + mw) : p.name;         // "Name  1380 MW"
        cls  = 'hv-lab hv-lab-mw';
      } else {
        const kv = kvText(p.voltage);
        const k  = (p.kind||'').toLowerCase();
        if(/substation|station|transformer/.test(k)){
          text = kv ? (p.name + ' ' + kv) : p.name;        // "Name 132 kV"
          cls  = 'hv-lab';
        } else {                                           // line / cable / minor_line
          text = kv ? (p.name + ' (' + kv + ')') : p.name; // "Name (132 kV)"
          cls  = 'hv-lab hv-lab-line';
        }
      }
      // anchor: marker latlng, else polyline midpoint, else bounds centre
      let ll = (l.getLatLng && l.getLatLng());
      if(!ll && l.getCenter){ try{ ll = l.getCenter(); }catch(e){} }
      if(!ll && l.getBounds){ try{ ll = l.getBounds().getCenter(); }catch(e){} }
      if(ll) out.push({ ll, text, cls });
    });
  };
  pull(sub['power.hv'], false);
  pull(sub['power.ps'], true);
  return out;
}

// Build/refresh the windowed label set. Cheap to fully rebuild on each moveend.
function buildHvLabels(){
  if(!hvLabelsOn) return;
  ensureHvPane();
  if(!hvLabelLayer) hvLabelLayer = L.layerGroup([], {pane:'hvLabels'});
  if(!map.hasLayer(hvLabelLayer)) hvLabelLayer.addTo(map);
  hvLabelLayer.clearLayers();
  // labels follow the HV network: hide entirely if HV layer is off or zoomed out
  if(map.getZoom() < HV_LAB_MINZOOM || !map.hasLayer(sub['power.hv'])) return;
  const b = map.getBounds().pad(0.15);
  let n = 0;
  for(const it of hvLabelDescriptors()){
    if(!b.contains(it.ll)) continue;
    L.tooltip({permanent:true, direction:'right', offset:[6,0],
               className:it.cls, opacity:1, pane:'hvLabels', interactive:false})
      .setLatLng(it.ll).setContent(it.text).addTo(hvLabelLayer);
    if(++n >= HV_LAB_CAP) break;
  }
}

// public toggle wired into the control as cfg.onHvLabels
function setHvLabels(on){
  hvLabelsOn = on;
  ensureHvPane();
  if(!hvLabelLayer) hvLabelLayer = L.layerGroup([], {pane:'hvLabels'});
  if(on){ buildHvLabels(); }
  else {
    hvLabelLayer.clearLayers();
    if(map.hasLayer(hvLabelLayer)) map.removeLayer(hvLabelLayer);
  }
}

// re-window on pan/zoom, mirroring the LV layers; no cost while toggle is off.
map.on('moveend', () => { if(hvLabelsOn) buildHvLabels(); });

// ============================================================================
//  GENERALIZED LayerDeck — N Power-style groups + flat leaves, data-driven.
//  Drop-in replacement for the whole `const LeafLayerDeck = L.Control.extend({...})`
//  block AND its instantiation `new LeafLayerDeck({...}).addTo(map)`.
//  Robust: every child resolves to a real layer (chips with no layer are filtered
//  out -> m.hasLayer(undefined) is impossible). Drawer height via measure()
//  (height:auto), never live scrollHeight -> no padding feedback loop.
// ============================================================================
const LeafLayerDeck = L.Control.extend({
  options:{ position:'topright' },
  initialize:function(cfg, opts){ L.setOptions(this, opts||{}); this._cfg = cfg; },

  onAdd:function(){
    const cfg = this._cfg, m = cfg.map;
    const root = L.DomUtil.create('div','fx-deck');
    L.DomEvent.disableClickPropagation(root);
    L.DomEvent.disableScrollPropagation(root);
    root.innerHTML = this._template(cfg);

    // ---- basemap segmented control (unchanged) ----
    const baseNames = Object.keys(cfg.bases);
    root.querySelectorAll('[data-base]').forEach(el => {
      L.DomEvent.on(el, 'click', () => {
        const name = el.getAttribute('data-base');
        baseNames.forEach(n => { if (m.hasLayer(cfg.bases[n])) m.removeLayer(cfg.bases[n]); });
        cfg.bases[name].addTo(m);
        cfg.bases[name].bringToBack && cfg.bases[name].bringToBack();
        root.querySelectorAll('[data-base]').forEach(b => b.classList.toggle('on', b === el));
      });
    });

    // ---- flat leaves (Trains) ----
    cfg.leaves.forEach(leaf => {
      const chip = root.querySelector('.fx-chip[data-leaf="'+leaf.key+'"]');
      if(!chip || !leaf.layer) return;                 // robustness: never wire undefined
      chip.classList.toggle('on', m.hasLayer(leaf.layer));
      L.DomEvent.on(chip, 'click', () => this._toggle(chip, leaf.layer, m));
    });

    // ---- groups ----
    cfg.groups.forEach(g => this._wireGroup(root, m, cfg, g));
    return root;
  },

  _toggle:function(chip, layer, m){
    if(!layer) return;
    if (m.hasLayer(layer)) { m.removeLayer(layer); chip.classList.remove('on'); }
    else {
      m.addLayer(layer); chip.classList.add('on');
      chip.classList.add('pulse'); setTimeout(() => chip.classList.remove('pulse'), 440);
    }
  },

  // ---- generic group wiring (refactor of the old _wirePower) ------------------
  _wireGroup:function(root, m, cfg, g){
    const group  = root.querySelector('[data-group="'+g.key+'"]');
    const parent = group.querySelector('.fx-chip.parent');
    const drawer = group.querySelector('.fx-subs');
    // children that actually resolved to a layer (defensive)
    const kids = g.children
      .map(c => ({ def:c, chip:group.querySelector('.fx-chip[data-child="'+c.key+'"]') }))
      .filter(o => o.chip && o.def.layer);

    // measure natural content height at height:auto (NOT live scrollHeight, which
    // double-counts padding and never shrinks -> the historical drawer-growth bug).
    const measure = () => { const p=drawer.style.height; drawer.style.height='auto'; const h=drawer.scrollHeight; drawer.style.height=p; return h; };
    const reflow  = () => { if (group.classList.contains('open')) drawer.style.height = measure() + 'px'; };

    const refreshParent = () => {
      let on=0; const total=kids.length;
      kids.forEach(k => { const is=m.hasLayer(k.def.layer); k.chip.classList.toggle('on', is); if(is) on++; });
      parent.classList.remove('on','partial');
      if (on===total && total>0) parent.classList.add('on');
      else if (on>0)             parent.classList.add('partial');
      // power group only: LV RAG legend visible while LV child is on
      const legend = group.querySelector('[data-rag]');
      if (legend) legend.classList.toggle('is-on', m.hasLayer(cfg.lvNetwork));
      reflow();
    };

    const setOpen = (o) => {
      group.classList.toggle('open', o);
      drawer.style.height = o ? measure() + 'px' : '0px';
    };

    // chevron = disclosure only
    L.DomEvent.on(parent.querySelector('.fx-disc'), 'click', (e) => {
      L.DomEvent.stop(e); setOpen(!group.classList.contains('open'));
    });
    // master puck: any on -> all off; none on -> all on (+open)
    L.DomEvent.on(parent.querySelector('.fx-puck'), 'click', (e) => {
      L.DomEvent.stop(e);
      const anyOn = kids.some(k => m.hasLayer(k.def.layer));
      if (anyOn) kids.forEach(k => { if(m.hasLayer(k.def.layer)) m.removeLayer(k.def.layer); });
      else { kids.forEach(k => { if(!m.hasLayer(k.def.layer)) m.addLayer(k.def.layer); }); setOpen(true); }
      refreshParent();
    });
    // individual children
    kids.forEach(k => L.DomEvent.on(k.chip, 'click', () => { this._toggle(k.chip, k.def.layer, m); refreshParent(); }));

    // ---- extras inside this group's drawer ----
    // HV labels toggle (always visible; sits OUTSIDE the LV-gated .fx-rag block)
    const labtog = group.querySelector('[data-labtog]');
    if (labtog) L.DomEvent.on(labtog, 'click', (e) => {
      L.DomEvent.stop(e);
      const on = !labtog.classList.contains('on');
      labtog.classList.toggle('on', on);
      cfg.onHvLabels && cfg.onHvLabels(on);
      reflow();
    });
    // LV capacity toggle (inside .fx-rag; unchanged behaviour)
    const captog = group.querySelector('[data-captog]');
    if (captog) L.DomEvent.on(captog, 'click', (e) => {
      L.DomEvent.stop(e);
      const on = !captog.classList.contains('on');
      captog.classList.toggle('on', on);
      const legend = group.querySelector('[data-rag]');
      if (legend) legend.classList.toggle('cap-on', on);
      cfg.onCapacity && cfg.onCapacity(on);
      reflow();
    });

    refreshParent();
    // open groups that start with any child on (all grouped children default ON)
    requestAnimationFrame(() => setOpen(kids.some(k => m.hasLayer(k.def.layer))));
  },

  _chip:function(key, label, icon, color, attr){
    return `<button class="fx-chip" ${attr}="${key}" style="--c:${color}">
      <span class="fx-puck">${icon}</span>
      <span class="fx-name">${label}</span>
      <span class="fx-bar"></span>
      <span class="fx-tick"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4 10-12"/></svg></span>
    </button>`;
  },

  // per-group extras HTML (power only). HV-labels toggle is rendered BEFORE the
  // .fx-rag block so it stays visible regardless of LV state.
  _extrasHtml:function(g){
    if (g.key !== 'power') return '';
    return `
      <button class="fx-cap fx-labtog" data-labtog><span class="fx-cap-sw"></span>HV labels (kV / MW)</button>
      <div class="fx-rag" data-rag>
        <div class="fx-rag-tx"><i style="background:#FFC400;border-color:#3A2E00"></i>Transformer (substation)</div>
        <button class="fx-cap" data-captog><span class="fx-cap-sw"></span>Colour cables by capacity</button>
        <div class="fx-rag-legend">
          <div class="fx-rag-bar"></div>
          <div class="fx-rag-rows">
            <span><i style="background:${FX_RAGC.g}"></i>Spare</span>
            <span><i style="background:${FX_RAGC.a}"></i>Limited</span>
            <span><i style="background:${FX_RAGC.r}"></i>At capacity</span>
          </div>
        </div>
      </div>`;
  },

  _groupHtml:function(g){
    const childChips = g.children
      .map(c => this._chip(c.key, c.label, c.icon, c.color, 'data-child')).join('\n');
    return `
      <div class="fx-group" data-group="${g.key}">
        <button class="fx-chip parent" style="--c:${g.color}">
          <span class="fx-puck">${g.icon}</span>
          <span class="fx-name">${g.label}</span>
          <span class="fx-disc" title="Show / hide ${g.label}">${CHEV}</span>
        </button>
        <div class="fx-subs">
          ${childChips}
          ${this._extrasHtml(g)}
        </div>
      </div>`;
  },

  _template:function(cfg){
    const baseChips = Object.keys(cfg.bases).map((n,i) =>
      `<button class="fx-base${(n===cfg.baseDefault)||(cfg.baseDefault==null&&i===0)?' on':''}" data-base="${n}" title="${n}">${n.replace(/\s*\(.*\)$/,'').replace('Satellite + labels','Sat + labels')}</button>`
    ).join('');
    const groupsHtml = cfg.groups.map(g => this._groupHtml(g)).join('\n');
    const leafChips  = cfg.leaves.map(l => this._chip(l.key, l.label, l.icon, l.color, 'data-leaf')).join('\n');
    return `
      <div class="fx-head"><span class="fx-title">Layers</span></div>
      <div class="fx-eyebrow">Basemap</div>
      <div class="fx-seg">${baseChips}</div>
      <div class="fx-eyebrow">Overlays</div>
      <div class="fx-chips">
        ${groupsHtml}
        ${leafChips}
      </div>`;
  },
});

// ---- config + mount (replaces the old single new LeafLayerDeck({...}) call) ----
const GROUPS = [
  { key:'power', label:'Power', color:FX.hv, icon:ICON.hv, children:[
      { key:'power.hv', label:'HV network',     icon:ICON.hv,      color:FX.hv,     layer:sub['power.hv'] },
      { key:'power.ps', label:'Power stations', icon:ICON.station, color:FX.power,  layer:sub['power.ps'] },
      { key:'power.lv', label:'LV network',     icon:ICON.lv,      color:FX.lv,     layer:lvNetwork } ] },
  { key:'fuel', label:'Oil &amp; chemicals', color:FX.fuel, icon:ICON.fuel, children:[
      { key:'fuel.pipe', label:'Pipelines',  icon:ICON.pipe, color:FX.fuel, layer:sub['fuel.pipe'] },
      { key:'fuel.tank', label:'Tank farms', icon:ICON.tank, color:FX.fuel, layer:sub['fuel.tank'] } ] },
  { key:'gas', label:'Gas', color:FX.gas, icon:ICON.gas, children:[
      { key:'gas.pipe', label:'Pipelines',   icon:ICON.pipe, color:FX.gas, layer:sub['gas.pipe'] },
      { key:'gas.hold', label:'Gas holders', icon:ICON.gas,  color:FX.gas, layer:sub['gas.hold'] } ] },
  { key:'water', label:'Water', color:FX.water, icon:ICON.water, children:[
      { key:'water.site', label:'Sites',     icon:ICON.water, color:FX.water, layer:sub['water.site'] },
      { key:'water.pipe', label:'Pipelines', icon:ICON.pipe,  color:FX.water, layer:sub['water.pipe'] } ] },
  { key:'sewage', label:'Sewage', color:FX.sewage, icon:ICON.sewage, children:[
      { key:'sewage.site', label:'Sites',     icon:ICON.sewage, color:FX.sewage, layer:sub['sewage.site'] },
      { key:'sewage.pipe', label:'Pipelines', icon:ICON.pipe,   color:FX.sewage, layer:sub['sewage.pipe'] } ] },
].map(g => ({...g, children: g.children.filter(c => c.layer)}));   // drop any child whose layer is missing

new LeafLayerDeck({
  map, bases, baseDefault:'Street (OSM)',
  groups: GROUPS,
  leaves: [ { key:'train', label:'Trains', icon:ICON.train, color:FX.train, layer:layers.train } ],
  lvNetwork,
  onCapacity: setLvCapacity,
  onHvLabels: setHvLabels,
}).addTo(map);


const title=L.control({position:'topleft'});
title.onAdd=()=>{const d=L.DomUtil.create('div','tt');d.style.marginLeft='44px';
  d.innerHTML='<h3>Infrastructure</h3><small>solid = overground &middot; dashed = underground</small>';
  return d;};
title.addTo(map);
</script></body></html>"""


if __name__ == "__main__":
    main()
