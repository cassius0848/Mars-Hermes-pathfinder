const INDEX='mars-task-index';
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('message',event=>{
  if(event.data?.type!=='activate-task'||!/^mars-task-[\w-]+$/.test(event.data.cacheName))return;
  event.waitUntil((async()=>{
    const selected=await caches.open(event.data.cacheName);
    if(!await selected.match(new URL('build-info.json',self.registration.scope))){event.ports[0]?.postMessage({ok:false});return;}
    const index=await caches.open(INDEX);
    await index.put(new URL('offline-index',self.registration.scope),new Response(event.data.cacheName));
    const old=(await caches.keys()).filter(name=>name.startsWith('mars-task-')&&name!==INDEX&&name!==event.data.cacheName);
    for(const name of old.slice(0,Math.max(0,old.length-1)))await caches.delete(name);
    event.ports[0]?.postMessage({ok:true});
  })());
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
  event.respondWith((async()=>{
    try{const response=await fetch(event.request);if(response.ok)return response;}
    catch{}
    const index=await caches.open(INDEX),pointer=await index.match(new URL('offline-index',self.registration.scope));
    if(pointer){
      const cache=await caches.open(await pointer.text()),url=new URL(event.request.url);
      if(event.request.mode==='navigate'){
        const end=url.pathname.split('/').at(-1);
        if(!end)url.pathname+='index.html';else if(!end.includes('.'))url.pathname+='.html';
      }
      const cached=await cache.match(url,{ignoreSearch:true});if(cached)return cached;
    }
    return new Response('This file is not in the saved mission package.',{status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}});
  })());
});
