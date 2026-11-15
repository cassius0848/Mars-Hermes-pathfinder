import { layers, officialLayerUrl, readCapabilities, tilesInView, viewportGeology, hiRiseProducts, molaProfile, molaExport,
  CTX_DEM, ctxWindow, fetchCtxTerrain } from './mars-data.js';
import { attachAtlasNavigation } from './atlas-navigation.js';
import { craterSources } from './crater-sources.js';
import { frameTask } from './render-runtime.js';

const $ = id => document.getElementById(id);
const canvas = $('surface');
const ctx = canvas.getContext('2d');
const atlasViews = {
  global: { center: [0, 0], span: 360 },
  jezero: { center: [77.74, 18.44], span: 1.7 },
  gale: { center: [137.4, -4.6], span: 2.6 },
  endeavour: { center: [-5.53, -1.95], span: 2.6 },
  eberswalde: { center: [-33.3, -23.8], span: 2.2 },
  hawksbill: { center: [77.406, 18.4588], span: 0.022 },
  neretva: { center: [77.303, 18.4945], span: 0.035 },
};
const classicCraters = [
  { id: 'jezero', label: 'Jezero', center: [77.74, 18.44] },
  { id: 'gale', label: 'Gale', center: [137.4, -5.4] },
  { id: 'endeavour', label: 'Endeavour', center: [-5.53, -1.95] },
  { id: 'eberswalde', label: 'Eberswalde', center: [-33.3, -23.8] },
];
const classicRoute = ['jezero', 'gale', 'endeavour', 'eberswalde'];
const tileCache = new Map();
const shown = new Map();
const colors = ['#e8a47d', '#8ad5b5', '#e9d088', '#b9b9ed', '#96bcdb', '#eaa6bb'];
const requested = new URLSearchParams(location.search).get('area');
const initialView = Object.hasOwn(atlasViews, requested) ? requested : 'jezero';
const state = { ...atlasViews[initialView], center: [...atlasViews[initialView].center], viewId: initialView, epoch: 0, points: [], picking: false };
const paint = frameTask(renderMap);
const overlays = [...document.querySelectorAll('[data-overlay]')];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const toolTabs = [...document.querySelectorAll('.atlas-tabs [role="tab"]')];
function showToolTab(current, focus = false) {
  for (const tab of toolTabs) {
    const active = tab === current;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    $(tab.getAttribute('aria-controls')).hidden = !active;
  }
  if (focus) current.focus();
}
toolTabs.forEach((tab, index) => {
  tab.addEventListener('click', () => showToolTab(tab));
  tab.addEventListener('keydown', event => {
    const next = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: toolTabs.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    showToolTab(toolTabs[(next + toolTabs.length) % toolTabs.length], true);
  });
});

const navigation = attachAtlasNavigation({
  canvas, fmt, paint,
  cancelProfile() {
    state.profileRequest?.abort(); state.profileRequest = null;
    if (state.picking) {
      state.picking = false; state.points = [];
      $('profile-status').textContent = '沿两点连线查询 NASA MOLA 高程。';
    }
  },
  fit(points) {
    let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
    for (const [lon, lat] of points) {
      west = Math.min(west, lon); east = Math.max(east, lon);
      south = Math.min(south, lat); north = Math.max(north, lat);
    }
    state.center = [(west + east) / 2, (south + north) / 2];
    state.span = clamp(1.33 * Math.max(east - west, (north - south) * state.w / state.h), 0.002, 360);
    schedule();
  },
});

function screen([lon, lat]) {
  return [(lon - state.center[0]) * state.scale + state.w / 2, (state.center[1] - lat) * state.scale + state.h / 2];
}

function coord(x, y) {
  return [state.center[0] + (x - state.w / 2) / state.scale, state.center[1] - (y - state.h / 2) / state.scale];
}

function fmt([lon, lat]) {
  return `${Math.abs(lon).toFixed(5)}°${lon < 0 ? 'W' : 'E'} · ${Math.abs(lat).toFixed(5)}°${lat < 0 ? 'S' : 'N'}`;
}

function frame() {
  const [west, north] = coord(0, 0), [east, south] = coord(state.w, state.h);
  return [Math.max(west, -180), Math.max(south, -90), Math.min(east, 180), Math.min(north, 90)];
}

function mark(poly, close) {
  poly.forEach((point, i) => {
    const [x, y] = screen(point);
    if (i && Math.abs(poly[i - 1][0] - point[0]) < 180) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  });
  if (close) ctx.closePath();
}

