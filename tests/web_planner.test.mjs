import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
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

test('real Hawksbill terrain shows three tradeoffs at low sun', () => {
  const grid = terrain('hawksbill'), route = routeFor(grid), light = terrainLight(grid, 17.25, 0);
  const { candidates } = planMission(grid, route, light);
  const [fast, gentle, bright] = ['time', 'terrain', 'light'].map(key => candidates.find(candidate => candidate.profiles.includes(key)));
  assert.ok(fast.minutes < gentle.minutes && fast.steep > gentle.steep);
  assert.ok(bright.shadow < fast.shadow && bright.minutes > fast.minutes);
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
