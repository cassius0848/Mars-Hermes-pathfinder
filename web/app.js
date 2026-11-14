import { MissionMap, profileChart } from './map.js';
import { queryOfficial } from './official.js';
import { cellOf, cellXY, decodeTerrain, geographic, indexOf, progressAt, SOL_RATIO } from './planner.js';

const $ = id => document.getElementById(id);
const layerLabels = { optical: '正射影像', elevation: '高程', slope: '坡度', thermal: '热红外', light: '地形阴影', geology: '地质' };
const profileLabels = { time: '时间优先', terrain: '坡度优先', light: '光照优先' };
const state = { generation: 0, planningId: 0, queryId: 0, closures: [], complete: [], mode: 'idle' };
const map = new MissionMap($('map'), pickPoint);
const worker = new Worker(new URL('./planner-worker.js', import.meta.url), { type: 'module' });
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

function invalidate() {
  state.planningId++;
  state.current = null;
  state.candidates = [];
  $('compute').disabled = !state.site?.height || !state.start || !state.stops?.length;
  $('plan-error').textContent = '';
  renderRoutes(); redraw();
}

async function loadSite(site) {
  const generation = ++state.generation;
  $('area').value = site.id;
  endNavigation();
  Object.assign(state, { site, start: null, stops: [], light: null, closures: [], complete: [], mode: 'idle', preset: false });
  $('map-title').textContent = site.name;
  $('map-caption').textContent = site.regional ? 'Jezero 陨石坑及周边 · 半径 40 km' : `Jezero 局部步行区 · ${distance(site.rows * site.step)} × ${distance(site.cols * site.step)}`;
  $('grid-detail').textContent = `${site.step} m / 格`;
  $('scope-note').textContent = site.regional ? '区域走廊用于比较地形。请打开步行区查看导航和三维。' : '原型按地形和模拟时间计算。碎石、沙地承载力、实时天气、辐射与生命支持待核验。';
  $('roundtrip-field').hidden = Boolean(site.regional);
  $('roundtrip').checked = !site.regional;
  $('preset').disabled = true;
  $('start-nav').hidden = Boolean(site.regional);
  $('pick-hint').textContent = '正在读取地形网格…';
  $('official-results').hidden = true;
  $('live-query').disabled = true;
  $('roundtrip').disabled = false;
  state.queryId++;
  map.setSite(site);
  renderLayers(); renderSettings(); renderSources(); renderEvidence(); renderSelections(); invalidate();
  try {
    const [height, slope] = await Promise.all([get(`${dataUrl(site.id)}/elevation.bin`, 'arrayBuffer'), get(`${dataUrl(site.id)}/slope.bin`, 'arrayBuffer')]);
    if (generation !== state.generation) return;
    state.site = decodeTerrain(site, height, slope);
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
  const controls = site.regional ? [['坡度上限（°）', 'slope-limit', 25, 5, 30]]
    : [['坡度上限（°）', 'slope-limit', 18, 5, 30], ['基础步速（米/分）', 'speed', 15, 5, 40],
      ['总预算（分钟）', 'budget', site.budget, 10, 600], ['返航预留（分钟）', 'reserve', 8, 0, 180]];
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
  }
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
  $('map').classList.toggle('selecting', mode !== 'idle');
  $('pick-hint').textContent = { start: '在地图上点击出发地。', goal: '在地图上点击目的地。',
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
  if (state.site.slope[i] > Number($('slope-limit').value)) {
    $('pick-hint').textContent = `此处坡度 ${state.site.slope[i].toFixed(1)}°，超过当前上限。请重新选点。`;
    return;
  }
  const picked = state.mode;
  if (picked === 'start') {
    if (state.stops.some(stop => isSame(stop.cell, cell))) { $('pick-hint').textContent = '出发地和目的地需要分开。'; return; }
    state.start = cell;
  } else {
    if (isSame(state.start, cell)) { $('pick-hint').textContent = '出发地和目的地需要分开。'; return; }
    state.stops = [{ cell, name: '自选目的地', minutes: 0 }];
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
  $('goal-coord').textContent = state.stops.length > 1 ? `${state.stops.length} 个预设科学站` : state.stops[0] ? display(state.stops[0].cell) : '点击后在地图选点';
  $('live-query').disabled = !ready || !(state.stops.length || state.start);
}

function readRoute() {
  const regional = state.site.regional;
  const inputs = [...$('settings').querySelectorAll('input[type=number]')];
  if (inputs.some(input => !input.value || !input.checkValidity())) throw Error('请检查规划参数的范围。');
  const route = { start: state.start, stops: state.stops, base: state.start, closures: state.closures,
    limit: +$('slope-limit').value, speed: regional ? 1 : +$('speed').value,
    budget: regional ? Infinity : +$('budget').value, reserve: regional ? 0 : +$('reserve').value,
    returnToBase: !regional && $('roundtrip').checked, allowSingleStop: state.preset && $('roundtrip').checked && state.stops.length > 1 };
  if (route.reserve >= route.budget) throw Error('总预算须大于预留时间。');
  return route;
}

function requestPlan(route, onResult, hourOffset = 0) {
  const id = ++state.planningId;
  const localHour = Number($('hour')?.value ?? 12);
  state.onPlan = onResult;
  worker.postMessage({ id, route, hour: (localHour + hourOffset / (60 * SOL_RATIO)) % 24, season: +($('season')?.value ?? 0) });
}

worker.onmessage = ({ data }) => {
  if (data.id !== state.planningId) return;
  state.light = data.light ?? state.light;
  state.onPlan?.(data);
  renderLayers();
};
worker.onerror = () => { $('plan-error').textContent = '规划程序加载失败，请重新载入页面。'; };

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
    $('plan-error').textContent = '正在计算路线…';
    requestPlan(route, result => {
      $('compute').disabled = false;
      $('plan-error').textContent = result.error ?? '';
      state.candidates = result.candidates;
      state.current = recommended(result.candidates);
      if (state.current?.shortened) $('plan-error').textContent = `双站任务在当前限制下不可行，推荐先访问 ${state.current.shortened}。`;
      else if (state.current && !state.current.feasible) $('plan-error').textContent = '没有能在预算内完成的路线。可调整停靠点、预算或返航预留。';
      renderRoutes(); redraw();
    });
  } catch (error) { $('plan-error').textContent = error.message; }
}

