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
                    out.append(feat({"type": "LineString", "coordinates": coords},
                                    **base, cat="pipe", substance=sub,
                                    kind="pipeline" + (f" ({sub})" if sub else ""),
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
.leaflet-control-layers{border:none;border-radius:10px;box-shadow:0 1px 8px rgba(0,0,0,.22);font:13px/1.5 system-ui;overflow:hidden}
.leaflet-control-layers-expanded{padding:6px 4px}
.leaflet-control-layers-list{padding:2px 12px 2px 8px}
.leaflet-control-layers label{display:flex;align-items:center;margin:3px 0;font-weight:500;color:#1a1a1a;cursor:pointer}
.leaflet-control-layers input{margin:0 8px 0 2px}
.ln{display:inline-block;width:22px;height:0;border-top:4px solid;border-radius:2px;margin:0 8px 0 1px;vertical-align:middle}
.lab{background:#0a7d2c;color:#fff;border:none;font:11px/1.2 system-ui;font-weight:600;padding:1px 5px;border-radius:4px;box-shadow:0 1px 2px rgba(0,0,0,.3);white-space:nowrap}
.lab:before{display:none}
.tt{background:#fff;border-radius:9px;box-shadow:0 1px 8px rgba(0,0,0,.22);padding:8px 12px;font:system-ui}
.tt h3{margin:0;font-size:15px;font-weight:600;color:#1a1a1a}
.tt small{color:#888;font-size:11.5px}
.leaflet-popup-content{font:12px/1.45 system-ui;max-height:240px;overflow:auto;margin:11px 13px}
.pt{font-weight:600;text-transform:capitalize;color:#1a1a1a}
.pn{color:#111}.pm{color:#888;margin:1px 0 4px}
.leaflet-popup-content table{border-collapse:collapse;margin-top:5px}
.leaflet-popup-content td{border-top:1px solid #eee;padding:1px 7px 1px 0}.k{color:#999}
</style>
</head><body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><script>
const data=__DATA__;
const CAT={
  power :{c:'#e23b2e',label:'Power'},
  train :{c:'#333333',label:'Trains'},
  water :{c:'#1ba3c6',label:'Water'},
  sewage:{c:'#8a6d3b',label:'Sewage'},
  pipe  :{c:'#9b27b0',label:'Pipes'},
};
const ORDER=['power','train','water','sewage','pipe'];
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
    onEachFeature:(f,l)=>l.bindPopup(pop(f.properties)),
  });}

// Trains layer also carries labelled markers for the 6 traction supply points.
const trainGroup=L.featureGroup([catLayer('train')]);
data.features.filter(f=>f.properties.traction).forEach(f=>{
  const c=L.geoJSON(f).getBounds().getCenter();
  L.circleMarker(c,{radius:7,color:'#0a7d2c',weight:2,fillColor:'#2ee06a',fillOpacity:.95})
    .bindTooltip(f.properties.label,{permanent:true,direction:'top',className:'lab',offset:[0,-7]})
    .bindPopup(pop(f.properties)).addTo(trainGroup);
});

const layers={power:catLayer('power'),train:trainGroup,water:catLayer('water'),
              sewage:catLayer('sewage'),pipe:catLayer('pipe')};
ORDER.forEach(k=>layers[k].addTo(map));
const overlays={};
ORDER.forEach(k=>overlays[`<span class="ln" style="border-color:${CAT[k].c}"></span>${CAT[k].label}`]=layers[k]);
L.control.layers(bases,overlays,{collapsed:false,position:'topright'}).addTo(map);

map.fitBounds(layers.power.getBounds().pad(0.03));

const title=L.control({position:'topleft'});
title.onAdd=()=>{const d=L.DomUtil.create('div','tt');d.style.marginLeft='44px';
  d.innerHTML='<h3>Infrastructure</h3><small>solid = overground &middot; dashed = underground</small>';
  return d;};
title.addTo(map);
</script></body></html>"""


if __name__ == "__main__":
    main()
