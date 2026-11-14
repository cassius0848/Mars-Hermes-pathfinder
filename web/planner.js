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

export function terrainLight(grid, hour, season) {
  const sun = solarPosition(grid.center[1], hour, season);
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
  const open = Uint8Array.from(grid.slope, (slope, i) => Number.isFinite(grid.height[i]) && slope <= limit);
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
      const costOfStep = regional || profile === "terrain" ? minutes * (1 + 5 * steep * steep)
        : profile === "light" ? minutes * (1 + 3 * (Number(!isLit(grid, light, index)) + Number(!isLit(grid, light, next))))
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
  let from = route.start, shadow = 0, steep = 0, ascent = 0, maxSlope = 0;
  for (const stop of stops) {
    const leg = solveLeg(grid, route, from, stop.cell, profile, open, light);
    if (!leg) return null;
    for (let i = 1; i < leg.length; i++) {
      const previous = leg[i - 1], cell = leg[i];
      const distance = Math.hypot(...cellOf(grid, cell).map((v, j) => v - cellOf(grid, previous)[j])) * grid.step;
      const rise = grid.height[cell] - grid.height[previous];
      const grade = Math.atan2(Math.abs(rise), distance) / DEG;
      const slope = Math.max(grade, grid.slope[previous], grid.slope[cell]);
      maxSlope = Math.max(maxSlope, slope);
      ascent += Math.max(0, rise);
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
    margin, shadow, steep, ascent, maxSlope, feasible: margin >= -1e-8 };
}

const samePath = (a, b) => a.path.length === b.path.length && a.path.every((cell, i) => cell === b.path[i]);

export function planMission(grid, route, light) {
  if (route.start == null || (!route.stops.length && !route.returnToBase)) return { error: "请在地图上选取出发地和目的地。", candidates: [] };
  const open = openCells(grid, route.limit, route.closures);
  const stops = [...route.stops];
  if (route.returnToBase) stops.push({ cell: route.base, name: "返航", returnLeg: true });
  if ([route.start, ...stops.map(s => s.cell)].some(cell => !open[indexOf(grid, cell)])) {
    return { error: "起点或任务点位于无数据、封锁或超坡度的网格。请在地图上另选位置。", candidates: [] };
  }
  const candidates = [];
  const hasMixedLight = light?.mask.includes(0) && light.mask.includes(1);
  for (const profile of grid.regional || route.returnOnly ? ["time"] : hasMixedLight ? PROFILES : PROFILES.slice(0, 2)) {
    const candidate = itinerary(grid, route, stops, profile, open, light);
    if (!candidate || candidate.path.length < 2) continue;
    const previous = candidates.find(other => samePath(other, candidate));
    if (previous) previous.profiles.push(profile);
    else candidates.push(candidate);
  }
  if (!hasMixedLight && !grid.regional && !route.returnOnly && candidates[0]?.profiles.includes("time")) {
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