function geologicColor(unit) {
  const id = [...String(unit ?? '')].reduce((sum, char) => (31 * sum + char.codePointAt(0)) | 0, 0);
  return colors[Math.abs(id) % colors.length];
}

function drawClassicNetwork() {
  if (state.viewId !== 'global') return;
  const byId = new Map(classicCraters.map(crater => [crater.id, crater]));
  ctx.save();
  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = '#f5d892';
  ctx.lineWidth = 2;
  ctx.beginPath();
  classicRoute.forEach((id, index) => {
    const [x, y] = screen(byId.get(id).center);
    if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  });
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = '600 12px system-ui';
  ctx.textAlign = 'left';
  for (const crater of classicCraters) {
    const [x, y] = screen(crater.center);
    if (x < -80 || x > state.w + 80 || y < -40 || y > state.h + 40) continue;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#f5d892';
    ctx.fill();
    ctx.strokeStyle = '#241f1b';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#fff1c7';
    ctx.fillText(crater.label, x + 10, y - 9);
  }
  ctx.restore();
}

function renderMap() {
  ctx.fillStyle = '#191715'; ctx.fillRect(0, 0, state.w, state.h);
  for (const [id, tiles] of shown) {
    ctx.globalAlpha = id === 'ctx' || id === 'hirise' ? Number($('image-opacity').value) / 100 : 1;
    for (const tile of tiles) {
      const entry = tileCache.get(tile.url);
      if (entry?.status !== 'loaded') continue;
      const [x, y] = screen([tile.lon, tile.lat]);
      const size = tile.degrees * state.scale;
      ctx.drawImage(entry.image, x, y, size, size);
    }
  }
  ctx.globalAlpha = 1;
  drawClassicNetwork();
  if (state.ctxTerrain) {
    const { data, image } = state.ctxTerrain;
    const [x, y] = screen([data.lon, data.lat]);
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 0.8;
    ctx.drawImage(image, x, y, data.dLon * state.scale, data.dLat * state.scale);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
  }
  for (const shape of state.geology?.features ?? []) {
    ctx.beginPath(); shape.rings.forEach(ring => mark(ring, true));
    const color = geologicColor(shape.unit);
    ctx.fillStyle = `${color}33`; ctx.strokeStyle = color; ctx.lineWidth = 1;
    ctx.fill('evenodd'); ctx.stroke();
  }
  for (const polygon of state.footprint ?? []) {
    ctx.beginPath(); polygon.forEach(ring => mark(ring, true));
    ctx.fillStyle = '#e9d08828'; ctx.strokeStyle = '#f5d892'; ctx.lineWidth = 2;
    ctx.fill('evenodd'); ctx.stroke();
  }
  if (state.points.length === 2) {
    ctx.beginPath(); mark(state.profileTrack?.map(point => point.lonlat) ?? state.points, false);
    ctx.strokeStyle = '#b9f5cf'; ctx.lineWidth = 2; ctx.stroke();
  }
  state.points.forEach((point, i) => {
    const [x, y] = screen(point);
    ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#b9f5cf'; ctx.fill(); ctx.fillStyle = '#1f271e';
    ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'center'; ctx.fillText(i + 1, x, y + 3.5);
  });
  navigation.draw(ctx, screen);
  const axes = $('location');
  const label = `中心 ${fmt(state.center)} · 横向约 ${(state.w / state.scale).toFixed(state.span < 0.15 ? 3 : 1)}°`;
  if (axes.textContent !== label) axes.textContent = label;
}

function tileStatus() {
  const active = [...shown.values()].flat();
  const ready = active.filter(tile => tileCache.get(tile.url)?.status === 'loaded').length;
  const failed = active.filter(tile => tileCache.get(tile.url)?.status === 'failed').length;
  const layers = [...shown].filter(([, tiles]) => tiles.length).map(([key]) => key);
  const extra = state.layerErrors?.length ? ` · ${state.layerErrors.join('、')}暂不可用` : '';
  const status = active.length ? `NASA 在线瓦片 ${ready}/${active.length} · ${layers.length} 层${failed ? ` · ${failed} 张未返回` : ''}${extra}`
    : state.loading ? '正在读取 NASA 图层和当前视野…' : `当前视野暂无可显示瓦片${extra}`;
  if ($('tile-status').textContent !== status) $('tile-status').textContent = status;
}

