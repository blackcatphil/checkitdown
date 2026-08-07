/**
 * THE GOLD WIREFRAME — vertical and horizontal edges on every extruded mass.
 *
 * `fill-extrusion` has no stroke and MapLibre's line layers are ground-plane
 * only, so an elevated 3D line has no supported route. This is the custom-layer
 * one, and it is the TRIANGLE-EXPANDED version rather than `gl.LINES`, because
 * `ALIASED_LINE_WIDTH_RANGE` was measured at **[1, 1]**: WebGL will not draw a
 * line thicker than one device pixel, which on a 2x display is a half-CSS-pixel
 * hairline. Width has to be built, not requested.
 *
 * Each edge becomes a quad. The expansion happens in the VERTEX SHADER, in
 * screen space after projection, so the ribbon keeps a constant pixel width
 * however the camera is pitched or rotated — which matters here because the
 * ambient drift changes the matrix every frame.
 *
 * THREE THINGS THIS HAS TO GET RIGHT, and all three have already gone wrong
 * once in this project in some other form:
 *
 *  1. IT ANIMATES WITH THE RISE. The masses tween their height; edges drawn at
 *     full height while the buildings grow underneath would be visibly wrong for
 *     the whole animation. Both are driven from ONE progress value — `u_p` here
 *     is the same number the fill-extrusion expression gets, including the same
 *     per-feature stagger, recomputed in the shader rather than trusted to match.
 *  2. DEPTH TESTING, so edges hide behind masses instead of drawing through
 *     them. Without it this is an x-ray box, not a wireframe.
 *  3. IT REPORTS WHAT IT DREW. `segments` is a real count from the buffer,
 *     because a custom layer that renders nothing looks exactly like one that
 *     was never added — the failure this codebase keeps meeting.
 */

type Ring = [number, number][]
export type WireFeature = { ring: Ring; height: number; stagger: number; slug?: string }

/** Must match the stagger in the rise expression, or the edges lag the masses. */
export const WIRE_STAGGER = 0.35

const VERT = `
attribute vec2 a_pos;
attribute float a_ztop;
attribute vec2 a_posb;
attribute float a_ztopb;
attribute float a_side;
attribute float a_stagger;
attribute float a_dim;
uniform mat4 u_matrix;
uniform float u_p;
uniform float u_width;
uniform vec2 u_res;
uniform float u_depthBias;
varying float v_dim;

float rise(float st) {
  return clamp((u_p - st) / ${(1 - WIRE_STAGGER).toFixed(2)}, 0.0, 1.0);
}

void main() {
  v_dim = a_dim;
  float f = rise(a_stagger);
  vec4 ca = u_matrix * vec4(a_pos, a_ztop * f, 1.0);
  vec4 cb = u_matrix * vec4(a_posb, a_ztopb * f, 1.0);

  /* Behind the camera the perspective divide flips and the ribbon would fan
     across the screen. Clamped rather than discarded so the quad degenerates
     quietly instead of drawing garbage. */
  float wa = max(ca.w, 0.000001);
  float wb = max(cb.w, 0.000001);

  vec2 sa = (ca.xy / wa) * 0.5 * u_res;
  vec2 sb = (cb.xy / wb) * 0.5 * u_res;

  vec2 d = sb - sa;
  float len = length(d);
  vec2 dir = len > 0.0001 ? d / len : vec2(1.0, 0.0);
  vec2 offset = vec2(-dir.y, dir.x) * (u_width * 0.5) * a_side;

  vec2 s = sa + offset;

  /* DEPTH BIAS, applied in NDC and multiplied back by w.
     The ribbons lie exactly ON the extrusion faces, so the depth comparison is
     a coin toss that re-flips every frame as the camera moves — the flicker.
     POLYGON_OFFSET_FILL was tried first and measured: no effect at any factor
     or unit value, including against a control of 0/0. Biasing the depth we
     write is the lever we actually control. */
  float ndcZ = (ca.z / wa) - u_depthBias;
  gl_Position = vec4((s / (0.5 * u_res)) * wa, ndcZ * wa, wa);
}
`

