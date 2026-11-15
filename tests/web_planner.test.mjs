import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { environmentSettings, medaSun } from '../web/atlas-environment.js';
import { cellOf, cellXY, decodeTerrain, geographic, indexOf, isLit, planMission, progressAt, project, solarPosition, terrainLight } from '../web/planner.js';

const assets = path.join(process.env.MARS_WEB_DIST ?? 'dist', 'assets');
const metadata = JSON.parse(fs.readFileSync(path.join(assets, 'sites.json'), 'utf8'));
const terrain = id => {
  const site = metadata.sites.find(item => item.id === id);
  const buffer = file => Uint8Array.from(fs.readFileSync(path.join(assets, id, file))).buffer;
  return decodeTerrain(site, buffer('elevation.bin'), buffer('slope.bin'));
};
const routeFor = site => ({ start: site.base, base: site.base, stops: site.targets.map(item => ({ ...item, minutes: 12 })),
  closures: [], limit: 18, speed: 15, budget: 100, reserve: 8, returnToBase: true });

test('projected clicks and 2D navigation cells share the geographic origin', () => {
  for (const id of ['jezero', 'hawksbill', 'neretva']) {
    const grid = terrain(id);
    assert.deepEqual(geographic(grid, [0, 0]), grid.center);
    const [east, north] = cellXY(grid, grid.base);
    const [e, n] = project(grid, geographic(grid, [east, north]));
    assert.ok(Math.hypot(east - e, north - n) < 1e-5);
    assert.ok(Number.isFinite(grid.height[indexOf(grid, grid.base)]));
  }
});

test('real Hawksbill terrain remains route-computable at low sun', () => {
  const grid = terrain('hawksbill'), route = routeFor(grid), light = terrainLight(grid, 17.25, 0);
  const { candidates } = planMission(grid, route, light);
  const [fast, gentle, bright] = ['time', 'terrain', 'light'].map(key => candidates.find(candidate => candidate.profiles.includes(key)));
  assert.ok(fast.minutes < gentle.minutes && fast.steep > gentle.steep);
  assert.ok(bright.shadow <= fast.shadow + 1e-6);
  assert.ok(bright.minutes >= fast.minutes - 1e-6);
  assert.ok(candidates.every(candidate => candidate.feasible && candidate.maxSlope <= route.limit + 1e-6));
  assert.equal(fast.path[0], fast.path.at(-1));
  const [first] = fast.visits;
  const progress = progressAt(grid, fast, first.arrival + 5);
  assert.equal(progress.visit.name, first.name);
  assert.equal(indexOf(grid, progress.cell), first.cell);
});

test('a closure blocks cells during replanning, including diagonals through its corner', () => {
  const grid = terrain('neretva'), route = routeFor(grid), light = terrainLight(grid, 9.5, 0);
  const initial = planMission(grid, route, light).candidates[0];
  const progress = progressAt(grid, initial, initial.times[25]);
  const closures = [{ cell: cellOf(grid, initial.path[43]), radius: 7 }];
  const newRoute = { ...route, start: progress.cell, closures, stops: [], returnOnly: true };
  const returnPlan = planMission(grid, newRoute, light).candidates[0];
  assert.deepEqual(progressAt(grid, returnPlan, returnPlan.minutes).cell, route.base);
  assert.ok(returnPlan.path.every(index => {
    const [r, c] = cellOf(grid, index), [y, x] = closures[0].cell;
    return Math.hypot(r - y, c - x) * grid.step > 7;
  }));
  const tiny = { rows: 2, cols: 2, step: 2, height: Float32Array.from([0, 0, 0, 0]), slope: Float32Array.from([0, 40, 40, 0]) };
  assert.equal(planMission(tiny, { ...route, start: [0, 0], stops: [{ cell: [1, 1] }], returnToBase: false }, light).candidates.length, 0);
});