function loadTile(url) {
  if (tileCache.has(url)) {
    const entry = tileCache.get(url);
    tileCache.delete(url); tileCache.set(url, entry);
    if (entry.status !== 'failed' || Date.now() - entry.failedAt < 20000) return;
  }
  const image = new Image();
  const entry = { image, status: 'loading' };
  tileCache.set(url, entry);
  const done = status => {
    entry.status = status;
    if (status === 'failed') entry.failedAt = Date.now();
    paint(); tileStatus();
  };
  image.onload = () => done('loaded'); image.onerror = () => done('failed');
  image.src = url;
}

function pruneTiles() {
  const active = new Set([...shown.values()].flat().map(tile => tile.url));
  for (const url of tileCache.keys()) {
    if (tileCache.size <= 260) break;
    if (!active.has(url)) tileCache.delete(url);
  }
}

function geologyExtent(bbox) {
  return bbox[0] < 79.5 && bbox[2] > 75.5 && bbox[1] < 20 && bbox[3] > 16;
}

async function refresh() {
  const epoch = ++state.epoch;
  const base = $('base').value, bbox = frame();
  state.loading = true; state.layerErrors = [];
  const keys = [base, ...overlays.filter(el => el.checked && state.span <= 7 && Number($('image-opacity').value) > 0
    && (el.value !== 'hirise' || state.span <= 0.25)).map(el => el.value)];
  $('base-source').href = officialLayerUrl(layers[base]);
  $('dem-export').hidden = state.span > 60;
  if (state.span <= 60) $('dem-export').href = molaExport(bbox);
  const results = await Promise.allSettled(keys.map(key => readCapabilities(layers[key])));
  if (epoch !== state.epoch) return;
  shown.clear();
  for (let i = 0; i < keys.length; i++) {
    const result = results[i], key = keys[i];
    if (result.status === 'rejected') { state.layerErrors.push(layers[key].title); continue; }
    const tiles = tilesInView(result.value, bbox, state.scale);
    shown.set(key, tiles); tiles.forEach(tile => loadTile(tile.url));
  }
  state.loading = false; pruneTiles(); paint(); tileStatus();
}

function clearGeology() {
  state.geoRequest?.abort(); state.geoRequest = null;
  state.geology = null;
  $('geo-legend').replaceChildren();
}

async function refreshGeology() {
  clearGeology();
  const status = $('geo-status'), bbox = frame();
  if (!$('geology').checked) { status.textContent = ''; paint(); return; }
  if (state.span > 4) { status.textContent = '放大到 Jezero–Nili Planum 可查看区域地质面。'; paint(); return; }
  if (!geologyExtent(bbox)) { status.textContent = '当前视野超出 SIM 3464 区域制图范围。'; paint(); return; }
  const controller = new AbortController(); state.geoRequest = controller;
  status.textContent = '正在向 USGS 查询地质面…';
  try {
    const result = await viewportGeology(bbox, controller.signal);
    if (controller !== state.geoRequest) return;
    state.geology = result;
    const labels = new Map(result.features.map(feature => [feature.unit, feature.name]));
    const items = Array.from(labels, ([unit, name]) => {
      const span = document.createElement('span'), color = document.createElement('span');
      color.className = 'swatch'; color.style.backgroundColor = geologicColor(unit);
      span.append(color, unit ? `${unit} · ${name}` : name); return span;
    });
    if (items.length) items.push(link('查看 USGS 原始响应 ↗', result.url));
    $('geo-legend').replaceChildren(...items);
    status.textContent = result.features.length ? `USGS 返回 ${result.features.length} 个地质面${result.partial ? ' · 请放大查看剩余要素' : ''}` : '当前视野没有 SIM 3464 已制图地质面。';
  } catch {
    if (controller === state.geoRequest) status.textContent = 'USGS 地质服务暂不可用，可平移、缩放或重开图层重试。';
  }
  paint();
}

