import fs from 'node:fs';
import path from 'node:path';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';

const ROOT=path.resolve('.'),OUT=path.join(ROOT,'tiles','mvt');
import dataUtils from './map-data.js';
const {clipOutside}=dataUtils;
const only=(process.argv.find(a=>a.startsWith('--only='))||'').split('=')[1];

const mapsTier=tier=>f=>(f.properties||{}).kind==='main'&&String((f.properties||{}).pressure).toUpperCase()===tier?[f]:[];
const cadentMain=f=>clipOutside(f);
const identity=f=>[f];
const SPECS=[
  {id:'lv',root:'tiles/lvgeo',native:14,min:14,select:identity},
  {id:'cadent-main',root:'tiles/gasgeo/main',native:14,min:14,select:cadentMain},
  {id:'cadent-svc',root:'tiles/gasgeo/svc',native:14,min:14,select:identity},
  {id:'maps-ip',root:'tiles/mapsgeo/ip',native:14,min:12,select:mapsTier('IP')},
  {id:'maps-mp',root:'tiles/mapsgeo/mp',native:15,min:13,select:mapsTier('MP')},
  {id:'maps-lp',root:'tiles/mapsgeo/lp',native:16,min:15,select:mapsTier('LP')},
];
const lon2x=(lon,z)=>Math.floor((lon+180)/360*2**z);
const lat2y=(lat,z)=>{const r=lat*Math.PI/180;return Math.floor((1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*2**z)};

function inventory(root){
  const out=[],abs=path.join(ROOT,root);if(!fs.existsSync(abs))return out;
  for(const xd of fs.readdirSync(abs,{withFileTypes:true}))if(xd.isDirectory()&&/^\d+$/.test(xd.name)){
    for(const yf of fs.readdirSync(path.join(abs,xd.name),{withFileTypes:true}))if(yf.isFile()&&/^\d+\.json$/.test(yf.name))
      out.push({x:Number(xd.name),y:Number(yf.name.slice(0,-5)),file:path.join(abs,xd.name,yf.name)});
  }
  return out;
}
function groupAt(records,native,z){
  const shift=native-z,groups=new Map();
  for(const r of records){const x=Math.floor(r.x/2**shift),y=Math.floor(r.y/2**shift),k=x+'/'+y;
    if(!groups.has(k))groups.set(k,{x,y,files:[]});groups.get(k).files.push(r.file)}
  return [...groups.values()];
}
function primitiveProperties(p){const out={};for(const[k,v]of Object.entries(p||{}))if(v==null||['string','number','boolean'].includes(typeof v))out[k]=v;return out}
function encodeGroup(spec,z,g){
  const seen=new Set(),features=[];
  for(const file of g.files){const fc=JSON.parse(fs.readFileSync(file,'utf8'));for(const f of fc.features||[]){
    const key=f.id==null?null:String(f.id);if(key&&seen.has(key))continue;if(key)seen.add(key);
    for(const q of spec.select(f))features.push({...q,properties:primitiveProperties(q.properties)});
  }}
  if(!features.length)return 0;
  const index=geojsonvt({type:'FeatureCollection',features},{maxZoom:z,indexMaxZoom:z,indexMaxPoints:0,
    tolerance:z===spec.native?.65:2.2,extent:4096,buffer:64,lineMetrics:false});
  const tile=index.getTile(z,g.x,g.y);if(!tile||!tile.features.length)return 0;
  const buf=vtpbf.fromGeojsonVt({network:tile},{version:2,extent:4096});
  const dir=path.join(OUT,spec.id,String(z),String(g.x));fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,g.y+'.pbf'),buf);return buf.length;
}
async function buildSpec(spec){
  const records=inventory(spec.root);if(!records.length)throw new Error(`No input tiles for ${spec.id}`);
  const target=path.join(OUT,spec.id);fs.rmSync(target,{recursive:true,force:true});
  let totalTiles=0,totalBytes=0;console.log(`${spec.id}: ${records.length} source tiles`);
  for(let z=spec.min;z<=spec.native;z++){
    const groups=groupAt(records,spec.native,z);let done=0,zBytes=0,zTiles=0;
    for(const g of groups){const bytes=encodeGroup(spec,z,g);if(bytes){zTiles++;zBytes+=bytes}done++;
      if(done%250===0)console.log(`  z${z}: ${done}/${groups.length}`)}
    totalTiles+=zTiles;totalBytes+=zBytes;console.log(`  z${z}: wrote ${zTiles} tiles, ${(zBytes/1048576).toFixed(1)} MiB`);
  }
  console.log(`${spec.id}: ${totalTiles} tiles, ${(totalBytes/1048576).toFixed(1)} MiB total`);
}

async function buildPointFile(id,file,z){
  const target=path.join(OUT,id);fs.rmSync(target,{recursive:true,force:true});
  const fc=JSON.parse(fs.readFileSync(path.join(ROOT,file),'utf8')),groups=new Map();
  for(const f of fc.features||[]){if((f.geometry||{}).type!=='Point')continue;const c=f.geometry.coordinates,x=lon2x(c[0],z),y=lat2y(c[1],z),k=x+'/'+y;
    if(!groups.has(k))groups.set(k,{x,y,features:[]});groups.get(k).features.push({...f,properties:primitiveProperties(f.properties)})}
  let count=0,bytes=0;for(const g of groups.values()){const index=geojsonvt({type:'FeatureCollection',features:g.features},{maxZoom:z,indexMaxZoom:z,indexMaxPoints:0,tolerance:.5,extent:4096,buffer:64});const tile=index.getTile(z,g.x,g.y);if(!tile)continue;const buf=vtpbf.fromGeojsonVt({network:tile},{version:2,extent:4096}),dir=path.join(target,String(z),String(g.x));fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,g.y+'.pbf'),buf);count++;bytes+=buf.length}
  console.log(`${id}: ${count} tiles, ${(bytes/1048576).toFixed(1)} MiB total`);
}

fs.mkdirSync(OUT,{recursive:true});
for(const spec of SPECS)if(!only||spec.id===only)await buildSpec(spec);
if(!only||only==='lv-transformers')await buildPointFile('lv-transformers','lv_transformers.geojson',14);
console.log('Vector-tile build complete.');
