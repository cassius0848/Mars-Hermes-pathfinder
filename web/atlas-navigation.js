import { cellOf, cellXY, isLit, progressAt } from './planner.js';
import { atlasCell, atlasLonLat, atlasSites, atlasTexture, loadAtlasTerrain } from './atlas-terrain.js';
import { environmentSettings, medaSun } from './atlas-environment.js';
import { fetchOfficial } from './official.js';

const $ = id => document.getElementById(id);
const PALETTE = ['#86f8c1', '#ffc18e', '#b8c5ff', '#f7acdc'];
const PROFILES = { environment: '多参数组合', time: '时间优先', terrain: '地形优先', light: '少阴影优先' };
const PDS_CHANNELS = { ANCILLARY: '太阳位置', PS: '气压', TIRS: '热红外', RDS: '紫外' };
const WEIGHTS = ['terrain', 'light', 'thermal', 'uv', 'pressure', 'inertia'];
const ROUTE_FIELDS = { thermal: ['地表温度', 'K', 5], inertia: ['热惯量', 'J m⁻² K⁻¹ s⁻½', 20],
  pressure: ['地表气压', 'Pa', 25], uv: ['太阳辐照潜势', 'W/m²', 80], terrain: ['坡度', '°', 5] };
const ENDPOINTS = { start: '出发地', goal: '目的地' };
const names = route => route.profiles.map(profile => PROFILES[profile]).join(' / ');
const km = distance => (distance / 1000).toFixed(2) + ' 公里';