const FRAG = `
precision mediump float;
uniform vec4 u_color;
uniform vec4 u_colorDim;
varying float v_dim;
/* A CUSTOM LAYER CANNOT READ feature-state, so the dim travels as a per-vertex
   attribute instead. Without it the wireframe would stay gold around a dimmed
   mass, and a dimmed building wearing a lit cage still reads as selected. */
void main() { gl_FragColor = mix(u_color, u_colorDim, step(0.5, v_dim)); }
`

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(`wireframe shader: ${gl.getShaderInfoLog(sh)}`)
  }
  return sh
}

const FLOATS_PER_VERTEX = 8

export type WireframeLayer = {
  id: string
  type: 'custom'
  renderingMode: '3d'
  /** Real count from the buffer — proof it drew, not that it exists. */
  readonly segments: number
  setProgress(p: number): void
  setColor(rgba: [number, number, number, number]): void
  /** Dim every vertex belonging to these slugs. Same group model as the fills:
   *  a property dims whole, never half. */
  setDimmed(slugs: ReadonlySet<string>): void
  readonly dimmedVertices: number
  /** Frames this layer has actually been asked to render, and the last GL error
   *  it saw. A segment count proves the BUFFER; these prove the DRAW. */
  readonly frames: number
  readonly glError: number
  /** The last matrix handed to render(), so where a vertex actually lands can be
   *  computed instead of assumed. */
  readonly lastMatrix: number[] | null
  readonly sampleVertex: [number, number, number] | null
  /** Depth bias, [factor, units], pulling the ribbon toward the viewer so it
   *  wins the comparison against the surface it lies on. */
  polygonOffset: [number, number]
  /** NDC depth pulled toward the viewer. The lever that actually works. */
  depthBias: number
  /** Hidden below the zoom at which the masses draw — a custom layer has no
   *  `minzoom`, so the gate is here. */
  visible: boolean
  setVisible(v: boolean): void
  /** Diagnostic only: turn depth testing off to find out whether the edges are
   *  being drawn and then losing the depth comparison, versus never drawn. */
  depthTest: boolean
  onAdd(map: unknown, gl: WebGL2RenderingContext): void
  onRemove(map: unknown, gl: WebGL2RenderingContext): void
  render(this: WireframeLayer, gl: WebGL2RenderingContext, args: {
    modelViewProjectionMatrix: Float32Array | number[]
    defaultProjectionData?: { mainMatrix: Float32Array }
  }): void
}

/**
 * Builds the vertex data. Split out from the GL so it can be unit-tested with
 * no browser — the arithmetic (segment count, stagger, altitudes) is where the
 * mistakes actually live.
 */
/**
 * Miter-offset a ring outward, in metres, working in a local metric frame so a
 * degree of longitude at latitude 36 is not treated as a degree of latitude.
 * Direction is chosen by comparing areas rather than assuming a winding.
 */
export function offsetRing(ring: Ring, metres: number): Ring {
  const lat0 = ring.reduce((a, p) => a + p[1], 0) / ring.length
  const lon0 = ring.reduce((a, p) => a + p[0], 0) / ring.length
  const mLat = 111320
  const mLon = 111320 * Math.cos((lat0 * Math.PI) / 180)
  const pts = ring.slice(0, -1).map(([lon, lat]) => [(lon - lon0) * mLon, (lat - lat0) * mLat] as [number, number])
  const area = (ps: [number, number][]) => {
    let a = 0
    for (let i = 0; i < ps.length; i++) {
      const [x1, y1] = ps[i]; const [x2, y2] = ps[(i + 1) % ps.length]
      a += x1 * y2 - x2 * y1
    }
    return Math.abs(a / 2)
  }
  const build = (d: number) => pts.map((v, i) => {
    const p = pts[(i - 1 + pts.length) % pts.length]
    const n = pts[(i + 1) % pts.length]
    const norm = ([x, y]: [number, number]): [number, number] => { const L = Math.hypot(x, y) || 1; return [x / L, y / L] }
    const e1 = norm([v[0] - p[0], v[1] - p[1]])
    const e2 = norm([n[0] - v[0], n[1] - v[1]])
    const n1: [number, number] = [e1[1], -e1[0]]
    const n2: [number, number] = [e2[1], -e2[0]]
    const bi = norm([n1[0] + n2[0], n1[1] + n2[1]])
    const cos = Math.max(Math.abs(bi[0] * n1[0] + bi[1] * n1[1]), 0.25)
    const len = Math.min(d / cos, d * 4)
    return [v[0] + bi[0] * len, v[1] + bi[1] * len] as [number, number]
  })
  const a0 = area(pts)
  const cands = [build(metres), build(-metres)]
  const out = area(cands[0]) > a0 ? cands[0] : cands[1]
  const back = out.map(([x, y]) => [x / mLon + lon0, y / mLat + lat0] as [number, number])
  back.push(back[0])
  return back
}

