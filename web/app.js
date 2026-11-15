import { MissionMap, profileChart } from './map.js';
import { queryOfficial } from './official.js';
import { canAnimateRoute, cellOf, cellXY, decodeTerrain, geographic, indexOf, isLit, progressAt, SOL_RATIO } from './planner.js';
import { missionData } from './mission-data.js';

const $ = id => document.getElementById(id);
const layerLabels = { optical: '正射影像', elevation: '高程', slope: '坡度', thermal: '热红外', light: '地形阴影', geology: '地质' };
const profileLabels = { time: '时间优先', terrain: '坡度优先', light: '光照优先' };
const state = { generation: 0, planningId: 0, queryId: 0, closures: [], complete: [], mode: 'idle',
  localization: { status: 'UNINITIALIZED', source: '未初始化', cell: null, confidence: null, updated: null } };
const map = new MissionMap($('map'), pickPoint);
let worker = createPlanner();
const dataUrl = id => `assets/${id}`;
const compass = ([lon, lat]) => `${lon.toFixed(5)}°E, ${Math.abs(lat).toFixed(5)}°${lat < 0 ? 'S' : 'N'}`;
const distance = meters => meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${meters.toFixed(0)} m`;
const minute = value => `${value.toFixed(1)} 分钟`;
const isSame = (a, b) => !!(a && b && a[0] === b[0] && a[1] === b[1]);

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(text, action, className) {
  const node = el('button', text, className);
  node.type = 'button'; node.onclick = action;
  return node;
}

function link(text, url) {
  const node = el('a', text);
  node.href = url; node.target = '_blank'; node.rel = 'noreferrer';
  return node;
}

async function get(url, type) {
  const response = await fetch(url);
  if (!response.ok) throw Error(`读取 ${url} 失败（HTTP ${response.status}）`);
  return response[type]();
}

const localizationLabels = {
  UNINITIALIZED: '未初始化',
  FIXED: '已定位',
  DEAD_RECKONING: '里程计估计',
  RELOCALIZATION: '重新定位中',
  SAFE_STOP: '安全停车',
};

function renderMissionData() {
  const root = $('mission-data');
  if (!root || !state.site) return;
  const available = layer => {
    if (['terrain', 'optical', 'thermal', 'geology'].includes(layer.id)) return true;
    if (layer.id === 'atmosphere') return Boolean(state.site.meda);
    return false;
  };
  root.replaceChildren(...missionData.map(layer => {
    const item = el('article', null, 'mission-data-item');
    const heading = el('div', null, 'mission-data-heading');
    heading.append(el('strong', layer.name), el('span', available(layer) ? '已接入' : '待栅格化',
      available(layer) ? 'data-ready' : 'data-pending'));
    item.append(heading, el('p', layer.role, 'muted'), link('官方数据 ↗', layer.source));
    return item;
  }));
  const ready = missionData.filter(available).length;
  $('mission-data-note').textContent = `当前区域有 ${ready} 类数据可用于背景或规划；光谱、辐射等未栅格化数据不会进入 A* 代价面。`;
}

function resetLocalization() {
  state.localization = { status: 'UNINITIALIZED', source: '未初始化', cell: null, confidence: null, updated: null };
  renderLocalization();
}

function renderLocalization() {
  const localization = state.localization ?? {};
  const status = $('localization-status');
  const detail = $('localization-detail');
  if (!status || !detail) return;
  status.textContent = localizationLabels[localization.status] ?? localization.status ?? '未初始化';
  if (localization.status === 'FIXED') {
    const coordinate = localization.cell && state.site ? compass(geographic(state.site, cellXY(state.site, localization.cell))) : '—';
    detail.textContent = `${coordinate} · ${localization.source} · ${localization.confidence} · ${localization.updated}`;
  } else {
    detail.textContent = '开始导航演示时会使用所选出发地初始化模拟位置，也可手动初始化。';
  }
  $('localize-start').disabled = !state.start || Boolean(state.nav);
  $('localize-now').disabled = !state.start && !state.progress?.cell;
}

function initializeLocalization() {
  if (!state.start || !state.site) {
    $('pick-hint').textContent = '请先在地图上选择出发地。';
    return;
  }
  state.localization = {
    status: 'FIXED',
    source: '已知起点 + 地图锚点（演示）',
    cell: state.start,
    confidence: `地图网格 ${state.site.step} m，未测量实际定位误差`,
    updated: '当前任务时刻',
  };
  renderLocalization();
  if (state.nav) $('nav-notice').textContent = '已用已知地形锚点更新当前位置。';
}

function relocalize() {
  const cell = state.progress?.cell ?? state.start;
  if (!cell || !state.site) return;
  state.localization = {
    status: 'FIXED',
    source: '局部视觉/地形匹配（模拟）',
    cell,
    confidence: `地图网格 ${state.site.step} m，未测量实际定位误差`,
    updated: '刚刚',
  };
  renderLocalization();
  if (state.nav) {
    $('nav-notice').textContent = '已完成模拟地形重定位，可从当前点继续或重新规划。';
    updateNavigation();
  }
}


function invalidate() {
  state.planningId++;
  state.onPlan = null;
  state.current = null;
  state.candidates = [];
  state.diagnostics = [];
  state.reportRoute = null;
  $('compute').disabled = !state.site?.height || !state.start || !state.stops?.length;
  $('compute').textContent = '计算路线 ↗';
  $('plan-error').textContent = '';
  renderRoutes(); redraw();
}

async function loadSite(site) {
  const generation = ++state.generation;
  $('area').value = site.id;
  $('atlas-link').href = `atlas.html?area=${site.id}`;
  endNavigation();
  Object.assign(state, { site, start: null, stops: [], light: null, closures: [], complete: [], mode: 'idle', preset: false });
  resetLocalization();
  $('map-title').textContent = site.name;
  $('map-caption').textContent = site.regional ? 'Jezero 陨石坑及周边 · 半径 40 km' : `Jezero 局部步行区 · ${distance(site.rows * site.step)} × ${distance(site.cols * site.step)}`;
  $('grid-detail').textContent = `${site.step} m / 格`;
  $('scope-note').textContent = site.regional ? '区域导航使用 100 m 地形作粗略估时与三维预演，不能识别米级障碍；未计入休息和生命支持消耗。可进入步行区查看 1 m 地形。' : '原型按地形和模拟时间计算。碎石、沙地承载力、实时天气、辐射与生命支持待核验。';
  $('roundtrip-field').hidden = false;
  $('roundtrip').checked = !site.regional;
  $('preset').disabled = true;
  $('start-nav').hidden = false;
  $('pick-hint').textContent = '正在读取地形网格…';
  $('official-results').hidden = true;
  $('live-query').disabled = true;
  $('roundtrip').disabled = false;
  state.queryId++;
  map.setSite(site);
  renderLayers(); renderSettings(); renderSources(); renderEvidence(); renderMissionData(); renderSciencePoints(); renderLocalization(); renderSelections(); invalidate();
  try {
    const [height, slope] = await Promise.all([get(`${dataUrl(site.id)}/elevation.bin`, 'arrayBuffer'), get(`${dataUrl(site.id)}/slope.bin`, 'arrayBuffer')]);
    if (generation !== state.generation) return;
    state.site = decodeTerrain(site, height, slope);
    worker ??= createPlanner();
    worker.postMessage({ type: 'terrain', site, height, slope }, [height, slope]);
    $('preset').disabled = false;
    loadPreset();
  } catch (error) {
    if (generation === state.generation) $('pick-hint').textContent = error.message;
  }
}

function renderSettings() {
  const site = state.site;
  const root = $('settings'); root.replaceChildren();
  const controls = [['坡度上限（°）', 'slope-limit', site.regional ? 25 : 18, 5, 30], ['基础步速（米/分）', 'speed', 15, 5, 40],
    ['总预算（分钟）', 'budget', site.budget ?? 480, 10, site.regional ? 20160 : 600],
    ['返航预留（分钟）', 'reserve', site.regional ? 60 : 8, 0, site.regional ? 1440 : 180]];
  for (const [label, id, value, min, max] of controls) {
    const field = el('label', label), input = el('input');
    input.type = 'number'; input.id = id; input.min = min; input.max = max; input.value = value; input.step = 1;
    input.addEventListener('input', invalidate);
    field.append(input); root.append(field);
  }
  if (!site.regional) {
    for (const [label, id, entries] of [
      ['出发时刻 · 火星当地真太阳时', 'hour', [[9.5, '09:30'], [6.75, '06:45'], [12, '12:00'], [17.25, '17:15'], [20, '20:00']]],
      ['模拟季节 · 太阳黄经 Ls', 'season', [[0, '0° · 北半球春分'], [90, '90° · 北半球夏至'], [180, '180° · 北半球秋分'], [270, '270° · 北半球冬至']]],
    ]) {
      const field = el('label', label), select = el('select'); select.id = id;
      for (const [value, text] of entries) { const option = el('option', text); option.value = value; select.append(option); }
      select.onchange = () => { state.light = null; invalidate(); if (state.start && state.stops.length) calculate(); };
      field.append(select); root.append(field);
    }
    root.append(el('p', '步速随沿线高差调整。光照使用规划时刻的地形阴影，途中重算会更新时刻。', 'parameter-note'));
  } else root.append(el('p', '区域用时按所设步速与沿途高差粗略估算，不包含休息或生命支持条件；区域光照未建模。区域动画支持超限参考回放。', 'parameter-note'));
}

function renderLayers() {
  const layers = [...state.site.layers, ...state.site.regional ? [] : ['light']];
  $('layers').replaceChildren(...layers.map(layer => {
    const control = button(layerLabels[layer], () => {
      if (!state.nav) show2D();
      map.setLayer(layer);
      renderLayers();
      if (layer === 'light' && !state.light && state.start && state.stops.length && !state.nav) calculate();
    });
    control.setAttribute('aria-pressed', map.layer === layer);
    return control;
  }));
  $('geology-key').hidden = map.layer !== 'geology';
  if (state.site.units) $('geology-key').replaceChildren(...state.site.units.map(([name, color]) => {
    const swatch = el('span', null, 'swatch'); swatch.style.backgroundColor = `#${color}`;
    const entry = el('span'); entry.append(swatch, name); return entry;
  }));
  const description = {
    optical: state.site.regional ? 'NASA Mars Trek · CTX' : 'HiRISE · 地理配准正射',
    elevation: `${state.site.depth.min.toFixed(0)} 至 ${state.site.depth.max.toFixed(0)} m · 火星高程`,
    slope: '0–35° 色阶 · 亮色表示陡坡', thermal: 'THEMIS · 100 m · 相对红外强度',
    light: state.light ? `深色为模型阴影 · 太阳高度 ${state.light.sun.elevation.toFixed(1)}°` : '按所选火星时刻计算地形阴影',
    geology: `SIM 3464 · 图中约 ${state.site.coverage.geology?.toFixed(1)}% 有地质分类`,
  };
  $('map-legend').textContent = description[map.layer];
}

