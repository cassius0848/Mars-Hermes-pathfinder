import test from 'node:test';
import assert from 'node:assert/strict';
import { planMission } from '../web/planner.js';

function grid() {
  return { rows: 5, cols: 5, step: 10, left: 0, top: 50, height: new Float32Array(25), slope: new Float32Array(25) };
}
function route(extra = {}) {
  return { start: [2, 0], base: [2, 0], stops: [{ cell: [2, 4], name: 'Goal', minutes: 0 }],
    limit: 10, speed: 10, budget: 20, reserve: 2, closures: [], returnToBase: false, diagnose: true, ...extra };
}

test('reports slope, total time and reserve together and preserves the reference path', () => {
  const terrain = grid();
  for (let row = 0; row < 5; row++) terrain.slope[row * 5 + 2] = 25;
  const result = planMission(terrain, route({ budget: 1, reserve: 2 }));
  assert.ok(result.candidates.length);
  const plan = result.candidates[0];
  assert.equal(plan.estimated, true);
  assert.equal(plan.feasible, false);
  assert.deepEqual(plan.violations.map(v => v.code), ['SLOPE', 'BUDGET', 'RESERVE']);
  assert.equal(plan.violations[0].excess, 15);
  assert.ok(plan.path.length > 1);
});

test('point-first estimates keep original budgets when assessing feasibility', () => {
  const plan = planMission(grid(), route({ mode: 'estimate', budget: 3, reserve: 1 })).candidates[0];
  assert.equal(plan.minutes, 4);
  assert.equal(plan.margin, -2);
  assert.equal(plan.feasible, false);
  assert.ok(plan.violations.some(v => v.code === 'BUDGET'));
  assert.ok(plan.violations.some(v => v.code === 'RESERVE' && v.excess === 2));
});

test('strict search uses a detour and does not falsely report the direct steep cell', () => {
  const terrain = grid(); terrain.slope[12] = 25;
  const result = planMission(terrain, route());
  assert.ok(result.candidates.every(p => !p.estimated && p.feasible && p.maxSlope <= 10));
  assert.ok(result.candidates.every(p => !p.path.includes(12)));
});

test('missing elevation and closures remain hard constraints in estimate mode', () => {
  const terrain = grid(); terrain.height[10] = NaN;
  const missing = planMission(terrain, route({ mode: 'estimate' }));
  assert.equal(missing.candidates.length, 0);
  assert.match(missing.error, /出发地.*高程/);
  const blocked = planMission(grid(), route({ mode: 'estimate', closures: [{ cell: [2, 2], radius: 10 }] }));
  assert.ok(blocked.candidates.every(p => p.path.every(i => Math.hypot(Math.floor(i / 5) - 2, i % 5 - 2) > 1)));
});

test('a disconnected data footprint produces no invented complete route or time', () => {
  const terrain = grid();
  for (let row = 0; row < 5; row++) terrain.height[row * 5 + 2] = NaN;
  const result = planMission(terrain, route({ mode: 'estimate' }));
  assert.equal(result.candidates.length, 0);
  assert.match(result.error, /不连通/);
});

test('direction changes time and ascent/descent; round trips include stops and return', () => {
  const terrain = grid(); terrain.height = Float32Array.from({ length: 25 }, (_, i) => i % 5);
  const forward = planMission(terrain, route({ limit: 30 })).candidates[0];
  const reverse = planMission(terrain, route({ start: [2, 4], base: [2, 4], stops: [{ cell: [2, 0], name: 'Base', minutes: 0 }], limit: 30 })).candidates[0];
  assert.ok(forward.minutes > reverse.minutes);
  assert.equal(forward.ascent, reverse.descent);
  assert.equal(forward.descent, reverse.ascent);
  const loop = planMission(terrain, route({ limit: 30, returnToBase: true, stops: [{ cell: [2, 4], name: 'Science', minutes: 3 }] })).candidates[0];
  assert.ok(Math.abs(loop.minutes - loop.movingMinutes - 3) < 1e-8);
  assert.equal(loop.ascent, loop.descent);
  assert.equal(loop.path[0], loop.path.at(-1));
  assert.equal(loop.visits.at(-1).returnLeg, true);
});

test('reserve alone can fail; relaxing a time budget cannot remove a slope violation', () => {
  const reserveOnly = planMission(grid(), route({ budget: 5, reserve: 2 })).candidates[0];
  assert.deepEqual(reserveOnly.violations.map(v => v.code), ['RESERVE']);
  const terrain = grid(); terrain.slope.fill(25);
  const slopeOnly = planMission(terrain, route({ mode: 'estimate', budget: 600 })).candidates[0];
  assert.deepEqual(slopeOnly.violations.map(v => v.code), ['SLOPE']);
});

