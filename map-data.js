/* Shared by the browser and data checks. No network or map-engine dependencies. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MIMData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const osmId = f => String(f.properties?.osm || f.properties?.id || f.id || '').replace(/^https?:\/\/(?:www\.)?openstreetmap\.org\//, '');
  function mergeStatic(...collections) {
    const records = new Map();
    for (const collection of collections) for (const f of collection.features || []) {
      if (!f.geometry) continue;
      const key = osmId(f) || JSON.stringify(f.geometry);
      const previous = records.get(key);
      if (!previous) { records.set(key, f); continue; }
      // Preserve base geometry; the supplemental extract often has richer plant tags.
      const a = previous.properties || {}, b = f.properties || {};
      const properties = {...a};
      for (const [k, v] of Object.entries(b)) if (v !== '' && v != null) properties[k] = v;
      properties.tags = {...a.tags, ...b.tags};
      const geometry = /Polygon/.test(f.geometry.type) && !/Polygon/.test(previous.geometry.type) ? f.geometry : previous.geometry;
      records.set(key, {...previous, properties, geometry});
    }
    return [...records.values()];
  }
  function classify(p, geometry) {
    const k = String(p.kind || '').toLowerCase(), tags = p.tags || {}, type = geometry?.type || '';
    if (p.cat === 'power') return /power station|\bplant\b/.test(k) || tags.power === 'plant' ? 'power.ps' : 'power.hv';
    if (p.cat === 'fuel') return /chimney/.test(k) ? 'fuel.chimney' : /LineString/.test(type) ? 'fuel.pipe' : 'fuel.tank';
    if (p.cat === 'gas') {
      if (/holder/.test(k)) return 'gas.hold';
      if (/tank/.test(k)) return /avgas|gasoline/.test(k) ? 'fuel.tank' : 'gas.tank';
      // The OSM extract has no recorded pressure for these pipes.
      return 'gas.un';
    }
    if (p.cat === 'water') return /weir|dam|reservoir|tower|station|tank/.test(k) ? 'water.site' : /LineString/.test(type) ? 'water.pipe' : 'water.site';
    if (p.cat === 'sewage') return /LineString/.test(type) ? 'sewage.pipe' : 'sewage.site';
    return p.cat === 'train' ? 'train' : null;
  }
  function powerMW(value) {
    const match = /^\s*([\d.]+)\s*(GW|MW|kW|W)?\s*$/i.exec(String(value || ''));
    if (!match) return 0;
    return Number(match[1]) * ({gw:1000, mw:1, kw:.001, w:.000001}[String(match[2] || 'MW').toLowerCase()]);
  }
  function applyPlantDetails(features, details) {
    return features.map(f => {
      const record = details.records[osmId(f)];
      if (!record) return f;
      const confirmed = record.tags.power === 'plant';
      const p = {...f.properties, plant_checked:new Date(details.checked_at).toLocaleDateString('en-GB',{timeZone:'Europe/London',day:'numeric',month:'short',year:'numeric'}), plant_match:confirmed ? 'Current OSM plant record' : 'Legacy record; current OSM plant tag not found'};
      if (confirmed) {
        p.tags = {...p.tags};
        for (const k of ['name','operator','owner','power','plant:source','plant:method','plant:output:electricity','generator:source','start_date','end_date','disused:power','construction:power','ref','voltage']) delete p.tags[k];
        Object.assign(p.tags,record.tags);
        p.name=record.tags.name||'';p.operator=record.tags.operator||'';p.voltage=record.tags.voltage||'';
        p.kind=record.tags['plant:source'] ? record.tags['plant:source']+' power station' : 'power station';
      }
      return {...f,properties:p};
    });
  }
  function distinctHits(features, metadata) {
    const seen = new Set();
    return features.filter(f => {
      const p = f.properties || {}, m = metadata.get(f.layer.id) || {};
      const id = p.id || p.asset_id || p._asset || f.id;
      const key = `${f.source || m.origin}|${p._group || m.key}|${id != null ? String(id).replace(/^[sc]:/, '') : JSON.stringify(f.geometry)}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
  }
  const MAPS_BOUNDS=[-3.198587,53.134005,-2.301016,53.694087];
const same=(a,b)=>a&&b&&Math.abs(a[0]-b[0])<1e-10&&Math.abs(a[1]-b[1])<1e-10;
const lerp=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
function outsideLine(line){
  const[xmin,ymin,xmax,ymax]=MAPS_BOUNDS,parts=[];let cur=null;
  const flush=()=>{if(cur&&cur.length>1)parts.push(cur);cur=null};
  const add=(a,b)=>{if(!cur)cur=[a,b];else if(same(cur[cur.length-1],a)){if(!same(cur[cur.length-1],b))cur.push(b)}else{flush();cur=[a,b]}};
  for(let i=1;i<line.length;i++){
    const a=line[i-1],b=line[i],dx=b[0]-a[0],dy=b[1]-a[1],ts=[0,1];
    const cut=t=>{if(t>1e-10&&t<1-1e-10)ts.push(t)};
    if(dx){cut((xmin-a[0])/dx);cut((xmax-a[0])/dx)}if(dy){cut((ymin-a[1])/dy);cut((ymax-a[1])/dy)}
    ts.sort((x,y)=>x-y);const cuts=ts.filter((t,j)=>!j||Math.abs(t-ts[j-1])>1e-10);
    for(let j=1;j<cuts.length;j++){const t0=cuts[j-1],t1=cuts[j],m=lerp(a,b,(t0+t1)/2);
      if(m[0]<xmin||m[0]>xmax||m[1]<ymin||m[1]>ymax)add(lerp(a,b,t0),lerp(a,b,t1));else flush()}
  }
  flush();return parts;
}
function clipOutside(f){
  const g=f.geometry||{},lines=g.type==='LineString'?[g.coordinates]:g.type==='MultiLineString'?g.coordinates:[];
  if(!lines.length)return[f];const parts=lines.flatMap(outsideLine),id=String(f.id??'main');
  return parts.map((coordinates,i)=>({...f,id:id+':outside:'+i,geometry:{type:'LineString',coordinates}}));
}

  return { applyPlantDetails, clipOutside, osmId, mergeStatic, classify, powerMW, distinctHits };
});
