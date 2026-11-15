import { t as uiText } from './locale.js';
const DEG = Math.PI / 180;
const shortNames = { terrain: uiText("坡度"), light: uiText("阴影"), thermal: uiText("地表温度"), inertia: uiText("热惯量"), uv: uiText("太阳辐照潜势"), pressure: uiText("地表气压") };

export const normalizedLongitude = lon => lon >= -180 && lon < 180 ? lon : ((lon + 180) % 360 + 360) % 360 - 180;

export function regionalSolarTime(snapshot, lon) {
  const ls = snapshot.ls * DEG;
  const eccentricity = 0.0934;
  const orbit = ls - 251 * DEG;
  const eccentricAnomaly = 2 * Math.atan2(Math.sqrt(1 - eccentricity) * Math.sin(orbit / 2), Math.sqrt(1 + eccentricity) * Math.cos(orbit / 2));
  const meanAnomaly = eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly);
  const equationOfCenter = Math.atan2(Math.sin(orbit - meanAnomaly), Math.cos(orbit - meanAnomaly)) / DEG;
  const equationOfTime = 2.861 * Math.sin(2 * ls) - 0.071 * Math.sin(4 * ls) + 0.002 * Math.sin(6 * ls) - equationOfCenter;
  const hour = ((snapshot.primeHour + (lon + equationOfTime) / 15) % 24 + 24) % 24;
  const distance = 1.52367934 * (1 - eccentricity ** 2) / (1 + eccentricity * Math.cos(orbit));
  return { hour, peakWm2: 1361 / distance ** 2 };
}

export function readThermal(meta, payload, longitude, latitude) {
  const lon = normalizedLongitude(longitude);
  for (const tile of meta.tes.tiles) {
    const row = Math.floor((tile.north - latitude) / tile.degrees + 1e-9);
    const col = Math.floor((lon - tile.west) / tile.degrees + 1e-9);
    if (row < 0 || col < 0 || row >= tile.rows || col >= tile.cols) continue;
    const encoded = payload.getUint16(tile.offset + (row * tile.cols + col) * 2, true);
    if (!(encoded & 32767)) return null;
    return { value: encoded & 32767, interpolated: Boolean(encoded & 32768), degrees: tile.degrees };
  }
  return null;
}

export function readClimate(meta, payload, snapshot, key, longitude, latitude) {
  const { cols, rows, westCenter, northCenter, gridDegrees } = meta.climate;
  const x = ((normalizedLongitude(longitude) - westCenter) / gridDegrees + cols) % cols;
  const y = (northCenter - latitude) / gridDegrees;
  if (y < 0 || y > rows - 1) return NaN;
  const i = Math.floor(x), i2 = (i + 1) % cols, j = Math.floor(y), j2 = Math.min(j + 1, rows - 1);
  const dx = x - i, dy = y - j;
  const sample = (r, c) => payload.getFloat32(snapshot[key] + (r * cols + c) * 4, true);
  return (sample(j, i) * (1 - dx) + sample(j, i2) * dx) * (1 - dy) +
    (sample(j2, i) * (1 - dx) + sample(j2, i2) * dx) * dy;
}

function surfaceFlux(grid, index, row, col, sun, peakWm2, lit) {
  if (!lit || sun.up <= 0) return 0;
  const { height, rows, cols, step } = grid;
  const center = height[index];
  const west = col > 0 ? height[index - 1] : NaN;
  const east = col < cols - 1 ? height[index + 1] : NaN;
  const north = row > 0 ? height[index - cols] : NaN;
  const south = row < rows - 1 ? height[index + cols] : NaN;
  const gradient = (low, high) => Number.isFinite(low) && Number.isFinite(high) ? (high - low) / (2 * step)
    : Number.isFinite(high) ? (high - center) / step : Number.isFinite(low) ? (center - low) / step : 0;
  const dx = gradient(west, east), dy = gradient(south, north);
  return peakWm2 * Math.max(0, (sun.up - sun.east * dx - sun.north * dy) / Math.hypot(1, dx, dy));
}

