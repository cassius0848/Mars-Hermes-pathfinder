import { elevationAt, isLit, pathXY } from './planner.js';

const definitions = {
  elevation: ['高程剖面', 'm', 0, 1],
  thermal: ['地表温度', 'K', 1, 1], pressure: ['地表气压', 'Pa', 1, 10],
  inertia: ['热惯量', 'J m⁻² K⁻¹ s⁻½', 0, 20], uv: ['太阳辐照潜势', 'W/m²', 1, 80],
  terrain: ['坡度', '°', 1, 2], light: ['直射日照', '', 0, 1],
};
const names = {thermal:'地表温度',pressure:'地表气压',inertia:'热惯量',uv:'太阳辐照潜势',terrain:'坡度',light:'阴影'};
const finite = value => typeof value === 'number' && Number.isFinite(value);

export function environmentTracks(grid, candidate, light, context = {}) {
  const environment = candidate.environment, observation = context.observation;
  const make = (key, values, source, options = {}) => ({key, values, source,
    label: definitions[key][0], unit: definitions[key][1], digits: definitions[key][2], span: definitions[key][3],
    active: context.coverage ? context.coverage.active.includes(names[key]) : observation ? (context.weights?.[key] ?? 1)>0 : true, ...options});
  const elevation=make('elevation',Float32Array.from(candidate.path,(_,i)=>grid.height&&grid.cols&&grid.rows
    ?elevationAt(grid,pathXY(grid,candidate,i)):NaN),`当前路线真实高程 · 原始网格 ${grid.step??'未知'} m · 沿路采样，不使用三维垂直夸张`,{active:true});
  const withElevation=tracks=>[elevation,...tracks];
  if (environment?.kind === 'regional') return withElevation(['thermal','pressure','inertia','uv'].map(key => make(key,
    environment.values[key], key === 'thermal' || key === 'pressure' ? 'OpenMARS 再分析 · 源网格 5° · 空间插值'
      : key === 'inertia' ? `TES 夜侧观测 · 源网格 ${context.coverage?.thermalSpacing || '未知'}°`
        : '太阳几何 + DEM · 固定场景模型',
    {model:key !== 'inertia', step:key === 'inertia', flags:key === 'inertia' ? environment.interpolated : null})));
  const lit = Float32Array.from(candidate.path, index => Number(isLit(grid,light,index)));
  if (observation) {
    const constant = value => new Float32Array(candidate.path.length).fill(finite(value) ? value : NaN);
    return withElevation([
      make('thermal',constant(observation.groundLongwaveWm2),'MEDA 历史点测 · 沿路引用同一读数',
        {label:'地表长波辐照',unit:'W/m²',model:true,reference:true,uncertainty:observation.groundLongwaveUncertaintyWm2}),
      make('pressure',constant(observation.pressurePa),'MEDA 历史点测 · 沿路引用同一读数',{model:true,reference:true}),
      make('uv',constant(observation.uvWm2),'MEDA 历史点测 · 不代表各路段实测',
        {label:'紫外观测参考',unit:'W/m²',digits:4,span:0.005,model:true,reference:true}),
      make('light',lit,'太阳位置观测 + DEM · 地形遮挡模型',{step:true,model:true}),
    ]);
  }
  return withElevation([make('terrain',Float32Array.from(candidate.path,index=>grid.slope[index]),'当前路线高程包 · 网格坡度'),
    make('light',lit,'太阳几何 + DEM · 地形遮挡模型',{step:true,model:true})]);
}

export function minuteAtDistance(candidate, distance) {
  const value = Math.max(0,Math.min(candidate.distance,distance));
  let lo=0,hi=candidate.lengths.length-1;
  while(lo<hi) { const mid=(lo+hi)>>>1; if(candidate.lengths[mid]<value) lo=mid+1; else hi=mid; }
  if(!lo) return candidate.times[0];
  const a=lo-1,b=lo,span=candidate.lengths[b]-candidate.lengths[a];
  return candidate.times[a]+(candidate.times[b]-candidate.times[a])*(span ? (value-candidate.lengths[a])/span : 0);
}

