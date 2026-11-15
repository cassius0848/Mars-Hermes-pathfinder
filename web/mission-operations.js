import { t as uiText } from './locale.js';
import { planMission } from './planner.js';

export const RESOURCE_TYPES = [
  { id:'oxygen', label:uiText("氧气"), unit:'g' },
  { id:'battery', label:uiText("电池"), unit:'Wh' },
  { id:'water', label:uiText("用水"), unit:'mL' },
];

export function validateResources(resources = []) {
  if (!Array.isArray(resources) || resources.length > RESOURCE_TYPES.length) throw Error(uiText("资源配置格式无效。"));
  const seen = new Set();
  for (const r of resources) {
    if (!RESOURCE_TYPES.some(t=>t.id===r.id) || seen.has(r.id)) throw Error(uiText("资源类别无效或重复。"));
    seen.add(r.id);
    if (![r.capacity,r.travelRate,r.workRate,r.reservePercent].every(Number.isFinite)
      || r.capacity < 0 || r.travelRate < 0 || r.workRate < 0 || r.travelRate+r.workRate <= 0
      || r.reservePercent < 0 || r.reservePercent >= 100 || !Number.isFinite(r.reserveAmount ?? 0) || (r.reserveAmount ?? 0)<0) {
      throw Error(uiText("资源容量、耗用率或预留无效；请提供有单位的非负值和正耗用率。"));
    }
  }
  return resources;
}

// Stop work and travel use separate rates. Return legs already belong to the plan.
export function elapsedWork(plan, minute) {
  const time=Math.max(0,Math.min(plan.minutes,minute));
  const work=plan.visits.reduce((sum,v)=>sum+Math.max(0,Math.min(time,v.leave)-Math.min(time,v.arrival)),0);
  return {work,travel:Math.max(0,time-work)};
}

export function resourceReadings(plan, resources = [], minute = plan.minutes) {
  validateResources(resources);
  const {travel,work}=elapsedWork(plan,minute);
  return resources.map(r=>{
    const definition=RESOURCE_TYPES.find(t=>t.id===r.id);
    const used=travel*r.travelRate+work*r.workRate;
    const reserve=r.reserveAmount ?? r.capacity*r.reservePercent/100;
    return {...definition,used,remaining:r.capacity-used,reserve,capacity:r.capacity,
      feasible:r.capacity-used>=reserve-1e-8,source:r.source || uiText("用户输入，来源未填写")};
  });
}

export function assessResources(plan, resources = []) {
  const usage=resourceReadings(plan,resources);
  const violations=[...(plan.violations ?? [])];
  for(const r of usage) if(!r.feasible) violations.push({code:`RESOURCE_${r.id.toUpperCase()}`,
    metric:uiText("{0}（含预留）", [r.label]),actual:r.used+r.reserve,limit:r.capacity,
    excess:r.used+r.reserve-r.capacity,unit:r.unit});
  return {...plan,resourceUsage:usage,violations,feasible:plan.feasible&&violations.length===0};
}

export function resourcesAfter(resources, plan, minute, delay = 0, overrides = {}) {
  if (!Number.isFinite(delay) || delay<0) throw Error(uiText("新增停留时间必须为非负数。"));
  const current=resourceReadings(plan,resources,minute);
  return resources.map((r,i)=>{
    const remaining=Object.hasOwn(overrides,r.id)?overrides[r.id]:current[i].remaining-delay*r.workRate;
    if(!Number.isFinite(remaining)||remaining<0) throw Error(uiText("{0}已耗尽或更新读数无效，不能按现有资源继续规划。", [current[i].label]));
    // Keep the original absolute reserve instead of shrinking it after every replan.
    return {...r,capacity:remaining,reserveAmount:current[i].reserve};
  });
}

function arrangements(items) {
  if(!items.length)return [[]];
  return items.flatMap((item,i)=>arrangements(items.filter((_,j)=>i!==j)).map(tail=>[item,...tail]));
}

export function planOperations(grid, route, light) {
  validateResources(route.resources);
  if(!route.scienceSelection?.enabled) {
    const result=planMission(grid,route,light);
    return {...result,candidates:result.candidates.map(p=>assessResources(p,route.resources))};
  }
  const targets=route.scienceSelection.targets;
  if(!Array.isArray(targets)||!targets.length||targets.length>4)throw Error(uiText("自动科学选站支持 1–4 个已登记科学点。"));
  if(targets.some(t=>!t.name||!Array.isArray(t.cell)||!Number.isFinite(t.priority)||t.priority<1||t.priority>5
    ||!Number.isFinite(t.minutes)||t.minutes<0||t.minutes>240))throw Error(uiText("请检查科学点优先级和停留时间。"));
  const cells=new Set(targets.map(t=>JSON.stringify(t.cell)));
  if(cells.size!==targets.length)throw Error(uiText("科学点网格不能重复。"));
  const mandatory=targets.reduce((mask,t,i)=>t.required?mask|1<<i:mask,0);
  const feasibleTargets=new Set(),failures=new Map(),best=[];
  let evaluated=0;
  const legCache=new Map();
  for(let mask=1;mask<1<<targets.length;mask++) {
    if((mask&mandatory)!==mandatory)continue;
    for(const stops of arrangements(targets.filter((_,i)=>mask&1<<i))) {
      const attempt=planMission(grid,{...route,stops,legCache,allowSingleStop:false},light);
      evaluated++;
      const candidates=attempt.candidates.map(p=>({...assessResources(p,route.resources),scienceStops:stops,
        scienceScore:stops.reduce((sum,t)=>sum+t.priority,0)}));
      for(const stop of stops) {
        if(candidates.some(p=>p.feasible))feasibleTargets.add(stop.name);
        else if(!failures.has(stop.name))failures.set(stop.name,candidates[0]?.violations.map(v=>v.metric).join('、')||attempt.error||uiText("没有完整通路"));
      }
      best.push(...candidates);
      best.sort((a,b)=>Number(b.feasible)-Number(a.feasible)||b.scienceScore-a.scienceScore||a.minutes-b.minutes||a.maxSlope-b.maxSlope);
      best.splice(6);
    }
  }
  const selected=best[0],visited=new Set(selected?.scienceStops.map(t=>t.name));
  const omitted=targets.filter(t=>!visited.has(t.name)).map(t=>({name:t.name,
    reason:feasibleTargets.has(t.name)?uiText("与其他站点组合后，当前推荐方案的用户优先级总分更高或用时更短。"):failures.get(t.name)||uiText("不满足必去点组合和现有限制。")}));
  const scienceDecision={objective:route.scienceSelection.objective,evaluated,omitted,
    note:uiText("优先级为用户设定，非 NASA 科学评分；比较全部所选站点组合与顺序，以及现有寻路策略，不代表连续地形的全局最优。")};
  if(!selected)return {candidates:[],scienceDecision,error:uiText("必去科学点与有效地形或通行限制不相容，无法生成完整任务。")};
  return {candidates:best,scienceDecision,error:selected.feasible?undefined:uiText("当前必去点、时间或资源限制下没有可执行组合，以下仅为需求参考。")};
}

export function routeQuality(grid, plan) {
  const valid=plan.path.filter(i=>Number.isFinite(grid.height[i])&&Number.isFinite(grid.slope[i])).length;
  return {terrainCoverage:plan.path.length?valid/plan.path.length:0,terrainSpacing:grid.step,
    label:grid.step<=2?uiText("米级地形包"):grid.step<=100?uiText("区域地形网格"):uiText("粗略地形走廊"),
    caveat:uiText("网格间距不等于定位精度；网格以下岩块、承载力与实际定位误差尚未核验。")};
}