function loadPreset() {
  const site = state.site;
  state.start = site.base;
  resetLocalization();
  state.stops = site.targets.slice(0, site.regional ? 1 : 2).map(target => ({ cell: target.cell, name: target.name, minutes: site.regional ? 0 : 12 }));
  state.closures = [];
  state.preset = !site.regional;
  state.queryId++;
  $('official-results').hidden = true;
  $('roundtrip').checked = !site.regional;
  setMode('idle'); renderSelections(); calculate();
}

function setMode(mode) {
  state.mode = mode;
  $('pick-start').setAttribute('aria-pressed', mode === 'start');
  $('pick-goal').setAttribute('aria-pressed', mode === 'goal');
  $('add-waypoint').setAttribute('aria-pressed', mode === 'waypoint');
  $('map').classList.toggle('selecting', mode !== 'idle');
  $('pick-hint').textContent = { start: '在地图上点击出发地。', goal: '在地图上点击目的地（保留已有经停点）。', waypoint: '在地图上点击新增经停点，它会插入目的地之前。',
    idle: state.site?.regional ? '点击步行区标记进入局部地图，或选择出发地和目的地。' : '可改选任意有高程覆盖的网格。' }[mode];
  if (mode !== 'idle') {
    $('map').focus({ preventScroll: true });
    if (window.innerWidth < 641) $('map').scrollIntoView({ block: 'center' });
  }
}