function schedule() {
  state.epoch++;
  state.scale = state.w / Math.min(state.span, 360);
  if (state.span === 360) state.scale = Math.min(state.scale, state.h / 180);
  const halfLon = state.w / (2 * state.scale), halfLat = state.h / (2 * state.scale);
  state.center[0] = halfLon >= 180 ? 0 : clamp(state.center[0], -180 + halfLon, 180 - halfLon);
  state.center[1] = halfLat >= 90 ? 0 : clamp(state.center[1], -90 + halfLat, 90 - halfLat);
  paint();
  state.productRequest?.abort(); state.productRequest = null;
  $('search-products').disabled = state.span > 4;
  $('product-status').textContent = state.span > 4 ? '请先放大到较小区域。' : '可查原始 HiRISE 高程和正射数据。';
  $('products').replaceChildren(); $('product-source').hidden = true;
  state.footprint = null;
  clearTimeout(state.refreshTimer); clearTimeout(state.geoTimer);
  state.refreshTimer = setTimeout(refresh, 80);
  state.geoRequest?.abort(); state.geoRequest = null;
  state.geoTimer = setTimeout(refreshGeology, 300);
  state.ctxRequest?.abort(); state.ctxRequest = null;
  clearTimeout(state.ctxTimer);
  state.ctxTimer = setTimeout(refreshCtx, 400);
}

async function refreshCtx() {
  state.ctxRequest?.abort(); state.ctxRequest = null;
  state.ctxTerrain = null; paint();
  const status = $('ctx-status');
  if (!$('ctx-elevation').checked) { status.textContent = ''; return; }
  const window = ctxWindow(frame());
  if (!window) { status.textContent = '当前视野超出 Jezero CTX 高程覆盖。'; return; }
  if (state.span > 0.18 || window.height > 650 || window.width > 650) {
    status.textContent = '放大到约 10 公里以内，可读取当前视野的 20 米数值高程。'; return;
  }
  const controller = new AbortController(); state.ctxRequest = controller;
  status.textContent = '正在从 USGS 读取 20 米高程切片…';
  try {
    const data = await fetchCtxTerrain(window, controller.signal);
    if (state.ctxRequest !== controller) return;
    if (!data.valid) { status.textContent = '当前视野的 CTX 高程没有有效像元。'; return; }
    const image = document.createElement('canvas');
    image.width = data.width; image.height = data.height;
    const context = image.getContext('2d'), pixels = context.createImageData(data.width, data.height);
    data.values.forEach((z, i) => {
      if (!Number.isFinite(z)) return;
      const t = (z - data.min) / Math.max(data.max - data.min, 1);
      pixels.data.set([37 + 218 * t, 87 + 112 * t, 113 - 16 * t, 255], 4 * i);
    });
    context.putImageData(pixels, 0, 0);
    state.ctxTerrain = { data, image }; paint();
    status.replaceChildren(`USGS 20 米 · ${data.valid}/${data.values.length} 个有效像元 · 低处蓝色 ${data.min.toFixed(0)} m，高处金色 ${data.max.toFixed(0)} m。 `,
      link('原始高程 TIFF ↗', CTX_DEM));
  } catch (error) {
    controller.abort();
    if (state.ctxRequest === controller) status.textContent = error.message;
  }
}

function zoom(factor, x = state.w / 2, y = state.h / 2) {
  const at = coord(x, y);
  state.span = clamp(state.span * factor, 0.005, 360);
  const scale = state.w / state.span;
  state.center = [at[0] - (x - state.w / 2) / scale, at[1] + (y - state.h / 2) / scale];
  schedule();
}

function link(title, url) {
  const a = document.createElement('a');
  a.href = url; a.target = '_blank'; a.rel = 'noreferrer'; a.textContent = title;
  return a;
}

function routeMetrics(track) {
  let ascent = 0, descent = 0, maxGrade = 0;
  for (let i = 1; i < track.length; i++) {
    const previous = track[i - 1], current = track[i];
    if (!Number.isFinite(previous.z) || !Number.isFinite(current.z)) continue;
    const dz = current.z - previous.z;
    const meters = Math.max((current.km - previous.km) * 1000, 1);
    if (dz >= 0) ascent += dz; else descent -= dz;
    maxGrade = Math.max(maxGrade, Math.abs(dz) / meters * 100);
  }
  return { ascent, descent, maxGrade };
}

