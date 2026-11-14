import { cellOf, cellXY, progressAt } from './planner.js';
import { atlasCell, atlasLonLat, atlasTexture, loadAtlasTerrain } from './atlas-terrain.js';

const $ = id => document.getElementById(id);
const PALETTE = ['#86f8c1', '#ffc18e', '#b8c5ff'];
const PROFILES = { time: '时间优先', terrain: '地形优先', light: '少阴影优先' };
const ENDPOINTS = { start: '出发地', goal: '目的地' };
const names = route => route.profiles.map(profile => PROFILES[profile]).join(' / ');
const km = distance => (distance / 1000).toFixed(2) + ' 公里';

export function attachAtlasNavigation({ canvas, fmt, paint, cancelProfile, fit }) {
  const status = $('nav-status'), host = $('atlas-3d'), playback = $('nav-playback');
  const planButton = $('nav-plan'), viewButton = $('nav-3d');
  const progress = $('nav-progress'), playButton = $('nav-play');
  const routeList = $('nav-routes');
  const points = { start: null, goal: null };
  let armed, task, result, view, viewTask, selected = 0, frame = 0, last = 0, minute = 0, position;

  function buttons() {
    for (const key of Object.keys(points)) {
      $(`nav-${key}`).setAttribute('aria-pressed', String(key === armed));
      $(`nav-${key}-coord`).textContent = points[key] ? fmt(points[key]) : '未选择';
    }
    planButton.disabled = !points.start || !points.goal || Boolean(task);
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
        ctx.lineWidth = index === selected ? 3.5 : 2; ctx.strokeStyle = PALETTE[index]; ctx.stroke();
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
      button.onclick = () => {
        selected = index; minute = 0; position = null; stop();
        if (view) { view.setColor(PALETTE[index]); view.setPlan(candidate); updateProgress(); }
        [...routeList.children].forEach((item, i) => item.setAttribute('aria-pressed', String(i === index)));
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
      const terrain = await loadAtlasTerrain(mode, endpoints, pending.abort.signal, message => {
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
      pending.worker = new Worker('planner-worker.js', { type: 'module' });
      pending.worker.onmessage = ({ data }) => {
        if (task !== pending) return;
        try {
          if (data.error) throw Error(data.error);
          const mixedLight = data.light?.mask.includes(0) && data.light.mask.includes(1);
          const candidates = data.candidates.map(candidate => ({ ...candidate,
            profiles: mixedLight ? candidate.profiles : candidate.profiles.filter(profile => profile !== 'light'),
            line: candidate.path.map(index => atlasLonLat(grid, cellXY(grid, cellOf(grid, index)))) }));
          result = { grid, light: data.light, candidates, coarse };
          selected = 0;
          status.textContent = `${label}。${candidates.length} 条路线。不同策略若经过相同网格会合并。${coarse ? '仅用于比较大尺度地形，时间预算不用于筛选走廊。' : ''}`;
          renderCandidates();
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
      status.textContent = `${label}已就绪，正在比较时间、地形和模拟光照…`;
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
    $('nav-position').textContent = `${fmt(position)} · 已走 ${km(pos.distance)} / ${km(candidate.distance)}${coarse ? ' · MOLA 地形走廊回放' : ` · 模拟第 ${minute.toFixed(1)} 分钟`}`;
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
      textureStatus.textContent = grid.id ? '三维地形与贴图来自 HiRISE 高程和正射影像。' : '正在加载 NASA Mars Trek 官方影像贴图…';
      view = new TerrainView(host, grid, candidates[selected], { color: PALETTE[selected] });
      view.setFollow($('nav-follow').checked);
      updateProgress();
      host.scrollIntoView({ block: 'nearest' });
      $('nav-back').focus({ preventScroll: true });
      if (!grid.id) {
        const texture = await atlasTexture(grid, controller.signal);
        if (viewTask === controller) {
          if (texture) view.setTexture(texture);
          textureStatus.textContent = texture ? '三维贴图来自 NASA Mars Trek。' : '官方影像暂不可用，当前显示数值高程地形。';
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