function describe(candidate) {
  return state.site.regional ? '区域走廊' : candidate.profiles.map(key => profileLabels[key]).join(' / ');
}

function renderRoutes() {
  const root = $('routes');
  const { site, candidates = [], current, nav } = state;
  $('route-count').textContent = candidates.length ? `${candidates.length} 条` : '';
  $('start-nav').disabled = !current?.feasible || Boolean(nav) || Boolean(site?.regional);
  if (!candidates.length) { root.replaceChildren(el('p', '选取起终点后可比较候选路线。', 'muted')); return; }
  root.replaceChildren(...candidates.map(candidate => {
    const control = button(null, () => { state.current = candidate; renderRoutes(); redraw(); }, 'route-row');
    control.disabled = Boolean(nav);
    control.setAttribute('aria-pressed', candidate === current);
    const first = el('span', null, 'route-top'), summary = el('small', null, 'metric-line');
    const variant = candidate.shortened ? ` · ${candidate.shortened}` : '';
    first.append(el('strong', `${describe(candidate)}${variant}`), el('span', site.regional ? distance(candidate.distance) : minute(candidate.minutes), 'route-time'));
    summary.append(el('span', site.regional ? `最大坡度 ${candidate.maxSlope.toFixed(1)}°`
      : `${distance(candidate.distance)} · 陡坡 ${distance(candidate.steep)} · 阴影 ${distance(candidate.shadow)}`));
    if (!site.regional) {
      summary.append(el('span', candidate.feasible ? `余 ${candidate.margin.toFixed(1)} 分` : '超预算', `route-margin${candidate.feasible ? '' : ' late'}`));
      control.append(first, summary, el('small', `累计爬升 ${distance(candidate.ascent)} · 最大坡度 ${candidate.maxSlope.toFixed(1)}°${candidate.pareto ? ' · 权衡方案' : ''}`));
    } else control.append(first, summary);
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

function redraw() {
  if (!state.site) return;
  const shownStops = state.current?.shortened ? state.stops.filter(stop => stop.name === state.current.shortened) : state.stops;
  map.data = { start: state.start, stops: shownStops, closures: state.closures, plan: state.current, light: state.light, progress: state.progress };
  map.draw();
  profileChart($('profile'), state.site, state.current, state.progress);
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
  for (const control of [...$('settings').querySelectorAll('input, select'), $('preset'), $('roundtrip')]) control.disabled = !enabled;
  $('compute').disabled = !enabled || !state.start || !state.stops?.length;
  renderSelections();
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
  if (!state.current?.feasible || state.site.regional) return;
  setMode('idle');
  const route = state.inputRoute;
  const nav = { time: 0, elapsed: 0, playing: true, base: state.start, route, replanning: false, done: false };
  state.nav = nav;
  $('navigation').hidden = false; $('view-tools').hidden = false;
  $('nav-notice').textContent = '模拟回放 · 时间加速。';
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
    nav.time = Math.min(state.current.minutes, nav.time + dt * 2);
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
  const status = nav.blocked ? '路线暂停，等待返航或结束回放' : nav.done ? (plan.visits.at(-1)?.returnLeg ? '已抵达基地' : '已抵达目的地')
    : state.progress.visit ? `正在观察 ${state.progress.visit.name}` : `下一站 ${due?.name ?? '终点'}`;
  $('nav-progress').textContent = `${status} · ${location} · 已用 ${minute(totalTime)} · 完成路线后余量 ${minute(plan.margin)}`;
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
  cancelAnimationFrame(nav.frame);
  nav.view?.destroy();
  state.nav = null; state.progress = null; state.closures = [];
  $('navigation').hidden = true; $('view-tools').hidden = true; $('terrain-fallback').hidden = true;
  show2D(); setPlanningEnabled(true); renderRoutes();
}

function replan(returnOnly) {
  const nav = state.nav, old = state.current;
  if (!nav || nav.replanning) return;
  const now = nav.elapsed + nav.time, start = state.progress.cell;
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
    returnOnly, closures, allowSingleStop: false };
  const desired = old.profiles[0];
  nav.playing = false; nav.replanning = true;
  $('nav-notice').textContent = returnOnly ? '从当前位置计算返航路线…' : '加入前方封路，从当前位置重新规划…';
  updateNavigation();
  function apply(result, returning) {
    const viable = result.candidates.filter(candidate => candidate.feasible);
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
    nav.elapsed = now; nav.time = 0; nav.done = false; nav.blocked = !next.feasible; nav.playing = next.feasible;
    nav.view?.setPlan(next);
    $('nav-notice').textContent = next.feasible
      ? `${returning ? '返航' : '绕行'}已重算 · 从当前点还有 ${distance(next.distance)} · 预计 ${minute(next.minutes)}。`
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
  $('compute').onclick = calculate;
  $('roundtrip').onchange = calculate;
  $('show-rover').onchange = event => { map.rover = event.target.checked; map.draw(); };
  $('zoom-in').onclick = () => map.zoom(1.45);
  $('zoom-out').onclick = () => map.zoom(1 / 1.45);
  $('zoom-reset').onclick = () => map.zoom(1);
  $('start-nav').onclick = beginNavigation;
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