export function buildWireGeometry(
  features: WireFeature[],
  zPerMeter: (lat: number) => number,
  offsetMetres = 0,
) {
  const data: number[] = []
  /* One slug per VERTEX, so a dim flag can be written straight into a parallel
     buffer without re-deriving which building a vertex came from. */
  const vertexSlug: string[] = []
  let segments = 0

  const push = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    stagger: number,
    slug: string,
  ) => {
    segments++
    /* Two triangles per segment, four corners, each carrying BOTH endpoints so
       the shader can work out the screen-space direction on its own. */
    const corners: [number, number, number, number, number, number, number][] = [
      [ax, ay, az, bx, by, bz, 1], [ax, ay, az, bx, by, bz, -1],
      [bx, by, bz, ax, ay, az, -1], [bx, by, bz, ax, ay, az, 1],
    ]
    const order = [0, 1, 2, 0, 2, 3]
    for (const i of order) {
      const [px, py, pz, qx, qy, qz, side] = corners[i]
      data.push(px, py, pz, qx, qy, qz, side, stagger)
      vertexSlug.push(slug)
    }
  }

  for (const f of features) {
    /* PUSHED OUTWARD, which is what actually stops the flicker.
       Depth bias could only trade flicker for x-ray: enough bias to settle the
       comparison was enough to punch through the whole building (the gold count
       climbed toward the depth-disabled value). The edges were EXACTLY
       coincident with the faces, so no bias fixes that — moving them a little
       way off the surface does. Half a metre out, they are genuinely in front
       on the near side and genuinely behind the far faces, so depth occludes
       them correctly and nothing is a tie. */
    const ring = offsetMetres > 0 ? offsetRing(f.ring, offsetMetres) : f.ring
    /* The ring is closed (last point repeats the first), so the final vertex is
       skipped to avoid a zero-length segment. */
    const n = ring.length - 1
    for (let i = 0; i < n; i++) {
      const [lng, lat] = ring[i]
      const [lng2, lat2] = ring[(i + 1) % n]
      const zTop = f.height * zPerMeter(lat)
      const zTop2 = f.height * zPerMeter(lat2)
      const [x, y] = mercator(lng, lat)
      const [x2, y2] = mercator(lng2, lat2)
      // vertical edge, ground to roof
      push(x, y, 0, x, y, zTop, f.stagger, f.slug ?? '')
      // roof edge, following the ring
      push(x, y, zTop, x2, y2, zTop2, f.stagger, f.slug ?? '')
    }
  }
  return { array: new Float32Array(data), segments, vertices: data.length / FLOATS_PER_VERTEX, vertexSlug }
}

/** Web Mercator, normalised 0..1 — the space MapLibre's matrix expects. */
export function mercator(lng: number, lat: number): [number, number] {
  const x = (180 + lng) / 360
  const y = (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360
  return [x, y]
}

/** Mercator z units per metre at a latitude. */
export function zPerMeterAt(lat: number): number {
  const EARTH_CIRCUMFERENCE = 40075016.686
  return 1 / (EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180))
}