export function buildRegionalEnvironment(grid, request, light, pointAt, isSunlit, peakWm2) {
  const { catalog, buffer, snapshot, pressureTarget, temperatureTarget } = request;
  const payload = new DataView(buffer), count = grid.height.length;
  if (payload.byteLength !== catalog.bytes) throw Error(uiText("区域环境栅格长度与来源清单不符。"));
  const weights = { ...request.weights };
  const fields = {
    thermal: new Float32Array(count).fill(NaN), inertia: new Float32Array(count).fill(NaN),
    uv: new Float32Array(count).fill(NaN), pressure: new Float32Array(count).fill(NaN),
  };
  const interpolated = new Uint8Array(count);
  let available = 0, missingThermal = 0, missingPressure = 0, missingInertia = 0, thermalSpacing = 0;
  for (let index = 0; index < count; index++) {
    if (!Number.isFinite(grid.height[index]) || !Number.isFinite(grid.slope[index])) continue;
    available++;
    const row = Math.floor(index / grid.cols), col = index % grid.cols;
    const [lon, lat] = pointAt(row, col);
    const inertia = readThermal(catalog, payload, lon, lat);
    if (inertia) {
      fields.inertia[index] = inertia.value;
      interpolated[index] = Number(inertia.interpolated);
      thermalSpacing = Math.max(thermalSpacing, inertia.degrees);
    } else missingInertia++;
    const temp = readClimate(catalog, payload, snapshot, 'tsurf', lon, lat);
    const pressure = readClimate(catalog, payload, snapshot, 'ps', lon, lat);
    fields.thermal[index] = temp;
    fields.pressure[index] = pressure;
    if (!Number.isFinite(temp)) missingThermal++;
    if (!Number.isFinite(pressure)) missingPressure++;
    fields.uv[index] = surfaceFlux(grid, index, row, col, light.sun, peakWm2, isSunlit(index));
  }

  const disabled = [];
  for (const [key, missing] of Object.entries({ thermal: missingThermal, inertia: missingInertia, pressure: missingPressure })) {
    if (available && missing === 0) continue;
    if (weights[key] > 0) disabled.push(shortNames[key]);
    weights[key] = 0;
  }
  const costs = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    if (!Number.isFinite(fields.uv[i])) continue;
    costs[i] = (weights.thermal ? weights.thermal * Math.max(0, fields.thermal[i] - temperatureTarget) / 20 : 0)
      + (weights.inertia ? weights.inertia * Math.max(0, 500 - fields.inertia[i]) / 300 : 0)
      + weights.uv * fields.uv[i] / 500
      + (weights.pressure ? weights.pressure * Math.max(0, pressureTarget - fields.pressure[i]) / 35 : 0);
  }
  const active = Object.entries(shortNames).filter(([key]) => weights[key] > 0).map(([, label]) => label);
  return { kind: 'regional', weights, fields, interpolated, costs, active, disabled, thermalSpacing };
}

export function regionalMetrics(environment, candidate, isSunlit) {
  const keys = ['thermal', 'inertia', 'uv', 'pressure'];
  const values = Object.fromEntries(keys.map(key => [key, Float32Array.from(candidate.path, cell => environment.fields[key][cell])]));
  const sums = Object.fromEntries(keys.map(key => [key, 0]));
  let daylightMinutes = 0, interpolatedMinutes = 0;
  for (let i = 1; i < candidate.path.length; i++) {
    const a = candidate.path[i - 1], b = candidate.path[i];
    const minutes = candidate.times[i] - candidate.times[i - 1];
    daylightMinutes += minutes * (Number(isSunlit(a)) + Number(isSunlit(b))) / 2;
    interpolatedMinutes += minutes * (environment.interpolated[a] + environment.interpolated[b]) / 2;
    for (const key of keys) sums[key] += minutes * (values[key][i - 1] + values[key][i]) / 2;
  }
  const mean = key => Number.isFinite(sums[key]) ? sums[key] / candidate.minutes : null;
  return {
    kind: 'regional', daylightMinutes, meanTemperatureK: mean('thermal'), meanPressurePa: mean('pressure'),
    meanInertia: mean('inertia'), meanSolarWm2: mean('uv'),
    interpolatedPercent: Number.isFinite(sums.inertia) ? interpolatedMinutes / candidate.minutes * 100 : null,
    interpolated: Uint8Array.from(candidate.path, cell => environment.interpolated[cell]),
    values,
  };
}


