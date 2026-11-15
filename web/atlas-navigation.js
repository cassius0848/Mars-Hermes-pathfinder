import { t as uiText } from './locale.js';
import { cellOf, cellXY, elevationAt, isLit, pathXY, progressAt, project } from './planner.js';
import { atlasCell, atlasLonLat, atlasSites, atlasTexture, loadAtlasContext, loadAtlasTerrain } from './atlas-terrain.js';
import { environmentSettings, medaSun } from './atlas-environment.js';
import { fetchOfficial } from './official.js';
import { profileChart } from './map.js';
import { bindVerticalScale } from './vertical-scale.js';
import { atlasExamples, sourceForArea } from './atlas-areas.js';
import { EnvironmentPanel, routeValueColor } from './atlas-environment-panel.js';

const $ = id => document.getElementById(id);
const PALETTE = ['#86f8c1', '#ffc18e', '#b8c5ff', '#f7acdc'];
const PROFILES = { environment: uiText("多参数组合"), time: uiText("时间优先"), terrain: uiText("地形优先"), light: uiText("少阴影优先") };
const PDS_CHANNELS = { ANCILLARY: uiText("太阳位置"), PS: uiText("气压"), TIRS: uiText("热红外"), RDS: uiText("紫外") };
const WEIGHTS = ['terrain', 'light', 'thermal', 'uv', 'pressure', 'inertia'];
const ROUTE_FIELDS = { thermal: [uiText("地表温度"), 'K', 5], inertia: [uiText("热惯量"), 'J m⁻² K⁻¹ s⁻½', 20],
  pressure: [uiText("地表气压"), 'Pa', 25], uv: [uiText("太阳辐照潜势"), 'W/m²', 80], terrain: [uiText("坡度"), '°', 5] };
const POINT_LABELS = { start: uiText("出发地"), goal: uiText("目的地"), waypoint: uiText("途经点") };
const names = route => route.profiles.map(profile => PROFILES[profile]).join(' / ');
const km = distance => (distance / 1000).toFixed(2) + uiText(" 公里");

