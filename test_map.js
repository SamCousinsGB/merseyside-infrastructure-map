// Structural/data smoke test for the production MapLibre map.
// The browser rendering path is deliberately WebGL-native, so this checks the
// shipped page, source data and representative protobuf tiles without mocking
// a graphics engine.
const fs=require('fs');
const path=require('path');
const Pbf=require('pbf');
const {VectorTile}=require('@mapbox/vector-tile');

const htmlPath=path.resolve(process.argv[2]||'index.html');
const root=path.dirname(htmlPath);
const html=fs.readFileSync(htmlPath,'utf8');
const check=(ok,msg)=>{if(!ok)throw new Error(msg)};

check(/maplibre-gl@5\.24\.0/.test(html),'production page is not pinned to MapLibre GL 5.24.0');
check(!/leaflet(?:\.css|@|\bL\.map)/i.test(html),'legacy Leaflet runtime is still present');
check(/type:'vector'/.test(html)&&/source-layer':'network'/.test(html),'vector-tile sources/layers are missing');
check(/renderWorldCopies:false/.test(html)&&/antialias:false/.test(html),'performance-sensitive map options are missing');
check(/queryRenderedFeatures/.test(html),'GPU feature picking / popups are missing');

const inline=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).pop();
check(inline,'inline application script was not found');
new Function(inline);

for(const key of ['power.hv','power.ps','power.lv','gas.hp','gas.ip','gas.mp','gas.lp','gas.svc','gas.agi','gas.agpipe','gas.hold','water.site','water.pipe','sewage.site','sewage.pipe','train'])
  check(html.includes(`'${key}'`),`layer key ${key} is missing`);

const jsonFiles=['data.json','extra_infra.geojson','gas_ag_sites.geojson','gas_ag_pipes.geojson','gas_transmission.geojson','tiles/mapsgeo/agi.geojson','tiles/mapsgeo/meta.json'];
for(const rel of jsonFiles){const p=path.join(root,rel);check(fs.existsSync(p),`${rel} is missing`);JSON.parse(fs.readFileSync(p,'utf8'))}
const data=JSON.parse(fs.readFileSync(path.join(root,'data.json'),'utf8'));
check((data.features||[]).length>8000,'static infrastructure data is unexpectedly short');

function filesUnder(dir,ext){const out=[];for(const ent of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,ent.name);if(ent.isDirectory())out.push(...filesUnder(p,ext));else if(p.endsWith(ext))out.push(p)}return out}
function decode(file){const tile=new VectorTile(new Pbf(fs.readFileSync(file)));const layer=tile.layers.network;check(layer&&layer.length,`empty/missing network layer in ${path.relative(root,file)}`);return layer}
const expected={
  'lv':{min:2700,prop:'rag'},
  'lv-transformers':{min:2700,prop:'id'},
  'cadent-main':{min:170,prop:'p'},
  'cadent-svc':{min:900,prop:'t'},
  'maps-ip':{min:350,prop:'pressure',value:'IP'},
  'maps-mp':{min:3300,prop:'pressure',value:'MP'},
  'maps-lp':{min:13000,prop:'pressure',value:'LP'},
};
let tileCount=0,tileBytes=0;
for(const[id,rule]of Object.entries(expected)){
  const dir=path.join(root,'tiles','mvt',id);check(fs.existsSync(dir),`MVT tree ${id} is missing`);
  const files=filesUnder(dir,'.pbf');check(files.length>=rule.min,`${id} has ${files.length} tiles; expected at least ${rule.min}`);
  const layer=decode(files[0]),props=layer.feature(0).properties;check(props[rule.prop]!=null,`${id} lost property ${rule.prop}`);
  if(rule.value)check(props[rule.prop]===rule.value,`${id} contains the wrong pressure tier`);
  tileCount+=files.length;tileBytes+=files.reduce((n,f)=>n+fs.statSync(f).size,0);
}
check(tileBytes>70*1024*1024&&tileBytes<100*1024*1024,`vector-tile payload is suspicious: ${(tileBytes/1048576).toFixed(1)} MiB`);

// Known records used by browser interaction checks must retain popup fields.
const lp=decode(path.join(root,'tiles/mvt/maps-lp/16/32185/21231.pbf'));
let asset=null;for(let i=0;i<lp.length;i++){const p=lp.feature(i).properties;if(String(p.asset_id)==='313003157'){asset=p;break}}
check(asset&&asset.spec==='125MM PE'&&asset.diameter_mm===125,'known MAPS main did not survive MVT build');
const svc=decode(path.join(root,'tiles/mvt/cadent-svc/14/8046/5307.pbf'));
let service=null;for(let i=0;i<svc.length;i++){const p=svc.feature(i).properties;if(p.t==='s'){service=p;break}}
check(service&&service.p==='LP','known Cadent service pipe did not survive MVT build');

console.log(`OK: MapLibre page syntax and ${jsonFiles.length} GeoJSON sources are valid`);
console.log(`    ${tileCount.toLocaleString()} protobuf vector tiles, ${(tileBytes/1048576).toFixed(1)} MiB, representative properties intact`);