export function trackAtMinute(track,candidate,minute) {
  const time=Math.max(0,Math.min(candidate.minutes,minute));
  let lo=0,hi=candidate.times.length-1;
  while(lo+1<hi) { const mid=(lo+hi)>>>1; if(candidate.times[mid]<=time) lo=mid; else hi=mid; }
  const ratio=candidate.times[hi]>candidate.times[lo] ? (time-candidate.times[lo])/(candidate.times[hi]-candidate.times[lo]) : 0;
  const a=track.values?.[lo],b=track.values?.[hi];
  let value;
  if(ratio<=1e-9) value=a; else if(ratio>=1-1e-9) value=b;
  else if(track.step) value=ratio<0.5?a:b;
  else value=finite(a)&&finite(b)?a+(b-a)*ratio:NaN;
  return {value:finite(value)?value:null, interpolated:Boolean(track.flags?.[lo]||track.flags?.[hi])};
}

export function trackSegments(track, maxPoints=500) {
  const runs=[]; let run=null;
  for(let i=1;i<(track.values?.length??0);i++) {
    if(!finite(track.values[i-1])||!finite(track.values[i])) { run=null; continue; }
    const estimated=Boolean(track.model||track.flags?.[i-1]||track.flags?.[i]);
    if(!run||run.estimated!==estimated) { run={estimated,indices:[i-1]}; runs.push(run); }
    run.indices.push(i);
  }
  return runs.map(run=>{
    if(run.indices.length<=maxPoints) return run;
    const kept=new Set([run.indices[0],run.indices.at(-1)]),size=Math.ceil(run.indices.length/(maxPoints/3));
    for(let start=0;start<run.indices.length;start+=size) {
      const bucket=run.indices.slice(start,start+size);
      kept.add(bucket[0]);
      kept.add(bucket.reduce((a,b)=>track.values[a]<track.values[b]?a:b));
      kept.add(bucket.reduce((a,b)=>track.values[a]>track.values[b]?a:b));
    }
    return {...run,indices:[...kept].sort((a,b)=>a-b)};
  });
}

export function routeValueColor(value,min,max,key,minimumSpan=1) {
  if(!finite(value)||!finite(min)||!finite(max)) return '#9c9b9c';
  if(key==='light') return value>=0.5?'#ffd575':'#aa9bff';
  const ratio=Math.max(0,Math.min(1,(value-(min+max)/2)/Math.max(max-min,minimumSpan)+0.5));
  return `hsl(${220-189*ratio} 85% 67%)`;
}

const node=(name,className,text)=>{const el=document.createElement(name);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};
const svgNode=(name,attrs)=>{const el=document.createElementNS('http://www.w3.org/2000/svg',name);for(const [k,v]of Object.entries(attrs))el.setAttribute(k,v);return el;};
const format=(track,value)=>value===null||!finite(value)?'缺测':track.key==='light'?(value>=0.5?'日照':'阴影'):`${value.toFixed(track.digits)} ${track.unit}`;

