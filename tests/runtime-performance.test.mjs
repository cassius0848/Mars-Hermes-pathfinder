import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../dist/vendor/three.module.min.js';
import { BudgetCache, frameTask } from '../dist/render-runtime.js';
import { TerrainView } from '../dist/terrain-view.js';
import { loadAtlasTerrain } from '../dist/atlas-terrain.js';

test('bursts render once per frame using the latest state and cancel cleanly',()=>{
  const queued=new Map();let next=0,draws=0,last;
  const draw=frameTask(value=>{draws++;last=value;},cb=>{queued.set(++next,cb);return next;},id=>queued.delete(id));
  for(let i=0;i<50;i++)draw(i);
  assert.equal(queued.size,1);queued.values().next().value();queued.clear();
  assert.equal(draws,1);assert.equal(last,49);
  draw(50);draw.cancel();assert.equal(queued.size,0);assert.equal(draws,1);
  draw(51);queued.values().next().value();assert.equal(draws,2);assert.equal(last,51);
});

test('cache observes both byte and entry limits and evicts the least recently used value',()=>{
  const cache=new BudgetCache(12,2);
  cache.set('a',1,4);cache.set('b',2,4);assert.equal(cache.get('a'),1);
  cache.set('c',3,4);assert.equal(cache.get('b'),undefined);assert.equal(cache.bytes,8);
  cache.set('large',4,20);assert.equal(cache.get('large'),undefined);assert.equal(cache.bytes,8);
  cache.set('d',5,10);assert.equal(cache.entries.size,1);assert.equal(cache.bytes,10);
});

test('scale or camera changes reuse route buffers, station objects and their textures',()=>{
  const geometry=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0),new THREE.Vector3(1,0,0)]);
  const plan={},station={position:new THREE.Vector3(),material:{map:{texture:true}}},texture=station.material.map;
  const view=Object.assign(Object.create(TerrainView.prototype),{plan,route:{geometry},
    routeAnchors:[{e:0,n:0,elevation:10},{e:1,n:0,elevation:20}],
    stationAnchors:[{object:station,e:1,n:0,elevation:20,offset:10,scaled:true}],
    verticalScale:2,perspective:'orbit',heightAt(e,n,z){return z*this.verticalScale;},draw(){}});
  const buffer=geometry.getAttribute('position').array;
  view.setPlan(plan);
  assert.equal(view.route.geometry,geometry);assert.equal(geometry.getAttribute('position').array,buffer);
  assert.equal(buffer[1],23);assert.equal(buffer[4],43);assert.equal(station.position.y,60);
  view.perspective='first-person';view.setPlan(plan);
  assert.ok(Math.abs(buffer[1]-20.24)<1e-5);assert.equal(station.material.map,texture);
  geometry.dispose();
});

test('an unchanged display mode and scale do not rebuild or recompile the scene',()=>{
  const view={mode:'relief',verticalScale:1.5,autoScale:1.5};
  assert.doesNotThrow(()=>TerrainView.prototype.setDisplay.call(view,'relief',1.5));
});

function elevationTiff() {
  const bytes=new ArrayBuffer(256+32*32*4),v=new DataView(bytes);
  v.setUint32(0,0x002a4949,true);v.setUint32(4,8,true);
  const tags=[[256,3,1,32],[257,3,1,32],[258,3,1,32],[259,3,1,1],[277,3,1,1],
    [322,3,1,32],[323,3,1,32],[324,4,1,256],[325,4,1,4096],[339,3,1,3],[33550,12,3,160],[33922,12,6,184]];
  v.setUint16(8,tags.length,true);
  tags.forEach(([tag,type,count,value],i)=>{const o=10+i*12;v.setUint16(o,tag,true);v.setUint16(o+2,type,true);v.setUint32(o+4,count,true);v.setUint32(o+8,value,true);});
  [0.6/32,0.8/32,0].forEach((n,i)=>v.setFloat64(160+8*i,n,true));
  [0,0,0,76.6,18.3,0].forEach((n,i)=>v.setFloat64(184+8*i,n,true));
  for(let i=0;i<1024;i++)v.setFloat32(256+4*i,-1900+i%32,true);
  return bytes;
}

test('replanning identical points reuses the real-grid result without another export request',async()=>{
  const original=globalThis.fetch;let requests=0;
  globalThis.fetch=async()=>{requests++;return new Response(elevationTiff());};
  const points=[[76.80408,18.12523],[76.87676,18.12152]],signal=new AbortController().signal;
  try {
    const first=await loadAtlasTerrain('hrsc',points,signal,()=>{});
    const second=await loadAtlasTerrain('hrsc',points,signal,()=>{});
    assert.equal(requests,1);assert.equal(second,first);assert.equal(second.grid.step,200);
    await loadAtlasTerrain('hrsc',[[76.804081,18.12523],points[1]],signal,()=>{});
    assert.equal(requests,2);
    const aborted=new AbortController();aborted.abort();
    await assert.rejects(loadAtlasTerrain('hrsc',points,aborted.signal,()=>{}),{name:'AbortError'});
    assert.equal(requests,2);
  } finally {globalThis.fetch=original;}
});
