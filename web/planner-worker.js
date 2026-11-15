import { cellXY, decodeTerrain, geographic, isLit, planMission, terrainLight } from './planner.js';
import { buildRegionalEnvironment, regionalSolarTime } from './atlas-regional.js';
import { planOperations, assessResources } from './mission-operations.js';

let grid;
const lightCache = new Map();

self.onmessage = ({ data }) => {
  try {
    if (data.type === 'terrain' || data.type === 'grid') {
      grid = data.type === 'grid' ? data.grid : data.height ? decodeTerrain(data.site, data.height, data.slope) : data.site;
      lightCache.clear();
      return;
    }
    const { id, route } = data;
    let { hour, season } = data;
    const regional = route.environment?.kind === 'regional' ? route.environment : null;
    const solar = regional && regionalSolarTime(regional.snapshot, grid.center[0]);
    if (solar) {
      hour = solar.hour;
      season = regional.snapshot.ls;
    }
    const key = route.environment?.observation ? `meda:${route.environment.observation.sclk}` : `${hour}:${season}`;
    if ((!grid.regional || route.regionalNavigation && route.environment) && !lightCache.has(key)) {
      if (lightCache.size === 6) lightCache.delete(lightCache.keys().next().value);
      lightCache.set(key, terrainLight(grid, hour, season, route.environment?.sun,
        regional ? Math.max(1, Math.ceil(Math.max(grid.rows, grid.cols) / 280)) : undefined));
    }
    const light = lightCache.get(key);
    if (regional) {
      route.environment = buildRegionalEnvironment(grid, regional, light, (r, c) => geographic(grid, cellXY(grid, [r, c])),
        index => isLit(grid, light, index), solar.peakWm2);
    }
    const result = planOperations(grid, route, light);
    if (regional) {
      const { active, disabled, thermalSpacing } = route.environment;
      result.coverage = { active, disabled, thermalSpacing, hour, ls: season, year: regional.snapshot.year };
    }
    if (!route.scienceSelection?.enabled && route.mode !== 'estimate' && route.allowSingleStop && !result.candidates.some(candidate => candidate.feasible)) {
      const alternatives = route.stops.flatMap(stop => {
        const single = planMission(grid, { ...route, stops: [stop], diagnose: false }, light);
        return single.candidates.map(candidate => ({ ...assessResources(candidate,route.resources), shortened: stop.name }));
      }).filter(candidate => candidate.feasible).sort((a, b) => a.minutes - b.minutes);
      if (alternatives.length) {
        result.candidates = [...alternatives, ...result.candidates];
        delete result.error;
        delete result.diagnostics;
      }
    }
    self.postMessage({ id, light, ...result });
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message, candidates: [] });
  }
};