export function createWireframeLayer(
  id: string,
  features: WireFeature[],
  opts: {
    width: number
    color: [number, number, number, number]
    colorDim: [number, number, number, number]
    offsetMetres?: number
  },
): WireframeLayer {
  const geom = buildWireGeometry(features, zPerMeterAt, opts.offsetMetres ?? 0)
  let program: WebGLProgram | null = null
  let buffer: WebGLBuffer | null = null
  let dimBuffer: WebGLBuffer | null = null
  const dimFlags = new Float32Array(geom.vertices)
  let dimDirty = false
  let glRef: WebGL2RenderingContext | null = null
  let loc: Record<string, number> = {}
  let uni: Record<string, WebGLUniformLocation | null> = {}
  let progress = 1
  let color = opts.color
  let frames = 0
  let glError = 0
  let lastMatrix: number[] | null = null

  return {
    id,
    depthTest: true,
    visible: true,
    setVisible(v) { this.visible = v },
    polygonOffset: [0, 0],
    depthBias: 0.0009,
    type: 'custom',
    renderingMode: '3d',
    get segments() { return geom.segments },
    get frames() { return frames },
    get glError() { return glError },
    get lastMatrix() { return lastMatrix },
    get sampleVertex() {
      if (geom.vertices === 0) return null
      return [geom.array[0], geom.array[1], geom.array[2]] as [number, number, number]
    },
    setProgress(p) { progress = p },
    setColor(c) { color = c },
    get dimmedVertices() { return dimFlags.reduce((n, v) => n + (v > 0.5 ? 1 : 0), 0) },
    setDimmed(slugs) {
      for (let i = 0; i < dimFlags.length; i++) {
        dimFlags[i] = slugs.has(geom.vertexSlug[i]) ? 1 : 0
      }
      dimDirty = true
      /* Upload immediately when the context is up; otherwise onAdd will. */
      if (glRef && dimBuffer) {
        glRef.bindBuffer(glRef.ARRAY_BUFFER, dimBuffer)
        glRef.bufferData(glRef.ARRAY_BUFFER, dimFlags, glRef.DYNAMIC_DRAW)
        dimDirty = false
      }
    },

    onAdd(_map, gl) {
      const vs = compile(gl, gl.VERTEX_SHADER, VERT)
      const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
      program = gl.createProgram()!
      gl.attachShader(program, vs)
      gl.attachShader(program, fs)
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(`wireframe link: ${gl.getProgramInfoLog(program)}`)
      }
      loc = {
        a_pos: gl.getAttribLocation(program, 'a_pos'),
        a_ztop: gl.getAttribLocation(program, 'a_ztop'),
        a_posb: gl.getAttribLocation(program, 'a_posb'),
        a_ztopb: gl.getAttribLocation(program, 'a_ztopb'),
        a_side: gl.getAttribLocation(program, 'a_side'),
        a_stagger: gl.getAttribLocation(program, 'a_stagger'),
        a_dim: gl.getAttribLocation(program, 'a_dim'),
      }
      uni = {
        u_matrix: gl.getUniformLocation(program, 'u_matrix'),
        u_p: gl.getUniformLocation(program, 'u_p'),
        u_width: gl.getUniformLocation(program, 'u_width'),
        u_res: gl.getUniformLocation(program, 'u_res'),
        u_color: gl.getUniformLocation(program, 'u_color'),
        u_depthBias: gl.getUniformLocation(program, 'u_depthBias'),
        u_colorDim: gl.getUniformLocation(program, 'u_colorDim'),
      }
      buffer = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, geom.array, gl.STATIC_DRAW)
      glRef = gl
      dimBuffer = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, dimBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, dimFlags, gl.DYNAMIC_DRAW)
      dimDirty = false
    },

    onRemove(_map, gl) {
      if (dimBuffer) gl.deleteBuffer(dimBuffer)
      if (buffer) gl.deleteBuffer(buffer)
      if (program) gl.deleteProgram(program)
      buffer = null
      program = null
    },

    render(gl, args) {
      frames++
      if (!this.visible) return
      if (!program || !buffer || geom.vertices === 0) return
      gl.useProgram(program)
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)

      const stride = FLOATS_PER_VERTEX * 4
      const attrib = (name: string, size: number, offset: number) => {
        const l = loc[name]
        if (l < 0) return
        gl.enableVertexAttribArray(l)
        gl.vertexAttribPointer(l, size, gl.FLOAT, false, stride, offset)
      }
      attrib('a_pos', 2, 0)
      attrib('a_ztop', 1, 8)
      attrib('a_posb', 2, 12)
      attrib('a_ztopb', 1, 20)
      attrib('a_side', 1, 24)
      attrib('a_stagger', 1, 28)

      /* Separate, tightly-packed buffer: the dim flag changes on every filter
         click while the geometry never does, so re-uploading the interleaved
         array would push 8x the bytes for one float per vertex. */
      if (dimDirty && dimBuffer) {
        gl.bindBuffer(gl.ARRAY_BUFFER, dimBuffer)
        gl.bufferData(gl.ARRAY_BUFFER, dimFlags, gl.DYNAMIC_DRAW)
        dimDirty = false
      }
      if (loc.a_dim >= 0 && dimBuffer) {
        gl.bindBuffer(gl.ARRAY_BUFFER, dimBuffer)
        gl.enableVertexAttribArray(loc.a_dim)
        gl.vertexAttribPointer(loc.a_dim, 1, gl.FLOAT, false, 0, 0)
      }

      /* THE MATRIX IS `defaultProjectionData.mainMatrix`, NOT
         `modelViewProjectionMatrix`.
         The first version used the latter, which is the MapLibre v2/v3 custom
         layer convention carried over from memory. In v6 that matrix belongs to
         a different space: its translation row is ~1e7 while a mercator
         coordinate is ~0.18, so every vertex projected to NDC y = 2.34 — off
         screen, silently. The layer reported 848 segments, 274 rendered frames
         and GL error 0 the whole time, because all of those were true.
         `mainMatrix` is the one that takes normalised mercator, and the same
         sample vertex lands at NDC (0.42, 0.70). */
      const projection = (args.defaultProjectionData as { mainMatrix: Float32Array } | undefined)
      const matrix = projection?.mainMatrix ?? (args.modelViewProjectionMatrix as Float32Array)
      lastMatrix = Array.from(matrix)
      gl.uniformMatrix4fv(uni.u_matrix, false, matrix)
      gl.uniform1f(uni.u_p, progress)
      gl.uniform1f(uni.u_width, opts.width * (window.devicePixelRatio || 1))
      gl.uniform2f(uni.u_res, gl.drawingBufferWidth, gl.drawingBufferHeight)
      gl.uniform4f(uni.u_color, color[0], color[1], color[2], color[3])
      gl.uniform4f(uni.u_colorDim, opts.colorDim[0], opts.colorDim[1], opts.colorDim[2], opts.colorDim[3])
      gl.uniform1f(uni.u_depthBias, this.depthBias)

      /* DEPTH TEST ON, DEPTH WRITE OFF. Testing is what hides an edge behind a
         mass — without it this draws through the buildings and reads as an
         x-ray box. Not writing keeps the ribbons from occluding each other at
         the corners, where two quads meet at the same depth. */
      if (this.depthTest) {
        gl.enable(gl.DEPTH_TEST)
        gl.depthFunc(gl.LEQUAL)
      } else {
        gl.disable(gl.DEPTH_TEST)
      }
      gl.depthMask(false)

      /* THE EDGES ARE COINCIDENT WITH THE SURFACE THEY OUTLINE, so depth
         precision decides per-pixel, per-frame, which one wins — and as the
         camera moves that decision flips. That is the flicker: measured at a
         coefficient of variation of 15.6% in the gold-pixel count across a
         moving camera, against 5.6% with the layer removed.
         POLYGON_OFFSET_FILL is the fix for exactly this case (decals on
         surfaces) and applies here because the ribbons ARE triangles. Negative
         values pull toward the viewer. Disabling the depth test also removes
         the flicker — and draws every hidden edge, which is the x-ray box. */
      const [factor, units] = this.polygonOffset
      if (factor !== 0 || units !== 0) {
        gl.enable(gl.POLYGON_OFFSET_FILL)
        gl.polygonOffset(factor, units)
      }

      gl.drawArrays(gl.TRIANGLES, 0, geom.vertices)
      gl.disable(gl.POLYGON_OFFSET_FILL)
      const err = gl.getError()
      if (err !== 0) glError = err
      gl.depthMask(true)
      gl.enable(gl.DEPTH_TEST)
    },
  }
}
