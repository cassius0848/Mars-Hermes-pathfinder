import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as planner from '../dist/planner.js';
import { TerrainView } from '../dist/terrain-view.js';

test('the shared worker accepts atlas grids and both local terrain initialization protocols', () => {
  const source = fs.readFileSync(new URL('../dist/planner-worker.js', import.meta.url), 'utf8').replace(/^import[^\n]+\n/gm, '');
  const site = { rows: 3, cols: 3, step: 1, center: [0, 0], left: 0, top: 3, depth: { offset: 0, scale: 1, min: 0, max: 0 } };
  const grid = { ...site, height: new Float32Array(9), slope: new Float32Array(9) };
  const initializations = [{ type: 'grid', grid }, { type: 'terrain', site: grid },
    { type: 'terrain', site, height: new Uint16Array(9).buffer, slope: new Float32Array(9).buffer }];
  for (const data of initializations) {
    const messages = [], self = { postMessage: value => messages.push(value) };
    vm.runInNewContext(source, { ...planner, self });
    self.onmessage({ data });
    self.onmessage({ data: { id: 1, hour: 12, season: 0, route: { start: [0, 0], base: [0, 0],
      stops: [{ cell: [2, 2], name: 'Goal', minutes: 0 }], closures: [], limit: 30, speed: 15,
      budget: 100, reserve: 0, returnToBase: false } } });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].error, undefined);
    assert.ok(messages[0].candidates.length);
  }
});

test('shared 3D meshes preserve holes and expose the original atlas texture and color APIs', () => {
  const site = { rows: 3, cols: 3, step: 1, left: 0, top: 3, depth: { min: 0, max: 0 }, height: Float32Array.from([0, 0, 0, 0, NaN, 0, 0, 0, 0]) };
  const view = { site, meshStride: 1, mid: 0, verticalScale: 1, meshScale: 1 };
  const { geometry, rows, cols } = TerrainView.prototype.mesh.call(view);
  assert.ok(Array.from(geometry.attributes.position.array).every(Number.isFinite));
  assert.ok(!Array.from(geometry.index.array).includes(4));
  assert.ok(geometry.index.count > 0);
  assert.equal(typeof TerrainView.prototype.setTexture, 'function');
  assert.equal(typeof TerrainView.prototype.setColor, 'function');
  assert.equal(TerrainView.prototype.heightAt.call({ ...view, rows, cols }, 0.5, 1.5, 0), 0);
  geometry.dispose();
});
