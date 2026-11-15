import { environmentMetrics, environmentStepCost } from './atlas-environment.js';

const DEG = Math.PI / 180;
const RADIUS = 3396190;
const DIAGONAL = Math.SQRT2;
const SHADOW_STEP = 4;

export const PROFILES = ["time", "terrain", "light"];
export const SLOPE_EXPOSURE_DEG = 12;
export const SOL_RATIO = 1.02749125;

export function indexOf(grid, [row, col]) {
  return Number.isInteger(row) && Number.isInteger(col) && row >= 0 && col >= 0 && row < grid.rows && col < grid.cols
    ? row * grid.cols + col : -1;
}

export const cellOf = (grid, index) => [Math.floor(index / grid.cols), index % grid.cols];
export const cellXY = (grid, [row, col]) => [grid.left + (col + 0.5) * grid.step, grid.top - (row + 0.5) * grid.step];

export function geographic(grid, [east, north]) {
  const [lon, lat] = grid.center.map(angle => angle * DEG);
  const distance = Math.hypot(east, north);
  if (!distance) return [...grid.center];
  const arc = distance / RADIUS;
  const newLat = Math.asin(Math.cos(arc) * Math.sin(lat) + north * Math.sin(arc) * Math.cos(lat) / distance);
  const newLon = lon + Math.atan2(east * Math.sin(arc), distance * Math.cos(lat) * Math.cos(arc) - north * Math.sin(lat) * Math.sin(arc));
  return [(newLon / DEG + 360) % 360, newLat / DEG];
}

export function project(grid, [longitude, latitude]) {
  const [lon, lat] = grid.center.map(angle => angle * DEG);
  const delta = longitude * DEG - lon;
  const target = latitude * DEG;
  const east = Math.cos(target) * Math.sin(delta);
  const north = Math.cos(lat) * Math.sin(target) - Math.sin(lat) * Math.cos(target) * Math.cos(delta);
  const length = Math.hypot(east, north);
  if (!length) return [0, 0];
  const angle = Math.atan2(length, Math.sin(lat) * Math.sin(target) + Math.cos(lat) * Math.cos(target) * Math.cos(delta));
  return [east * RADIUS * angle / length, north * RADIUS * angle / length];
}

export function decodeTerrain(grid, heights, slopes) {
  const encoded = new DataView(heights);
  const slopeFile = new DataView(slopes);
  const size = grid.rows * grid.cols;
  if (heights.byteLength !== size * 2 || slopes.byteLength !== size * 4) throw Error("地形文件大小与清单不符");
  const height = new Float32Array(size);
  const slope = new Float32Array(size);
  for (let cell = 0; cell < size; cell++) {
    const value = encoded.getUint16(cell * 2, true);
    height[cell] = value === 65535 ? NaN : grid.depth.offset + value * grid.depth.scale;
    slope[cell] = slopeFile.getFloat32(cell * 4, true);
  }
  return { ...grid, height, slope };
}

export function solarPosition(lat, hour, season) {
  const seasonSin = Math.sin(season * DEG);
  const declination = Math.asin(0.42565 * seasonSin) + 0.25 * DEG * seasonSin;
  const graphicLat = Math.atan(Math.tan(lat * DEG) / (1 - 1 / 169.8) ** 2);
  const angle = (hour - 12) * 15 * DEG;
  const east = -Math.cos(declination) * Math.sin(angle);
  const north = Math.sin(declination) * Math.cos(graphicLat) - Math.cos(declination) * Math.cos(angle) * Math.sin(graphicLat);
  const up = Math.sin(declination) * Math.sin(graphicLat) + Math.cos(declination) * Math.cos(graphicLat) * Math.cos(angle);
  return { east, north, up, elevation: Math.asin(up) / DEG, azimuth: (Math.atan2(east, north) / DEG + 360) % 360 };
}