test('solar geometry and shadow casting agree with an analytic ridge case', () => {
  assert.ok(Math.abs(solarPosition(0, 12, 0).elevation - 90) < 1e-8);
  assert.equal(solarPosition(0, 6, 0).azimuth, 90);
  assert.equal(solarPosition(0, 18, 0).azimuth, 270);
  const size = 28, ridge = { rows: size, cols: size, step: 2, height: new Float32Array(size ** 2), center: [0, 0], depth: { min: 0, max: 40 } };
  for (let row = 0; row < size; row++) for (let col = 4; col < 8; col++) ridge.height[row * size + col] = 40;
  const west = terrainLight(ridge, 17.25, 0);
  assert.equal(isLit(ridge, west, indexOf(ridge, [14, 2])), true);
  assert.equal(isLit(ridge, west, indexOf(ridge, [14, 14])), false);
  assert.ok(terrainLight(ridge, 23, 0).mask.every(value => value === 0));
});

const readJson = url => JSON.parse(fs.readFileSync(new URL(url, import.meta.url), 'utf8'));
const catalog = readJson('../web/atlas-meda.json');
const sample = catalog.observations[0];
const zero = { terrain: 0, light: 0, thermal: 0, uv: 0, pressure: 0 };
const routeDefaults = { closures: [], limit: 18, speed: 15, budget: 240, reserve: 20, returnToBase: false };

test('MEDA uses the PDS west-positive azimuth and restricts its coverage', () => {
  assert.equal(sample.sclk, 712939040);
  assert.equal(sample.pressurePa, 765.34);
  const sun = medaSun(sample);
  assert.ok(Math.abs(sun.azimuth - 233.45) < 1e-9);
  assert.ok(Math.abs(sun.elevation - 20.08) < 1e-9);
  assert.ok(sun.east < 0 && sun.north < 0 && sun.up > 0);
  assert.throws(() => environmentSettings(catalog, sample.sclk, zero, 780, { id: 'neretva' }), /Hawksbill/);
});

test('increasing the UV weight finds a different route around the sunny strip', () => {
  const rows = 5, cols = 9, count = rows * cols;
  const grid = { id: 'hawksbill', step: 1, rows, cols, height: new Float32Array(count), slope: new Float32Array(count) };
  const mask = new Uint8Array(count);
  mask.fill(1, 2 * cols + 1, 3 * cols - 1);
  const light = { mask, rows, cols, stride: 1 };
  const record = { ...routeDefaults, start: [2, 0], stops: [{ name: 'goal', cell: [2, 8] }] };
  const run = weights => {
    const environment = environmentSettings(catalog, sample.sclk, weights, 780, grid);
    const { candidates } = planMission(grid, { ...record, environment }, light);
    return candidates.find(candidate => candidate.profiles.includes('environment'));
  };
  const fast = run(zero);
  const uv = run({ ...zero, uv: 5 });
  assert.notDeepEqual(uv.path, fast.path);
  assert.ok(uv.environment.sunlitUvJm2 < fast.environment.sunlitUvJm2);
  assert.ok(uv.minutes > fast.minutes);
  assert.equal(uv.environment.thermalKJm2, sample.groundLongwaveWm2 * uv.minutes * 0.06);
  assert.equal(uv.environment.pressureDeficitPaMin, (780 - sample.pressurePa) * uv.minutes);
});

test('the real 1 m Hawksbill route yields MEDA metrics for both observations', () => {
  const grid = terrain(catalog.siteId);
  const site = grid;
  assert.equal(grid.step, 1);
  for (const observation of catalog.observations) {
    const environment = environmentSettings(catalog, observation.sclk, { terrain: 1, light: 1, thermal: 1, uv: 1, pressure: 1 }, 780, grid);
    const light = terrainLight(grid, 0, 0, environment.sun);
    const { candidates, error } = planMission(grid, { ...routeDefaults, start: site.base, stops: [site.targets[0]], environment }, light);
    assert.ok(candidates.length, error);
    assert.ok(candidates[0].profiles.includes('environment'));
    assert.ok(candidates[0].environment.thermalKJm2 > 0);
    assert.ok(candidates[0].environment.sunlitMinutes <= candidates[0].minutes + 1e-9);
  }
});
