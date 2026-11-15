import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../dist/vendor/three.module.min.js';
import { environmentTracks, minuteAtDistance, routeValueColor, trackAtMinute, trackSegments } from '../dist/atlas-environment-panel.js';
import { regionalMetrics } from '../dist/atlas-regional.js';
import { TerrainView } from '../dist/terrain-view.js';

const candidate={path:[0,1,1,2],times:[0,10,20,30],lengths:[0,100,100,200],distance:200,minutes:30};

test('distance selection uses arrival time at a dwell and preserves later travel time',()=>{
  assert.equal(minuteAtDistance(candidate,100),10);
  assert.equal(minuteAtDistance(candidate,150),25);
  assert.equal(minuteAtDistance(candidate,-1),0);
  assert.equal(minuteAtDistance(candidate,300),30);
});

test('environment cursor keeps missing values missing rather than interpolating over gaps',()=>{
  const track={values:Float32Array.from([270,NaN,NaN,280])};
  assert.equal(trackAtMinute(track,candidate,0).value,270);
  assert.equal(trackAtMinute(track,candidate,5).value,null);
  assert.equal(trackAtMinute(track,candidate,15).value,null);
  assert.equal(trackAtMinute(track,candidate,30).value,280);
  assert.deepEqual(trackSegments(track),[]);
});

test('downsampling preserves spikes, gaps and measured versus interpolated segments',()=>{
  const values=new Float32Array(3000).fill(300);values[1577]=500;values[1000]=NaN;
  const flags=new Uint8Array(3000);flags.fill(1,2000,2400);
  const runs=trackSegments({values,flags},90);
  assert.ok(runs.some(run=>run.indices.includes(1577)));
  assert.ok(runs.some(run=>run.estimated));
  assert.ok(runs.some(run=>!run.estimated));
  assert.ok(!runs.some(run=>run.indices[0]<1000&&run.indices.at(-1)>1000));
});

test('regional route quality flags and units survive into the navigation tracks',()=>{
  const environment={kind:'regional',fields:{thermal:Float32Array.from([270,271,272]),pressure:Float32Array.from([680,681,682]),
    inertia:Float32Array.from([300,310,320]),uv:Float32Array.from([200,0,210])},interpolated:Uint8Array.from([0,1,0])};
  const metrics=regionalMetrics(environment,candidate,()=>true);
  assert.deepEqual([...metrics.interpolated],[0,1,1,0]);
  const tracks=environmentTracks({}, {...candidate,environment:metrics},null,{coverage:{active:['地表温度','热惯量'],thermalSpacing:0.05}});
  assert.equal(tracks.find(t=>t.key==='inertia').step,true);
  assert.equal(tracks.find(t=>t.key==='inertia').unit,'J m⁻² K⁻¹ s⁻½');
  assert.equal(tracks.find(t=>t.key==='pressure').active,false);
  assert.match(tracks.find(t=>t.key==='thermal').source,/5°/);
  assert.equal(trackAtMinute(tracks.find(t=>t.key==='inertia'),candidate,15).interpolated,true);
});

test('MEDA point observations remain constant references with correct physical units',()=>{
  const observation={pressurePa:765.34,groundLongwaveWm2:207.6,groundLongwaveUncertaintyWm2:1.56,uvWm2:0.01840455};
  const grid={cols:3,slope:new Float32Array(3)};
  const tracks=environmentTracks(grid,candidate,null,{observation,weights:{thermal:0}});
  const thermal=tracks.find(t=>t.key==='thermal');
  assert.equal(thermal.label,'地表长波辐照');assert.equal(thermal.unit,'W/m²');
  assert.equal(thermal.uncertainty,1.56);assert.equal(thermal.active,false);
  assert.ok([...thermal.values].every(v=>Math.abs(v-207.6)<1e-4));
  assert.match(thermal.source,/同一读数/);
  assert.equal(tracks.some(t=>t.key==='inertia'),false);
});

test('3D route colouring is removable and uses the same missing-data and shade colours as 2D',()=>{
  assert.equal(routeValueColor(NaN,1,2,'thermal'),'#9c9b9c');
  assert.equal(routeValueColor(0,0,1,'light'),'#aa9bff');
  assert.equal(routeValueColor(1,0,1,'light'),'#ffd575');
  const geometry=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(1,0,0)]);
  const route=new THREE.Line(geometry,new THREE.LineBasicMaterial());
  const view={route,draw:()=>{}};
  TerrainView.prototype.setRouteColors.call(view,['#aa9bff','#ffd575']);
  assert.equal(route.material.vertexColors,true);assert.equal(geometry.getAttribute('color').count,2);
  TerrainView.prototype.setColor.call(view,'#86f8c1');
  assert.equal(route.material.vertexColors,false);assert.equal(geometry.getAttribute('color'),undefined);
  assert.equal(view.routeColors,null);
  geometry.dispose();route.material.dispose();
});