export function attachAtlasNavigation({ canvas, fmt, paint, cancelProfile, fit }) {
  const status = $('nav-status'), host = $('atlas-3d'), playback = $('nav-playback');
  const planButton = $('nav-plan'), viewButton = $('nav-3d');
  const progress = $('nav-progress'), playButton = $('nav-play');
  const routeList = $('nav-routes');
  const points = { start: null, goal: null }, waypoints = [];
  const waypointList = $('nav-waypoints'), extentSelect = $('nav-extent');
  const perspectiveSelect = $('nav-perspective');
  const medaSelect = $('nav-meda'), medaOptions = $('nav-meda-options');
  let meda, regionalMeta, regionalBuffer;
  const climateSelect = $('nav-climate'), results = $('atlas-results'), coloring = $('nav-route-color');
  const baseOptions = [...coloring.options];
  const regional = () => medaSelect.value === 'regional';
  let currentArea = null;
  const autoSource = $('nav-auto-source'), demoButton = $('nav-regional-demo');
  const environmentPanel = new EnvironmentPanel($('nav-env-panel'), $('nav-env-hud'), $('nav-coverage-viz'), {
    seek: minute => seekMinute(minute),
    layer: key => { coloring.value = key; changeRouteColor(); },
  });

  async function regionalRequest(signal, weights) {
    if (!regionalMeta || !climateSelect.value) throw Error(uiText("区域环境索引未加载。请选择“地形与自选太阳时”，或刷新后重试。"));
    const snapshot = regionalMeta.climate.snapshots.find(entry => entry.id === climateSelect.value);
    const temperatureTarget = $('nav-temperature').valueAsNumber, pressureTarget = $('nav-pressure').valueAsNumber;
    const valid = Object.values(weights).every(weight => Number.isFinite(weight) && weight >= 0 && weight <= 5);
    if (!valid || !Number.isFinite(temperatureTarget) || !Number.isFinite(pressureTarget)) throw Error(uiText("请检查环境权重和比较值。"));
    regionalBuffer ??= fetchOfficial('atlas-regional.bin.gz', 'arrayBuffer').then(async buffer => {
      const magic = new Uint8Array(buffer, 0, 2);
      if (magic[0] !== 31 || magic[1] !== 139) {
        if (buffer.byteLength === regionalMeta.bytes) return buffer;
        throw Error(uiText("区域环境数据格式无效。"));
      }
      const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
      return new Response(stream).arrayBuffer();
    }).catch(error => { regionalBuffer = null; throw error; });
    const buffer = await regionalBuffer;
    signal.throwIfAborted();
    return { kind: 'regional', catalog: regionalMeta, buffer, snapshot, weights, temperatureTarget, pressureTarget };
  }
  let armed, task, result, view, viewTask, selected = 0, frame = 0, last = 0, minute = 0, position;

  function updateObservation() {
    const broad = regional();
    const sample = meda?.observations.find(item => item.sclk === Number(medaSelect.value));
    const environment = broad || Boolean(sample);
    $('nav-env-summary').textContent = broad ? uiText("区域多参数") : sample ? `MEDA · Sol ${sample.sol}` : uiText("地形与光照");
    medaOptions.hidden = !environment;
    for (const input of medaOptions.querySelectorAll('input')) input.disabled = !environment;
    for (const label of document.querySelectorAll('[data-manual-sun]')) {
      label.hidden = environment;
      label.querySelector('input').disabled = environment;
    }
    $('nav-climate-field').hidden = !broad;
    for (const label of medaOptions.querySelectorAll('[data-regional-weight]')) {
      label.hidden = !broad;
      label.querySelector('input').disabled = !broad;
    }
    $('nav-meda-demo').hidden = !sample;
    $('nav-meda-reading').hidden = !sample;
    $('nav-thermal-label').textContent = broad ? uiText("减少高温停留") : uiText("减少长波辐照");
    $('nav-radiation-label').textContent = broad ? uiText("减少太阳辐照潜势") : uiText("减少日照段 UV");
    $('nav-meda-status').textContent = broad
      ? (regionalMeta ? uiText("TES 热惯量 · OpenMARS 温度和气压 · DEM 日照。快照条件在整条路线的比较中固定。") : uiText("正在读取区域数据索引…"))
      : sample ? uiText("Hawksbill Gap 原位历史观测。热红外和气压按时长累计，紫外按日照段估算。") : uiText("按高程、坡度、路径时间及自选太阳时规划。");
    if (sample) {
      const sun = medaSun(sample);
      $('nav-meda-reading').textContent = uiText("Sol {0} · LTST {1} · 太阳仰角 {2}° · 地表长波 {3} W/m² · RDS 紫外 {4} W/m² · 气压 {5} Pa", [sample.sol, sample.localTrueSolarTime, sun.elevation.toFixed(2), sample.groundLongwaveWm2.toFixed(2), sample.uvWm2.toFixed(5), sample.pressurePa.toFixed(2)]);
    }
  }

  function sourceLink(title, url) {
    const link = document.createElement('a');
    link.href = url; link.target = '_blank'; link.rel = 'noreferrer';
    link.textContent = title + ' ↗';
    return link;
  }

  updateObservation();
  fetchOfficial('atlas-regional.json', 'json').then(catalog => {
    regionalMeta = catalog;
    for (const snapshot of catalog.climate.snapshots) {
      const hr = String(Math.round(snapshot.primeHour)).padStart(2, '0');
      climateSelect.add(new Option(uiText("MY {0} · Ls {1}° · 0°经线 {2}:00", [snapshot.year, snapshot.ls.toFixed(2), hr]), snapshot.id));
    }
    $('nav-regional-links').replaceChildren(...[catalog.tes, catalog.climate, catalog.solar].map(product => {
      const row = document.createElement('li');
      row.append(sourceLink(product.title, product.source));
      return row;
    }));
    updateObservation();
  }).catch(() => {
    if (regional()) $('nav-meda-status').textContent = uiText("区域环境数据索引暂不可用。可以切换到地形规划。");
  });

  fetchOfficial('atlas-meda.json', 'json').then(catalog => {
    meda = catalog;
    for (const sample of meda.observations) {
      medaSelect.add(new Option(`${meda.siteName} · Sol ${sample.sol} · ${sample.localTrueSolarTime} LTST`, sample.sclk));
    }
    $('nav-meda-links').replaceChildren(...Object.entries(meda.products).map(([id, product]) => sourceLink(PDS_CHANNELS[id] + ' CSV', product.csv)));
  }).catch(() => { $('nav-meda-links').textContent = uiText("Hawksbill 原位观测索引暂不可用。"); });

  function buttons() {
    for (const key of Object.keys(points)) {
      $(`nav-${key}`).setAttribute('aria-pressed', String(key === armed));
      $(`nav-${key}-coord`).textContent = points[key] ? fmt(points[key]) : uiText("点击后在地图选点");
      for (const [axis, index] of [['lon', 0], ['lat', 1]]) $(`nav-${key}-${axis}`).value = points[key]?.[index] ?? '';
    }
    $('nav-waypoint').setAttribute('aria-pressed', String(armed === 'waypoint'));
    planButton.disabled = !points.start || !points.goal || Boolean(task);
    $('nav-reverse').disabled = !points.start || !points.goal || Boolean(task);
    results.hidden = !result;
    $('nav-view-results').hidden = !result;
    viewButton.hidden = !result;
  }

  function renderWaypoints(focusIndex, action) {
    waypointList.hidden = !waypoints.length;
    waypointList.replaceChildren(...waypoints.map((point, index) => {
      const item = document.createElement('li'), copy = document.createElement('div');
      const name = document.createElement('strong'), coords = document.createElement('small');
      name.textContent = uiText("途经 {0}", [index + 1]);
      coords.textContent = fmt(point);
      copy.append(name, coords);
      const actions = document.createElement('div');
      actions.className = 'atlas-waypoint-actions';
      for (const [key, label, title, delta] of [
        ['up', '↑', uiText("上移"), -1], ['down', '↓', uiText("下移"), 1], ['remove', uiText("删除"), uiText("删除"), 0],
      ]) {
        const button = document.createElement('button'), destination = index + delta;
        button.type = 'button';
        button.dataset.action = key;
        button.textContent = label;
        button.setAttribute('aria-label', uiText("{0}途经点 {1}", [title, index + 1]));
        button.disabled = destination < 0 || destination >= waypoints.length;
        button.onclick = () => {
          if (delta) {
            [waypoints[index], waypoints[destination]] = [waypoints[destination], waypoints[index]];
          } else waypoints.splice(index, 1);
          cancelPick();
          resetResult();
          renderWaypoints(Math.min(destination, waypoints.length - 1), key);
          status.textContent = uiText("途经顺序已更新，请重新计算路线。");
        };
        actions.append(button);
      }
      item.append(copy, actions);
      return item;
    }));
    if (focusIndex === undefined) return;
    const item = waypointList.children[focusIndex];
    const next = item?.querySelector(`[data-action="${action}"]:enabled`) ?? item?.querySelector('button:enabled') ?? $('nav-waypoint');
    next.focus({ preventScroll: true });
  }

  function stop() {
    cancelAnimationFrame(frame); frame = 0;
    playButton.textContent = uiText("播放");
  }

  function close3d(focus = false) {
    viewTask?.abort(); viewTask = null;
    stop();
    view?.destroy(); view = null;
    host.hidden = true; playback.hidden = true; canvas.hidden = false; $('atlas-zoom').hidden = false;
    viewButton.disabled = false;
    paint();
    if (focus) viewButton.focus();
  }

  const routeProfile = $('atlas-route-profile'), profileCanvas = $('nav-profile');
  let profileProgress;
  function drawProfile() {
    if (result) profileChart(profileCanvas, result.grid, result.candidates[selected], profileProgress);
  }
  new ResizeObserver(drawProfile).observe(profileCanvas);

  function resetResult() {
    routeProfile.hidden = true;
    profileProgress = null;
    environmentPanel.clear();
    autoSource.hidden = true;
    task?.abort.abort(); task?.worker?.terminate(); task = null;
    result = null; position = null; minute = 0;
    close3d();
    $('nav-data-link').hidden = true;
    routeList.replaceChildren();
    coloring.replaceChildren(...baseOptions);
    coloring.value = 'route';
    $('nav-route-legend').hidden = true;
    $('nav-coverage').textContent = uiText("计算后列出实际参与本次路线的参数。");
    buttons(); paint();
  }

  function cancelPick() {
    if (!armed) return;
    armed = null;
    canvas.classList.remove('picking');
    buttons();
  }

  function arm(key) {
    if (armed === key) { cancelPick(); status.textContent = uiText("已取消选点。"); return; }
    cancelProfile();
    close3d();
    armed = key; buttons();
    status.textContent = uiText("点击地图设置{0}，或移动地图后按回车选择中心。", [POINT_LABELS[key]]);
    canvas.classList.add('picking');
    canvas.focus({ preventScroll: true });
    canvas.scrollIntoView({ block: 'nearest' });
  }

  function pick(point) {
    if (!armed) return false;
    if (Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) return true;
    const key = armed;
    if (key === 'waypoint') waypoints.push(point);
    else points[key] = point;
    cancelPick();
    resetResult();
    if (key === 'waypoint') {
      renderWaypoints();
      status.textContent = uiText("已添加途经点 {0}。可继续添加或调整顺序。", [waypoints.length]);
      $('nav-waypoint').focus({ preventScroll: true });
    } else if (!points.start || !points.goal) arm(points.start ? 'goal' : 'start');
    else {
      status.textContent = uiText("出发地和目的地已设置，可以添加途经点或计算路线。");
      planButton.focus({ preventScroll: true });
      planButton.scrollIntoView({ block: 'nearest' });
    }
    return true;
  }

  function metric(value, digits, unit) {
    return Number.isFinite(value) ? value.toFixed(digits) + ' ' + unit : uiText("缺测");
  }

  function pickedValues() {
    if (!result || coloring.value === 'route') return null;
    const candidate = result.candidates[selected], key = coloring.value;
    if (key === 'terrain') return Float32Array.from(candidate.path, i => result.grid.slope[i]);
    if (key === 'light') return Uint8Array.from(candidate.path, i => Number(isLit(result.grid, result.light, i)));
    return candidate.environment?.values?.[key] ?? null;
  }

  function extent(values) {
    let min = Infinity, max = -Infinity;
    for (const value of values) {
      if (!Number.isFinite(value)) continue;
      min = Math.min(min, value); max = Math.max(max, value);
    }
    return [min, max];
  }

  function updateLegend() {
    const values = pickedValues(), legend = $('nav-route-legend');
    legend.hidden = !values;
    if (!values) return;
    if (coloring.value === 'light') {
      legend.textContent = uiText("直射光为金色，地形遮挡为紫色。");
      return;
    }
    const [min, max] = extent(values), [label, unit] = ROUTE_FIELDS[coloring.value];
    legend.textContent = uiText("{0}沿选中路线 {1} – {2}。蓝色较低，橙色较高，缺测用灰色。", [label, metric(min, 2, unit), metric(max, 2, unit)]);
  }

  function updateRouteLayers() {
    const select = $('nav-route-layer');
    select.hidden = false;
    const sample = result.candidates[selected].environment;
    const current = coloring.value;
    const fields = Object.entries(sample?.values ?? {}).filter(([, values]) => values.some(Number.isFinite));
    coloring.replaceChildren(...baseOptions, ...fields.map(([key]) => new Option(ROUTE_FIELDS[key][0], key)));
    coloring.value = [...coloring.options].some(option => option.value === current) ? current : 'route';
    coloring.querySelector('option[value="light"]').disabled = !result.light;
    updateLegend();
  }

  function updateComparison() {
    const element = $('nav-comparison'), { candidates, coverage } = result;
    const combined = candidates.find(route => route.profiles.includes('environment'));
    const baseline = candidates.find(route => route.profiles.includes('time'));
    if (!combined || !baseline) {
      element.textContent = uiText("点选候选路线可在地图上高亮显示。");
      return;
    }
    const factors = coverage ? (coverage.active.join('、') || uiText("时间")) : uiText("所选 MEDA 参数");
    if (combined === baseline) {
      element.textContent = uiText("{0}。按当前权重，组合解与时间优先使用同一条路线。", [factors]);
      return;
    }
    const deltaTime = combined.minutes - baseline.minutes;
    const signed = value => Math.abs(value) < 0.05 ? '0.0' : (value >= 0 ? '+' : '') + value.toFixed(1);
    const change = signed(deltaTime);
    const slopeChange = signed(combined.maxSlope - baseline.maxSlope);
    const reference = new Set(baseline.path);
    const newCells = combined.path.filter(cell => !reference.has(cell)).length / combined.path.length;
    element.textContent = uiText("已启用 {0}。相对时间优先，组合路线 {1}% 的网格不同，最大坡度 {2}°，用时 {3} 分钟。", [factors, Math.round(newCells * 100), slopeChange, change]);
  }

  function drawSegmentValues(ctx, screen, line, values) {
    const [min, max] = extent(values);
    for (let i = 1; i < line.length; i++) {
      const value = (values[i - 1] + values[i]) / 2;
      ctx.strokeStyle = routeValueColor(value, min, max, coloring.value, ROUTE_FIELDS[coloring.value]?.[2] ?? 1);
      ctx.beginPath();
      ctx.moveTo(...screen(line[i - 1]));
      ctx.lineTo(...screen(line[i]));
      ctx.stroke();
    }
  }

  function draw(ctx, screen) {
    if (result) {
      const { candidates } = result;
      const order = candidates.map((candidate, index) => index).filter(index => index !== selected);
      order.push(selected);
      for (const index of order) {
        ctx.beginPath();
        for (const [i, point] of candidates[index].line.entries()) {
          if (i) ctx.lineTo(...screen(point)); else ctx.moveTo(...screen(point));
        }
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.lineWidth = index === selected ? 6 : 4; ctx.strokeStyle = '#201711'; ctx.stroke();
        ctx.lineWidth = index === selected ? 4 : 2;
        const values = index === selected ? pickedValues() : null;
        if (values) drawSegmentValues(ctx, screen, candidates[index].line, values);
        else { ctx.strokeStyle = PALETTE[index]; ctx.stroke(); }
      }
    }
    for (const key of Object.keys(points)) {
      if (!points[key]) continue;
      const [x, y] = screen(points[key]);
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fillStyle = key === 'start' ? '#9cf3cb' : '#ffc58c'; ctx.fill();
      ctx.strokeStyle = '#1c1815'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#1c1815';
      ctx.fillText(key === 'start' ? uiText("起") : uiText("终"), x, y + 3.5);
    }
    for (const [index, point] of waypoints.entries()) {
      const [x, y] = screen(point), radius = index < 9 ? 10 : 13;
      ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = '#d0c4ff'; ctx.fill();
      ctx.strokeStyle = '#1c1815'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#1c1815';
      ctx.fillText(index + 1, x, y + 4);
    }
    if (position) {
      const [x, y] = screen(position);
      ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.fillStyle = '#172028'; ctx.fill();
      ctx.lineWidth = 4; ctx.strokeStyle = '#142328'; ctx.stroke();
      ctx.lineWidth = 2.5; ctx.strokeStyle = '#bbf5e4'; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffdb91'; ctx.fill();
    }
  }

  function renderCandidates() {
    routeList.replaceChildren(...result.candidates.map((candidate, index) => {
      const button = document.createElement('button'), label = document.createElement('strong'), detail = document.createElement('small');
      button.type = 'button'; button.className = 'nav-candidate'; button.style.setProperty('--route-color', PALETTE[index]);
      button.setAttribute('aria-pressed', String(index === selected));
      label.textContent = names(candidate);
      const metrics = uiText("{0} · 爬升 {1} 米 · 最大坡度 {2}° · 阴影 {3}%", [km(candidate.distance), Math.round(candidate.ascent), candidate.maxSlope.toFixed(1), Math.round(candidate.shadow / candidate.distance * 100)]);
      detail.textContent = uiText("{0} · 约 {1} 分钟{2}{3}", [metrics, Math.round(candidate.minutes), result.coarse ? uiText("（区域估算）") : '', candidate.feasible ? '' : uiText(" · 超出可用时间")]);
      button.append(label, detail);
      if (candidate.environment) {
        const env = candidate.environment, environmental = document.createElement('small');
        if (env.kind === 'regional') {
          environmental.textContent = uiText("快照下日照路段 {0}% · 地表温度 {1} · 气压 {2}", [Math.round((1 - candidate.shadow / candidate.distance) * 100), metric(env.meanTemperatureK, 2, 'K'), metric(env.meanPressurePa, 2, 'Pa')]);
          const thermal = document.createElement('small');
          thermal.textContent = uiText("热惯量 {0} · 其中插值 {1} · 平均太阳辐照潜势 {2}", [metric(env.meanInertia, 1, 'J m⁻² K⁻¹ s⁻½'), metric(env.interpolatedPercent, 0, '%'), metric(env.meanSolarWm2, 1, 'W/m²')]);
          button.append(environmental, thermal);
        } else {
          environmental.textContent = uiText("直射光 {0} 分 · 热红外参考 {1} kJ/m² · 日照段 UV {2} J/m² · 低压差 {3} Pa·分", [env.sunlitMinutes.toFixed(1), env.thermalKJm2.toFixed(1), env.sunlitUvJm2.toFixed(2), env.pressureDeficitPaMin.toFixed(0)]);
          button.append(environmental);
        }
      }
      button.onclick = () => {
        selected = index; minute = 0; position = null; stop();
        if (view) { view.setColor(PALETTE[index]); view.setPlan(candidate); updateProgress(); }
        [...routeList.children].forEach((item, i) => item.setAttribute('aria-pressed', String(i === index)));
        updateRouteLayers();
        updateEnvironmentPanel(); applyRouteColor();
        paint();
      };
      return button;
    }));
  }

  async function plan(event) {
    event.preventDefault();
    if (planButton.disabled) return;
    cancelPick();
    resetResult();
    const settings = Object.fromEntries(['slope', 'speed', 'budget', 'reserve', 'hour', 'season'].map(key => [key, $(`nav-${key}`).valueAsNumber]));
    const pending = { abort: new AbortController() };
    task = pending; buttons();
    const mode = $('nav-source').value, ordered = [points.start, ...waypoints, points.goal];
    try {
      const hasObservation = Boolean(medaSelect.value) && !regional();
      if (hasObservation && mode !== 'auto' && mode !== 'local') {
        throw Error(uiText("MEDA 场景使用 Hawksbill Gap 的 HiRISE 验证区。请选择自动或米级高程。"));
      }
      const terrain = await loadAtlasTerrain(hasObservation ? 'local' : mode, ordered, pending.abort.signal, message => {
        if (task === pending) status.textContent = message;
      });
      if (task !== pending) return;
      const { grid, label, source, coarse } = terrain;
      if (!coarse && settings.reserve >= settings.budget) throw Error(uiText("预留时间必须小于总时间预算。"));
      const cells = ordered.map(point => atlasCell(grid, point));
      const nameAt = index => index === 0 ? uiText("出发地") : index === cells.length - 1 ? uiText("目的地") : uiText("途经 {0}", [index]);
      for (const [index, cell] of cells.entries()) {
        if (!cell) throw Error(uiText("{0}超出高程数据覆盖范围。", [nameAt(index)]));
        const previous = cells[index - 1];
        if (previous && previous[0] === cell[0] && previous[1] === cell[1]) {
          throw Error(uiText("{0}和{1}落在同一网格。请拉开距离或选择更精细的高程。", [nameAt(index - 1), nameAt(index)]));
        }
      }
      const [start, ...visits] = cells;
      const stops = visits.map((cell, index) => ({ cell, xy: project(grid, ordered[index+1]), name: nameAt(index + 1) }));
      const returnToBase = $('nav-return').checked;
      const route = { start, base: start, startXY: project(grid, ordered[0]), baseXY: project(grid, ordered[0]), stops, closures: [],
        limit: settings.slope, speed: settings.speed, budget: settings.budget, reserve: settings.reserve, returnToBase };
      if (medaSelect.value) {
        const weights = Object.fromEntries(WEIGHTS.map(key => [key, $(`weight-${key}`).valueAsNumber]));
        if (regional()) {
          status.textContent = uiText("{0}。正在读取规划区域的 TES 和 OpenMARS 数据…", [label]);
          route.environment = await regionalRequest(pending.abort.signal, weights);
        } else {
          route.environment = environmentSettings(meda, Number(medaSelect.value), weights, $('nav-pressure').valueAsNumber, grid);
        }
      }
      if (task !== pending) return;
      pending.worker = new Worker('planner-worker.js', { type: 'module' });
      pending.worker.onmessage = ({ data }) => {
        if (task !== pending) return;
        try {
          if (data.error) throw Error(data.error);
          const mixedLight = data.light?.mask.includes(0) && data.light.mask.includes(1);
          const candidates = data.candidates.map(candidate => ({ ...candidate,
            profiles: mixedLight ? candidate.profiles : candidate.profiles.filter(profile => profile !== 'light'),
            line: candidate.path.map((index, i) => atlasLonLat(grid, pathXY(grid, candidate, i))) }));
          result = { grid, label, light: data.light, candidates, coarse, coverage: data.coverage,
            environmentContext: {observation:route.environment?.observation, snapshot:route.environment?.snapshot,
              weights:route.environment?.weights, coverage:data.coverage} };
          selected = 0;
          const scenario = route.environment?.observation;
          const observationLabel = scenario ? ` · NASA MEDA Sol ${scenario.sol} ${scenario.localTrueSolarTime} LTST`
            : data.coverage ? uiText(" · 区域多参数") : '';
          status.textContent = uiText("{0}{1}。{2} 条候选路线{3}。起终点保留所选坐标。{4}", [label, observationLabel, candidates.length, waypoints.length ? uiText("，按顺序经过 {0} 个途经点", [waypoints.length]) : '', coarse ? uiText("区域高程用于地形筛选，不能辨认网格以下的岩块和陡坎。") : '']);
          const coverage = data.coverage;
          if (coverage) {
            const enabled = coverage.active.join('、') || uiText("行进时间");
            const spacing = coverage.thermalSpacing ? coverage.thermalSpacing + '°' : uiText("缺测");
            $('nav-coverage').textContent = uiText("已启用 {0}。OpenMARS 5°，TES {1}，模拟当地太阳时约 {2} h。{3}", [enabled, spacing, coverage.hour.toFixed(1), coverage.disabled.length ? uiText("覆盖不完整，已跳过 ") + coverage.disabled.join('、') + '。' : '']);
          } else {
            $('nav-coverage').textContent = scenario ? uiText("使用 Hawksbill Gap 原位历史观测。") : uiText("按高程、坡度和模拟日照规划。");
          }
          renderCandidates();
          updateComparison();
          updateRouteLayers();
          updateEnvironmentPanel();
          fit(candidates.flatMap(candidate => candidate.line));
          viewButton.hidden = false;
        } catch (error) { status.textContent = `${label}。 ${error.message}`; }
        finally { finish(pending); }
      };
      pending.worker.onerror = () => {
        if (task !== pending) return;
        status.textContent = uiText("浏览器路线计算失败。请重试。"); finish(pending);
      };
      const sourceLink = $('nav-data-link');
      sourceLink.href = source; sourceLink.hidden = false;
      status.textContent = route.environment
        ? uiText("{0}已就绪，正在比较多参数组合与时间优先路线…", [label])
        : uiText("{0}已就绪，正在比较时间、地形和模拟光照…", [label]);
      pending.worker.postMessage({ type: 'grid', grid });
      pending.worker.postMessage({ route, hour: settings.hour, season: settings.season });
    } catch (error) {
      if (task !== pending) return;
      status.textContent = error.name === 'TimeoutError' ? uiText("官方高程服务响应超时，请重试或缩短路线。") : error.message;
      autoSource.hidden = !error.suggestedSource;
      finish(pending);
    }
  }

  function finish(pending) {
    pending.abort.abort(); pending.worker?.terminate(); task = null;
    buttons(); paint();
  }

  function updateProgress() {
    const { grid, candidates, light, coarse } = result;
    const candidate = candidates[selected], pos = progressAt(grid, candidate, minute);
    view?.update(pos, light);
    profileProgress = pos;
    drawProfile();
    position = atlasLonLat(grid, pos.xy);
    progress.value = Math.round(minute / candidate.minutes * 1000);
    const [row, col] = pos.cell, cell = row * grid.cols + col;
    const elevation = Math.round(elevationAt(grid, pos.xy)), slope = grid.slope[cell].toFixed(1);
    $('nav-position').textContent = uiText("模拟队员 · {0} · 高程 {1} m · 坡度 {2}° · 已走 {3} / {4}{5}", [fmt(position), elevation, slope, km(pos.distance), km(candidate.distance), coarse ? uiText(" · 区域地形走廊回放") : uiText(" · 模拟第 {0} 分钟", [minute.toFixed(1)])]);
    environmentPanel.update(minute, pos, coloring.value);
  }

  function updateEnvironmentPanel() {
    routeProfile.hidden = false;
    environmentPanel.set(result.grid, result.candidates[selected], result.light, result.environmentContext,
      [...coloring.options].map(option => option.value));
    updateProgress();
  }

  function seekMinute(value) {
    if (!result) return;
    stop(); minute = Math.max(0, Math.min(result.candidates[selected].minutes, value));
    updateProgress(); paint();
  }

  function applyRouteColor() {
    if (!view) return;
    const values = pickedValues();
    if (!values) { view.setColor(PALETTE[selected]); return; }
    const [min, max] = extent(values);
    view.setRouteColors(Array.from(values, value => routeValueColor(value, min, max, coloring.value, ROUTE_FIELDS[coloring.value]?.[2] ?? 1)));
  }

  function changeRouteColor() {
    updateLegend(); applyRouteColor(); if (result) updateProgress(); paint();
  }

  function play(now) {
    if (!frame || !view) return;
    const duration = result.candidates[selected].minutes;
    const speed = $('nav-playback-speed').value;
    minute = Math.min(duration, minute + (now - last) / (speed === 'demo' ? 36000 : 60000) * (speed === 'demo' ? duration : Number(speed)));
    last = now; updateProgress();
    if (minute >= duration) stop(); else frame = requestAnimationFrame(play);
  }

  async function open3d(opening = true) {
    if (!result) return;
    stop();
    viewTask?.abort();
    const controller = new AbortController();
    viewTask = controller; viewButton.disabled = true;
    const current = result, { grid, candidates } = current;
    const contextStatus = $('nav-context-status'), textureStatus = $('nav-texture');
    textureStatus.textContent = '';
    const wide = extentSelect.value === 'surroundings';
    $('nav-context-radius').disabled = !wide;
    const radius = Number($('nav-context-radius').value);
    host.hidden = false; playback.hidden = false; canvas.hidden = true; $('atlas-zoom').hidden = true;
    playButton.disabled = !view;
    progress.disabled = !view;
    if (opening) {
      host.scrollIntoView({ block: 'nearest' });
      $('nav-back').focus({ preventScroll: true });
    }
    contextStatus.textContent = uiText("正在显示路线高程网格…");
    try {
      const { TerrainView } = await import('./terrain-view.js');
      if (viewTask !== controller) return;
      function show(display, surroundings) {
        const previous = view;
        const next = new TerrainView(host, display.grid, candidates[selected], {
          color: PALETTE[selected], atlas: true, routeGrid: grid, surroundings,
        });
        previous?.destroy(); view = next;
        playButton.disabled = progress.disabled = false;
        updateDisplay(); updatePerspective();
        applyRouteColor();
        view.setGridVisible($('nav-grid-lines').checked);
        updateProgress();
        contextStatus.textContent = `${display.label} · ${surroundings ? uiText("周边地形") : uiText("路线高程网格")}。`;
        if (display.grid.id) {
          textureStatus.textContent = uiText("使用配准正射影像。");
        } else {
          textureStatus.textContent = uiText("正在加载 NASA 官方影像，当前高程和导航已可使用。");
          atlasTexture(display.grid, controller.signal).then(texture => {
            if (viewTask !== controller || view !== next) return;
            if (texture) next.setTexture(texture);
            textureStatus.textContent = texture ? uiText("已加载 NASA Mars Trek 官方影像。") : uiText("官方影像暂不可用，当前显示数值高程地形。");
          }).catch(() => { if (viewTask === controller && view === next) textureStatus.textContent = uiText("影像暂不可用，当前显示实测高程。"); });
        }
      }
      // Show usable terrain immediately; remote surroundings must never leave a blank canvas.
      show({grid, label: current.label}, false);
      if (wide) {
        contextStatus.textContent = uiText("路线地形已显示，正在扩展周边实测高程…");
        try {
          const display = current.context?.radius === radius ? current.context
            : await loadAtlasContext(candidates.flatMap(candidate => candidate.line), controller.signal, radius);
          if (viewTask !== controller) return;
          show(display, true); current.context = {...display, radius};
        } catch (error) {
          if (viewTask !== controller) return;
          extentSelect.value = 'route';
          contextStatus.textContent = uiText("周边高程暂不可用，已保留路线地形：{0}", [error.message]);
        }
      }
    } catch (error) {
      if (viewTask !== controller) return;
      if (!view) {
        close3d(); status.textContent = uiText("三维地形无法显示：{0}。二维路线仍可查看。", [error.message]);
      } else textureStatus.textContent = uiText("官方影像暂不可用，当前显示数值高程地形。");
    }
  }

  $('nav-coordinates').onsubmit = event => {
    event.preventDefault();
    const next = Object.fromEntries(['start', 'goal'].map(key => [key,
      ['lon', 'lat'].map(axis => $(`nav-${key}-${axis}`).valueAsNumber)]));
    if (Object.values(next).some(point => !point.every(Number.isFinite) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 80)) return;
    cancelPick(); cancelProfile(); resetResult();
    Object.assign(points, next); buttons(); fit([points.start, ...waypoints, points.goal]); paint();
    status.textContent = uiText("已应用精确坐标，请计算路线。");
  };

  for (const key of Object.keys(POINT_LABELS)) $(`nav-${key}`).onclick = () => arm(key);
  $('nav-reset').onclick = () => {
    cancelPick(); points.start = points.goal = null;
    waypoints.length = 0; renderWaypoints(); resetResult();
    status.textContent = uiText("在地图上依次选择出发地和目的地。");
  };
  $('nav-reverse').onclick = () => {
    if (!points.start || !points.goal) return;
    [points.start, points.goal]=[points.goal, points.start];waypoints.reverse();
    cancelPick();resetResult();renderWaypoints();
    status.textContent=uiText("起终点与途经顺序已反向，请重新计算路线。");
  };
  medaSelect.addEventListener('change', updateObservation);
  async function demo(id, targetIndex, mode, run) {
    try {
      const sites = await atlasSites();
      const site = sites.find(item => item.id === id);
      if (!site?.base || !site.targets?.[targetIndex]?.cell) throw Error(uiText("当前版本没有可用的示例点。"));
      cancelPick();
      cancelProfile();
      waypoints.length = 0; renderWaypoints(); resetResult();
      points.start = atlasLonLat(site, cellXY(site, site.base));
      points.goal = atlasLonLat(site, cellXY(site, site.targets[targetIndex].cell));
      $('nav-source').value = mode;
      fit([points.start, points.goal]); buttons(); paint();
      if (run) {
        medaSelect.value = 'regional';
        updateObservation();
        $('nav-form').requestSubmit();
      } else status.textContent = uiText("已设置 Hawksbill Gap 示例点。可调整权重或计算路线。");
    } catch (error) {
      status.textContent = error.message;
    }
  }
  $('nav-meda-demo').onclick = () => demo('hawksbill', 0, 'auto', false);
  demoButton.onclick = () => {
    const example = atlasExamples[currentArea];
    if (!example) return;
    if (example.site) return demo(example.site, example.target, example.source, true);
    cancelPick(); cancelProfile();
    waypoints.length = 0; renderWaypoints(); resetResult();
    points.start = [...example.start]; points.goal = [...example.goal];
    $('nav-source').value = example.source;
    medaSelect.value = 'regional'; updateObservation();
    fit([points.start, points.goal]); buttons(); paint();
    $('nav-form').requestSubmit();
  };
  autoSource.onclick = () => {
    $('nav-source').value = 'auto';
    autoSource.hidden = true;
    $('nav-form').requestSubmit();
  };

  function setArea(id) {
    const example = atlasExamples[id];
    const source = $('nav-source'), next = sourceForArea(id, source.value);
    const changedArea = currentArea !== null && currentArea !== id;
    const changedSource = next !== source.value;
    const changedObservation = Boolean(medaSelect.value) && !regional() && id !== 'hawksbill';
    currentArea = id;
    if (changedArea) { cancelPick(); if (task || result) resetResult(); }
    demoButton.textContent = example ? uiText("示例路线") : uiText("先选择区域");
    demoButton.title = example ? uiText("载入并计算 {0} 示例路线", [example.name]) : uiText("选择一个陨石坑后可试算");
    demoButton.disabled = !example;
    if (changedSource || changedObservation) {
      resetResult(); source.value = next;
      if (changedObservation) { medaSelect.value = 'regional'; updateObservation(); }
      status.textContent = uiText("已切换到 {0}，已移除不适用的区域数据限制。原选点保留，可重新选点或点击当前区域试算。", [example?.name ?? uiText("全球视图")]);
    } else if (changedArea && (points.start || points.goal)) status.textContent = uiText("已切换到 {0}。原选点保留，试算按钮将设置当前区域的示例点。", [example?.name ?? uiText("全球视图")]);
    else if (!points.start && !points.goal) status.textContent = example
      ? uiText("在 {0} 地图选取起点和终点，或试算该区域路线。", [example.name])
      : uiText("选择具体区域后可试算，也可在地图上手动选点并使用自动高程。");
  }

  const scaleRange = $('nav-exaggeration'), scaleNumber = $('nav-exaggeration-number');
  let orbitScale = scaleRange.valueAsNumber;
  function updatePerspective() {
    const firstPerson = perspectiveSelect.value === 'first-person';
    if (firstPerson && !scaleRange.disabled) {
      orbitScale = scaleRange.valueAsNumber; setScale(1);
      if ($('nav-playback-speed').value === 'demo') $('nav-playback-speed').value = '10';
    }
    if (!firstPerson && scaleRange.disabled) setScale(orbitScale);
    scaleRange.disabled = scaleNumber.disabled = $('nav-true-scale').disabled = firstPerson;
    view?.setPerspective(firstPerson ? 'first-person' : 'orbit');
    view?.setFollow(perspectiveSelect.value === 'follow');
    $('nav-view-note').textContent = firstPerson
      ? uiText("宇航员步行视角 · 眼高 1.7 米 · 真实垂直比例。拖动可环顾，播放或拖动导航进度前进。轨道高程无法还原网格以下的岩块和脚下细节。")
      : uiText("可拖动旋转视角、滚轮缩放。地形来自实测高程，细节受原始数据分辨率限制。");
  }
  function updateDisplay() { view?.setDisplay($('nav-relief').value, scaleRange.value); }
  const setScale = bindVerticalScale('nav', updateDisplay);
  $('nav-relief').onchange = updateDisplay;
  coloring.onchange = changeRouteColor;
  $('nav-form').onsubmit = plan;
  const settingsSummary=()=>{
    $('nav-settings-summary').textContent=uiText("{0}° · {1} 分钟 · 预留 {2} 分钟{3}", [$('nav-slope').value || '—', $('nav-budget').value || '—', $('nav-reserve').value || '—', $('nav-return').checked?uiText(" · 往返"):'']);
  };
  settingsSummary();
  $('nav-form').addEventListener('input',settingsSummary);
  $('nav-form').addEventListener('invalid',event=>{
    let parent=event.target.parentElement;
    while(parent&&parent!==$('nav-form')) {if(parent.tagName==='DETAILS')parent.open=true;parent=parent.parentElement;}
    status.textContent=uiText("有参数超出输入范围，请修正已展开的设置。");
  },true);
  $('nav-form').onchange = () => {
    settingsSummary();
    if (!result && !task) return;
    resetResult(); status.textContent = uiText("设置已更新，请重新计算路线。");
  };
  $('nav-back').onclick = () => close3d(true);
  viewButton.onclick = () => open3d();
  extentSelect.onchange = () => open3d(false);
  $('nav-context-radius').onchange = () => { if (extentSelect.value === 'surroundings') open3d(false); };
  perspectiveSelect.onchange = updatePerspective;
  $('nav-grid-lines').onchange = event => view?.setGridVisible(event.target.checked);
  playButton.onclick = () => {
    if (frame) { stop(); return; }
    if (minute >= result.candidates[selected].minutes) minute = 0;
    last = performance.now(); frame = requestAnimationFrame(play); playButton.textContent = uiText("暂停");
  };
  progress.oninput = () => {
    stop(); minute = +progress.value / 1000 * result.candidates[selected].minutes; updateProgress();
  };
  return { pick, cancelPick, draw, setArea };
}


