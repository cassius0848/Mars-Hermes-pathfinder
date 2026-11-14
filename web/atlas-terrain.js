import { cellXY, decodeTerrain, geographic, project } from './planner.js';
import { fetchOfficial } from './official.js';
import { CTX_DEM, ctxBounds, ctxWindow, fetchCtxTerrain, fetchMolaTerrain, layers, readCapabilities, tilesInView } from './mars-data.js';

const toSigned = lon => lon > 180 ? lon - 360 : lon;
export const atlasLonLat = (grid, xy) => {
  const [lon, lat] = geographic(grid, xy);
  return [toSigned(lon), lat];
};

export function atlasCell(grid, point) {
  const [x, y] = project(grid, point);
  const col = Math.floor((x - grid.left) / grid.step), row = Math.floor((grid.top - y) / grid.step);
  return row >= 0 && col >= 0 && row < grid.rows && col < grid.cols ? [row, col] : null;
}

function gridBounds(grid) {
  const right = grid.left + grid.cols * grid.step, bottom = grid.top - grid.rows * grid.step;
  const corners = [[grid.left, grid.top], [right, grid.top], [grid.left, bottom], [right, bottom]].map(xy => atlasLonLat(grid, xy));
  const lons = corners.map(point => point[0]), lats = corners.map(point => point[1]);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

function sampleElevation(terrain, [lon, lat]) {
  const x = (lon - terrain.lon) / terrain.dLon * terrain.width - 0.5;
  const y = (terrain.lat - lat) / terrain.dLat * terrain.height - 0.5;
  const col = Math.floor(x), row = Math.floor(y);
  if (col < 0 || row < 0 || col >= terrain.width - 1 || row >= terrain.height - 1) return NaN;
  const n = row * terrain.width + col;
  const a = terrain.values[n], b = terrain.values[n + 1];
  const c = terrain.values[n + terrain.width], d = terrain.values[n + terrain.width + 1];
  const u = x - col, v = y - row;
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

const inCtx = ([lon, lat]) => lon > ctxBounds[0] && lon < ctxBounds[2] && lat > ctxBounds[1] && lat < ctxBounds[3];

function planningGrid(points, coarse) {
  if (coarse && (Math.abs(points[0][0] - points[1][0]) > 180 || points.some(([, lat]) => Math.abs(lat) > 80))) {
    throw Error('MOLA 走廊模式目前支持南北纬 80°以内、不跨越 ±180° 经线的路线。');
  }
  const center = points[0].map((value, i) => (value + points[1][i]) / 2);
  const xy = points.map(point => project({ center }, point));
  const distance = Math.hypot(xy[1][0] - xy[0][0], xy[1][1] - xy[0][1]);
  const maxKm = coarse ? 120 : 15;
  if (distance > maxKm * 1000) throw Error(`${coarse ? 'MOLA' : 'CTX'} 单段规划支持相距最多 ${maxKm} 公里的两点。请缩短路线或分段规划。`);
  if (coarse && distance < 3000) throw Error('MOLA 约 1 公里的规划网格需要两点至少相距 3 公里。请拉开间距。');
  const step = coarse ? 1000 : 20;
  const margin = coarse ? Math.max(4000, Math.min(16000, distance * 0.18)) : Math.max(320, Math.min(1500, distance * 0.25));
  const halfX = Math.ceil((Math.max(...xy.map(p => Math.abs(p[0]))) + margin) / step);
  const halfY = Math.ceil((Math.max(...xy.map(p => Math.abs(p[1]))) + margin) / step);
  return { center, step, left: -halfX * step, top: halfY * step, cols: 2 * halfX, rows: 2 * halfY };
}

function finiteSlopes(grid, height) {
  const slope = new Float32Array(height.length).fill(NaN);
  for (let r = 1; r < grid.rows - 1; r++) for (let c = 1; c < grid.cols - 1; c++) {
    const i = r * grid.cols + c;
    if (!Number.isFinite(height[i])) continue;
    const dx = (height[i + 1] - height[i - 1]) / (2 * grid.step);
    const dy = (height[i + grid.cols] - height[i - grid.cols]) / (2 * grid.step);
    slope[i] = Math.atan(Math.hypot(dx, dy)) * 180 / Math.PI;
  }
  return slope;
}

let catalog;
export async function loadAtlasTerrain(mode, points, signal, status) {
  if (mode === 'auto' || mode === 'local') {
    catalog ??= fetchOfficial('assets/sites.json', 'json').catch(error => { catalog = null; throw error; });
    const { sites } = await catalog;
    signal.throwIfAborted();
    const site = sites.find(s => !s.regional && points.every(point => atlasCell(s, point)));
    if (site) {
      status(`正在读取 ${site.name} 的 HiRISE 验证区高程…`);
      const folder = `assets/${site.id}`;
      const [height, slope] = await Promise.all(['elevation', 'slope'].map(name => fetchOfficial(`${folder}/${name}.bin`, 'arrayBuffer', signal)));
      return { grid: decodeTerrain(site, height, slope), label: `${site.name} · HiRISE 2 米网格`, source: Object.values(site.sources)[0] };
    }
    if (mode === 'local') throw Error('请把两点设在同一个 2 米验证区内（Hawksbill Gap 或 Neretva Vallis），或改用在线 CTX。');
  }
  const covered = points.every(inCtx);
  if (mode === 'ctx' && !covered) throw Error('至少一个选点在 Jezero CTX 高程覆盖之外。可改用 MOLA 粗略地形走廊。');
  const coarse = mode === 'mola' || !covered;
  const grid = planningGrid(points, coarse);
  const margin = coarse ? 0.035 : 0.001;
  const bbox = gridBounds(grid).map((value, i) => value + (i < 2 ? -margin : margin));
  if (coarse && (bbox[0] < -180 || bbox[2] > 180 || bbox[2] - bbox[0] > 20)) throw Error('MOLA 走廊过于接近 ±180° 经线。请缩短路线或向远离经线的一侧选点。');
  status(coarse ? '正在向 NASA 请求 MOLA 数值高程…' : '正在向 USGS 请求路线周边的 CTX 20 米数值高程…');
  const source = coarse ? await fetchMolaTerrain(bbox, signal) : await fetchCtxTerrain(ctxWindow(bbox), signal);
  const height = new Float32Array(grid.rows * grid.cols);
  let min = Infinity, max = -Infinity;
  for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) {
    const z = sampleElevation(source, atlasLonLat(grid, cellXY(grid, [r, c])));
    height[r * grid.cols + c] = z;
    if (Number.isFinite(z)) { min = Math.min(min, z); max = Math.max(max, z); }
  }
  if (!Number.isFinite(min)) throw Error('选点附近没有可用的数值高程，请缩短路线或重选。');
  return { grid: { ...grid, height, slope: finiteSlopes(grid, height), depth: { min, max } },
    label: coarse ? 'NASA MOLA · 在线约 1 公里走廊' : 'USGS/JPL CTX · 在线 20 米网格',
    source: coarse ? source.url : CTX_DEM, coarse };
}

export async function atlasTexture(grid, signal) {
  const bbox = gridBounds(grid);
  const width = 512, height = 512;
  const [west, south, east, north] = bbox;
  const lonScale = width / (east - west), latScale = height / (north - south);
  const raster = document.createElement('canvas');
  raster.width = width; raster.height = height;
  const context = raster.getContext('2d', { willReadFrequently: true });
  let loaded = false;
  for (const key of ['viking', 'ctx']) {
    signal.throwIfAborted();
    const layer = await readCapabilities(layers[key]).catch(() => null);
    if (!layer) continue;
    const tiles = tilesInView(layer, bbox, Math.min(lonScale, latScale));
    await Promise.all(tiles.map(async tile => {
      const blob = await fetchOfficial(tile.url, 'blob', signal).catch(() => null);
      if (!blob) return;
      const image = await createImageBitmap(blob).catch(() => null);
      if (!image) return;
      context.drawImage(image, (tile.lon - west) * lonScale, (north - tile.lat) * latScale,
        tile.degrees * lonScale, tile.degrees * latScale);
      image.close();
      loaded = true;
    }));
  }
  signal.throwIfAborted();
  if (!loaded) return null;
  const input = context.getImageData(0, 0, width, height);
  const output = context.createImageData(width, height);
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) {
    const xy = [grid.left + (c + 0.5) / width * grid.cols * grid.step, grid.top - (r + 0.5) / height * grid.rows * grid.step];
    const [lon, lat] = atlasLonLat(grid, xy);
    const x = Math.min(width - 1, Math.max(0, Math.floor((lon - west) * lonScale)));
    const y = Math.min(height - 1, Math.max(0, Math.floor((north - lat) * latScale)));
    const src = (y * width + x) * 4, dst = (r * width + c) * 4;
    output.data.set(input.data[src + 3] ? input.data.subarray(src, src + 4) : [139, 110, 88, 255], dst);
  }
  context.putImageData(output, 0, 0);
  return raster;
}
