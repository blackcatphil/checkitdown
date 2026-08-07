/**
 * The GL cannot be tested without a browser, but the ARITHMETIC can — and the
 * arithmetic is where wireframe bugs actually live: a segment count that is
 * quietly zero, a stagger that does not match the rise, an altitude in the
 * wrong units. A custom layer that renders nothing looks exactly like one that
 * was never added, so every number it depends on is checked here first.
 *
 *   node --test lib/wireframe.test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { ROOM_FOOTPRINTS } from './room-footprints.ts'
import { buildWireGeometry, mercator, WIRE_STAGGER, zPerMeterAt } from './wireframe.ts'

const square = [[-115.17, 36.11], [-115.169, 36.11], [-115.169, 36.111], [-115.17, 36.111], [-115.17, 36.11]]

test('a closed ring yields two segments per edge — one vertical, one along the roof', () => {
  const g = buildWireGeometry([{ ring: square, height: 100, stagger: 0 }], zPerMeterAt)
  /* 4 corners -> 4 vertical edges + 4 roof edges. The repeated closing vertex
     must NOT produce a fifth zero-length pair. */
  assert.equal(g.segments, 8)
  assert.equal(g.vertices, 8 * 6, 'six vertices per segment: two triangles')
})

test('it draws SOMETHING for every extruded mass in the real data', () => {
  /* The failure this guards is the whole point of the module: a wireframe with
     an empty buffer is invisible and indistinguishable from a missing layer. */
  const feats = ROOM_FOOTPRINTS.features
    .filter((f) => f.properties.height)
    .map((f, i, all) => ({ ring: f.geometry.coordinates[0], height: f.properties.height, stagger: i / all.length * WIRE_STAGGER }))
  const g = buildWireGeometry(feats, zPerMeterAt)
  /* The count is PINNED on purpose — a silent height-filter regression should
     fail here, loudly. When a height is deliberately seeded (MGM Grand,
     2026-08-07: 16 -> 17), this number moves with it, in the same commit. */
  assert.equal(feats.length, 17, 'the 17 cited masses')
  assert.ok(g.segments > 200, `only ${g.segments} segments for 17 buildings`)
  assert.ok(g.array.length > 0)
  assert.equal(g.array.length, g.vertices * 8, 'eight floats per vertex')
})

test('a flat component contributes no edges', () => {
  const g = buildWireGeometry([], zPerMeterAt)
  assert.equal(g.segments, 0)
  assert.equal(g.vertices, 0)
})

test('vertical edges run from the ground to the roof, in mercator units', () => {
  const h = 150
  const g = buildWireGeometry([{ ring: square, height: h, stagger: 0 }], zPerMeterAt)
  /* First segment is the first vertical edge: a at z 0, b at z = h * zPerMeter. */
  const a = g.array.slice(0, 8)
  assert.equal(a[2], 0, 'the vertical edge does not start at ground level')
  const expected = h * zPerMeterAt(36.11)
  assert.ok(Math.abs(a[5] - expected) < 1e-12, `roof altitude ${a[5]} != ${expected}`)
  assert.ok(expected > 0 && expected < 1e-4, 'mercator z is wildly out of range — wrong units')
})

test('the two corners of a quad carry opposite sides', () => {
  const g = buildWireGeometry([{ ring: square, height: 10, stagger: 0 }], zPerMeterAt)
  const sides = [g.array[6], g.array[14]]
  assert.deepEqual(sides, [1, -1], 'the ribbon cannot be expanded without opposite normals')
})

test('the stagger travels with the vertex, so edges rise WITH their mass', () => {
  const g = buildWireGeometry([{ ring: square, height: 10, stagger: 0.21 }], zPerMeterAt)
  /* Compared with a tolerance because the buffer is Float32Array: 0.21 round-
     trips as 0.20999999344, and an exact check here fails on the storage type
     rather than on anything being wrong. */
  for (let i = 0; i < g.vertices; i++) {
    assert.ok(Math.abs(g.array[i * 8 + 7] - 0.21) < 1e-6,
      `vertex ${i} carries stagger ${g.array[i * 8 + 7]} — it would rise out of step with its mass`)
  }
})

test('the rise and the wireframe SHARE one stagger constant', () => {
  /* Originally this compared two numbers. They are now one: MapShell imports
     WIRE_STAGGER instead of declaring its own 0.35, so the two cannot drift
     apart at all — which is a stronger guarantee than checking they still
     match. The test therefore asserts the SHARING, and fails if anyone
     reintroduces a local literal. */
  const text = readFileSync(new URL('../app/MapShell.tsx', import.meta.url), 'utf8')
  assert.match(text, /const STAGGER = WIRE_STAGGER/,
    'MapShell has stopped importing the shared stagger — the edges can now lag the masses')
  assert.doesNotMatch(text, /const STAGGER = [0-9]/,
    'MapShell declares its own stagger literal again')
  assert.equal(typeof WIRE_STAGGER, 'number')
  assert.ok(WIRE_STAGGER > 0 && WIRE_STAGGER < 1)
})

test('mercator projection is sane for Las Vegas', () => {
  const [x, y] = mercator(-115.1726, 36.112)
  assert.ok(x > 0.17 && x < 0.19, `x ${x} is not in the western hemisphere band`)
  assert.ok(y > 0.35 && y < 0.40, `y ${y} is not at Las Vegas latitude`)
})
