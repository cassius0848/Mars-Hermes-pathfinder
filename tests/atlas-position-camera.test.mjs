import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../dist/vendor/three.module.min.js';
import { atlasCell, atlasLonLat, planningGrid } from '../dist/atlas-terrain.js';
import { cellXY, elevationAt, pathXY, planMission, progressAt, project } from '../dist/planner.js';
import { stationSprite, TerrainView, walkingPose } from '../dist/terrain-view.js';

const fixtures = [
  [[76.80408,18.12523],[76.87676,18.12152]],
  [[76.73194,18.07949],[76.79555,18.11676]],
  [[76.90951,17.70640],[76.96064,17.72191]],
];
const near = (actual, expected, epsilon=1e-7) => actual.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<epsilon, `${actual} != ${expected}`));
function mission(points, spacing=1000) {
  const grid = planningGrid(points, true, false, spacing);
  grid.height = new Float32Array(grid.rows*grid.cols).fill(-1800);
  grid.slope = new Float32Array(grid.height.length);
  grid.depth = {min:-1800,max:-1800};
  const route = {start:atlasCell(grid,points[0]), startXY:project(grid,points[0]), base:atlasCell(grid,points[0]), baseXY:project(grid,points[0]),
    stops:points.slice(1).map((p,i)=>({cell:atlasCell(grid,p),xy:project(grid,p),name:`Stop ${i+1}`,minutes:0})),
    closures:[],limit:18,speed:15,budget:1440,reserve:0,returnToBase:false};
  return {grid,route};
}

test('all screenshot routes keep the exact selected coordinates on coarse and blended grids',()=>{
  for (const points of fixtures) for (const spacing of [1000,200]) {
    const {grid,route}=mission(points,spacing), plan=planMission(grid,route).candidates[0];
    assert.ok(plan);
    near(atlasLonLat(grid,pathXY(grid,plan,0)),points[0]);
    near(atlasLonLat(grid,pathXY(grid,plan,plan.path.length-1)),points[1]);
    near(atlasLonLat(grid,progressAt(grid,plan,0).xy),points[0]);
    near(atlasLonLat(grid,progressAt(grid,plan,plan.minutes).xy),points[1]);
    near(plan.visits[0].xy,route.stops[0].xy);
    const measured=plan.xy.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p[0]-plan.xy[i][0],p[1]-plan.xy[i][1]),0);
    assert.ok(Math.abs(plan.distance-measured)<1e-7);
    assert.ok(Math.abs(plan.minutes-plan.distance/route.speed)<1e-7);
  }
});

test('waypoint anchors, dwell time and return legs share one continuous playback geometry',()=>{
  const points=[fixtures[0][0],[76.84,18.13],fixtures[0][1]];
  const {grid,route}=mission(points,200); route.stops[0].minutes=7; route.returnToBase=true;
  const plan=planMission(grid,route).candidates[0];
  assert.equal(plan.visits.length,3);
  for (const [i,visit] of plan.visits.entries()) {
    const expected=i===2?points[0]:points[i+1];
    near(atlasLonLat(grid,progressAt(grid,plan,visit.arrival).xy),expected);
  }
  assert.ok(Math.abs(plan.minutes-plan.distance/route.speed-7)<1e-7);
});

test('missing elevation around an exact anchor is diagnosed without shifting the point',()=>{
  const {grid,route}=mission(fixtures[0],200);
  const [r,c]=route.start;
  grid.height[(r-1)*grid.cols+c]=NaN;
  route.startXY=cellXY(grid,[r,c]).map((v,i)=>v+(i?50:0));
  assert.ok(!Number.isFinite(elevationAt(grid,route.startXY)));
  const result=planMission(grid,route);
  assert.equal(result.candidates.length,0);
  assert.match(result.error,/实际坐标缺少有效高程/);
});

test('surroundings extend at least eight kilometres past these edge routes without unbounded meshes',()=>{
  for (const points of fixtures) {
    const grid=planningGrid(points,true,true,200);
    const routeXY=points.map(p=>project(grid,p));
    assert.ok(grid.cols*grid.step >= Math.abs(routeXY[0][0]-routeXY[1][0])+16000);
    assert.ok(grid.cols<=504 && grid.rows<=504);
    assert.equal(grid.step,200);
  }
});

test('destination markers retain screen sizing independently of terrain spacing and camera distance',()=>{
  const marker=stationSprite({width:64,height:64});
  assert.equal(marker.isSprite,true);
  assert.equal(marker.material.sizeAttenuation,false);
  assert.equal(marker.material.depthTest,false);
  assert.ok(marker.scale.x<0.02 && marker.scale.y<0.02);
  marker.material.map.dispose(); marker.material.dispose();
});

test('overview frustum contains the terrain even when a coarse route needs a distant camera',()=>{
  const camera=new THREE.PerspectiveCamera(45,1,1,5000);
  const view={host:{clientWidth:800,clientHeight:600},camera,
    renderer:{getPixelRatio:()=>1,domElement:{width:800,height:600},render:()=>{}},
    size:1000,distance:30000,angle:0.64,pitch:0.49,follow:false,
    target:new THREE.Vector3(),overview:new THREE.Vector3(-40000,0,30000),drawCrewMarker:()=>{}};
  TerrainView.prototype.renderFrame.call(view);
  camera.updateMatrixWorld();
  const point=view.overview.clone().project(camera);
  assert.ok(Math.abs(point.x)<1e-6 && Math.abs(point.y)<1e-6 && point.z<1);
  assert.ok(camera.far>view.distance);
});

test('walking view uses a 1.7 metre eye height, east/north headings and bounded free look',()=>{
  const north=walkingPose([150,-200],[0,1],32);
  near(north.eye,[150,33.7,200]);
  assert.ok(north.target[2]<north.eye[2]);
  const east=walkingPose([150,-200],[1,0],32);
  assert.ok(east.target[0]>east.eye[0]);
  near(walkingPose([150,-200],[1,0],32,0.7,0.2).eye,east.eye);
});
