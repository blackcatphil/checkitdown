/**
 * FLICKER, QUANTIFIED. A still frame cannot show a flicker, so this samples the
 * gold-pixel count across many frames while the camera moves in tiny steps —
 * small enough that the scene is essentially identical, large enough that the
 * depth values change. A stable render gives a nearly flat series; z-fighting
 * gives a series that jumps.
 */
import { inflateSync } from 'node:zlib'
import { chromium } from 'playwright'

const N = Number(process.env.N ?? 16)
const STEP = Number(process.env.STEP ?? 0.06)
/* A rotation small enough that the SCENE is unchanged: any swing in the count
   at this step is the depth comparison flipping, not an edge becoming hidden. */
const CAM = { center: [-115.1755, 36.1135], zoom: 17.2, pitch: 60, bearing: -30 }

function decodePng(buf) {

  let pos = 8, idat = [], w = 0, h = 0, ct = 0
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), t = buf.toString('ascii', pos + 4, pos + 8)
    const body = buf.subarray(pos + 8, pos + 8 + len)
    if (t === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); ct = body[9] }
    else if (t === 'IDAT') idat.push(body)
    else if (t === 'IEND') break
    pos += 12 + len
  }
  const nc = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct]
  const raw = inflateSync(Buffer.concat(idat)), stride = w * nc
  const out = Buffer.alloc(stride * h)
  let prev = Buffer.alloc(stride), i = 0
  for (let y = 0; y < h; y++) {
    const f = raw[i++]; const line = Buffer.from(raw.subarray(i, i + stride)); i += stride
    for (let x = 0; x < stride; x++) {
      const a = x >= nc ? line[x - nc] : 0, b = prev[x], c = x >= nc ? prev[x - nc] : 0
      if (f === 1) line[x] = (line[x] + a) & 255
      else if (f === 2) line[x] = (line[x] + b) & 255
      else if (f === 3) line[x] = (line[x] + ((a + b) >> 1)) & 255
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255
      }
    }
    line.copy(out, y * stride); prev = line
  }
  return { w, h, nc, px: out }
}

function goldCount({ w, h, nc, px }) {
  let gold = 0
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const o = (y * w + x) * nc
      const r = px[o], g = px[o + 1], b = px[o + 2]
      const max = Math.max(r, g, b), min = Math.min(r, g, b)
      if (max - min < 8) continue
      const d = max - min
      let hh = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
      hh = (hh * 60 + 360) % 360
      if (hh >= 20 && hh < 70) gold++
    }
  }
  return gold
}

const stats = (xs) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length)
  const steps = xs.slice(1).map((v, i) => Math.abs(v - xs[i]))
  return { mean: m, sd, cv: sd / m, maxStep: Math.max(...steps), meanStep: steps.reduce((a, b) => a + b, 0) / steps.length }
}

const b = await chromium.launch()
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await p.goto(process.argv[2] ?? 'http://localhost:3100', { waitUntil: 'load' })
await p.waitForTimeout(14000)
await p.evaluate((cam) => {
  const m = window.__cid_map
  m.getCanvasContainer().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  m.jumpTo(cam)
}, CAM)
await p.waitForTimeout(4000)
const clip = await p.evaluate(() => {
  const r = document.querySelector('canvas.maplibregl-canvas').getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
})

async function series(label) {
  const out = []
  for (let i = 0; i < N; i++) {
    await p.evaluate(([base, step, i]) => window.__cid_map.setBearing(base + i * step), [CAM.bearing, STEP, i])
    await p.waitForTimeout(260)
    out.push(goldCount(decodePng(await p.screenshot({ clip }))))
  }
  const s = stats(out)
  console.log(`${label.padEnd(22)} mean ${s.mean.toFixed(0)} · sd ${s.sd.toFixed(0)} · cv ${(s.cv * 100).toFixed(2)}% · mean step ${s.meanStep.toFixed(0)} · max step ${s.maxStep.toFixed(0)}`)
  return s
}

/* MEASURE WHAT SHIPS. An earlier version defaulted this sweep to depthBias 0,
   which silently overrode the shipped value — so the gate failed against a
   configuration nobody runs. Only an explicit BIAS= sweeps; otherwise the
   layer is left exactly as the app built it. */
let withWire = null
if (process.env.BIAS) {
  for (const bias of process.env.BIAS.split(',').map(Number)) {
    await p.evaluate((v) => {
      window.__cid_map.style._layers['rooms-wire'].implementation.depthBias = v
      window.__cid_map.triggerRepaint()
    }, bias)
    await p.waitForTimeout(700)
    const s = await series(`depthBias ${bias}`)
    if (withWire === null) withWire = s
  }
} else {
  const cfg = await p.evaluate(() => {
    const i = window.__cid_map.style._layers['rooms-wire'].implementation
    return { bias: i.depthBias }
  })
  withWire = await series(`as shipped (bias ${cfg.bias})`)
}

/* THE DEPTH EXPERIMENT, RE-RUN AGAINST A SUBJECT THAT DRAWS.
   The first version of this test ran while the layer was projecting off-screen,
   so nothing could be occluded and 'depth off changes nothing' was true and
   meaningless. */
await p.evaluate(() => {
  window.__cid_map.style._layers['rooms-wire'].implementation.depthTest = false
  window.__cid_map.triggerRepaint()
})
await p.waitForTimeout(800)
await series('wireframe, DEPTH OFF')
await p.evaluate(() => {
  window.__cid_map.style._layers['rooms-wire'].implementation.depthTest = true
  window.__cid_map.triggerRepaint()
})
await p.waitForTimeout(800)

await p.evaluate(() => window.__cid_map.removeLayer('rooms-wire'))
await p.waitForTimeout(800)
const without = await series('wireframe REMOVED')
await b.close()

/* THE GATE. A still frame cannot show a flicker, so the assertion is about
   VARIANCE ACROSS MOTION: at a rotation too small to change the scene, the
   gold-pixel count must not swing more than the map does without the wireframe.
   Z-fighting shows up here as a step count several times the control's. */
/* ASSERTED ON THE WIREFRAME'S OWN CV, not on a ratio to the control.
   The control's step count swung 646 -> 1740 across runs, so a ratio against it
   moved between 2.1x and 5.7x for the SAME broken build — a threshold that
   noisy is a flake generator, and it let the regression through once already.
   The wireframe's own CV separates cleanly: 2.2-2.8% when fixed, 7.8% when
   z-fighting. */
const ratio = withWire.meanStep / without.meanStep
console.log(`\nwireframe CV ${(withWire.cv * 100).toFixed(2)}% · control CV ${(without.cv * 100).toFixed(2)}% · step ratio ${ratio.toFixed(2)}x`)
if (withWire.cv > 0.05) {
  console.log(`FAIL — the gold count swings ${(withWire.cv * 100).toFixed(1)}% across a rotation too small to change the scene. That is the flicker.`)
  process.exit(1)
}
console.log('Flicker check passed — measured across motion, not in a still.')