function drawChart(track) {
  const svg = $('height-chart');
  const good = track.filter(point => Number.isFinite(point.z));
  const lo = Math.min(...good.map(p => p.z)), hi = Math.max(...good.map(p => p.z)), distance = track.at(-1).km;
  const x = km => 49 + km / distance * 250;
  const y = z => 117 - (z - lo) / Math.max(hi - lo, 1) * 93;
  const add = (tag, attrs, text) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (text != null) node.textContent = text;
    svg.append(node);
  };
  svg.replaceChildren();
  for (const z of new Set([lo, hi])) {
    add('line', { x1: 49, x2: 300, y1: y(z), y2: y(z), stroke: '#55453a' });
    add('text', { x: 4, y: y(z) + 4, fill: '#cfbfaf', 'font-size': 10 }, `${z} m`);
  }
  let path = '', continuing = false;
  for (const point of track) {
    if (!Number.isFinite(point.z)) { continuing = false; continue; }
    path += `${continuing ? 'L' : 'M'} ${x(point.km)} ${y(point.z)} `; continuing = true;
  }
  add('path', { d: path, fill: 'none', stroke: '#a9edc4', 'stroke-width': 2 });
  add('text', { x: 299, y: 136, fill: '#cfbfaf', 'font-size': 10, 'text-anchor': 'end' }, `${distance.toFixed(2)} km`);
  svg.removeAttribute('hidden');
}

async function pick(point) {
  if (navigation.pick(point)) return;
  if (!state.picking || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) return;
  state.points.push(point); paint();
  const status = $('profile-status');
  if (state.points.length < 2) { status.textContent = `起点 ${fmt(point)}。请选择终点。`; return; }
  state.picking = false; canvas.classList.remove('picking');
  status.textContent = '正在向 NASA 请求 24 个 MOLA 高程样点…';
  const controller = new AbortController(); state.profileRequest = controller;
  try {
    const { url, track } = await molaProfile(...state.points, controller.signal);
    if (controller !== state.profileRequest) return;
    state.profileTrack = track; paint();
    const count = track.filter(p => Number.isFinite(p.z)).length;
    const metrics = routeMetrics(track);
    status.textContent = count > 1
      ? `NASA 返回 ${count}/${track.length} 个有效高程 · 长约 ${track.at(-1).km.toFixed(2)} km · 上升 ${metrics.ascent.toFixed(0)} m · 下降 ${metrics.descent.toFixed(0)} m · 最大坡度约 ${metrics.maxGrade.toFixed(1)}%`
      : '有效 MOLA 样本不足，请重选。';
    $('profile-source').href = url; $('profile-source').hidden = false;
    if (count > 1) drawChart(track);
  } catch (error) {
    if (controller === state.profileRequest) status.textContent = error.message;
  }
}

async function search() {
  if (state.span > 4) return;
  state.productRequest?.abort();
  const controller = new AbortController(); state.productRequest = controller;
  $('search-products').disabled = true; $('product-status').textContent = '正在查询 USGS HiRISE 目录…';
  try {
    const result = await hiRiseProducts(frame(), controller.signal);
    if (controller !== state.productRequest) return;
    const items = result.features.map(item => {
      const li = document.createElement('li');
      li.append(item.id, document.createElement('br'));
      if (['Polygon', 'MultiPolygon'].includes(item.geometry?.type)) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = '显示覆盖';
        button.onclick = () => {
          state.footprint = item.geometry.type === 'Polygon' ? [item.geometry.coordinates] : item.geometry.coordinates;
          paint();
        };
        li.append(button, ' ');
      }
      for (const [label, asset] of [['高程', item.assets?.dtm], ['正射示例', item.assets?.ortho_2 ?? item.assets?.ortho_0], ['质量图', item.assets?.fom]]) {
        if (asset?.href?.startsWith('https://')) li.append(link(label, asset.href));
      }
      return li;
    });
    $('products').replaceChildren(...items);
    $('product-status').textContent = items.length ? `USGS 返回 ${items.length} 个产品${result.more ? ' · 可放大缩小搜索范围' : ''}` : '这个视野未找到单幅立体高程产品，可平移或扩大范围重查。';
    $('product-source').href = result.url; $('product-source').hidden = false;
  } catch {
    if (controller === state.productRequest) $('product-status').textContent = 'USGS 目录暂不可用，请重试。';
  } finally {
    if (controller === state.productRequest) $('search-products').disabled = false;
  }
}