function pickPoint(cell, xy) {
  if (state.nav || !state.site?.height) return;
  if (state.mode === 'idle') {
    if (state.site.regional) {
      const target = state.site.targets.find(item => {
        const center = cellXY(state.site, item.cell);
        return Math.hypot(xy[0] - center[0], xy[1] - center[1]) < 14 / map.scale;
      });
      if (target) loadSite(state.sites.find(site => site.id === target.site));
    }
    return;
  }
  const i = indexOf(state.site, cell);
  if (!Number.isFinite(state.site.height[i])) { $('pick-hint').textContent = '这个位置没有高程数据。请在地图覆盖内重新选点。'; return; }
  if (!Number.isFinite(state.site.slope[i])) { $('pick-hint').textContent = '这个位置没有有效坡度数据，请重新选点。'; return; }
  if (state.site.slope[i] > Number($('slope-limit').value)) {
    $('plan-error').textContent = `所选点坡度 ${state.site.slope[i].toFixed(1)}° 超过上限，将显示超限诊断与参考估算。`;
  }
  const picked = state.mode;
  if (picked === 'start') {
    if (state.stops.some(stop => isSame(stop.cell, cell))) { $('pick-hint').textContent = '出发地和目的地需要分开。'; return; }
    state.start = cell;
    resetLocalization();
  } else if (picked === 'waypoint') {
    if (isSame(state.start, cell) || state.stops.some(stop => isSame(stop.cell, cell))) {
      $('pick-hint').textContent = '经停点需要与出发地、目的地及已有经停点分开。'; return;
    }
    state.waypointSerial = (state.waypointSerial ?? 0) + 1;
    state.stops.splice(-1, 0, { cell, name: `经停点 ${state.waypointSerial}`, minutes: 0 });
    state.preset = false;
  } else {
    if (isSame(state.start, cell)) { $('pick-hint').textContent = '出发地和目的地需要分开。'; return; }
    if (state.stops.slice(0, -1).some(stop => isSame(stop.cell, cell))) { $('pick-hint').textContent = '目的地需要与经停点分开。'; return; }
    state.stops = [...state.stops.slice(0, -1), { cell, name: '自选目的地', minutes: 0 }];
    state.preset = false;
  }
  setMode(picked === 'start' && !state.stops.length ? 'goal' : 'idle');
  state.queryId++;
  $('official-results').hidden = true;
  renderSelections();
  if (state.start && state.stops.length) calculate(); else invalidate();
}

function renderSelections() {
  const display = cell => compass(geographic(state.site, cellXY(state.site, cell)));
  const ready = Boolean(state.site?.height);
  $('pick-start').disabled = $('pick-goal').disabled = !ready || Boolean(state.nav);
  $('start-coord').textContent = state.start ? display(state.start) : '点击后在地图选点';
  $('goal-coord').textContent = state.stops.length ? display(state.stops.at(-1).cell) : '点击后在地图选点';
  $('live-query').disabled = !ready || !(state.stops.length || state.start);
  $('swap-points').disabled = !ready || Boolean(state.nav) || !state.start || state.stops.length !== 1;
  $('swap-points').title = state.stops.length > 1 ? '交换适用于单一起点和目的地；多站任务请先选一个目的地。' : '';
  $('clear-plan').disabled = !ready;
  $('add-waypoint').disabled = !ready || Boolean(state.nav) || !state.start || !state.stops.length;
  renderWaypoints();
}

function updateStops() {
  state.preset = false;
  state.queryId++; $('official-results').hidden = true;
  setMode('idle'); renderSelections();
  if (state.start && state.stops.length) calculate(); else invalidate();
}

function renderWaypoints() {
  const waypoints = state.stops.slice(0, -1);
  $('waypoint-count').textContent = String(waypoints.length);
  $('waypoint-list').replaceChildren(...waypoints.map((stop, index) => {
    const item = el('li', null, 'waypoint-item');
    item.append(el('strong', `${index + 1}. ${stop.name}`), el('small', compass(geographic(state.site, cellXY(state.site, stop.cell))), 'muted'));
    const controls = el('div', null, 'waypoint-controls'), label = el('label', '停留（分钟）'), input = el('input');
    input.type = 'number'; input.min = 0; input.max = 180; input.step = 1; input.value = stop.minutes;
    input.setAttribute('aria-label', `经停点 ${index + 1} 停留分钟`); input.disabled = Boolean(state.nav);
    input.oninput = () => { state.stops[index].minutes = Number(input.value); state.preset = false; invalidate(); };
    input.onchange = () => { if (input.value && input.checkValidity()) calculate(); };
    label.append(input); controls.append(label);
    for (const [title, delta] of [['上移', -1], ['下移', 1]]) {
      const move = button(title, () => {
        const other = index + delta;
        [state.stops[index], state.stops[other]] = [state.stops[other], state.stops[index]];
        updateStops();
      });
      move.setAttribute('aria-label', `${title}经停点 ${index + 1}`);
      move.disabled = Boolean(state.nav) || index + delta < 0 || index + delta >= waypoints.length;
      controls.append(move);
    }
    const remove = button('删除', () => { state.stops.splice(index, 1); updateStops(); });
    remove.setAttribute('aria-label', `删除经停点 ${index + 1}`); remove.disabled = Boolean(state.nav);
    controls.append(remove); item.append(controls); return item;
  }));
}

function clearPlan() {
  endNavigation();
  worker?.terminate(); worker = null;
  map.cursor = null;
  state.queryId++;
  Object.assign(state, { start: null, stops: [], inputRoute: null, progress: null, closures: [], complete: [], preset: false, waypointSerial: 0 });
  resetLocalization();
  $('official-results').hidden = true;
  invalidate(); renderSelections(); setMode('start');
  $('pick-hint').textContent = '已清空起终点、路线和封路，规划参数已保留。请在地图上选择新的出发地。';
}

function swapPoints() {
  if (state.nav || !state.start || state.stops.length !== 1) return;
  const previous = state.start;
  state.start = state.stops[0].cell;
  state.stops = [{ cell: previous, name: '原出发地', minutes: 0 }];
  state.preset = false; state.closures = [];
  state.queryId++; $('official-results').hidden = true;
  resetLocalization(); setMode('idle'); renderSelections(); calculate();
}

function readRoute() {
  const regional = state.site.regional;
  const inputs = [...$('settings').querySelectorAll('input[type=number]'), ...$('waypoint-list').querySelectorAll('input[type=number]')];
  const invalid = inputs.filter(input => !input.value || !input.checkValidity());
  if (invalid.length) throw Error(invalid.map(input => `${input.getAttribute('aria-label') ?? input.parentElement.firstChild.textContent}须为 ${input.min}–${input.max} 范围内的有效整数。`).join(' '));
  const route = { start: state.start, stops: state.stops, base: state.start, closures: state.closures,
    mode: $('planning-method').value, diagnose: true,
    limit: +$('slope-limit').value, speed: +$('speed').value,
    budget: +$('budget').value, reserve: +$('reserve').value, regionalNavigation: Boolean(regional),
    returnToBase: $('roundtrip').checked, allowSingleStop: state.preset && $('roundtrip').checked && state.stops.length > 1 };
  return route;
}

function requestPlan(route, onResult, hourOffset = 0) {
  if (!worker) {
    worker = createPlanner();
    worker.postMessage({ type: 'terrain', site: state.site });
  }
  const id = ++state.planningId;
  state.reportRoute = route;
  const localHour = Number($('hour')?.value ?? 12);
  state.onPlan = onResult;
  worker.postMessage({ id, route, hour: (localHour + hourOffset / (60 * SOL_RATIO)) % 24, season: +($('season')?.value ?? 0) });
}

