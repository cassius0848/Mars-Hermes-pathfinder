import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { atlasExamples, sourceForArea } from '../dist/atlas-areas.js';
import { loadAtlasTerrain } from '../dist/atlas-terrain.js';
import { project } from '../dist/planner.js';

test('each selectable area has its own example rather than falling back to Jezero', () => {
  assert.deepEqual(Object.keys(atlasExamples).sort(), ['eberswalde', 'endeavour', 'gale', 'hawksbill', 'jezero', 'neretva']);
  for (const id of ['jezero', 'hawksbill', 'neretva']) assert.equal(atlasExamples[id].site, id);
  for (const id of ['gale', 'endeavour', 'eberswalde']) {
    const example = atlasExamples[id];
    assert.equal(example.source, 'auto');
    const [x, y] = project({ center: example.start }, example.goal);
    assert.ok(Math.hypot(x, y) >= 3000 && Math.hypot(x, y) <= 120000);
    assert.ok(Math.abs(example.start[0] - 77.74) > 1);
  }
  assert.equal(atlasExamples.global, undefined);
});

test('changing areas releases incompatible fixed elevation sources', () => {
  for (const id of ['gale', 'endeavour', 'eberswalde', 'global']) {
    for (const source of ['jezero', 'ctx', 'local']) assert.equal(sourceForArea(id, source), 'auto');
  }
  assert.equal(sourceForArea('hawksbill', 'local'), 'local');
  assert.equal(sourceForArea('jezero', 'jezero'), 'jezero');
  assert.equal(sourceForArea('gale', 'mola'), 'mola');
});

test('out-of-cache fixed selections offer recovery and auto routes Gale to HRSC/MOLA', async () => {
  const sites = JSON.parse(fs.readFileSync(new URL('../dist/assets/sites.json', import.meta.url), 'utf8')).sites;
  const fetchBefore = globalThis.fetch, requested = [];
  globalThis.fetch = async url => {
    requested.push(String(url));
    if (url === 'assets/sites.json') return Response.json({ sites });
    if (String(url).includes('/Mars_MOLA_blend200ppx_HRSC_DEM_') && String(url).includes('/exportImage')) throw Error('HRSC request reached');
    if (String(url).includes('/mola128_') && String(url).includes('/exportImage')) throw Error('MOLA fallback reached');
    throw Error('Unexpected fetch ' + url);
  };
  try {
    const points = [atlasExamples.gale.start, atlasExamples.gale.goal];
    const signal = new AbortController().signal;
    await assert.rejects(loadAtlasTerrain('jezero', points, signal, () => {}), error => error.suggestedSource === 'auto' && /Currently using Jezero.*out of coverage/.test(error.message));
    await assert.rejects(loadAtlasTerrain('local', points, signal, () => {}), error => error.suggestedSource === 'auto');
    await assert.rejects(loadAtlasTerrain('hrsc', points, signal, () => {}), /HRSC request reached/);
    await assert.rejects(loadAtlasTerrain('auto', points, signal, () => {}), /MOLA fallback reached/);
    assert.ok(requested.some(url => url.includes('/mola128_')));
    assert.ok(!requested.some(url => url.includes('/jezero/elevation.bin')));
  } finally { globalThis.fetch = fetchBefore; }
});