export class EnvironmentPanel {
  constructor(host,hud,coverage,{seek,layer}) {
    Object.assign(this,{host,hud,coverage,seek,layer});
    this.observer=new ResizeObserver(()=>{
      if(!this.candidate||Math.round(host.clientWidth)===this.width)return;
      const minute=this.minute,position=this.currentPosition,selected=this.currentLayer;
      this.set(...this.inputs);if(position)this.update(minute,position,selected);
    });
    this.observer.observe(host);
  }
  clear() {this.host.hidden=true;this.hud.hidden=true;this.coverage.replaceChildren();this.candidate=null;}
  set(grid,candidate,light,context,allowedLayers) {
    this.inputs=[grid,candidate,light,context,allowedLayers];
    this.candidate=candidate;this.tracks=environmentTracks(grid,candidate,light,context);this.rows=[];
    this.host.replaceChildren();this.coverage.replaceChildren();this.hud.replaceChildren();
    this.host.hidden=false;this.hud.hidden=false;
    this.width=Math.round(this.host.clientWidth);
    const chartWidth=Math.max(260,this.width-28),plotWidth=chartWidth-70;
    const heading=node('div','env-heading');heading.append(node('h2',null,'高程剖面与沿途环境'));
    this.position=node('output','env-position');heading.append(this.position);this.host.append(heading);
    const snapshot=context.snapshot,observation=context.observation;
    const scene=observation?`MEDA · Sol ${observation.sol} · ${observation.localTrueSolarTime} LTST · 历史测站参考`
      :snapshot?`OpenMARS · MY ${snapshot.year} · Ls ${snapshot.ls.toFixed(2)}° · 固定气候快照`:'所选太阳时与地形模拟';
    this.host.append(node('p','muted',scene),node('p','muted','点击曲线联动地图和三维位置；聚焦曲线后可用方向键。虚线表示模型、插值或沿路引用，空白表示缺测。'));
    this.hud.append(node('p','env-hud-title',observation?'MEDA 历史测站参考 · 非沿途实测':'沿途环境 · 固定场景，非实时'));
    const hudValues=node('div','env-hud-values');this.hud.append(hudValues);
    const charts=node('div','env-charts');this.host.append(charts);
    for(const track of this.tracks) {
      const finiteValues=Array.from(track.values??[]).filter(finite),ratio=(track.values?.length??0)?finiteValues.length/track.values.length:0;
      const section=node('section','env-track');section.dataset.field=track.key;
      const head=node('div','env-track-heading'),button=node('button','env-layer',track.label);
      button.type='button';button.disabled=!allowedLayers.includes(track.key);button.setAttribute('aria-pressed','false');
      button.onclick=()=>this.layer(track.key);
      const output=node('output','env-reading');head.append(button,output);
      section.append(head,node('p','muted',track.source+(finite(track.uncertainty)?` · 原观测不确定度 ±${track.uncertainty.toFixed(2)} ${track.unit}`:'')));
      const chart=svgNode('svg',{viewBox:`0 0 ${chartWidth} 112`,role:'slider',tabindex:'0','aria-label':`沿路线定位 · ${track.label}`,
        'aria-valuemin':'0','aria-valuemax':candidate.distance,'aria-valuenow':'0'});
      const x=i=>54+candidate.lengths[i]/candidate.distance*plotWidth;
      let low=finiteValues.reduce((a,b)=>Math.min(a,b),Infinity),high=finiteValues.reduce((a,b)=>Math.max(a,b),-Infinity);
      if(!finiteValues.length){low=0;high=1;}
      const range=Math.max(high-low,track.span),mid=(low+high)/2;low=mid-range*0.6;high=mid+range*0.6;
      if(track.key==='light'){low=-0.1;high=1.1;}
      const y=v=>12+(high-v)/(high-low)*68;
      for(const value of track.key==='light'?[1,0]:[high,(high+low)/2,low]) {
        chart.append(svgNode('line',{x1:54,x2:chartWidth-16,y1:y(value),y2:y(value),class:'env-grid'}));
        const tick=svgNode('text',{x:48,y:y(value)+4,'text-anchor':'end',class:'env-axis'});
        tick.textContent=track.key==='light'?(value>=0.5?'日照':'阴影'):value.toFixed(track.digits);chart.append(tick);
      }
      for(const run of trackSegments(track)) {
        let d='';for(const [j,i]of run.indices.entries())d+=j?(track.step?`H${x(i)}V${y(track.values[i])}`:`L${x(i)},${y(track.values[i])}`):`M${x(i)},${y(track.values[i])}`;
        chart.append(svgNode('path',{d,fill:'none',class:run.estimated?'env-line env-estimated':'env-line'}));
      }
      if(!finiteValues.length) { const label=svgNode('text',{x:chartWidth/2,y:48,'text-anchor':'middle',class:'env-axis'});label.textContent='这一段缺少可用数据';chart.append(label); }
      for(const f of [0,0.5,1]) {
        const tick=svgNode('text',{x:54+f*plotWidth,y:104,'text-anchor':f===0?'start':f===1?'end':'middle',class:'env-axis'});
        tick.textContent=(candidate.distance*f/1000).toFixed(2)+' km';chart.append(tick);
      }
      const cursor=svgNode('line',{x1:54,x2:54,y1:6,y2:84,class:'env-cursor'});chart.append(cursor);
      const tooltip=node('output','env-tooltip');tooltip.hidden=true;
      const distanceAt=e=>Math.max(0,Math.min(1,((e.clientX-chart.getBoundingClientRect().left)/chart.getBoundingClientRect().width*chartWidth-54)/plotWidth))*candidate.distance;
      chart.onclick=e=>this.seek(minuteAtDistance(candidate,distanceAt(e)));
      chart.onpointermove=e=>{const distance=distanceAt(e),sample=trackAtMinute(track,candidate,minuteAtDistance(candidate,distance));tooltip.textContent=`${(distance/1000).toFixed(2)} km · ${format(track,sample.value)}${sample.interpolated?' · TES 插值':''}`;tooltip.hidden=false;};
      chart.onpointerleave=()=>{tooltip.hidden=true;};
      chart.onkeydown=e=>{
        const delta=e.shiftKey?0.1:0.01;
        const fraction=e.key==='Home'?0:e.key==='End'?1:e.key==='ArrowRight'?(this.distance/candidate.distance+delta):e.key==='ArrowLeft'?(this.distance/candidate.distance-delta):null;
        if(fraction===null)return;e.preventDefault();this.seek(minuteAtDistance(candidate,Math.max(0,Math.min(1,fraction))*candidate.distance));
      };
      section.append(chart,tooltip);charts.append(section);
      const availability=track.reference ? (finiteValues.length?'历史测站参考已载入 · 沿路复用同一读数':'历史观测缺失') : `${Math.round(ratio*100)}% 沿路采样可用`;
      const quality=node('p','env-quality',`${availability} · ${track.key==='elevation'?'真实地形与高差估算':track.active?'参与寻路比较':'未启用该项权重'}`);
      if(track.key==='inertia'&&finite(candidate.environment?.interpolatedPercent))quality.append(` · ${candidate.environment.interpolatedPercent.toFixed(0)}% 行进时间使用插值`);
      section.append(quality);
      const coverage=node('div','env-coverage-row');coverage.append(node('strong',null,track.label),node('span','muted',`${track.reference?'单点历史参考，非沿途实测':Math.round(ratio*100)+'% 采样可用'} · ${track.source}`));
      if(!track.reference){const meter=node('div','env-meter'),bar=node('span');bar.style.width=`${ratio*100}%`;meter.append(bar);coverage.append(meter);}
      this.coverage.append(coverage);
      const hud=node('div');hud.append(node('span',null,track.label));const hudOutput=node('strong');hud.append(hudOutput);hudValues.append(hud);
      this.rows.push({track,output,cursor,chart,button,hudOutput,plotWidth});
    }
    const sun=light?.sun;
    if(sun)this.host.append(node('p','muted',`太阳方位 ${sun.azimuth.toFixed(1)}° · 仰角 ${sun.elevation.toFixed(1)}° · 当前日照条件在本次比较中固定。`));
    this.host.append(node('p','muted','曲线为沿路采样，不提高原始数据精度。历史观测与再分析均非实时传感器读数；太阳辐照与紫外参考不等同于电离辐射剂量。'));
  }
  update(minute,position,selectedLayer) {
    if(!this.candidate)return;
    this.minute=minute;this.currentPosition=position;this.currentLayer=selectedLayer;
    this.distance=position.distance;
    this.position.textContent=`${(position.distance/1000).toFixed(2)} / ${(this.candidate.distance/1000).toFixed(2)} km · 模拟第 ${minute.toFixed(1)} 分钟`;
    for(const row of this.rows) {
      const x=54+position.distance/this.candidate.distance*row.plotWidth;
      const sample=trackAtMinute(row.track,this.candidate,minute),text=format(row.track,sample.value);
      row.output.textContent=text+(sample.interpolated?' · 插值':'');row.hudOutput.textContent=text;
      row.cursor.setAttribute('x1',x);row.cursor.setAttribute('x2',x);
      row.chart.setAttribute('aria-valuenow',position.distance);row.chart.setAttribute('aria-valuetext',`${(position.distance/1000).toFixed(2)} 公里 · ${text}`);
      row.button.setAttribute('aria-pressed',String(selectedLayer===row.track.key));
    }
  }
}