function createPlanner() {
  const planner = new Worker(new URL('./planner-worker.js', import.meta.url), { type: 'module' });
  planner.onmessage = ({ data }) => {
    if (data.id !== state.planningId) return;
    state.light = data.light ?? state.light;
    const callback = state.onPlan;
    state.onPlan = null;
    callback?.(data);
    renderLayers();
  };
  planner.onerror = event => {
    event.preventDefault();
    if (planner !== worker) return;
    planner.terminate(); worker = null;
    const callback = state.onPlan;
    state.onPlan = null;
    callback?.({ candidates: [], error: '规划程序中断。请点击计算路线重试。' });
    $('compute').disabled = Boolean(state.nav) || !state.site?.height || !state.start || !state.stops?.length;
    $('compute').textContent = '重试计算路线 ↗';
    $('plan-error').textContent = '规划程序中断。请点击计算路线重试。';
  };
  return planner;
}

function preferredProfile() {
  try { return localStorage.getItem('mars-pathfinder-profile'); } catch { return null; }
}

function recommended(candidates) {
  const valid = candidates.filter(c => c.feasible && c.pareto);
  const preferred = preferredProfile();
  return valid.find(c => c.profiles.includes(preferred)) || valid[0] || candidates.find(c => c.feasible) || candidates[0];
}

function calculate() {
  if (!state.site?.height || !state.start || !state.stops?.length || state.nav) return;
  invalidate();
  try {
    const route = readRoute();
    state.inputRoute = route;
    $('compute').disabled = true;
    $('compute').textContent = '正在计算…';
    $('plan-error').textContent = '正在计算路线…';
    requestPlan(route, result => {
      $('compute').disabled = false;
      $('compute').textContent = '重新计算路线 ↗';
      state.completedPlans = (state.completedPlans ?? 0) + 1;
      const completed = `第 ${state.completedPlans} 次计算完成：${result.candidates.length} 条候选路线。`;
      $('plan-error').textContent = `${completed}${result.error ?? '可选择方案并播放导航动画。'}`;
      state.candidates = result.candidates;
      state.diagnostics = result.diagnostics ?? [];
      state.current = recommended(result.candidates);
      if (state.current?.shortened) $('plan-error').textContent = `${completed}双站任务在当前限制下不可行，推荐先访问 ${state.current.shortened}。`;
      else if (state.current && !state.current.feasible) $('plan-error').textContent = `${completed}${result.error ? result.error + ' ' : ''}所选路线有 ${state.current.violations.length} 项指标不满足限制，详情见路线方案。`;
      renderRoutes(); redraw();
    });
  } catch (error) { $('compute').disabled = false; $('compute').textContent = '重新计算路线 ↗'; $('plan-error').textContent = error.message; }
}

function describe(candidate) {
  return `${state.site.regional ? '区域路线 · ' : ''}${candidate.profiles.map(key => profileLabels[key]).join(' / ')}`;
}

function renderRoutes() {
  const root = $('routes');
  const { site, candidates = [], current, nav } = state;
  renderSciencePoints();
  renderRouteReport();
  $('route-count').textContent = candidates.length ? `${candidates.length} 条` : '';
  $('start-nav').disabled = !canAnimateRoute(current, state.inputRoute, site) || Boolean(nav);
  $('start-nav').replaceChildren(site?.regional ? '播放区域 3D 导航动画 →' : state.inputRoute?.mode === 'estimate' ? '播放反算导航动画 →' : '开始导航演示 →');
  $('export-route').hidden = !current || Boolean(nav);
  $('export-route').disabled = $('export-route').hidden;
  if (!candidates.length) { root.replaceChildren(el('p', '选取起终点后可比较候选路线。', 'muted')); return; }
  root.replaceChildren(...candidates.map(candidate => {
    const control = button(null, () => { state.current = candidate; renderRoutes(); redraw(); }, 'route-row');
    control.disabled = Boolean(nav);
    control.setAttribute('aria-pressed', candidate === current);
    const first = el('span', null, 'route-top'), summary = el('small', null, 'metric-line');
    const variant = candidate.shortened ? ` · ${candidate.shortened}` : '';
    first.append(el('strong', `${candidate.estimated ? '参考估算 · ' : ''}${describe(candidate)}${variant}`), el('span', site.regional ? `约 ${(candidate.minutes / 60).toFixed(1)} 小时` : minute(candidate.minutes), 'route-time'));
    summary.append(el('span', `${distance(candidate.distance)} · 陡坡 ${distance(candidate.steep)}${site.regional ? '' : ` · 阴影 ${distance(candidate.shadow)}`}`));
    {
      summary.append(el('span', candidate.feasible ? `余 ${candidate.margin.toFixed(1)} 分` : `${candidate.violations?.length ?? 1} 项超限`, `route-margin${candidate.feasible ? '' : ' late'}`));
      control.append(first, summary, el('small', `累计爬升 ${distance(candidate.ascent)} · 最大坡度 ${candidate.maxSlope.toFixed(1)}°${candidate.pareto ? ' · 权衡方案' : ''}`));
    }
    return control;
  }));
  if (!nav && !site.regional && current) {
    root.append(button('记住此类路线', () => {
      try {
        localStorage.setItem('mars-pathfinder-profile', current.profiles[0]);
        $('plan-error').textContent = `已在此浏览器保存「${profileLabels[current.profiles[0]]}」偏好。推荐仍受路线约束。`;
        renderRoutes();
      } catch { $('plan-error').textContent = '浏览器未授权保存偏好。'; }
    }, 'text-button'));
    if (preferredProfile()) root.append(button('清除偏好', () => {
      localStorage.removeItem('mars-pathfinder-profile'); $('plan-error').textContent = '已清除路线偏好。'; renderRoutes();
    }, 'text-button'));
  }
}

function violationText(item) {
  if (item.code === 'RESERVE') return `返航预留不足：任务后剩余 ${item.actual.toFixed(1)} 分钟，要求至少 ${item.limit.toFixed(1)} 分钟，缺少 ${item.excess.toFixed(1)} 分钟。`;
  return `${item.metric}：估算 ${item.actual.toFixed(1)} ${item.unit}，上限 ${item.limit.toFixed(1)} ${item.unit}，超出 ${item.excess.toFixed(1)} ${item.unit}。`;
}

