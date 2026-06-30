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

// One toggleable layer per category, built straight from ORDER so the two
// can never drift out of sync.
const layers={};
ORDER.forEach(k=>{layers[k]=catLayer(k);});
// The Trains layer also carries labelled markers for the 6 traction points.
data.features.filter(f=>f.properties.traction).forEach(f=>{
  const c=L.geoJSON(f).getBounds().getCenter();
  L.circleMarker(c,{radius:7,color:'#15202B',weight:2,fillColor:'#00C2A8',fillOpacity:.95})
    .bindTooltip(f.properties.label,{permanent:true,direction:'top',className:'lab',offset:[0,-7]})
    .bindPopup(pop(f.properties)+gmaps(c.lat,c.lng)).addTo(layers.train);
});
ORDER.forEach(k=>layers[k].addTo(map));

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
function syncLv(){ syncLvTx(); renderLvCables(); }
const lvNetwork=L.layerGroup([lvTx]);   // cables added lazily into it by renderLvCables
lvNetwork.on('add',syncLv);
lvNetwork.on('remove',()=>{ lvTx.clearLayers(); if(lvCableLayer)lvCableLayer.clearLayers(); });
map.on('moveend',syncLv);

// ---- Layer control: custom "LayerDeck" (Power group -> HV + LV) -------------
const FX = {
  hv:'#6A2FBF', lv:'#22B8D9',
  train:'#2B2F36', water:'#1C8FB0', sewage:'#8A6A45', gas:'#E8730C', fuel:'#C026A8',
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
};
const CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
const LeafLayerDeck = L.Control.extend({
  options:{ position:'topright' },
  initialize:function(cfg, opts){ L.setOptions(this, opts||{}); this._cfg = cfg; },
  onAdd:function(){
    const cfg = this._cfg, m = cfg.map;
    const root = L.DomUtil.create('div','fx-deck');
    L.DomEvent.disableClickPropagation(root);
    L.DomEvent.disableScrollPropagation(root);
    root.innerHTML = this._template(cfg);
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
    const leafMap = { train:cfg.layers.train, water:cfg.layers.water,
                      sewage:cfg.layers.sewage, gas:cfg.layers.gas, fuel:cfg.layers.fuel };
    root.querySelectorAll('.fx-chip[data-leaf]').forEach(chip => {
      const layer = leafMap[chip.getAttribute('data-leaf')];
      chip.classList.toggle('on', m.hasLayer(layer));
      L.DomEvent.on(chip, 'click', () => this._toggle(chip, layer, m));
    });
    this._wirePower(root, m, cfg);
    return root;
  },
  _toggle:function(chip, layer, m){
    if (m.hasLayer(layer)) { m.removeLayer(layer); chip.classList.remove('on'); }
    else {
      m.addLayer(layer); chip.classList.add('on');
      chip.classList.add('pulse'); setTimeout(() => chip.classList.remove('pulse'), 440);
    }
  },
  _wirePower:function(root, m, cfg){
    const group  = root.querySelector('[data-power]');
    const parent = group.querySelector('.fx-chip.parent');
    const drawer = group.querySelector('.fx-subs');
    const hvChip = group.querySelector('[data-child="hv"]');
    const lvChip = group.querySelector('[data-child="lv"]');
    const legend = group.querySelector('[data-rag]');
    const HV = cfg.layers.power, LV = cfg.lvNetwork;
    // measure the drawer's natural content height (briefly at height:auto) instead
    // of scrollHeight, which includes padding and never shrinks -> the old code grew
    // the drawer 8px per toggle and never collapsed it back.
    const measure = () => { const p=drawer.style.height; drawer.style.height='auto'; const h=drawer.scrollHeight; drawer.style.height=p; return h; };
    const refreshParent = () => {
      const hvOn = m.hasLayer(HV), lvOn = m.hasLayer(LV);
      hvChip.classList.toggle('on', hvOn);
      lvChip.classList.toggle('on', lvOn);
      legend.classList.toggle('is-on', lvOn);
      parent.classList.remove('on','partial');
      if (hvOn && lvOn) parent.classList.add('on');
      else if (hvOn || lvOn) parent.classList.add('partial');
      if (group.classList.contains('open'))
        drawer.style.height = measure() + 'px';
    };
    const setOpen = (o) => {
      group.classList.toggle('open', o);
      drawer.style.height = o ? measure() + 'px' : '0px';
    };
    L.DomEvent.on(parent.querySelector('.fx-disc'), 'click', (e) => {
      L.DomEvent.stop(e); setOpen(!group.classList.contains('open'));
    });
    L.DomEvent.on(parent.querySelector('.fx-puck'), 'click', (e) => {
      L.DomEvent.stop(e);
      const anyOn = m.hasLayer(HV) || m.hasLayer(LV);
      if (anyOn) { m.removeLayer(HV); m.removeLayer(LV); }
      else { m.addLayer(HV); m.addLayer(LV); setOpen(true); }
      refreshParent();
    });
    L.DomEvent.on(hvChip, 'click', () => { this._toggle(hvChip, HV, m); refreshParent(); });
    L.DomEvent.on(lvChip, 'click', () => { this._toggle(lvChip, LV, m); refreshParent(); });
    const captog = group.querySelector('[data-captog]');
    L.DomEvent.on(captog, 'click', (e) => {
      L.DomEvent.stop(e);
      const on = !captog.classList.contains('on');
      captog.classList.toggle('on', on);
      legend.classList.toggle('cap-on', on);
      cfg.onCapacity && cfg.onCapacity(on);
      if (group.classList.contains('open')) drawer.style.height = measure() + 'px';
    });
    refreshParent();
    requestAnimationFrame(() => setOpen(m.hasLayer(HV) || m.hasLayer(LV)));
  },
  _chip:function(key, label, icon, color, attr){
    return `<button class="fx-chip" ${attr}="${key}" style="--c:${color}">
      <span class="fx-puck">${icon}</span>
      <span class="fx-name">${label}</span>
      <span class="fx-bar"></span>
      <span class="fx-tick"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4 10-12"/></svg></span>
    </button>`;
  },
  _template:function(cfg){
    const baseChips = Object.keys(cfg.bases).map((n,i) =>
      `<button class="fx-base${(n===cfg.baseDefault)||(cfg.baseDefault==null&&i===0)?' on':''}" data-base="${n}" title="${n}">${n.replace(/\s*\(.*\)$/,'').replace('Satellite + labels','Sat + labels')}</button>`
    ).join('');
    const leaves = [
      ['train','Trains',ICON.train,FX.train],
      ['water','Water',ICON.water,FX.water],
      ['sewage','Sewage',ICON.sewage,FX.sewage],
      ['gas','Gas',ICON.gas,FX.gas],
      ['fuel','Oil &amp; chemicals',ICON.fuel,FX.fuel],
    ].map(([k,l,ic,c]) => this._chip(k,l,ic,c,'data-leaf')).join('');
    return `
      <div class="fx-head"><span class="fx-title">Layers</span></div>
      <div class="fx-eyebrow">Basemap</div>
      <div class="fx-seg">${baseChips}</div>
      <div class="fx-eyebrow">Overlays</div>
      <div class="fx-chips">
        <div class="fx-group" data-power>
          <button class="fx-chip parent" style="--c:${FX.hv}">
            <span class="fx-puck">${ICON.hv}</span>
            <span class="fx-name">Power</span>
            <span class="fx-disc" title="Show / hide HV &amp; LV">${CHEV}</span>
          </button>
          <div class="fx-subs">
            ${this._chip('hv','HV network',ICON.hv,FX.hv,'data-child')}
            ${this._chip('lv','LV network',ICON.lv,FX.lv,'data-child')}
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
            </div>
          </div>
        </div>
        ${leaves}
      </div>`;
  },
});
new LeafLayerDeck({ map, bases, baseDefault:'Street (OSM)', layers, lvNetwork, onCapacity:setLvCapacity }).addTo(map);

map.fitBounds(layers.power.getBounds().pad(0.03));

const title=L.control({position:'topleft'});
title.onAdd=()=>{const d=L.DomUtil.create('div','tt');d.style.marginLeft='44px';
  d.innerHTML='<h3>Infrastructure</h3><small>solid = overground &middot; dashed = underground</small>';
  return d;};
title.addTo(map);
</script></body></html>"""


if __name__ == "__main__":
    main()