export function terrainLight(grid, hour, season, sun = solarPosition(grid.center[1], hour, season)) {
  const stride = SHADOW_STEP;
  const cols = Math.ceil(grid.cols / stride), rows = Math.ceil(grid.rows / stride);
  const mask = new Uint8Array(rows * cols);
  if (sun.up <= 0) return { sun, stride, cols, rows, mask };
  mask.fill(1);
  const norm = Math.max(Math.abs(sun.east), Math.abs(sun.north));
  if (norm < 0.00001) return { sun, stride, cols, rows, mask };
  const xStep = sun.east / norm, yStep = -sun.north / norm;
  const rise = grid.step * stride * sun.up / norm;
  const offset = Math.floor(stride / 2);
  const sample = (row, col) => grid.height[Math.min(grid.rows - 1, row * stride + offset) * grid.cols + Math.min(grid.cols - 1, col * stride + offset)];
  const end = Math.min(Math.ceil((grid.depth.max - grid.depth.min) / rise) + 1, 2 * Math.max(rows, cols));
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const base = sample(row, col);
      if (!Number.isFinite(base)) continue;
      for (let k = 1; k <= end; k++) {
        const y = Math.round(row + k * yStep), x = Math.round(col + k * xStep);
        if (y < 0 || x < 0 || y >= rows || x >= cols) break;
        if (sample(y, x) > base + k * rise) { mask[row * cols + col] = 0; break; }
      }
    }
  }
  return { sun, stride, cols, rows, mask };
}

export function isLit(grid, light, index) {
  if (!light) return true;
  const row = Math.floor(index / grid.cols), col = index % grid.cols;
  return light.mask[Math.floor(row / light.stride) * light.cols + Math.floor(col / light.stride)] === 1;
}

class MinHeap {
  items = [];
  push(item) {
    const a = this.items;
    let i = a.length;
    a.push(item);
    while (i > 0) {
      const p = (i - 1) >>> 1;
      if (a[p][0] <= item[0]) break;
      a[i] = a[p]; i = p;
    }
    a[i] = item;
  }
  pop() {
    const a = this.items, first = a[0], last = a.pop();
    if (!a.length) return first;
    let i = 0;
    while (i * 2 + 1 < a.length) {
      let child = i * 2 + 1;
      if (child + 1 < a.length && a[child + 1][0] < a[child][0]) child++;
      if (a[child][0] >= last[0]) break;
      a[i] = a[child]; i = child;
    }
    a[i] = last;
    return first;
  }
}

function openCells(grid, limit, closures) {
  const open = Uint8Array.from(grid.slope, (slope, i) => Number.isFinite(grid.height[i]) && Number.isFinite(slope) && slope >= 0 && slope <= limit);
  for (const { cell: [row, col], radius } of closures) {
    const cells = radius / grid.step, n = Math.ceil(cells);
    for (let y = Math.max(0, row - n); y <= Math.min(grid.rows - 1, row + n); y++) {
      for (let x = Math.max(0, col - n); x <= Math.min(grid.cols - 1, col + n); x++) {
        if (Math.hypot(row - y, col - x) <= cells) open[y * grid.cols + x] = 0;
      }
    }
  }
  return open;
}

function movementMinutes(distance, rise, speed, regional) {
  if (regional) return distance / speed;
  const grade = rise / distance;
  return distance * (1 + 2 * Math.abs(grade) + 2 * Math.max(0, grade)) / speed;
}

