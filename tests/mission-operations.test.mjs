import test from 'node:test';
import assert from 'node:assert/strict';
import { planOperations, resourceReadings, resourcesAfter, assessResources, routeQuality } from '../dist/mission-operations.js';
import { crc32,taskZip,bundleFiles } from '../dist/offline-task.js';
const grid={rows:6,cols:6,step:10,left:0,top:60,center:[77,18],height:new Float32Array(36),slope:new Float32Array(36)};
const route={start:[0,0],base:[0,0],stops:[{cell:[0,2],name:'A',minutes:5}],returnToBase:true,closures:[],limit:20,speed:10,budget:30,reserve:2};
const oxygen={id:'oxygen',capacity:20,travelRate:1,workRate:2,reservePercent:10,source:'test assumption'};
test('resources include work, outbound and return; absent resources remain unevaluated',()=>{
  const plan=planOperations(grid,{...route,resources:[oxygen]},null).candidates[0];
  assert.equal(plan.minutes,9);assert.equal(plan.resourceUsage[0].used,14);assert.equal(plan.resourceUsage[0].remaining,6);assert.ok(plan.feasible);
  assert.deepEqual(resourceReadings(plan,[]),[]);
  const failed=assessResources(plan,[{...oxygen,capacity:10}]);assert.equal(failed.feasible,false);assert.equal(failed.violations.at(-1).code,'RESOURCE_OXYGEN');
});
test('replanning consumes only elapsed work and keeps the absolute reserve',()=>{
  const plan=planOperations(grid,route,null).candidates[0];
  const remaining=resourcesAfter([oxygen],plan,4,1);
  assert.equal(remaining[0].capacity,12);assert.equal(remaining[0].reserveAmount,2);
  const again=resourcesAfter(remaining,plan,1,0,{oxygen:7});assert.equal(again[0].capacity,7);assert.equal(again[0].reserveAmount,2);
  assert.throws(()=>resourcesAfter([oxygen],plan,9,20),/exhausted/i);
});
test('scientific selection compares orders, respects required stops and explains omitted ones',()=>{
  const targets=[{cell:[0,2],name:'A',minutes:5,priority:5,required:false},{cell:[5,5],name:'B',minutes:10,priority:1,required:false}];
  const result=planOperations(grid,{...route,budget:15,scienceSelection:{enabled:true,objective:'compare',targets}},null);
  assert.equal(result.scienceDecision.evaluated,4);assert.ok(result.candidates[0].feasible);assert.equal(result.candidates[0].scienceStops[0].name,'A');
  assert.equal(result.scienceDecision.omitted[0].name,'B');
  const required=planOperations(grid,{...route,budget:15,scienceSelection:{enabled:true,targets:targets.map(t=>({...t,required:t.name==='B'}))}},null);
  assert.ok(required.candidates.every(p=>p.scienceStops.some(t=>t.name==='B')));assert.equal(required.candidates[0].feasible,false);
});
test('resource limits can change the chosen scientific combination',()=>{
  const targets=[{cell:[0,1],name:'A',minutes:5,priority:5},{cell:[0,2],name:'B',minutes:5,priority:1}];
  const selected=planOperations(grid,{...route,resources:[{...oxygen,capacity:16}],scienceSelection:{enabled:true,targets}},null);
  assert.ok(selected.candidates[0].feasible);assert.equal(selected.candidates[0].scienceScore,5);assert.equal(selected.candidates[0].scienceStops.length,1);
});
test('coverage is sampled on the actual path and reports source spacing',()=>{
  const sampled={...grid,height:Float32Array.from(grid.height)};sampled.height[2]=NaN;
  assert.equal(routeQuality(sampled,{path:[0,1,2]}).terrainCoverage,2/3);assert.equal(routeQuality(sampled,{path:[0,1]}).terrainSpacing,10);
});
test('portable ZIP uses original bytes, known CRC and excludes other mission assets',async()=>{
  assert.equal(crc32(new TextEncoder().encode('123456789')),0xcbf43926);
  const bytes=new Uint8Array(await taskZip([['task.json','{"team":"HermesX"}']]).arrayBuffer());
  assert.equal(new DataView(bytes.buffer).getUint32(0,true),0x04034b50);assert.equal(new DataView(bytes.buffer).getUint32(bytes.length-22,true),0x06054b50);
  assert.throws(()=>taskZip([['../secret','x']]),/file path is invalid/i);
  assert.deepEqual(bundleFiles({files_sha256:{'app.js':'a','assets/sites.json':'b','assets/hawksbill/x.bin':'c','assets/neretva/x.bin':'d'}},'hawksbill'),['app.js','assets/sites.json','assets/hawksbill/x.bin']);
});
