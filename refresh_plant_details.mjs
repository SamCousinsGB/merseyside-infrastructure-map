// Refresh metadata for already-mapped power plants using the public OSM API.
// This does not claim to refresh geometry or discover additional sites.
import fs from 'node:fs';
import data from './map-data.js';
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const plants=data.mergeStatic(read('data.json'),read('extra_infra.geojson')).filter(f=>data.classify(f.properties,f.geometry)==='power.ps');
const groups=Object.groupBy(plants.map(data.osmId),id=>id.split('/')[0]);
const keep=['name','operator','owner','power','plant:source','plant:method','plant:output:electricity','generator:source','start_date','end_date','disused:power','construction:power','ref','voltage'];
const records={};
for(const [type,ids] of Object.entries(groups)) for(let i=0;i<ids.length;i+=50){
  const batch=ids.slice(i,i+50).map(id=>id.split('/')[1]);
  const plural=type==='way'?'ways':type==='relation'?'relations':'nodes';
  const url=`https://api.openstreetmap.org/api/0.6/${plural}.json?${plural}=${batch.join(',')}`;
  const response=await fetch(url,{headers:{'User-Agent':'MerseysideInfrastructureMap (https://github.com/SamCousinsGB/merseyside-infrastructure-map)'},signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`OSM ${plural}: HTTP ${response.status}`);
  const result=await response.json();
  for(const element of result.elements){
    const tags=Object.fromEntries(keep.filter(k=>element.tags?.[k]!=null).map(k=>[k,element.tags[k]]));
    records[`${element.type}/${element.id}`]={tags,osm_updated_at:element.timestamp};
  }
  console.log(`Checked ${Math.min(i+50,ids.length)}/${ids.length} ${plural}`);
}
if(Object.keys(records).length!==plants.length)throw new Error('Incomplete refresh; previous file preserved');
const result={source:'OpenStreetMap API v0.6',checked_at:new Date().toISOString(),scope:'Metadata for existing power plants; geometry and other datasets unchanged',records};
fs.writeFileSync('plant_details.json',JSON.stringify(result,null,2)+'\n');
console.log(`Saved metadata for ${plants.length} mapped plants`);
