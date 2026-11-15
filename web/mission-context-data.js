import { fetchOfficial } from './official.js';
import { environmentSettings } from './atlas-environment.js';

let catalog,meda,payload;
export const regionalCatalog=()=>catalog??=fetchOfficial('atlas-regional.json','json').catch(e=>{catalog=null;throw e;});
export const medaCatalog=()=>meda??=fetchOfficial('atlas-meda.json','json').catch(e=>{meda=null;throw e;});
export async function missionEnvironment(kind,id,grid,weights) {
  if(kind==='terrain')return undefined;
  if(kind==='meda') {
    if(grid.id!=='hawksbill')throw Error('MEDA 历史测站情景仅用于 Hawksbill Gap 覆盖区。');
    return environmentSettings(await medaCatalog(),Number(id),weights,610,grid);
  }
  const meta=await regionalCatalog(),snapshot=meta.climate.snapshots.find(s=>s.id===id);
  if(!snapshot)throw Error('请选择有效的历史气候快照。');
  payload??=fetchOfficial('atlas-regional.bin.gz','arrayBuffer').then(async buffer=>{
    if(new Uint8Array(buffer)[0]!==31)return buffer;
    return new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }).catch(e=>{payload=null;throw e;});
  return {kind:'regional',catalog:meta,buffer:await payload,snapshot,weights,temperatureTarget:230,pressureTarget:610};
}
