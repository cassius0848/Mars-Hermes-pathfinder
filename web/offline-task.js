const encoder=new TextEncoder();
export function crc32(bytes) {
  let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}

// Uncompressed ZIP: portable, deterministic file bytes, no external runtime/CDN.
export function taskZip(entries) {
  const local=[],central=[];let offset=0,size=0;
  const header=n=>{const b=new Uint8Array(n);return [b,new DataView(b.buffer)];};
  for(const [path,payload] of entries){
    if(!/^[\w./-]+$/.test(path)||path.startsWith('/')||path.split('/').includes('..'))throw Error('离线包文件路径无效。');
    const name=encoder.encode(path),data=payload instanceof Uint8Array?payload:encoder.encode(payload),crc=crc32(data);
    const [a,v]=header(30);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);
    v.setUint16(12,33,true);v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,name.length,true);
    local.push(a,name,data);
    const [b,w]=header(46);w.setUint32(0,0x02014b50,true);w.setUint16(4,20,true);w.setUint16(6,20,true);w.setUint16(8,0x800,true);
    w.setUint16(14,33,true);w.setUint32(16,crc,true);w.setUint32(20,data.length,true);w.setUint32(24,data.length,true);w.setUint16(28,name.length,true);w.setUint32(42,offset,true);
    central.push(b,name);offset+=30+name.length+data.length;size+=46+name.length;
  }
  const [end,e]=header(22);e.setUint32(0,0x06054b50,true);e.setUint16(8,entries.length,true);e.setUint16(10,entries.length,true);
  e.setUint32(12,size,true);e.setUint32(16,offset,true);
  return new Blob([...local,...central,end],{type:'application/zip'});
}

export function downloadFile(blob,name) {
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}

export function bundleFiles(manifest,siteId) {
  if(!['jezero','hawksbill','neretva'].includes(siteId))throw Error('离线地图只支持已有地形数据包。');
  return Object.keys(manifest.files_sha256).filter(path=>!path.startsWith('assets/')
    ||path==='assets/sites.json'||path.startsWith(`assets/${siteId}/`));
}

export async function saveOfflineTask(siteId,snapshot,status=()=>{}) {
  if(!crypto.subtle||!('caches' in window))throw Error('浏览器需要 HTTPS/localhost 和离线存储支持。');
  const manifestResponse=await fetch('build-info.json',{cache:'no-store'});
  if(!manifestResponse.ok)throw Error('无法读取构建校验清单。');
  const manifestText=await manifestResponse.text(),manifest=JSON.parse(manifestText),files=bundleFiles(manifest,siteId);
  const cacheName=`mars-task-${String(manifest.source_commit).slice(0,40)}-${Date.now()}`;
  const cache=await caches.open(cacheName),entries=[];let bytes=0;
  try {
    for(const path of files) {
      status(`校验与保存 ${entries.length+1}/${files.length}：${path}`);
      const response=await fetch(path,{cache:'reload'});if(!response.ok)throw Error(`离线文件缺失：${path}`);
      const buffer=await response.arrayBuffer();bytes+=buffer.byteLength;
      if(bytes>64*1024*1024)throw Error('当前离线包超过 64 MiB，请选择较小任务区。');
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(v=>v.toString(16).padStart(2,'0')).join('');
      if(hash!==manifest.files_sha256[path])throw Error(`文件版本校验失败：${path}。请刷新后重试。`);
      await cache.put(new URL(path,location.href),new Response(buffer,{headers:{'Content-Type':response.headers.get('Content-Type')||'application/octet-stream'}}));
      entries.push([path,new Uint8Array(buffer)]);
    }
    const task={...snapshot,schema:'mars-pathfinder-task/v1',sourceCommit:manifest.source_commit,exportedAt:new Date().toISOString(),siteId};
    await cache.put(new URL('build-info.json',location.href),new Response(manifestText,{headers:{'Content-Type':'application/json'}}));
    await cache.put(new URL('task.json',location.href),new Response(JSON.stringify(task),{headers:{'Content-Type':'application/json'}}));
    const registration=await navigator.serviceWorker.register('offline-sw.js',{scope:'./'});
    await navigator.serviceWorker.ready;
    const worker=registration.active;
    if(!worker)throw Error('离线处理程序尚未就绪，请重试保存。');
    await new Promise((resolve,reject)=>{
      const channel=new MessageChannel(),timer=setTimeout(()=>reject(Error('离线索引保存超时。')),15000);
      channel.port1.onmessage=event=>{clearTimeout(timer);event.data?.ok?resolve():reject(Error('离线索引未保存。'));channel.port1.close();};
      worker.postMessage({type:'activate-task',cacheName},[channel.port2]);
    });
    entries.push(['build-info.json',manifestText],['task.json',JSON.stringify(task,null,2)],['OFFLINE-README.txt',
      `HermesX Mars Pathfinder AI\nSource: ${manifest.source_commit}\n\nUnzip, run: python -m http.server 8000\nOpen: http://localhost:8000/mission.html?area=${siteId}&restore=task.json\n\nThe selected mission terrain, imagery, evidence and task notes are included.\nOnline Mars Trek tiles and new external data are not included.\nResource rates are user assumptions, not certified suit specifications.\n`]);
    const blob=taskZip(entries);downloadFile(blob,`mars-${siteId}-task.zip`);
    status(`已保存本机离线地图并下载任务包 · ${(bytes/1048576).toFixed(1)} MiB · ${files.length} 个文件已校验。`);
    return {bytes,files:files.length,cacheName};
  } catch(error){await caches.delete(cacheName);throw error;}
}
