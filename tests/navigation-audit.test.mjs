import test from 'node:test';
import assert from 'node:assert/strict';
import { profileChart } from '../web/map.js';
import { MissionConsole } from '../web/mission-console.js';

test('elevation profile samples the same exact route anchors as navigation', () => {
  const site={rows:3,cols:3,left:0,top:30,step:10,
    height:Float32Array.from([-100,-90,-80,-90,-80,-70,-80,-70,-60])};
  const plan={path:[0,1,1,2],xy:[[8,24],[15,25],[15,25],[25,25]],lengths:[0,8,8,18],distance:18};
  const labels=[],lines=[];
  const context={scale(){},beginPath(){},moveTo(x,y){lines.push([x,y]);},lineTo(x,y){lines.push([x,y]);},stroke(){},
    fillRect(){},fillText(text){labels.push(text);}};
  const canvas={getBoundingClientRect:()=>({width:500}),getContext:()=>context};
  const previous=globalThis.window;globalThis.window={devicePixelRatio:1};
  try {profileChart(canvas,site,plan,{distance:8});} finally {globalThis.window=previous;}
  assert.ok(labels.includes('-96 m'),`Expected exact start elevation, got ${labels}`);
  assert.ok(labels.includes('-80 m'));
  assert.ok(lines.every(point=>point.every(Number.isFinite)));
});

test('import restores automatic selection, required and excluded targets, resources and solar settings', async () => {
  const controls=new Map(),control=id=>{if(!controls.has(id))controls.set(id,{value:'0',checked:false,disabled:false,options:[],checkValidity:()=>true,get valueAsNumber(){return Number(this.value);}});return controls.get(id);};
  for(const [id,values] of [['ops-scene',['terrain']],['ops-objective',['compare']],['hour',['9.5','6.75']],['season',['0','90']]])control(id).options=values.map(value=>({value}));
  const previous=globalThis.document;globalThis.document={getElementById:control};
  const console={site:{id:'hawksbill'},targets:[{name:'Swift Run',cell:[1,2]},{name:'Hazeltop',cell:[3,4]}],refreshScenes:async()=>{},isAutomatic:MissionConsole.prototype.isAutomatic};
  try {
    control('ops-auto').checked=true;control('ops-use-oxygen').checked=true;
    for(const [id,value]of Object.entries({'ops-cap-oxygen':'100','ops-travel-oxygen':'1','ops-work-oxygen':'2','ops-reserve-oxygen':'10',
      'ops-target-0':'required','ops-target-1':'ignore','ops-priority-0':'4','ops-dwell-0':'7','ops-objective':'compare','ops-scene':'terrain','hour':'6.75','season':'90'}))control(id).value=value;
    const config=MissionConsole.prototype.read.call(console);
    assert.deepEqual(config.lighting,{hour:6.75,season:90});
    control('ops-auto').checked=false;control('ops-use-oxygen').checked=false;
    control('ops-target-0').value=control('ops-target-1').value='optional';control('hour').value='9.5';control('season').value='0';
    await MissionConsole.prototype.restoreConfig.call(console,config);
    assert.deepEqual({auto:control('ops-auto').checked,roles:[control('ops-target-0').value,control('ops-target-1').value]},
      {auto:true,roles:['required','ignore']});
    assert.equal(Number(control('ops-dwell-0').value),7);
    assert.equal(control('ops-use-oxygen').checked,true);
    assert.equal(Number(control('hour').value),6.75);assert.equal(Number(control('season').value),90);
    console.site.regional=true;await MissionConsole.prototype.restoreConfig.call(console,config);
    assert.equal(control('ops-auto').checked,false,'regional maps must retain their automatic-science restriction');
    await MissionConsole.prototype.restoreConfig.call(console,{});
  } finally {globalThis.document=previous;}
});

test('missing elevation produces a no-data profile rather than numeric NaN labels',()=>{
  const labels=[],context={scale(){},fillText:text=>labels.push(text)};
  const site={rows:1,cols:2,left:0,top:10,step:10,height:Float32Array.from([NaN,NaN])};
  const previous=globalThis.window;globalThis.window={devicePixelRatio:1};
  try {profileChart({getBoundingClientRect:()=>({width:500}),getContext:()=>context},site,{path:[0,1],lengths:[0,10],distance:10});}
  finally {globalThis.window=previous;}
  assert.deepEqual(labels,['这一段缺少可用数据']);
});
