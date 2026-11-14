import { decodeTerrain, planMission, terrainLight } from './planner.js';

let grid;
const lightCache = new Map();

self.onmessage = ({ data }) => {
  try {
    if (data.type === 'terrain') {
      grid = decodeTerrain(data.site, data.height, data.slope);
      lightCache.clear();
      return;
    }
    const { id, route, hour, season } = data;
    const key = `${hour}:${season}`;
    if (!grid.regional && !lightCache.has(key)) {
      if (lightCache.size === 6) lightCache.delete(lightCache.keys().next().value);
      lightCache.set(key, terrainLight(grid, hour, season));
    }
    const light = lightCache.get(key);
    const result = planMission(grid, route, light);
    if (route.allowSingleStop && !result.candidates.some(candidate => candidate.feasible)) {
      const alternatives = route.stops.flatMap(stop => {
        const single = planMission(grid, { ...route, stops: [stop] }, light);
        return single.candidates.map(candidate => ({ ...candidate, shortened: stop.name }));
      }).filter(candidate => candidate.feasible).sort((a, b) => a.minutes - b.minutes);
      if (alternatives.length) {
        result.candidates = [...alternatives, ...result.candidates];
        delete result.error;
      }
    }
    self.postMessage({ id, light, ...result });
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message, candidates: [] });
  }
};