function renderRouteReport() {
  const plan = state.current, route = state.reportRoute ?? state.inputRoute, site = state.site;
  const diagnostics = $('route-diagnostics');
  const messages = [...(state.diagnostics ?? [])];
  if (plan) {
    messages.push(...(plan.violations ?? []).map(violationText));
    if (plan.estimated) messages.push('参考估算保留有效地形与封路约束，未强制满足所设坡度。此路线指标代表一个候选方案，并非全区域所需条件的理论最小值。');
    if (!plan.feasible) messages.push(route?.mode === 'estimate' || site?.regional
      ? '可播放此路线的参考动画；动画会保留全部超限提示，不代表路线满足当前限制。'
      : '调整限制后可开始导航，或切换按起终点反算播放参考动画。');
  }
  diagnostics.replaceChildren(...messages.map(message => el('p', message)));
  $('route-report').hidden = !plan;
  $('export-samples').disabled = !plan || Boolean(state.nav);
  if (!plan || !route) { $('route-metrics').replaceChildren(); return; }
  const scienceTime = plan.minutes - plan.movingMinutes;
  const returnVisit = plan.visits.find(visit => visit.returnLeg);
  const startHeight = site.height[plan.path[0]], endHeight = site.height[plan.path.at(-1)];
  const rows = [['计算结果', plan.feasible ? '满足当前限制' : '参考路线，存在超限'],
    ['路线总长', distance(plan.distance)], [site.regional ? '粗略估时 / 行走 / 停留' : '总用时 / 行走 / 停留', `${minute(plan.minutes)} / ${minute(plan.movingMinutes)} / ${minute(scienceTime)}`],
    ['去程含停留 / 返程时间', returnVisit ? `${minute(plan.visits.at(-2)?.leave ?? 0)} / ${minute(returnVisit.arrival - (plan.visits.at(-2)?.leave ?? 0))}` : '单程'],
    ['累计爬升 / 下降', `${distance(plan.ascent)} / ${distance(plan.descent)}`],
    ['起点 / 终点高程', `${startHeight.toFixed(2)} / ${endHeight.toFixed(2)} m`],
    ['任务站高程', plan.visits.filter(visit => !visit.returnLeg).map(visit => `${visit.name} ${site.height[visit.cell].toFixed(2)} m`).join('；') || '—'],
    ['沿途最低 / 最高高程', `${plan.minElevation.toFixed(2)} / ${plan.maxElevation.toFixed(2)} m`],
    ['最大 / 距离加权平均通行坡度', `${plan.maxSlope.toFixed(1)}° / ${plan.averageSlope.toFixed(1)}°`],
    ['陡坡路段（≥12°）', distance(plan.steep)],
    ['模型阴影 / 日照路段', site.regional ? '未计算局部光照' : `${distance(plan.shadow)} / ${distance(plan.distance - plan.shadow)}`],
    ['站点', plan.visits.map(visit => visit.name).join(' → ') || '—'],
    ['基础步速 / 地形格网', `${route.speed} m/分 · ${site.step} m / 格`],
    ['沿线样本数', `${plan.path.length} 个（含停留记录）`]];
  rows.push(['预算 / 返航预留', `${minute(route.budget)} / ${minute(route.reserve)}`],
    ['此路线所需总预算（含预留）', minute(plan.minutes + route.reserve)],
    ['完成后可留时间 / 扣除预留后余量', `${minute(route.budget - plan.minutes)} / ${minute(plan.margin)}`]);
  $('route-metrics').replaceChildren(...rows.flatMap(([label, value]) => [el('dt', label), el('dd', value)]));
}

function downloadText(contents, filename, type) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const download = el('a'); download.href = url; download.download = filename; download.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function exportSamples() {
  const { current: plan, site } = state;
  if (!plan || state.nav) return;
  const rows = [['sample', 'row', 'col', 'longitude_deg_E', 'latitude_deg_N', 'elevation_m', 'cell_slope_deg', 'elapsed_min', 'distance_m', 'modeled_sunlit', 'station', 'constraint_status']];
  plan.path.forEach((index, i) => {
    const cell = cellOf(site, index), coordinate = geographic(site, cellXY(site, cell));
    rows.push([i, ...cell, ...coordinate, site.height[index], site.slope[index], plan.times[i], plan.lengths[i],
      state.light ? Number(isLit(site, state.light, index)) : '', plan.visits.filter(visit => visit.cell === index).map(visit => visit.name).join(';'), plan.feasible ? 'within_limits' : 'reference_exceeds_limits']);
  });
  const quote = value => `"${String(value).replaceAll('"', '""')}"`;
  downloadText('\uFEFF' + rows.map(row => row.map(quote).join(',')).join('\r\n'), `${site.id}-route-samples.csv`, 'text/csv;charset=UTF-8');
}