const MOVES = [[-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
  [-1, -1, DIAGONAL], [-1, 1, DIAGONAL], [1, -1, DIAGONAL], [1, 1, DIAGONAL]];

export function solveLeg(grid, route, from, to, profile, open, light) {
  const start = indexOf(grid, from), goal = indexOf(grid, to);
  if (start < 0 || goal < 0 || !open[start] || !open[goal]) return null;
  if (start === goal) return [start];
  const { step, cols, rows, height, slope, regional } = grid;
  const maxRise = Math.tan(route.limit * DEG);
  const prior = new Int32Array(height.length).fill(-1);
  const best = new Float64Array(height.length).fill(Infinity);
  const heap = new MinHeap();
  best[start] = 0;
  heap.push([0, start, 0]);
  while (heap.items.length) {
    const [, index, cost] = heap.pop();
    if (cost !== best[index]) continue;
    if (index === goal) {
      const path = [index];
      while (path.at(-1) !== start) path.push(prior[path.at(-1)]);
      return path.reverse();
    }
    const row = Math.floor(index / cols), col = index % cols;
    for (const [dy, dx, length] of MOVES) {
      const y = row + dy, x = col + dx, next = index + dy * cols + dx;
      if (y < 0 || y >= rows || x < 0 || x >= cols || !open[next]) continue;
      if (dx && dy && (!open[index + dx] || !open[index + dy * cols])) continue;
      const distance = length * step, rise = height[next] - height[index];
      if (Math.abs(rise) > distance * maxRise) continue;
      const minutes = movementMinutes(distance, rise, route.speed, regional);
      const steep = (slope[index] + slope[next]) / (2 * route.limit);
      const useShade = profile === "environment" || profile === "light";
      const shade = useShade ? (Number(!isLit(grid, light, index)) + Number(!isLit(grid, light, next))) / 2 : 0;
      const costOfStep = profile === "environment" ? environmentStepCost(route.environment, minutes, steep, shade)
        : regional || profile === "terrain" ? minutes * (1 + 5 * steep * steep)
        : profile === "light" ? minutes * (1 + 6 * shade)
        : minutes;
      const nextCost = cost + costOfStep;
      if (nextCost >= best[next]) continue;
      best[next] = nextCost;
      prior[next] = index;
      const a = Math.abs(y - to[0]), b = Math.abs(x - to[1]);
      const guess = (Math.max(a, b) + (DIAGONAL - 1) * Math.min(a, b)) * step / route.speed;
      heap.push([nextCost + guess, next, nextCost]);
    }
  }
  return null;
}

function itinerary(grid, route, stops, profile, open, light) {
  const path = [indexOf(grid, route.start)];
  const times = [0], lengths = [0], visits = [];
  let from = route.start, shadow = 0, steep = 0, ascent = 0, descent = 0, slopeSum = 0;
  let maxSlope = grid.slope[path[0]], minElevation = grid.height[path[0]], maxElevation = minElevation;
  for (const stop of stops) {
    const leg = solveLeg(grid, route, from, stop.cell, profile, open, light);
    if (!leg) return null;
    for (let i = 1; i < leg.length; i++) {
      const previous = leg[i - 1], cell = leg[i];
      const distance = Math.hypot(...cellOf(grid, cell).map((v, j) => v - cellOf(grid, previous)[j])) * grid.step;
      const rise = grid.height[cell] - grid.height[previous];
      const grade = Math.atan2(Math.abs(rise), distance) / DEG;
      const [pr, pc] = cellOf(grid, previous), [cr, cc] = cellOf(grid, cell);
      const cornerSlope = pr !== cr && pc !== cc ? Math.max(grid.slope[pr * grid.cols + cc], grid.slope[cr * grid.cols + pc]) : 0;
      const slope = Math.max(grade, grid.slope[previous], grid.slope[cell], cornerSlope);
      maxSlope = Math.max(maxSlope, slope);
      ascent += Math.max(0, rise);
      descent += Math.max(0, -rise);
      slopeSum += slope * distance;
      minElevation = Math.min(minElevation, grid.height[cell]);
      maxElevation = Math.max(maxElevation, grid.height[cell]);
      if (slope >= SLOPE_EXPOSURE_DEG) steep += distance;
      shadow += distance * (Number(!isLit(grid, light, previous)) + Number(!isLit(grid, light, cell))) / 2;
      path.push(cell);
      times.push(times.at(-1) + movementMinutes(distance, rise, route.speed, grid.regional));
      lengths.push(lengths.at(-1) + distance);
    }
    visits.push({ name: stop.name, arrival: times.at(-1), leave: times.at(-1) + (stop.minutes ?? 0), cell: path.at(-1),
      returnLeg: stop.returnLeg, science: Boolean(stop.minutes) });
    if (stop.minutes) {
      path.push(path.at(-1));
      times.push(times.at(-1) + stop.minutes);
      lengths.push(lengths.at(-1));
    }
    from = stop.cell;
  }
  const minutes = times.at(-1), margin = route.budget - route.reserve - minutes;
  return { path, times, lengths, visits, profiles: [profile], distance: lengths.at(-1), minutes,
    margin, shadow, steep, ascent, descent, maxSlope, minElevation, maxElevation,
    averageSlope: lengths.at(-1) ? slopeSum / lengths.at(-1) : maxSlope,
    movingMinutes: minutes - visits.reduce((sum, visit) => sum + visit.leave - visit.arrival, 0),
    feasible: margin >= -1e-8 };
}

const samePath = (a, b) => a.path.length === b.path.length && a.path.every((cell, i) => cell === b.path[i]);

function searchMission(grid, route, light) {
  if (route.start == null || (!route.stops.length && !route.returnToBase)) return { error: "请在地图上选取出发地和目的地。", candidates: [] };
  const open = openCells(grid, route.limit, route.closures);
  const stops = [...route.stops];
  if (route.returnToBase) stops.push({ cell: route.base, name: "返航", returnLeg: true });
  if ([route.start, ...stops.map(s => s.cell)].some(cell => !open[indexOf(grid, cell)])) {
    return { error: "起点或任务点位于无数据、封锁或超坡度的网格。请在地图上另选位置。", candidates: [] };
  }
  const candidates = [];
  const hasMixedLight = light?.mask.includes(0) && light.mask.includes(1);
  const profiles = grid.regional || route.returnOnly ? ["time"] : hasMixedLight ? PROFILES : PROFILES.slice(0, 2);
  const runProfiles = route.environment && !grid.regional && !route.returnOnly ? ["environment", ...profiles] : profiles;
  for (const profile of runProfiles) {
    const candidate = itinerary(grid, route, stops, profile, open, light);
    if (!candidate || candidate.path.length < 2) continue;
    const previous = candidates.find(other => samePath(other, candidate));
    if (previous) previous.profiles.push(profile);
    else candidates.push(candidate);
  }
  if (light && !hasMixedLight && !grid.regional && !route.returnOnly && candidates[0]?.profiles.includes("time")) {
    candidates[0].profiles.push("light");
  }
  if (!candidates.length) return { error: "当前坡度限制或封锁区切断了路线。请检查选点与地图。", candidates: [] };
  for (const candidate of candidates) {
    const metrics = ["minutes", "steep", "shadow", "ascent"];
    candidate.pareto = !candidates.some(other => metrics.every(key => other[key] <= candidate[key] + 1e-8)
      && metrics.some(key => other[key] < candidate[key] - 1e-8));
  }
  return { candidates };
}

export function assessCandidate(candidate, route) {
  const violations = [];
  if (candidate.maxSlope > route.limit + 1e-8) violations.push({ metric: '最大通行坡度', actual: candidate.maxSlope,
    limit: route.limit, excess: candidate.maxSlope - route.limit, unit: '°', code: 'SLOPE' });
  if (candidate.minutes > route.budget + 1e-8) violations.push({ metric: '任务总用时', actual: candidate.minutes,
    limit: route.budget, excess: candidate.minutes - route.budget, unit: '分钟', code: 'BUDGET' });
  const remaining = route.budget - candidate.minutes;
  if (remaining < route.reserve - 1e-8) violations.push({ metric: '返航预留不足', actual: remaining,
    limit: route.reserve, excess: route.reserve - remaining, unit: '分钟', code: 'RESERVE' });
  return { ...candidate, margin: remaining - route.reserve, violations, feasible: violations.length === 0 };
}

export function planMission(grid, route, light) {
  if (grid.regional && route.regionalNavigation) grid = { ...grid, regional: false };
  if (!route.start || (!route.stops.length && !route.returnToBase)) return { candidates: [], error: '请在地图上选取出发地和目的地。' };
  const points = [{ cell: route.start, name: '出发地' }, ...route.stops];
  if (route.returnToBase) points.push({ cell: route.base, name: '返航点' });
  const diagnostics = [];
  for (const point of points) {
    if (!point.cell) continue;
    const i = indexOf(grid, point.cell);
    if (i < 0 || !Number.isFinite(grid.height[i]) || !Number.isFinite(grid.slope[i]) || grid.slope[i] < 0) {
      diagnostics.push(`${point.name}缺少有效高程或坡度数据，请重新选点。`);
    } else if ((route.closures ?? []).some(({ cell, radius }) => Math.hypot(cell[0] - point.cell[0], cell[1] - point.cell[1]) * grid.step <= radius)) {
      diagnostics.push(`${point.name}位于封路区域内，请移动该点或清空封路。`);
    }
  }
  if (diagnostics.length) return { candidates: [], diagnostics, error: diagnostics.join(' ') };
  const estimating = route.mode === 'estimate';
  let result = searchMission(grid, estimating ? { ...route, limit: 90 } : route, light);
  let relaxed = estimating;
  if (!result.candidates.length && route.start && route.stops.length && route.diagnose === true && !estimating && !route.returnOnly) {
    result = searchMission(grid, { ...route, limit: 90 }, light);
    relaxed = true;
  }
  if (!result.candidates.length) return { ...result,
    error: relaxed ? '有效地形覆盖或封路使起终点不连通，无法可靠估算完整路线及用时。' : '当前坡度限制或封路使起终点不连通。',
    diagnostics: [relaxed ? '已检查有效高程、坡度与封路。放宽坡度后仍无完整通路；请移动选点或清空封路。' : '当前坡度与封路约束下没有完整通路；可使用按起终点反算查看参考条件。'] };
  result.candidates = result.candidates.map(candidate => {
    const evaluated = { ...assessCandidate(candidate, route), estimated: relaxed };
    if (route.environment) evaluated.environment = environmentMetrics(route.environment, evaluated, cell => isLit(grid, light, cell));
    return evaluated;
  });
  if (relaxed) result.error = estimating ? '按起终点反算：先求参考路线，再核对当前限制。' : '当前坡度限制下无连通路线，以下为放宽坡度后的参考估算。';
  return result;
}

export function canAnimateRoute(plan, route, grid) {
  const regionalPlayback = Boolean(grid?.regional && route?.regionalNavigation);
  return (!grid?.regional || regionalPlayback) && Boolean(plan?.path?.length > 1 && Number.isFinite(plan.minutes) && plan.minutes > 0
    && (plan.feasible || route?.mode === 'estimate' || regionalPlayback));
}

export function progressAt(grid, plan, minute) {
  const time = Math.max(0, Math.min(minute, plan.minutes));
  let lo = 0, hi = plan.times.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1;
    if (plan.times[mid] <= time) lo = mid; else hi = mid;
  }
  const a = plan.path[lo], b = plan.path[hi];
  const ratio = plan.times[hi] > plan.times[lo] ? (time - plan.times[lo]) / (plan.times[hi] - plan.times[lo]) : 0;
  const start = cellXY(grid, cellOf(grid, a)), end = cellXY(grid, cellOf(grid, b));
  return { xy: start.map((v, j) => v + (end[j] - v) * ratio), heading: end.map((v, j) => v - start[j]),
    cell: cellOf(grid, ratio < 0.5 ? a : b), index: hi,
    visit: plan.visits.find(stop => time >= stop.arrival && time < stop.leave),
    distance: plan.lengths[lo] + (plan.lengths[hi] - plan.lengths[lo]) * ratio };
}
