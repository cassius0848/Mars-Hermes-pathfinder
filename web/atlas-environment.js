import { t as uiText } from './locale.js';
const DEG = Math.PI / 180;
const KEYS = ['terrain', 'light', 'thermal', 'uv', 'pressure'];

export function medaSun(observation) {
  const azimuth = (-observation.sunWestAzimuthDeg + 360) % 360;
  const zenith = observation.sunZenithDeg * DEG;
  return {
    azimuth, elevation: 90 - observation.sunZenithDeg,
    east: Math.sin(azimuth * DEG) * Math.sin(zenith),
    north: Math.cos(azimuth * DEG) * Math.sin(zenith),
    up: Math.cos(zenith),
  };
}

export function environmentSettings(catalog, sclk, input, pressureTarget, grid) {
  const observation = catalog.observations.find(sample => sample.sclk === sclk);
  if (!observation) throw Error(uiText("找不到所选的 MEDA 历史观测。"));
  if (grid.id !== catalog.siteId) {
    throw Error(uiText("此组 MEDA 历史观测适用于 Hawksbill Gap 的 HiRISE 验证区。请在该区设点并使用米级高程，或切回地形规划。"));
  }
  const weights = Object.fromEntries(KEYS.map(key => [key, input[key]]));
  if (Object.values(weights).some(weight => !Number.isFinite(weight) || weight < 0 || weight > 5)
      || !Number.isFinite(pressureTarget) || pressureTarget < 0 || pressureTarget > 1500) {
    throw Error(uiText("请检查环境权重和气压参考值。"));
  }
  const { groundLongwaveWm2, uvWm2, pressurePa } = observation;
  const deficitPa = Math.max(0, pressureTarget - pressurePa);
  return {
    observation, weights, deficitPa,
    thermalFactor: groundLongwaveWm2 / 250,
    uvFactor: uvWm2 / 0.02,
    pressureFactor: deficitPa / 20,
    sun: medaSun(observation),
  };
}

export function environmentStepCost(environment, minutes, steep, shade) {
  const { weights, thermalFactor, uvFactor, pressureFactor } = environment;
  return minutes * (1 + weights.terrain * steep ** 2 + weights.light * shade
    + weights.thermal * thermalFactor + weights.uv * uvFactor * (1 - shade)
    + weights.pressure * pressureFactor);
}

export function environmentMetrics(environment, candidate, isSunlit) {
  let sunlitMinutes = 0;
  for (let i = 1; i < candidate.path.length; i++) {
    const fraction = (Number(isSunlit(candidate.path[i - 1])) + Number(isSunlit(candidate.path[i]))) / 2;
    sunlitMinutes += (candidate.times[i] - candidate.times[i - 1]) * fraction;
  }
  const { groundLongwaveWm2, uvWm2 } = environment.observation;
  return {
    sunlitMinutes,
    thermalKJm2: groundLongwaveWm2 * candidate.minutes * 0.06,
    sunlitUvJm2: uvWm2 * sunlitMinutes * 60,
    pressureDeficitPaMin: environment.deficitPa * candidate.minutes,
  };
}