function exportRoute() {
  const { current, site, inputRoute, nav } = state;
  if (!current || nav) return;
  const card = document.implementation.createHTMLDocument('Mars Pathfinder AI · 任务卡');
  card.documentElement.lang = 'zh-CN';
  const style = el('style', 'body{font:14px/1.45 system-ui,sans-serif;margin:24px auto;width:min(96%,720px);color:#211b18}h1{font-size:24px;margin:0}h2{font-size:16px;margin:12px 0 4px}p,li{margin:3px 0}img{max-width:100%;display:block;margin:8px auto;max-height:280px}a{color:#844c2c}@media print{body{margin:0;width:100%}img{max-height:235px}}');
  const viewport = el('meta'); viewport.name = 'viewport'; viewport.content = 'width=device-width, initial-scale=1';
  card.head.append(viewport, style);
  const start = compass(geographic(site, cellXY(site, inputRoute.start)));
  const legs = el('ol');
  for (const leg of current.visits) {
    const coordinate = compass(geographic(site, cellXY(site, cellOf(site, leg.cell))));
    legs.append(el('li', `${leg.name} · ${coordinate} · 到达 ${minute(leg.arrival)}${leg.science ? ` · 停留 ${minute(leg.leave - leg.arrival)}` : ''}`));
  }
  const conditions = `预算 ${minute(inputRoute.budget)}，预留 ${minute(inputRoute.reserve)}，坡度上限 ${inputRoute.limit}°，基础步速 ${inputRoute.speed} m/min。`;
  const metrics = `${distance(current.distance)} · 预计 ${minute(current.minutes)} · 陡坡 ${distance(current.steep)} · 阴影 ${distance(current.shadow)} · 扣除预留 ${current.feasible ? '剩余' : '仍差'} ${minute(Math.abs(current.margin))}`;
  card.body.append(el('h1', `${site.name} · 火星步行任务卡`), el('p', `OrionX · ${describe(current)} · 模拟出舱`), el('p', metrics),
    el('h2', '路线与约束'), el('p', `出发地 ${start}`), legs, el('p', conditions),
    el('p', site.regional ? '100 m 区域地形粗略估时；区域光照未建模。' : `火星当地真太阳时 ${$('hour').selectedOptions[0].textContent} · 太阳黄经 ${$('season').value}°。`));
  for (const [id, title] of [['map', '二维路线'], ['profile', '高程剖面']]) {
    const picture = el('img'); picture.src = $(id).toDataURL('image/png'); picture.alt = title;
    card.body.append(picture);
  }
  card.body.append(el('h2', '数据与局限'), el('p', $('scope-note').textContent));
  card.body.append(el('h2', '完整指标与限制核对'), $('route-metrics').cloneNode(true), $('route-diagnostics').cloneNode(true));
  if (!current.feasible) card.body.append(el('p', '此卡为超限参考估算，不可作为满足当前约束的导航方案。'));
  const sources = el('p');
  for (const [name, url] of Object.entries(site.sources)) sources.append(link(name, url), ' · ');
  sources.append('OrionX'); card.body.append(sources);
  const url = URL.createObjectURL(new Blob(['<!doctype html>\n', card.documentElement.outerHTML], { type: 'text/html;charset=UTF-8' }));
  const download = el('a'); download.href = url; download.download = `${site.id}-marswalk.html`;
  download.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function redraw() {
  if (!state.site) return;
  const shownStops = state.current?.shortened ? state.stops.filter(stop => stop.name === state.current.shortened) : state.stops;
  map.data = { start: state.start, stops: shownStops, closures: state.closures, plan: state.current, light: state.light, progress: state.progress };
  map.draw();
  profileChart($('profile'), state.site, state.current, state.progress);
}

function renderSciencePoints() {
  const root = $('science-points');
  if (!root || !state.site) return;
  const targets = (state.site.targets ?? []).filter(target => target.task || target.reference || target.image);
  $('science-point-count').textContent = targets.length ? `${targets.length} 个` : '';
  if (!targets.length) {
    root.replaceChildren(el('p', '当前区域暂无带 NASA/PDS 证据的局部科学点。', 'muted'));
    return;
  }
  const visited = new Set((state.current?.visits ?? []).map(visit => visit.name));
  root.replaceChildren(...targets.map(target => {
    const card = el('article', null, 'science-point');
    const heading = el('div', null, 'science-point-heading');
    const included = visited.has(target.name);
    heading.append(el('strong', target.name), el('span', included ? '路线已纳入' : '候选点',
      included ? 'data-ready' : 'data-pending'));
    const xy = target.reference ?? cellXY(state.site, target.cell);
    card.append(heading, el('p', `${compass(geographic(state.site, xy))} · ${target.task ?? 'NASA 观测目标'}`, 'muted'));
    if (target.credit) card.append(el('p', target.credit, 'muted'));
    const actions = el('div', null, 'science-point-actions');
    if (target.url) actions.append(link('NASA/PDS 证据 ↗', target.url));
    const choose = button('设为目的地', () => {
      if (!state.site.height) {
        $('pick-hint').textContent = '地形仍在读取，请稍后再选择科学点。';
        return;
      }
      if (!state.start) { state.start = state.site.base; resetLocalization(); }
      if (isSame(state.start, target.cell) || state.stops.slice(0, -1).some(stop => isSame(stop.cell, target.cell))) {
        $('pick-hint').textContent = '该科学点已是出发地或经停点，请选择其他目的地。'; return;
      }
      state.stops = [...state.stops.slice(0, -1), { cell: target.cell, name: target.name, minutes: 12 }];
      state.preset = false;
      setMode('idle');
      state.queryId++;
      $('official-results').hidden = true;
      renderSelections();
      calculate();
    }, 'text-button');
    choose.disabled = Boolean(state.nav);
    actions.append(choose);
    const via = button('添加为经停点', () => {
      if (!state.start || !state.stops.length || !state.site.height) return;
      if (isSame(state.start, target.cell) || state.stops.some(stop => isSame(stop.cell, target.cell))) {
        $('pick-hint').textContent = '该科学点已在当前任务中，请勿重复添加。'; return;
      }
      state.stops.splice(-1, 0, { cell: target.cell, name: target.name, minutes: 12 });
      updateStops();
    }, 'text-button');
    via.disabled = Boolean(state.nav) || !state.site.height || !state.start || !state.stops.length;
    actions.append(via);
    card.append(actions);
    return card;
  }));
}

function renderSources() {
  const { site, catalog } = state;
  $('source-note').textContent = `${site.note} 已核对 ${site.hashes} 个源文件的 SHA‑256。`;
  const root = $('source-grid');
  const coverage = `${site.coverage.elevation.toFixed(1)}% 高程 · ${site.coverage.optical.toFixed(1)}% 光学 · ${site.coverage.thermal.toFixed(1)}% 红外有效覆盖`;
  const overview = el('article', null, 'source-card');
  overview.append(el('h3', '当前数据覆盖'), el('p', coverage, 'muted'), el('p', `归档 ${catalog.archiveCount} 个毅力号点位 · 至 Sol ${catalog.archiveSol}`, 'muted'));
  if (site.coverage.geology !== undefined) overview.append(el('p', `${site.coverage.geology.toFixed(1)}% 已标注地质单元`, 'muted'));
  root.replaceChildren(overview, ...Object.entries(site.sources).map(([title, url]) => {
    const card = el('article', null, 'source-card'); card.append(el('h3', title), link('打开原始资料 ↗', url)); return card;
  }));
  if (site.meda) {
    const card = el('article', null, 'source-card');
    card.append(el('h3', '毅力号 MEDA 历史观测'), el('p', `Sol 518 的 20 条归档样本 · 气温 ${site.meda.air_k} K · 气压 ${site.meda.pressure_pa} Pa`, 'muted'),
      el('p', '样本均值用于现场背景。', 'muted'));
    root.append(card);
  }
}

function renderEvidence() {
  const site = state.site;
  $('evidence').hidden = Boolean(site.regional);
  $('cards').replaceChildren(...site.targets.filter(t => t.image).map(target => {
    const card = el('article', null, 'science-card'), img = el('img');
    img.src = `${dataUrl(site.id)}/${target.image}`; img.alt = target.name; img.loading = 'lazy';
    card.append(el('h3', target.name), el('p', target.task, 'muted'), img,
      el('p', `${target.credit} · 火星车参考点与模拟停靠点相距 ${target.offset.toFixed(1)} m`, 'muted'), link('NASA 原始观测 ↗', target.url));
    return card;
  }));
  if (site.gallery) {
    const card = el('article', null, 'science-card'), img = el('img');
    img.src = `${dataUrl(site.id)}/${site.gallery.image}`; img.alt = 'Hawksbill Gap 任务区域的毅力号 Mastcam-Z 影像'; img.loading = 'lazy';
    card.append(el('h3', 'Hawksbill Gap 现场原始图'), el('p', '提供同一区域的近地视角。', 'muted'), img,
      el('p', site.gallery.credit, 'muted'), link('打开毅力号影像图库条目 ↗', site.gallery.url));
    $('cards').append(card);
  }
}

async function runOfficialQuery() {
  const { site, stops, start } = state;
  const point = stops.at(-1)?.cell ?? start;
  if (!point) return;
  const id = ++state.queryId, xyz = geographic(site, cellXY(site, point));
  const box = $('official-results');
  $('live-query').disabled = true;
  box.hidden = false; box.replaceChildren(el('p', `正在查询 ${compass(xyz)} 的官方资料…`));
  try {
    const report = await queryOfficial(site, xyz);
    if (id !== state.queryId) return;
    box.replaceChildren(el('h3', `选点 ${compass(xyz)}`));
    function row(title, data, url, format) {
      const line = el('p');
      line.append(el('strong', `${title} · `), data.status === 'fulfilled' ? format(data.value) : '接口暂不可用。', ' ', link('原始响应 ↗', url));
      box.append(line);
    }
    row('NASA Mars Trek', report.tile, report.tileUrl, t => t.visible ? `已读 ${t.size.join(' × ')} 影像瓦片。` : '瓦片透明，此层在选点无覆盖。');
    if (report.tile.value?.visible) {
      const img = el('img'); img.alt = '选点所在的 Mars Trek 官方影像瓦片'; img.src = report.tileUrl; box.append(img);
    }
    row('USGS SIM 3464', report.geology, report.geologyUrl, t => t.length ? `${report.radius} m 方框半宽内的地质单元 · ${t.join('、')}` : '该范围无返回的地质单元。');
    row('NASA 毅力号定位', report.rover, report.roverUrl, ({ nearest, archived }) => nearest
      ? `${archived ? '官方归档回退 · ' : '已读取在线记录 · '}最近航点 Sol ${nearest.sol}（${nearest.rmc}），距选点 ${distance(nearest.distance)}。`
      : '未返回可用航点。');
  } catch (error) {
    if (id === state.queryId) box.replaceChildren(el('p', error.message));
  } finally { if (id === state.queryId) $('live-query').disabled = false; }
}

function setPlanningEnabled(enabled) {
  for (const control of [...$('settings').querySelectorAll('input, select'), $('preset'), $('roundtrip'), $('planning-method')]) control.disabled = !enabled;
  $('compute').disabled = !enabled || !state.start || !state.stops?.length;
  renderSelections();
  renderLocalization();
}

function show2D() {
  $('terrain').hidden = true; $('map').hidden = false;
  document.querySelector('.map-tools').hidden = false;
  $('camera').hidden = true; $('view-toggle').textContent = '打开三维';
  redraw();
}

async function show3D(nav) {
  const notice = $('terrain-fallback');
  notice.hidden = true;
  try {
    const { TerrainView } = await import('./terrain-view.js');
    if (nav !== state.nav) return;
    $('terrain').hidden = false; $('map').hidden = true;
    document.querySelector('.map-tools').hidden = true;
    if (!nav.view) {
      nav.view = new TerrainView($('terrain'), state.site, state.current);
      nav.view.setFollow(true);
    }
    $('view-toggle').textContent = '返回二维'; $('camera').hidden = false;
    nav.view.update(state.progress, state.light);
    if (window.innerWidth < 641) $('terrain').scrollIntoView({ block: 'center' });
  } catch {
    if (nav !== state.nav) return;
    show2D();
    notice.textContent = '当前浏览器无法渲染三维地形。二维导航和高程剖面可继续使用。'; notice.hidden = false;
  }
}

function beginNavigation() {
  if (!canAnimateRoute(state.current, state.inputRoute, state.site)) return;
  if (state.localization?.status !== 'FIXED') {
    initializeLocalization();
  }
  setMode('idle');
  const route = state.inputRoute;
  const nav = { time: 0, elapsed: 0, playing: true, base: state.start, route, preview: route.mode === 'estimate' || Boolean(state.site.regional),
    label: state.site.regional ? '区域地形参考模拟' : '反算参考模拟',
    rate: state.site.regional ? Math.max(2, state.current.minutes / 60) : 2, replanning: false, done: false };
  state.nav = nav;
  $('navigation').hidden = false; $('view-tools').hidden = false;
  $('nav-notice').textContent = '模拟回放 · 已用所选出发地初始化位置 · 时间加速。';
  $('nav-title').textContent = state.site.regional ? '区域导航动画（100 m 地形参考）' : nav.preview ? '反算导航动画（参考模拟）' : '模拟导航';
  if (state.site.regional) $('nav-notice').textContent = '100 m 区域地形参考回放，约 60 秒播放完整行程；画面时间加速不改变估算用时。';
  $('camera').textContent = '俯瞰全区';
  setPlanningEnabled(false); renderRoutes(); updateNavigation(); show3D(nav);
  nav.frame = requestAnimationFrame(tick);
}

function tick(timestamp) {
  const nav = state.nav;
  if (!nav) return;
  const dt = nav.last == null ? 0 : Math.min(0.1, (timestamp - nav.last) / 1000);
  nav.last = timestamp;
  if (nav.playing && !nav.replanning && !nav.done && !nav.blocked) {
    nav.time = Math.min(state.current.minutes, nav.time + dt * nav.rate);
    if (nav.time >= state.current.minutes) { nav.done = true; nav.playing = false; }
    updateNavigation();
  }
  nav.frame = requestAnimationFrame(tick);
}

function updateNavigation() {
  const nav = state.nav, plan = state.current;
  state.progress = progressAt(state.site, plan, nav.time);
  const due = plan.visits.find(stop => stop.leave > nav.time);
  const totalTime = nav.elapsed + nav.time;
  const location = compass(geographic(state.site, state.progress.xy));
  const violations = plan.violations ?? [];
  $('simulation-label').hidden = !nav.preview;
  $('simulation-label').textContent = `${nav.label}${violations.length ? ` · ${violations.length} 项超限` : ''}`;
  $('nav-warning').hidden = !nav.preview;
  $('nav-warning').textContent = nav.preview ? `${nav.label}。${violations.length ? violations.map(violationText).join(' ') : '当前方案满足所设限制。'}${state.site.regional ? '100 m 网格不能识别米级障碍，用时为粗略估算。' : '动画基于地图与模拟时间。'}` : '';
  const status = nav.blocked ? '路线暂停，等待返航或结束回放' : nav.done ? (plan.visits.at(-1)?.returnLeg ? '已抵达基地' : '已抵达目的地')
    : state.progress.visit ? `正在观察 ${state.progress.visit.name}` : `下一站 ${due?.name ?? '终点'}`;
  $('nav-progress').textContent = `${status} · ${location} · 已用 ${minute(totalTime)} · ${plan.margin >= 0 ? '完成路线后余量' : '预计超出可用预算'} ${minute(Math.abs(plan.margin))}`;
  $('timeline').value = Math.round(nav.time / plan.minutes * 1000);
  $('timeline').disabled = nav.replanning || Boolean(nav.blocked);
  $('pause').textContent = nav.playing ? '暂停' : '继续';
  $('pause').disabled = nav.done || nav.replanning || Boolean(nav.blocked);
  $('closure').disabled = nav.done || nav.replanning || Boolean(nav.blocked);
  $('return').disabled = nav.replanning || isSame(state.progress.cell, nav.base);
  nav.view?.update(state.progress, state.light);
  redraw();
}

function endNavigation() {
  if (!state.nav) return;
  const nav = state.nav;
  state.planningId++;
  state.onPlan = null;
  cancelAnimationFrame(nav.frame);
  nav.view?.destroy();
  state.nav = null; state.progress = null; state.closures = [];
  $('navigation').hidden = true; $('view-tools').hidden = true; $('terrain-fallback').hidden = true;
  $('simulation-label').hidden = true; $('nav-warning').hidden = true;
  show2D(); setPlanningEnabled(true); renderRoutes();
}

function replan(returnOnly) {
  const nav = state.nav, old = state.current;
  if (!nav || nav.replanning) return;
  if (state.localization?.status !== 'FIXED') {
    $('nav-notice').textContent = '当前定位不可用，请先完成地形重定位。';
    return;
  }
  const now = nav.elapsed + nav.time, oldRemaining = old.minutes - nav.time, start = state.progress.cell;
  let closures = [...state.closures];
  if (!returnOnly) {
    const ahead = old.path.find((cell, i) => i >= state.progress.index && old.lengths[i] >= state.progress.distance + 18);
    if (ahead == null) { $('nav-notice').textContent = '离路线终点不足 18 米，无法在前方放置模拟封路。'; return; }
    const closure = cellOf(state.site, ahead);
    const points = [start, nav.base, ...old.visits.map(stop => cellOf(state.site, stop.cell))];
    if (points.some(cell => Math.hypot(cell[0] - closure[0], cell[1] - closure[1]) * state.site.step <= 8)) {
      $('nav-notice').textContent = '前方封路会覆盖当前位置、基地或任务点。可继续回放后重试。'; return;
    }
    closures.push({ cell: closure, radius: 7 });
  }
  const stops = old.visits.filter(v => !v.returnLeg && v.leave > nav.time).map(v => ({
    cell: cellOf(state.site, v.cell), name: v.name, minutes: Math.min(v.leave - v.arrival, v.leave - nav.time),
  }));
  const route = { ...nav.route, start, base: nav.base, stops: returnOnly ? [] : stops,
    budget: nav.route.budget - now, returnToBase: returnOnly || nav.route.returnToBase,
    returnOnly, closures, allowSingleStop: false, mode: nav.preview ? 'estimate' : 'constrained', diagnose: false };
  const desired = old.profiles[0];
  nav.playing = false; nav.replanning = true;
  $('nav-notice').textContent = returnOnly ? '从当前位置计算返航路线…' : '加入前方封路，从当前位置重新规划…';
  updateNavigation();
  function apply(result, returning) {
    const viable = nav.preview ? result.candidates : result.candidates.filter(candidate => candidate.feasible);
    const next = viable.find(candidate => candidate.profiles.includes(desired)) || viable[0] || (returning && result.candidates[0]);
    if (!next && !returning && !isSame(start, nav.base)) {
      requestPlan({ ...route, stops: [], returnToBase: true, returnOnly: true }, response => apply(response, true), now);
      return;
    }
    nav.replanning = false;
    state.closures = closures;
    if (!next) {
      nav.done = false; nav.blocked = true;
      $('nav-notice').textContent = result.error ?? '剩余预算下暂无可行路线。已暂停模拟。';
      show2D(); updateNavigation(); return;
    }
    state.current = next; state.candidates = [next];
    nav.elapsed = now; nav.time = 0; nav.done = false; nav.blocked = !nav.preview && !next.feasible; nav.playing = nav.preview || next.feasible;
    nav.view?.setPlan(next);
    $('nav-notice').textContent = nav.preview || next.feasible
      ? `${nav.preview ? '参考模拟 · ' : ''}${returning ? '返航' : '绕行'}已重算 · 从当前点还有 ${distance(next.distance)} · 原路线剩余 ${minute(oldRemaining)}，新路线预计 ${minute(next.minutes)}。`
      : `已找到返航路径。扣除预留后仍差 ${minute(-next.margin)}，模拟暂停。`;
    renderRoutes(); updateNavigation();
  }
  requestPlan(route, result => apply(result, returnOnly), now);
}

function bindControls() {
  $('area').onchange = event => loadSite(state.sites.find(site => site.id === event.target.value));
  $('preset').onclick = loadPreset;
  $('pick-start').onclick = () => setMode('start');
  $('pick-goal').onclick = () => setMode('goal');
  $('add-waypoint').onclick = () => setMode(state.mode === 'waypoint' ? 'idle' : 'waypoint');
  $('compute').onclick = calculate;
  $('clear-plan').onclick = clearPlan;
  $('swap-points').onclick = swapPoints;
  $('export-samples').onclick = exportSamples;
  $('planning-method').onchange = () => {
    $('method-note').textContent = $('planning-method').value === 'estimate'
      ? '先按起终点估算候选路线、时间与全部沿线指标，再逐项核对当前坡度、预算和返航预留。'
      : '在坡度限制内比较路线，并检查时间预算与返航预留。';
    if (state.start && state.stops.length) calculate(); else invalidate();
  };
  $('roundtrip').onchange = calculate;
  $('show-rover').onchange = event => { map.rover = event.target.checked; map.draw(); };
  $('zoom-in').onclick = () => map.zoom(1.45);
  $('zoom-out').onclick = () => map.zoom(1 / 1.45);
  $('zoom-reset').onclick = () => map.zoom(1);
  $('start-nav').onclick = beginNavigation;
  $('localize-start').onclick = initializeLocalization;
  $('localize-now').onclick = relocalize;
  $('export-route').onclick = exportRoute;
  $('stop-nav').onclick = () => { endNavigation(); calculate(); };
  $('pause').onclick = () => { state.nav.playing = !state.nav.playing; updateNavigation(); };
  $('timeline').oninput = event => {
    if (state.nav.replanning || state.nav.blocked) return;
    state.nav.time = Number(event.target.value) / 1000 * state.current.minutes;
    state.nav.done = state.nav.time >= state.current.minutes;
    state.nav.playing = false; updateNavigation();
  };
  $('return').onclick = () => replan(true);
  $('closure').onclick = () => replan(false);
  $('camera').onclick = () => {
    const view = state.nav.view; view.setFollow(!view.follow);
    $('camera').textContent = view.follow ? '俯瞰全区' : '跟随队员';
  };
  $('view-toggle').onclick = () => $('terrain').hidden ? show3D(state.nav) : show2D();
  $('live-query').onclick = runOfficialQuery;
  new ResizeObserver(redraw).observe($('profile'));
}

async function init() {
  bindControls();
  state.catalog = await get('assets/sites.json', 'json');
  state.sites = state.catalog.sites;
  $('area').replaceChildren(...state.sites.map(site => { const option = el('option', site.name); option.value = site.id; return option; }));
  $('area').disabled = false;
  const requested = new URLSearchParams(location.search).get('area');
  await loadSite(state.sites.find(site => site.id === requested) ?? state.sites[1]);
}

init().catch(error => { $('pick-hint').textContent = error.message; });

