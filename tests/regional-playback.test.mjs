import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { canAnimateRoute, decodeTerrain, planMission, progressAt, project } from '../web/planner.js';

test('regional navigation uses selected walking speed and elevation, while keeping time limits', () => {
  const grid = { regional: true, rows: 5, cols: 5, step: 100, left: 0, top: 500,
    height: Float32Array.from({ length: 25 }, (_, i) => (i % 5) * 10), slope: new Float32Array(25) };
  const route = { regionalNavigation: true, start: [2, 0], base: [2, 0], stops: [{ cell: [2, 4], name: 'Goal' }],
    closures: [], speed: 15, limit: 25, budget: 1, reserve: 0, returnToBase: false, mode: 'constrained' };
  const plan = planMission(grid, route).candidates[0];
  assert.ok(Math.abs(plan.minutes - 560 / 15) < 1e-7);
  assert.equal(plan.feasible, false);
  assert.equal(canAnimateRoute(plan, route, grid), true);
  assert.equal(canAnimateRoute(plan, { ...route, regionalNavigation: false }, grid), false);
  assert.ok(plan.violations.some(v => v.code === 'BUDGET'));
  assert.ok(!plan.profiles.includes('light'));
});

test('the screenshot route with two waypoints computes and can play in Jezero regional mode', () => {
  const catalog = JSON.parse(fs.readFileSync(new URL('../dist/assets/sites.json', import.meta.url), 'utf8'));
  const site = catalog.sites.find(item => item.id === 'jezero');
  const read = name => Uint8Array.from(fs.readFileSync(new URL(`../dist/assets/jezero/${name}.bin`, import.meta.url))).buffer;
  const grid = decodeTerrain(site, read('elevation'), read('slope'));
  const cell = lonlat => { const [x, y] = project(grid, lonlat); return [Math.floor((grid.top - y) / grid.step), Math.floor((x - grid.left) / grid.step)]; };
  const start = cell([77.26559, 18.61233]);
  const route = { start, base: start, regionalNavigation: true, mode: 'constrained', diagnose: true,
    stops: [[77.36932, 18.38650], [77.27921, 18.18048], [77.49249, 18.04085]].map((point, i) => ({ cell: cell(point), name: `Stop ${i + 1}`, minutes: 0 })),
    closures: [], limit: 25, speed: 15, budget: 480, reserve: 60, returnToBase: false };
  const result = planMission(grid, route);
  assert.ok(result.candidates.length);
  for (const candidate of result.candidates) {
    assert.ok(candidate.distance > 40000 && candidate.distance < 60000);
    assert.ok(candidate.minutes >= candidate.distance / route.speed);
    assert.ok(candidate.minutes < 10000);
    assert.equal(candidate.feasible, false);
    assert.equal(canAnimateRoute(candidate, route, grid), true);
    assert.equal(candidate.visits.length, 3);
    assert.deepEqual(progressAt(grid, candidate, candidate.minutes).cell, route.stops.at(-1).cell);
  }
});

test('regional return playback remains available after its modeled time budget is exhausted', () => {
  const grid = { regional: true, rows: 3, cols: 3, step: 100, left: 0, top: 300, height: new Float32Array(9), slope: new Float32Array(9) };
  const route = { start: [2, 2], base: [0, 0], stops: [], closures: [], regionalNavigation: true,
    mode: 'estimate', limit: 25, speed: 15, budget: -10, reserve: 0, returnToBase: true, returnOnly: true };
  const plan = planMission(grid, route).candidates[0];
  assert.equal(canAnimateRoute(plan, route, grid), true);
  assert.equal(plan.feasible, false);
  assert.deepEqual(progressAt(grid, plan, plan.minutes).cell, route.base);
});