new ResizeObserver(() => {
  const { width, height } = canvas.getBoundingClientRect(), ratio = Math.min(devicePixelRatio, 2);
  if (!width || !height) return;
  state.w = width; state.h = height;
  canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  schedule();
}).observe(canvas);
const craterNames = {
  jezero: 'Jezero', gale: 'Gale', endeavour: 'Endeavour', eberswalde: 'Eberswalde',
  hawksbill: 'Hawksbill Gap', neretva: 'Neretva Vallis',
};
function renderCraterSources(id) {
  const key = ['global', 'hawksbill', 'neretva'].includes(id) ? 'jezero' : id;
  const source = craterSources[key] ?? craterSources.jezero;
  const list = $('crater-sources');
  if (!list) return;
  const entries = source.links.map(item => {
    const li = document.createElement('li');
    li.append(link(item.label, item.url));
    if (item.note) li.append(document.createTextNode(` · ${item.note}`));
    return li;
  });
  list.replaceChildren(...entries);
  $('crater-source-status').textContent = `${source.label} · ${source.resolution} · ${source.status}`;
}

function updateWalkLink(id) {
  const area = id === 'global' ? 'jezero' : id;
  const name = craterNames[area] ?? 'Jezero';
  if (['jezero', 'hawksbill', 'neretva'].includes(area)) {
    $('walk-link').href = `./mission.html?area=${area}`;
    $('walk-link').textContent = `${name} 任务区 →`;
  } else {
    $('walk-link').href = `./atlas.html?area=${area}`;
    $('walk-link').textContent = `${name} 资料与剖面 →`;
  }
}

updateWalkLink(initialView);
renderCraterSources(initialView);
navigation.setArea(initialView);
$('atlas-area').value = initialView;
$('atlas-network-note').hidden = initialView !== 'global';
$('atlas-area').onchange = () => {
  const id=$('atlas-area').value,view=atlasViews[id];
  updateWalkLink(id);
  renderCraterSources(id);
  state.viewId = id;
  navigation.setArea(id);
  state.center = [...view.center]; state.span = view.span; schedule();
  $('atlas-network-note').hidden = id !== 'global';
  const url=new URL(location.href);url.searchParams.set('area',id);url.hash='';history.replaceState(null,'',url);
};
$('base').onchange = () => { shown.clear(); $('image-opacity').value = $('base').value === 'viking' ? 100 : 0; schedule(); };
$('image-opacity').oninput = paint;
$('image-opacity').onchange = () => { clearTimeout(state.refreshTimer); refresh(); };
overlays.forEach(el => { el.onchange = () => { if (!el.checked) shown.delete(el.value); schedule(); }; });
$('geology').onchange = refreshGeology;
$('ctx-elevation').onchange = refreshCtx;
$('closer').onclick = () => zoom(0.6);
$('farther').onclick = () => zoom(1.7);
$('pick-profile').onclick = () => {
  navigation.cancelPick();
  if (canvas.hidden) $('nav-back').click();
  state.profileRequest?.abort(); state.profileRequest = null;
  state.points = []; state.profileTrack = null; state.picking = true;
  canvas.classList.add('picking'); canvas.focus();
  $('profile-status').textContent = '在地图上选取剖面起点。';
  $('height-chart').setAttribute('hidden', ''); $('profile-source').hidden = true; paint();
};
$('search-products').onclick = search;
canvas.addEventListener('wheel', e => {
  e.preventDefault(); zoom(Math.exp(clamp(e.deltaY, -200, 200) * 0.004), e.offsetX, e.offsetY);
}, { passive: false });
let drag;
canvas.addEventListener('pointerdown', e => {
  if (!e.isPrimary || e.button !== 0) return;
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, center: [...state.center], moved: false };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  if (drag?.id !== e.pointerId) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 5) return;
  drag.moved = true; canvas.classList.add('dragging');
  state.center = [drag.center[0] - dx / state.scale, drag.center[1] + dy / state.scale]; schedule();
});
function endDrag(e) {
  if (drag?.id !== e.pointerId) return;
  if (!drag.moved && e.type === 'pointerup') pick(coord(e.offsetX, e.offsetY));
  drag = null; canvas.classList.remove('dragging');
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('keydown', e => {
  const moves = { ArrowLeft: [-0.15, 0], ArrowRight: [0.15, 0], ArrowUp: [0, 0.15], ArrowDown: [0, -0.15] };
  if (moves[e.key]) {
    e.preventDefault(); state.center = state.center.map((value, i) => value + moves[e.key][i] * state.span); schedule();
  } else if (['+', '=', '-'].includes(e.key)) { e.preventDefault(); zoom(e.key === '-' ? 1.7 : 0.6); }
  else if (e.key === 'Enter') { e.preventDefault(); pick(state.center); }
  else if (e.key === 'Escape') navigation.cancelPick();
});


