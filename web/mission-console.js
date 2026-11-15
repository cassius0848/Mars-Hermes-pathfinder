import { t as uiText } from './locale.js';
import { RESOURCE_TYPES, resourceReadings, routeQuality, validateResources } from './mission-operations.js';
import { saveOfflineTask, downloadFile } from './offline-task.js';
import { regionalCatalog, medaCatalog, missionEnvironment } from './mission-context-data.js';

const $=id=>document.getElementById(id);
const node=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
const load=key=>{try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}};
const save=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{}};
const field=(text,input)=>{const label=node('label',text);label.append(input);return label;};
function number(id,value,min,max,step='any') {const input=node('input');Object.assign(input,{id,type:'number',value,min,max,step});return input;}
function select(id,options) {const input=node('select');input.id=id;for(const [value,label]of options){const o=node('option',label);o.value=value;input.append(o);}return input;}
const numeric=id=>{const input=$(id);if(!input||input.value===''||!input.checkValidity())throw Error(uiText("请修正科学任务、资源或状态更新中的数值。"));return input.valueAsNumber;};
const keyFor=(site,name)=>`mars-field:${site.id}:${name}`;

export class MissionConsole {
  constructor({state,invalidate,onEvent,restore}) {
    Object.assign(this,{state,invalidate,onEvent,restore});this.host=$('operations-settings');
    this.host.innerHTML=uiText("<summary>科学目标、环境与资源</summary><div id=\"ops-config\" class=\"ops-config\"></div>");
    $('ops-import').onchange=async event=>{try{const file=event.target.files[0];if(!file)return;if(file.size>4*1048576)throw Error(uiText("任务文件过大。"));await restore(JSON.parse(await file.text()));$('ops-transfer-status').textContent=uiText("任务与现场记录已恢复，并重新核对路线。");}catch(error){$('ops-transfer-status').textContent=error.message;}finally{event.target.value='';}};
    $('ops-export-json').onclick=()=>{try{downloadFile(new Blob([JSON.stringify(this.snapshot(),null,2)],{type:'application/json'}),'mars-task.json');}catch(error){$('ops-transfer-status').textContent=error.message;}};
    $('ops-offline').onclick=async()=>{
      const button=$('ops-offline');button.disabled=true;
      try{await saveOfflineTask(this.site.id,this.snapshot(),text=>$('ops-transfer-status').textContent=text);}
      catch(error){$('ops-transfer-status').textContent=error.message;}
      finally{button.disabled=false;}
    };
    const events=$('ops-event-fields');
    events.append(field(uiText("新增停留（分）"),number('ops-delay',0,0,240)),field(uiText("更新步速（米/分，留空保留）"),number('ops-new-speed','',1,100)),
      field(uiText("当前模拟太阳时（小时，留空保留）"),number('ops-new-hour','',0,24)));
    for(const r of RESOURCE_TYPES)events.append(field(uiText("当前剩余{0}（{1}，留空按模型）", [r.label, r.unit]),number(`ops-remaining-${r.id}`,'',0,1e9)));
    $('ops-apply-event').onclick=()=>{
      try{const remaining={};for(const r of RESOURCE_TYPES)if($(`ops-remaining-${r.id}`).value!=='')remaining[r.id]=numeric(`ops-remaining-${r.id}`);
        const change={delay:numeric('ops-delay'),speed:$('ops-new-speed').value===''?null:numeric('ops-new-speed'),hour:$('ops-new-hour').value===''?null:numeric('ops-new-hour'),remaining};
        onEvent(change);$('ops-event-status').textContent=uiText("状态更新已提交，正在核对剩余任务与返航。");
      }catch(error){$('ops-event-status').textContent=error.message;}
    };
  }
  isAutomatic(){return Boolean($('ops-auto')?.checked&&!$('ops-auto').disabled);}
  setSite(site) {
    const {invalidate}=this;
    this.site=site;this.lastResult=null;this.context={};this.decision=null;
    const root=$('ops-config');root.replaceChildren();
    const auto=node('input');auto.type='checkbox';auto.id='ops-auto';auto.disabled=Boolean(site.regional);
    root.append(field(uiText("按科学目标自动选站与排序"),auto),node('p',uiText("自动模式保留出发地和返航点，重新生成经停站；必去点不能被预算或其他站点替代。支持最多 4 个已登记科学点。"),'muted'));
    root.append(field(uiText("研究问题"),select('ops-objective',[
      [uiText("比较岩石纹理与层理"),uiText("比较岩石纹理与层理")],[uiText("观察含水蚀变与矿物证据"),uiText("观察含水蚀变与矿物证据")],[uiText("记录地形与通行条件"),uiText("记录地形与通行条件")]])));
    const targets=(site.targets??[]).filter(t=>t.task||t.image||t.reference);
    this.targets=targets;
    for(const [i,target]of targets.entries()){
      const row=node('div',undefined,'ops-target');row.append(node('strong',target.name),
        field(uiText("站点要求"),select(`ops-target-${i}`, [['optional',uiText("可选")],['required',uiText("必去")],['ignore',uiText("不纳入自动任务")]])),
        field(uiText("用户优先级 1–5"),number(`ops-priority-${i}`,3,1,5,1)),field(uiText("观察停留（分）"),number(`ops-dwell-${i}`,12,0,180,1)));
      root.append(row);
    }
    if(site.regional)root.append(node('p',uiText("区域图提供走廊筛查；进入米级任务区后可按真实科学点自动选站。"),'muted'));
    root.append(node('p',uiText("科学分数来自用户优先级，用于候选任务权衡，不是 NASA 对站点的科学价值评级。"),'muted'));
    const scene=select('ops-scene',[['terrain',uiText("地形与自选太阳时")],['regional',uiText("TES / OpenMARS 区域快照")],...(site.id==='hawksbill'?[['meda',uiText("MEDA 历史测站参考")]]:[])]);
    this.sceneIds={};
    root.append(field(uiText("环境情景"),scene),field(uiText("观测 / 快照"),select('ops-snapshot',[])));
    const weightBox=node('div',undefined,'ops-grid');
    for(const [id,label,value]of [['terrain',uiText("坡度"),2],['light',uiText("阴影"),2],['thermal',uiText("温度 / 长波"),3],['inertia',uiText("热惯量"),3],['uv',uiText("太阳辐照 / UV"),1],['pressure',uiText("气压差"),0]])weightBox.append(field(uiText("{0}权重 0–5", [label]),number(`ops-weight-${id}`,value,0,5)));
    root.append(weightBox,node('p',uiText("区域温度/气压为 5° 再分析网格，TES 为原始区域观测；MEDA 为单点历史参考。曲线和寻路不会提高其空间精度。"),'muted'));
    const sceneStatus=node('p',uiText("仅使用地形与模拟太阳时。"),'muted');sceneStatus.id='ops-scene-status';root.append(sceneStatus);
    scene.onchange=async()=>{await this.refreshScenes();invalidate();};
    const resourceDetails=node('details');resourceDetails.append(node('summary',uiText("氧气、电池、用水和携带负载（估算）")));
    resourceDetails.append(node('p',uiText("未启用的资源显示未评估。容量、行走/作业耗用率和来源由用户提供；演示假设不是 NASA 宇航服规格。"),'muted'));
    for(const r of RESOURCE_TYPES){
      const section=node('fieldset'),enabled=node('input');enabled.type='checkbox';enabled.id=`ops-use-${r.id}`;
      const legend=node('legend');legend.append(field(uiText("评估{0}", [r.label]),enabled));section.append(legend);
      const fields=node('div',undefined,'ops-grid');
      fields.append(field(uiText("容量（{0}）", [r.unit]),number(`ops-cap-${r.id}`,'',0,1e9)),field(uiText("行走耗用（{0}/分）", [r.unit]),number(`ops-travel-${r.id}`,'',0,1e6)),
        field(uiText("作业耗用（{0}/分）", [r.unit]),number(`ops-work-${r.id}`,'',0,1e6)),field(uiText("容量预留（%）"),number(`ops-reserve-${r.id}`,10,0,99)));
      const source=node('input');source.type='text';source.id=`ops-source-${r.id}`;source.maxLength=300;
      section.append(fields,field(uiText("参数来源 / 说明"),source));resourceDetails.append(section);
    }
    const payload=node('div',undefined,'ops-grid');payload.append(field(uiText("携带负载（kg）"),number('ops-load',0,0,100)),field(uiText("每 kg 步速惩罚（%，用户假设）"),number('ops-load-rate',0,0,10)));
    resourceDetails.append(payload,node('p',uiText("有效步速 = 基础步速 ÷（1 + 负载 × 惩罚百分比）。默认惩罚为 0，尚未校准火星宇航服代谢。"),'muted'));
    const demo=node('button',uiText("载入演示假设"));demo.type='button';demo.onclick=()=>{
      for(const r of RESOURCE_TYPES){$(`ops-use-${r.id}`).checked=true;$(`ops-cap-${r.id}`).value=r.id==='water'?1000:100;
        $(`ops-travel-${r.id}`).value=$(`ops-work-${r.id}`).value=r.id==='water'?5:1;$(`ops-source-${r.id}`).value=uiText("团队自定义演示假设，非实测/认证规格");}
      invalidate();
    };resourceDetails.append(demo);root.append(resourceDetails);
    root.oninput=root.onchange=()=>invalidate();
    this.refreshScenes();this.clear();
  }
  async refreshScenes(){
    const site=this.site,kind=$('ops-scene').value,select=$('ops-snapshot');select.replaceChildren();select.disabled=kind==='terrain';
    if(kind==='terrain'){$('ops-scene-status').textContent=uiText("使用地形和任务模拟太阳时；未接入实时天气。");return;}
    try{
      $('ops-scene-status').textContent=uiText("正在读取已归档数据索引…");
      const catalog=kind==='regional'?await regionalCatalog():await medaCatalog();if(this.site!==site||$('ops-scene').value!==kind)return;
      const entries=kind==='regional'?catalog.climate.snapshots.map(s=>[s.id,uiText("MY {0} · Ls {1}° · 0°经线 {2}:00", [s.year, s.ls.toFixed(2), s.primeHour])]):catalog.observations.map(o=>[String(o.sclk),`Sol ${o.sol} · ${o.localTrueSolarTime} LTST`]);
      for(const [id,label]of entries){const o=node('option',label);o.value=id;select.append(o);}
      $('ops-scene-status').textContent=kind==='regional'?uiText("固定历史气候快照参与路径比较；沿途温度、气压和热惯量可联动查看。"):uiText("MEDA 历史测站参考；长波、气压不伪装成沿途实测。");
    }catch(error){$('ops-scene-status').textContent=error.message;}
  }
  read(){
    try{
      const resources=RESOURCE_TYPES.filter(r=>$(`ops-use-${r.id}`).checked).map(r=>({id:r.id,capacity:numeric(`ops-cap-${r.id}`),travelRate:numeric(`ops-travel-${r.id}`),workRate:numeric(`ops-work-${r.id}`),reservePercent:numeric(`ops-reserve-${r.id}`),source:$(`ops-source-${r.id}`).value.trim()}));
      validateResources(resources);
      const targets=this.targets.flatMap((target,i)=>$(`ops-target-${i}`).value==='ignore'?[]:[{...target,priority:numeric(`ops-priority-${i}`),minutes:numeric(`ops-dwell-${i}`),required:$(`ops-target-${i}`).value==='required'}]);
      if(this.isAutomatic()&&!targets.length)throw Error(uiText("请至少纳入一个科学点。"));
      const weights=Object.fromEntries(['terrain','light','thermal','inertia','uv','pressure'].map(k=>[k,numeric(`ops-weight-${k}`)]));
      return {resources,scienceSelection:{enabled:this.isAutomatic(),targets,objective:$('ops-objective').value},
        loadKg:numeric('ops-load'),loadPenalty:numeric('ops-load-rate'),scene:$('ops-scene').value,snapshot:$('ops-snapshot').value,weights,
        lighting:{hour:Number($('hour')?.value??12),season:Number($('season')?.value??0)}};
    }catch(error){this.host.open=true;throw error;}
  }
  environment(config){return missionEnvironment(config.scene,config.snapshot,this.site,config.weights);}
  setLocked(locked){for(const control of this.host.querySelectorAll('input,select,button'))control.disabled=locked; if(!locked){$('ops-auto').disabled=Boolean(this.site.regional);$('ops-snapshot').disabled=$('ops-scene').value==='terrain';}}
  clear(){this.stamp=null;this.lastPlan=null; $('ops-decision').textContent='';$('ops-resource-report').replaceChildren();$('ops-quality').replaceChildren();$('ops-resource-summary').textContent=uiText("计算后显示");}
  result(decision){this.decision=decision;}
  update(plan,route,minute=0,progress){
    if(!plan||!this.site)return;
    const stamp=`${Math.round(minute*10)}:${plan.minutes}:${this.decision?.evaluated}`;if(stamp===this.stamp&&this.lastPlan===plan&&this.lastRoute===route)return;this.stamp=stamp;this.lastPlan=plan;this.lastRoute=route;
    const quality=routeQuality(this.state().site,plan),context=$('ops-quality');
    context.textContent=uiText("{0} · {1} m / 格 · 路线上有效地形 {2}%。{3} 热红外仅作 {4} m 背景，非逐点温度。", [quality.label, quality.terrainSpacing, (quality.terrainCoverage*100).toFixed(0), quality.caveat, this.site.sourceSpacing?.thermal??100]);
    const decision=this.decision;
    $('ops-decision').textContent=decision?uiText("研究问题：{0}。比较 {1} 种站点组合与顺序；推荐用户优先级总分 {2}。{3} {4}", [decision.objective, decision.evaluated, plan.scienceScore, decision.omitted.map(t=>uiText("未纳入 {0}：{1}", [t.name, t.reason])).join(' '), decision.note]):'';
    const report=$('ops-resource-report');report.replaceChildren();
    const usage=resourceReadings(plan,route?.resources??[],minute),demand=plan.resourceUsage??[];
    const exceeded=demand.filter(r=>!r.feasible).length;
    $('ops-resource-summary').textContent=exceeded?uiText("{0} 项资源超限", [exceeded]):usage.length?uiText("{0} 项已按用户模型评估", [usage.length]):uiText("资源未配置");
    if(exceeded)$('ops-budget-details').open=true;
    for(const r of RESOURCE_TYPES){
      const current=usage.find(t=>t.id===r.id),total=demand.find(t=>t.id===r.id),row=node('div',undefined,'ops-resource');
      row.append(node('strong',r.label));
      if(!current)row.append(node('span',uiText("未评估：尚未配置容量与耗用率"),'muted'));
      else {
        row.append(node('span',uiText("已用 {0} / {1} {2} · 当前剩余 {3} · 全程预计 {4} · 预留 {5}", [current.used.toFixed(1), current.capacity.toFixed(1), r.unit, current.remaining.toFixed(1), total?.used.toFixed(1), current.reserve.toFixed(1)])));
        const meter=node('meter');meter.min=0;meter.max=Math.max(1,current.capacity);meter.value=Math.max(0,current.remaining);meter.low=current.reserve;meter.optimum=current.capacity;meter.setAttribute('aria-label',uiText("{0}剩余 {1} {2}", [r.label, current.remaining.toFixed(1), r.unit]));row.append(meter,node('small',current.source,'muted'));
      }
      report.append(row);
    }
    for(const card of document.querySelectorAll('[data-field-target]'))card.classList.toggle('at-station',card.dataset.fieldTarget===progress?.visit?.name);
  }
  appendTask(card,target){
    card.dataset.fieldTarget=target.name;
    const details=node('details'),summary=node('summary',uiText("现场任务卡与记录"));details.append(summary);
    const record=load(keyFor(this.site,target.name))??{status:'pending',note:''};
    if(target.image){const image=node('img');image.src=`assets/${this.site.id}/${target.image}`;image.alt=uiText("{0} NASA 现场观测", [target.name]);image.loading='lazy';image.className='field-image';details.append(image);}
    details.append(node('p',uiText("研究问题：{0}。{1}", [$('ops-objective')?.value??uiText("记录科学证据"), target.task??'']),'muted'),node('p',uiText("记录纹理、层理、颜色、脉体及周边地形；区分直接观察与解释。"),'muted'));
    if(Number.isFinite(target.offset))details.append(node('p',uiText("模拟站与原始证据坐标相距约 {0} m；站点并非实测宇航员定位。", [target.offset.toFixed(1)]),'muted'));
    const state=select('',[['pending',uiText("待观察")],['observed',uiText("已观察")],['sampled',uiText("已采样（用户记录）")],['skipped',uiText("跳过")]]);state.value=record.status;
    const note=node('textarea');note.rows=3;note.maxLength=2000;note.value=record.note;note.placeholder=uiText("观察结果、采样编号或跳过原因");
    const persist=()=>save(keyFor(this.site,target.name),{status:state.value,note:note.value,updatedAt:new Date().toISOString()});
    state.onchange=persist;note.oninput=persist;details.append(field(uiText("执行状态"),state),field(uiText("现场笔记（保存在本机）"),note));card.append(details);
  }
  snapshot(){
    const state=this.state(),records=Object.fromEntries(this.targets.map(t=>[t.name,load(keyFor(this.site,t.name))]));
    const configuration=this.read(),planning=state.inputRoute;
    return {schema:'mars-pathfinder-task/v1',team:'HermesX',siteId:this.site.id,start:state.nav?planning.start:state.start,stops:state.nav?planning.stops:state.stops,
      planning,configuration,scienceDecision:this.decision,records,events:state.events??[],
      navigationReference:state.nav?{elapsed:state.nav.elapsed,segmentMinute:state.nav.time,coordinate:state.progress.xy,note:uiText("导入将重新核验此规划段；此记录不是实时定位，也不会自动续走。")}:undefined,
      referencePlan:state.current?{distance:state.current.distance,minutes:state.current.minutes,path:state.current.path,xy:state.current.xy,times:state.current.times,lengths:state.current.lengths,resourceUsage:state.current.resourceUsage}:null,
      sources:this.site.sources,limits:uiText("历史/模型环境和用户资源假设；非实时遥测与飞行级安全判断。")};
  }
  restoreNotes(records){for(const target of this.targets){const record=records?.[target.name];if(record&&['pending','observed','sampled','skipped'].includes(record.status))save(keyFor(this.site,target.name),{status:record.status,note:String(record.note??'').slice(0,2000),updatedAt:record.updatedAt});}}
  async restoreConfig(config){
    if(!config)return;
    for(const r of validateResources(config.resources??[])){
      $(`ops-use-${r.id}`).checked=true;
      for(const [key,id]of [['capacity','cap'],['travelRate','travel'],['workRate','work'],['reservePercent','reserve']])$(`ops-${id}-${r.id}`).value=r[key];
      $(`ops-source-${r.id}`).value=String(r.source??'').slice(0,300);
    }
    $('ops-load').value=Number(config.loadKg)||0;$('ops-load-rate').value=Number(config.loadPenalty)||0;
    if(config.scienceSelection)$('ops-auto').checked=Boolean(config.scienceSelection.enabled&&!this.site.regional);
    if([...$('ops-objective').options].some(o=>o.value===config.scienceSelection?.objective))$('ops-objective').value=config.scienceSelection.objective;
    for(const [i,target]of this.targets.entries()){
      const targets=config.scienceSelection?.targets;
      const saved=targets?.find(t=>t.cell&&target.cell?t.cell[0]===target.cell[0]&&t.cell[1]===target.cell[1]:t.name===target.name);
      if(!saved){if(Array.isArray(targets))$(`ops-target-${i}`).value='ignore';continue;}
      $(`ops-target-${i}`).value=saved.required?'required':'optional';$(`ops-priority-${i}`).value=saved.priority;$(`ops-dwell-${i}`).value=saved.minutes;
    }
    for(const id of ['hour','season']){
      const control=$(id),value=config.lighting?.[id];
      if(Number.isFinite(value)&&control&&[...control.options].some(o=>Number(o.value)===value))control.value=String(value);
    }
    if([...$('ops-scene').options].some(o=>o.value===config.scene)){
      $('ops-scene').value=config.scene;await this.refreshScenes();
      if([...$('ops-snapshot').options].some(o=>o.value===config.snapshot))$('ops-snapshot').value=config.snapshot;
    }
    for(const key of ['terrain','light','thermal','inertia','uv','pressure'])if(Number.isFinite(config.weights?.[key]))$(`ops-weight-${key}`).value=config.weights[key];
    // Imported coordinates are recalculated; saved reference paths are never trusted as navigation.
  }
}
