#!/usr/bin/env node
/**
 * SERVE MAPLIBRE'S WORKER OURSELVES — and prove the copy has not drifted.
 *
 * MapLibre v6 spawns its worker from a Blob that imports `import.meta.url`.
 * Turbopack rewrites that to the PAGE url, so the worker fetched the HTML
 * document as its own source, failed, and died. Nothing threw: the main thread
 * still fetched the style, the TileJSON and the sprites, and `transformRequest`
 * still fired for every tile — but VECTOR TILES ARE FETCHED IN THE WORKER, so
 * not one request was made. Style 200, console clean, zero tiles, forever.
 *
 * Pointing `setWorkerUrl` at a static copy fixes it, and introduces the exact
 * hazard this project keeps relearning: a checked-in copy of someone else's
 * file goes stale silently, and a stale MapLibre worker beside a newer MapLibre
 * is a bug nobody would look for. So the copy is GENERATED, and `--check`
 * fails the build when it no longer matches the installed package.
 *
 *   node scripts/sync-map-worker.mjs           # write public/maplibre-gl-worker.mjs
 *   node scripts/sync-map-worker.mjs --check   # CI gate: drifted -> exit 1
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const DIST = 'node_modules/maplibre-gl/dist'
const check = process.argv.includes('--check')
const version = JSON.parse(readFileSync('node_modules/maplibre-gl/package.json', 'utf8')).version
const sha = (b) => createHash('sha256').update(b).digest('hex').slice(0, 12)

/* THE WORKER IS A MODULE AND IT HAS IMPORTS. Copying it alone shipped a worker
   that 404'd on its sibling and died exactly as silently as the bug it was
   meant to fix — same zero tiles, same clean console. So the import closure is
   WALKED rather than assumed, and an unexpected specifier is a hard failure
   rather than a missing file discovered in a browser. */
const closure = []
const walk = (name) => {
  if (closure.includes(name)) return
  const file = `${DIST}/${name}`
  if (!existsSync(file)) {
    console.error(`missing ${file} — is maplibre-gl installed?`)
    process.exit(1)
  }
  closure.push(name)
  const body = readFileSync(file, 'utf8')
  for (const m of body.matchAll(/from\s*["']([^"']+)["']/g)) {
    const spec = m[1]
    if (!spec.startsWith('./')) {
      console.error(`worker closure has a NON-RELATIVE import (${spec}) in ${name}.`)
      console.error('A bare specifier cannot be served from public/ — this needs a real bundling step.')
      process.exit(1)
    }
    walk(spec.slice(2))
  }
}
walk('maplibre-gl-worker.mjs')

let failed = 0
for (const name of closure) {
  const src = readFileSync(`${DIST}/${name}`)
  const out = `public/${name}`
  if (check) {
    if (!existsSync(out)) {
      console.error(`public/${name} is MISSING — the worker dies and the map requests NO TILES.`)
      failed++
    } else if (sha(readFileSync(out)) !== sha(src)) {
      console.error(`public/${name} has DRIFTED from maplibre-gl@${version}. Run: npm run sync:worker`)
      failed++
    }
  } else {
    writeFileSync(out, src)
  }
}
if (failed) process.exit(1)
console.log(`${check ? 'in sync' : 'wrote'}: ${closure.join(', ')} (maplibre-gl@${version})`)
