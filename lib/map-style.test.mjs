/**
 * The map is the least testable surface in the product — but a pure style
 * transform is not. These run with no browser and no network.
 *
 *   node --test lib/map-style.test.mjs
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { applyPalette, paletteCoverage } from './map-style.ts'

const T = { base: '#000', surface: '#111', water: '#222', line: '#333', dim: '#444' }
const STYLE = {
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#fff' } },
    { id: 'water', type: 'fill', paint: {} },
    { id: 'landuse', type: 'fill', paint: {} },
    { id: 'road-major', type: 'line', paint: { 'line-width': 3 } },
    { id: 'place-label', type: 'symbol', layout: { 'text-field': 'x' } },
    { id: 'building-3d', type: 'fill-extrusion', paint: {} },
    { id: 'odd', type: 'heatmap', paint: {} },
  ],
}

test('the input style is not mutated', () => {
  const before = JSON.stringify(STYLE)
  applyPalette(STYLE, T)
  assert.equal(JSON.stringify(STYLE), before, 'MapLibre keeps a reference to what it is handed')
})

test('water is told apart from land', () => {
  const out = applyPalette(STYLE, T)
  const water = out.layers.find((l) => l.id === 'water')
  const land = out.layers.find((l) => l.id === 'landuse')
  assert.equal(water.paint['fill-color'], T.water)
  assert.equal(water.paint['fill-opacity'], 1)
  assert.equal(land.paint['fill-color'], T.surface)
})

test('existing paint properties survive', () => {
  const out = applyPalette(STYLE, T)
  // A transform that replaced `paint` wholesale would silently drop line-width
  // and the map would look subtly wrong with nothing failing.
  assert.equal(out.layers.find((l) => l.id === 'road-major').paint['line-width'], 3)
})

test('the style\'s own buildings are hidden, since we extrude our own', () => {
  const out = applyPalette(STYLE, T)
  assert.equal(out.layers.find((l) => l.id === 'building-3d').paint['fill-extrusion-opacity'], 0)
})

test('an unknown layer type is left alone rather than guessed at', () => {
  const out = applyPalette(STYLE, T)
  assert.deepEqual(out.layers.find((l) => l.id === 'odd').paint, {})
})

test('coverage is reported, so a style changing shape upstream is visible', () => {
  const c = paletteCoverage(STYLE)
  assert.equal(c.total, 7)
  assert.equal(c.recoloured, 6)
  assert.equal(c.untouched, 1, 'the heatmap layer is deliberately untouched')
})

test('a style with no layers does not throw', () => {
  assert.deepEqual(applyPalette({}, T).layers, [])
})