export function attachAtlasNavigation({ canvas, fmt, paint, cancelProfile, fit }) {
  const status = $('nav-status'), host = $('atlas-3d'), playback = $('nav-playback');
  const planButton = $('nav-plan'), viewButton = $('nav-3d');
  const progress = $('nav-progress'), playButton = $('nav-play');
  const routeList = $('nav-routes');
  const points = { start: null, goal: null };
  const medaSelect = $('nav-meda'), medaOptions = $('nav-meda-options');
  let meda, regionalMeta, regionalBuffer;
  const climateSelect = $('nav-climate'), results = $('atlas-results'), coloring = $('nav-route-color');
  const baseOptions = [...coloring.options];
  const regional = () => medaSelect.value === 'regional';

  async function regionalRequest(signal, weights) {
    if (!regionalMeta || !climateSelect.value) throw Error('区域环境索引未加载。请选择“地形与自选太阳时”，或刷新后重试。');
    const snapshot = regionalMeta.climate.snapshots.find(entry => entry.id === climateSelect.value);
    const temperatureTarget = $('nav-temperature').valueAsNumber, pressureTarget = $('nav-pressure').valueAsNumber;
    const valid = Object.values(weights).every(weight => Number.isFinite(weight) && weight >= 0 && weight <= 5);
    if (!valid || !Number.isFinite(temperatureTarget) || !Number.isFinite(pressureTarget)) throw Error('请检查环境权重和比较值。');
    regionalBuffer ??= fetchOfficial('atlas-regional.bin.gz', 'arrayBuffer').then(async buffer => {
      const magic = new Uint8Array(buffer, 0, 2);
      if (magic[0] !== 31 || magic[1] !== 139) {
        if (buffer.byteLength === regionalMeta.bytes) return buffer;
        throw Error('区域环境数据格式无效。');
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
    $('nav-thermal-label').textContent = broad ? '减少高温停留' : '减少长波辐照';
    $('nav-radiation-label').textContent = broad ? '减少太阳辐照潜势' : '减少日照段 UV';
    $('nav-meda-status').textContent = broad
      ? (regionalMeta ? 'TES 热惯量 · OpenMARS 温度和气压 · DEM 日照。快照条件在整条路线的比较中固定。' : '正在读取区域数据索引…')
      : sample ? 'Hawksbill Gap 原位历史观测。热红外和气压按时长累计，紫外按日照段估算。' : '按高程、坡度、路径时间及自选太阳时规划。';
    if (sample) {
      const sun = medaSun(sample);
      $('nav-meda-reading').textContent = `Sol ${sample.sol} · LTST ${sample.localTrueSolarTime} · 太阳仰角 ${sun.elevation.toFixed(2)}° · 地表长波 ${sample.groundLongwaveWm2.toFixed(2)} W/m² · RDS 紫外 ${sample.uvWm2.toFixed(5)} W/m² · 气压 ${sample.pressurePa.toFixed(2)} Pa`;
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
      climateSelect.add(new Option(`MY ${snapshot.year} · Ls ${snapshot.ls.toFixed(2)}° · 0°经线 ${hr}:00`, snapshot.id));
    }
    $('nav-regional-links').replaceChildren(...[catalog.tes, catalog.climate, catalog.solar].map(product => {
      const row = document.createElement('li');
      row.append(sourceLink(product.title, product.source));
      return row;
    }));
    updateObservation();
  }).catch(() => {
    if (regional()) $('nav-meda-status').textContent = '区域环境数据索引暂不可用。可以切换到地形规划。';
  });

  fetchOfficial('atlas-meda.json', 'json').then(catalog => {
    meda = catalog;
    for (const sample of meda.observations) {
      medaSelect.add(new Option(`${meda.siteName} · Sol ${sample.sol} · ${sample.localTrueSolarTime} LTST`, sample.sclk));
    }
    $('nav-meda-links').replaceChildren(...Object.entries(meda.products).map(([id, product]) => sourceLink(PDS_CHANNELS[id] + ' CSV', product.csv)));
  }).catch(() => { $('nav-meda-links').textContent = 'Hawksbill 原位观测索引暂不可用。'; });

  function buttons() {
    for (const key of Object.keys(points)) {
      $(`nav-${key}`).setAttribute('aria-pressed', String(key === armed));
      $(`nav-${key}-coord`).textContent = points[key] ? fmt(points[key]) : '未选择';
    }
    planButton.disabled = !points.start || !points.goal || Boolean(task);
    results.hidden = !result;
    $('nav-view-results').hidden = !result;
    viewButton.hidden = !result;
  }

  function stop() {
    cancelAnimationFrame(frame); frame = 0;
    playButton.textContent = '播放';
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

  function resetResult() {
    task?.abort.abort(); task?.worker?.terminate(); task = null;
    result = null; position = null; minute = 0;
    close3d();
    $('nav-data-link').hidden = true;
    routeList.replaceChildren();
    coloring.replaceChildren(...baseOptions);
    coloring.value = 'route';
    $('nav-route-legend').hidden = true;
    $('nav-coverage').textContent = '计算后列出实际参与本次路线的参数。';
    buttons(); paint();
  }

  function cancelPick() {
    if (!armed) return;
    armed = null;
    canvas.classList.remove('picking');
    buttons();
  }

  function arm(key) {
    if (armed === key) { cancelPick(); status.textContent = '已取消选点。'; return; }
    cancelProfile();
    close3d();
    armed = key; buttons();
    status.textContent = `点击地图设置${ENDPOINTS[key]}，或移动地图后按回车选择中心。`;
    canvas.classList.add('picking');
    canvas.focus({ preventScroll: true });
    canvas.scrollIntoView({ block: 'nearest' });
  }

  function pick(point) {
    if (!armed) return false;
    if (Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) return true;
    const key = armed;
    points[key] = point;
    cancelPick();
    resetResult();
    if (!points.start || !points.goal) arm(points.start ? 'goal' : 'start');
    else {
      status.textContent = '两点已设置。可以调整设置，然后计算路线。';
      planButton.focus({ preventScroll: true });
      planButton.scrollIntoView({ block: 'nearest' });
    }
    return true;
  }

  function metric(value, digits, unit) {
    return Number.isFinite(value) ? value.toFixed(digits) + ' ' + unit : '缺测';
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
      legend.textContent = '直射光为金色，地形遮挡为紫色。';
      return;
    }
    const [min, max] = extent(values), [label, unit] = ROUTE_FIELDS[coloring.value];
    legend.textContent = `${label}沿选中路线 ${metric(min, 2, unit)} – ${metric(max, 2, unit)}。蓝色较低，橙色较高，缺测用灰色。`;
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
      element.textContent = '点选候选路线可在地图上高亮显示。';
      return;
    }
    const factors = coverage ? (coverage.active.join('、') || '时间') : '所选 MEDA 参数';
    if (combined === baseline) {
      element.textContent = `${factors}。按当前权重，组合解与时间优先使用同一条路线。`;
      return;
    }
    const deltaTime = combined.minutes - baseline.minutes;
    const signed = value => Math.abs(value) < 0.05 ? '0.0' : (value >= 0 ? '+' : '') + value.toFixed(1);
    const change = signed(deltaTime);
    const slopeChange = signed(combined.maxSlope - baseline.maxSlope);
    const reference = new Set(baseline.path);
    const newCells = combined.path.filter(cell => !reference.has(cell)).length / combined.path.length;
    element.textContent = `已启用 ${factors}。相对时间优先，组合路线 ${Math.round(newCells * 100)}% 的网格不同，最大坡度 ${slopeChange}°，用时 ${change} 分钟。`;
  }

  function drawSegmentValues(ctx, screen, line, values) {
    const [min, max] = extent(values);
    const center = (min + max) / 2;
    const span = Math.max(max - min, ROUTE_FIELDS[coloring.value]?.[2] ?? 1);
    for (let i = 1; i < line.length; i++) {
      const value = (values[i - 1] + values[i]) / 2;
      const ratio = (value - center) / span + 0.5;
      ctx.strokeStyle = !Number.isFinite(value) ? '#9c9b9c'
        : coloring.value === 'light' ? (value >= 0.5 ? '#ffd575' : '#aa9bff')
        : `hsl(${220 - 189 * ratio} 85% 67%)`;
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
      ctx.fillText(key === 'start' ? '起' : '终', x, y + 3.5);
    }
    if (position) {
      const [x, y] = screen(position);
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffdfad'; ctx.fill(); ctx.strokeStyle = '#221912'; ctx.stroke();
    }
  }

  function renderCandidates() {
    routeList.replaceChildren(...result.candidates.map((candidate, index) => {
      const button = document.createElement('button'), label = document.createElement('strong'), detail = document.createElement('small');
      button.type = 'button'; button.className = 'nav-candidate'; button.style.setProperty('--route-color', PALETTE[index]);
      button.setAttribute('aria-pressed', String(index === selected));
      label.textContent = names(candidate);
      const metrics = `${km(candidate.distance)} · 爬升 ${Math.round(candidate.ascent)} 米 · 最大坡度 ${candidate.maxSlope.toFixed(1)}° · 阴影 ${Math.round(candidate.shadow / candidate.distance * 100)}%`;
      detail.textContent = result.coarse ? metrics : `${metrics} · 约 ${Math.round(candidate.minutes)} 分钟${candidate.feasible ? '' : ' · 超出可用时间'}`;
      button.append(label, detail);
      if (candidate.environment) {
        const env = candidate.environment, environmental = document.createElement('small');
        if (env.kind === 'regional') {
          environmental.textContent = `快照下日照路段 ${Math.round((1 - candidate.shadow / candidate.distance) * 100)}% · 地表温度 ${metric(env.meanTemperatureK, 2, 'K')} · 气压 ${metric(env.meanPressurePa, 2, 'Pa')}`;
          const thermal = document.createElement('small');
          thermal.textContent = `热惯量 ${metric(env.meanInertia, 1, 'J m⁻² K⁻¹ s⁻½')} · 其中插值 ${metric(env.interpolatedPercent, 0, '%')} · 平均太阳辐照潜势 ${metric(env.meanSolarWm2, 1, 'W/m²')}`;
          button.append(environmental, thermal);
        } else {
          environmental.textContent = `直射光 ${env.sunlitMinutes.toFixed(1)} 分 · 热红外参考 ${env.thermalKJm2.toFixed(1)} kJ/m² · 日照段 UV ${env.sunlitUvJm2.toFixed(2)} J/m² · 低压差 ${env.pressureDeficitPaMin.toFixed(0)} Pa·分`;
          button.append(environmental);
        }
      }
      button.onclick = () => {
        selected = index; minute = 0; position = null; stop();
        if (view) { view.setColor(PALETTE[index]); view.setPlan(candidate); updateProgress(); }
        [...routeList.children].forEach((item, i) => item.setAttribute('aria-pressed', String(i === index)));
        updateRouteLayers();
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
    const mode = $('nav-source').value, endpoints = [points.start, points.goal];
    try {
      const hasObservation = Boolean(medaSelect.value) && !regional();
      if (hasObservation && mode !== 'auto' && mode !== 'local') {
        throw Error('MEDA 场景使用 Hawksbill Gap 的 HiRISE 验证区。请选择自动或米级高程。');
      }
      const terrain = await loadAtlasTerrain(hasObservation ? 'local' : mode, endpoints, pending.abort.signal, message => {
        if (task === pending) status.textContent = message;
      });
      if (task !== pending) return;
      const { grid, label, source, coarse } = terrain;
      if (!coarse && settings.reserve >= settings.budget) throw Error('预留时间必须小于总时间预算。');
      const [start, goal] = endpoints.map(point => atlasCell(grid, point));
      if (!start || !goal || (start[0] === goal[0] && start[1] === goal[1])) {
        throw Error('两点需要落在不同的有效高程网格内。请拉开距离或选择更精细的高程。');
      }
      const returnToBase = $('nav-return').checked;
      const route = { start, base: start, stops: [{ cell: goal, name: '目的地' }], closures: [],
        limit: settings.slope, speed: settings.speed, budget: settings.budget, reserve: settings.reserve, returnToBase };
      if (medaSelect.value) {
        const weights = Object.fromEntries(WEIGHTS.map(key => [key, $(`weight-${key}`).valueAsNumber]));
        if (regional()) {
          status.textContent = `${label}。正在读取规划区域的 TES 和 OpenMARS 数据…`;
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
            line: candidate.path.map(index => atlasLonLat(grid, cellXY(grid, cellOf(grid, index)))) }));
          result = { grid, light: data.light, candidates, coarse, coverage: data.coverage };
          selected = 0;
          const scenario = route.environment?.observation;
          const observationLabel = scenario ? ` · NASA MEDA Sol ${scenario.sol} ${scenario.localTrueSolarTime} LTST`
            : data.coverage ? ' · 区域多参数' : '';
          status.textContent = `${label}${observationLabel}。${candidates.length} 条候选路线。${coarse ? 'MOLA 用于大尺度地形筛选。' : ''}`;
          const coverage = data.coverage;
          if (coverage) {
            const enabled = coverage.active.join('、') || '行进时间';
            const spacing = coverage.thermalSpacing ? coverage.thermalSpacing + '°' : '缺测';
            $('nav-coverage').textContent = `已启用 ${enabled}。OpenMARS 5°，TES ${spacing}，模拟当地太阳时约 ${coverage.hour.toFixed(1)} h。${coverage.disabled.length ? '覆盖不完整，已跳过 ' + coverage.disabled.join('、') + '。' : ''}`;
          } else {
            $('nav-coverage').textContent = scenario ? '使用 Hawksbill Gap 原位历史观测。' : '按高程、坡度和模拟日照规划。';
          }
          renderCandidates();
          updateComparison();
          updateRouteLayers();
          fit(candidates.flatMap(candidate => candidate.line));
          viewButton.hidden = false;
        } catch (error) { status.textContent = `${label}。 ${error.message}`; }
        finally { finish(pending); }
      };
      pending.worker.onerror = () => {
        if (task !== pending) return;
        status.textContent = '浏览器路线计算失败。请重试。'; finish(pending);
      };
      const sourceLink = $('nav-data-link');
      sourceLink.href = source; sourceLink.hidden = false;
      status.textContent = route.environment
        ? `${label}已就绪，正在比较多参数组合与时间优先路线…`
        : `${label}已就绪，正在比较时间、地形和模拟光照…`;
      pending.worker.postMessage({ type: 'grid', grid });
      pending.worker.postMessage({ route, hour: settings.hour, season: settings.season });
    } catch (error) {
      if (task !== pending) return;
      status.textContent = error.name === 'TimeoutError' ? '官方高程服务响应超时，请重试或缩短路线。' : error.message;
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
    view.update(pos, light);
    position = atlasLonLat(grid, pos.xy);
    progress.value = Math.round(minute / candidate.minutes * 1000);
    const [row, col] = pos.cell, cell = row * grid.cols + col;
    const elevation = Math.round(grid.height[cell]), slope = grid.slope[cell].toFixed(1);
    $('nav-position').textContent = `${fmt(position)} · 高程 ${elevation} m · 坡度 ${slope}° · 已走 ${km(pos.distance)} / ${km(candidate.distance)}${coarse ? ' · MOLA 地形走廊回放' : ` · 模拟第 ${minute.toFixed(1)} 分钟`}`;
  }

  function play(now) {
    if (!frame || !view) return;
    const duration = result.candidates[selected].minutes;
    minute = Math.min(duration, minute + (now - last) / 36000 * duration);
    last = now; updateProgress();
    if (minute >= duration) stop(); else frame = requestAnimationFrame(play);
  }

  async function open3d() {
    if (!result || viewTask) return;
    const controller = new AbortController();
    viewTask = controller; viewButton.disabled = true;
    const { grid, candidates } = result;
    try {
      const { TerrainView } = await import('./terrain-view.js');
      if (viewTask !== controller) return;
      host.hidden = false; playback.hidden = false; canvas.hidden = true; $('atlas-zoom').hidden = true;
      const textureStatus = $('nav-texture');
      const imageSource = grid.id === 'jezero' ? 'Jezero 区域 CTX 缓存和配准影像' : 'HiRISE 高程与配准正射';
      textureStatus.textContent = grid.id ? imageSource + '。高程增强用于显示坡面与细节。' : '正在加载 NASA Mars Trek 官方影像贴图…';
      view = new TerrainView(host, grid, candidates[selected], { color: PALETTE[selected], atlas: true });
      updateDisplay();
      view.setFollow($('nav-follow').checked);
      updateProgress();
      host.scrollIntoView({ block: 'nearest' });
      $('nav-back').focus({ preventScroll: true });
      if (!grid.id) {
        const texture = await atlasTexture(grid, controller.signal);
        if (viewTask === controller) {
          if (texture) view.setTexture(texture);
          textureStatus.textContent = texture ? '光学样式使用 NASA Mars Trek 贴图，地形增强使用数值高程。' : '官方影像暂不可用，当前显示数值高程地形。';
        }
      }
    } catch {
      if (viewTask !== controller) return;
      if (!view) {
        close3d(); status.textContent = '浏览器无法启动三维 WebGL。二维路线仍可查看。';
      } else $('nav-texture').textContent = '官方影像暂不可用，当前显示数值高程地形。';
    }
  }

  for (const key of Object.keys(points)) $(`nav-${key}`).onclick = () => arm(key);
  $('nav-reset').onclick = () => {
    cancelPick(); points.start = points.goal = null; resetResult();
    status.textContent = '在地图上依次选择出发地和目的地。';
  };
  medaSelect.addEventListener('change', updateObservation);
  async function demo(id, targetIndex, mode, run) {
    try {
      const sites = await atlasSites();
      const site = sites.find(item => item.id === id);
      if (!site?.base || !site.targets?.[targetIndex]?.cell) throw Error('当前版本没有可用的示例点。');
      cancelPick();
      cancelProfile();
      resetResult();
      points.start = atlasLonLat(site, cellXY(site, site.base));
      points.goal = atlasLonLat(site, cellXY(site, site.targets[targetIndex].cell));
      $('nav-source').value = mode;
      fit([points.start, points.goal]); buttons(); paint();
      if (run) {
        medaSelect.value = 'regional';
        updateObservation();
        $('nav-form').requestSubmit();
      } else status.textContent = '已设置 Hawksbill Gap 示例点。可调整权重或计算路线。';
    } catch (error) {
      status.textContent = error.message;
    }
  }
  $('nav-meda-demo').onclick = () => demo('hawksbill', 0, 'auto', false);
  $('nav-regional-demo').onclick = () => demo('jezero', 1, 'jezero', true);

  const scaleRange = $('nav-exaggeration'), scaleNumber = $('nav-exaggeration-number');
  function updateDisplay() { view?.setDisplay($('nav-relief').value, scaleRange.value); }
  function setScale(value) {
    if (!Number.isFinite(value)) value = scaleRange.valueAsNumber;
    const scale = Math.max(1, Math.min(6, value)).toFixed(1);
    scaleRange.value = scale;
    scaleNumber.value = scale;
    $('nav-scale-label').value = '×' + scale;
    updateDisplay();
  }
  $('nav-relief').onchange = updateDisplay;
  scaleRange.oninput = () => setScale(scaleRange.valueAsNumber);
  scaleNumber.onchange = () => setScale(scaleNumber.valueAsNumber);
  $('nav-true-scale').onclick = () => setScale(1);
  coloring.onchange = () => { updateLegend(); paint(); };
  $('nav-form').onsubmit = plan;
  $('nav-form').onchange = () => {
    if (!result && !task) return;
    resetResult(); status.textContent = '设置已更新，请重新计算路线。';
  };
  $('nav-back').onclick = () => close3d(true);
  viewButton.onclick = open3d;
  $('nav-follow').onchange = event => view?.setFollow(event.target.checked);
  playButton.onclick = () => {
    if (frame) { stop(); return; }
    if (minute >= result.candidates[selected].minutes) minute = 0;
    last = performance.now(); frame = requestAnimationFrame(play); playButton.textContent = '暂停';
  };
  progress.oninput = () => {
    stop(); minute = +progress.value / 1000 * result.candidates[selected].minutes; updateProgress();
  };
  return { pick, cancelPick, draw };
}
