const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const data=require('./map-data.js');
const read=file=>JSON.parse(fs.readFileSync(file));
const point=(id,p={})=>({type:'Feature',properties:{id,...p},geometry:{type:'Point',coordinates:[-3,53.4]}});
test('merging an OSM object preserves useful tags without duplicating geometry',()=>{
 const [f]=data.mergeStatic({features:[point('way/1',{voltage:'33000',name:'Station',tags:{ref:'A'}})]},{features:[point('way/1',{name:'',kind:'gas power station',tags:{'plant:source':'gas'}})]});
 assert.equal(f.properties.name,'Station');assert.equal(f.properties.voltage,'33000');assert.deepEqual(f.properties.tags,{ref:'A','plant:source':'gas'});
});
test('classifications do not invent pressure, confuse aviation fuel with gas, or call a weir a pipeline',()=>{
 const line={type:'LineString'},polygon={type:'Polygon'};
 assert.equal(data.classify({cat:'gas',kind:'gas pipeline'},line),'gas.un');
 assert.equal(data.classify({cat:'gas',kind:'avgas_100ll tank'},polygon),'fuel.tank');
 assert.equal(data.classify({cat:'gas',kind:'LPG tank'},polygon),'gas.tank');
 assert.equal(data.classify({cat:'fuel',kind:'chimney'},point().geometry),'fuel.chimney');
 assert.equal(data.classify({cat:'water',kind:'weir'},line),'water.site');
});
test('generation output respects units',()=>{
 assert.equal(data.powerMW('1.38 GW'),1380);assert.equal(data.powerMW('500 kW'),.5);assert.equal(data.powerMW('500000 W'),.5);assert.equal(data.powerMW('498 MW'),498);assert.equal(data.powerMW('yes'),0);
});
test('plant refresh uses current tags and marks legacy records without inventing current confirmation',()=>{
 const details=read('plant_details.json');
 assert.equal(Object.keys(details.records).length,140);
 assert.equal(Object.values(details.records).filter(r=>r.tags.power==='plant').length,136);
 const f=point('way/1',{name:'Old name',tags:{operator:'Old operator','plant:output:electricity':'5 MW'}});
 const [updated]=data.applyPlantDetails([f],{checked_at:'2026-09-10T00:00:00Z',records:{'way/1':{tags:{power:'plant',name:'New name'}}}});
 assert.equal(updated.properties.name,'New name');assert.equal(updated.properties.tags.operator,undefined);assert.equal(updated.properties.tags['plant:output:electricity'],undefined);
 const [legacy]=data.applyPlantDetails([f],{checked_at:'2026-09-10T00:00:00Z',records:{'way/1':{tags:{}}}});
 assert.equal(legacy.properties.name,'Old name');assert.match(legacy.properties.plant_match,/Legacy/);
});
test('source boundary clipping retains the outside sections of a crossing line',()=>{
 const f={id:'test',properties:{asset_id:'a'},geometry:{type:'LineString',coordinates:[[-4,53.4],[-2,53.4]]}};
 const parts=data.clipOutside(f);assert.equal(parts.length,2);
 assert.deepEqual(parts[0].geometry.coordinates,[[-4,53.4],[-3.198587,53.4]]);
 assert.deepEqual(parts[1].geometry.coordinates,[[-2.301016,53.4],[-2,53.4]]);
 assert.equal(data.clipOutside({...f,geometry:{type:'LineString',coordinates:[[-3.1,53.4],[-3,53.4]]}}).length,0);
 assert.equal(parts[0].properties.asset_id,'a');
});
test('feature picker collapses multiple draw layers for one asset but keeps different sources',()=>{
 const f={id:'s:way/1',properties:{id:'way/1',_group:'power.hv'},source:'infra',layer:{id:'fill'}};
 const hits=data.distinctHits([f,{...f,id:'c:way/1',layer:{id:'point'}},{...f,source:'survey'}],new Map());assert.equal(hits.length,2);
});
test('production data keeps all distinct OSM objects and removes transmission repetition',()=>{
 const a=read('data.json'),b=read('extra_infra.geojson'),t=read('gas_transmission.geojson');
 const all=[...a.features,...b.features],merged=data.mergeStatic(a,b);
 assert.equal(merged.length,new Set(all.filter(f=>f.geometry).map(data.osmId)).size);
 const transmissionIds=new Set(t.features.map(data.osmId));
 assert.equal(merged.filter(f=>f.properties.cat==='gas'&&transmissionIds.has(data.osmId(f))).length,54);
 assert(merged.some(f=>f.properties.tags?.['plant:source']));
});
test('all saved basemap layers use keyless sources and retain upstream visibility',()=>{
 const style=vm.runInNewContext(fs.readFileSync('basemaps.js','utf8')+';FREE_BASE_STYLE');
 assert(style.layers.length>90);assert(!JSON.stringify(style).match(/cartocdn|api[_-]?key|access_token/i));
 assert.equal(new Set(style.layers.map(l=>l.id)).size,style.layers.length);
 assert(style.layers.filter(l=>l.metadata.basemap==='dark').every(l=>l.layout.visibility==='none'));
 assert(style.sources.openmaptiles.attribution.includes('OpenStreetMap'));
});
