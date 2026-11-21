// The car's body in three.js, built from a shape (profile.js): a lower body (bumpers, hood, fenders, doors, trunk)
// and a greenhouse (glass, pillars, roof), each lofted through slices along the car and cut into panels. Each panel
// is a geometry group with its own material, so paint, wraps and film can go on panel by panel. Wheels are in
// wheels.js; how panels look is in materials.js.
import * as THREE from "../vendor/three.module.js"
import { shapeOf, slicePositions, PANELS } from "./profile.js"

const PANEL_INDEX = Object.fromEntries(PANELS.map((id, i) => [id, i]))

// --- Cross-sections -------------------------------------------------------------------------------------------
//
// A slice is made of segments (left side, left corner, top, right corner, right side), each with a fixed number of
// points, so a segment's edge runs along the same row of the mesh from one end of the car to the other: panel
// edges that follow segments (the window line, the top of the doors) are clean lines, not steps.

const LOWER_COUNTS = { side: 22, corner: 10, top: 28 }
const GLASS_COUNTS = { side: 14, corner: 8, top: 18 }

// A polyline resampled to `count` points evenly along its length.
function resample(points, count) {
  const lengths = [0]
  for (let i = 1; i < points.length; i++) {
    lengths.push(lengths[i - 1] + Math.hypot(points[i].z - points[i - 1].z, points[i].y - points[i - 1].y))
  }
  const total = lengths[lengths.length - 1]
  const out = []
  let k = 0
  for (let i = 0; i < count; i++) {
    const target = total === 0 ? 0 : (total * i) / (count - 1)
    while (k < points.length - 2 && lengths[k + 1] < target) k++
    const span = lengths[k + 1] - lengths[k]
    const t = span > 0 ? (target - lengths[k]) / span : 0
    const a = points[k], b = points[Math.min(k + 1, points.length - 1)]
    out.push({ z: a.z + (b.z - a.z) * t, y: a.y + (b.y - a.y) * t })
  }
  return out
}

// Joins segments ({ tag, points, count }) into one slice. Each point carries its segment's tag, and `u`: how far up
// the side it is (0 at the bottom edge, 1 at the shoulder), for side segments.
function joinSegments(segments) {
  const out = []
  segments.forEach((seg, k) => {
    const pts = resample(seg.points, seg.count)
    pts.forEach((p, i) => {
      if (k > 0 && i === 0) return // the joint is the previous segment's last point
      const t = i / (seg.count - 1)
      out.push({ ...p, tag: seg.tag, u: seg.tag === "side" ? (seg.up ? t : 1 - t) : 1 })
    })
  })
  return out
}

// The right half of a slice as segments, from the bottom up: side, corner, half the top.
function halfSegments(side, corner, top) {
  return { side, corner, top }
}


// Mirrors right-half segments into a full slice: left side up, left corner, top across, right corner, right side down.
function fullSlice({ side, corner, top }, counts) {
  const neg = (pts) => pts.map((p) => ({ ...p, z: -p.z }))
  const across = [...neg(top), ...top.slice().reverse().slice(1)]
  return joinSegments([
    { tag: "side", points: neg(side), count: counts.side, up: true },
    { tag: "corner", points: neg(corner), count: counts.corner },
    { tag: "top", points: across, count: counts.top },
    { tag: "corner", points: corner.slice().reverse(), count: counts.corner },
    { tag: "side", points: side.slice().reverse(), count: counts.side, up: false },
  ])
}

// The numbers behind one slice of the lower body.
export function lowerParams(shape, x) {
  const w = Math.max(0, shape.halfWidth(x))
  const yt = shape.lowerTop(x)
  const yb = Math.min(shape.bottom(x), yt - 0.02)
  const height = yt - yb
  const rt = Math.max(0, Math.min(0.11, w * 0.45, height * 0.4))
  const crown = Math.min(0.03, w * 0.035)
  return { w, yt, yb, rt, crown, cut: Math.min(Math.max(yb, shape.archEdge(x)), yt - 0.015) }
}

// The right half of a lower-body slice: the side wall (trimmed above a wheel arch), the shoulder, half the top.
function lowerHalf(shape, x) {
  const { w, yt, yb, rt, crown, cut } = lowerParams(shape, x)
  const ys = yt - crown - rt
  const sideZ = (y) => {
    const u = Math.min(1, Math.max(0, (y - yb) / Math.max(1e-6, ys - yb)))
    const tuck = Math.max(0, 1 - u / 0.22) ** 2
    return w * (0.955 + 0.04 * Math.sin(Math.PI * u) * (1 - u * 0.4)) - w * 0.07 * tuck
  }
  const z0 = sideZ(ys)
  let corner = []
  for (let i = 0; i <= 28; i++) { const a = (i / 28) * (Math.PI / 2); corner.push({ z: z0 - rt + rt * Math.cos(a), y: ys + rt * Math.sin(a) }) }
  let side = []
  if (cut < ys) {
    for (let i = 0; i <= 30; i++) { const y = cut + ((ys - cut) * i) / 30; side.push({ z: sideZ(y), y }) }
  } else {
    // Over a wheel the arch reaches into the shoulder: the side is gone and the shoulder starts at the arch.
    const k = Math.max(1, corner.findIndex((p) => p.y >= cut))
    const a = corner[k - 1], b = corner[k]
    const t = (cut - a.y) / Math.max(1e-9, b.y - a.y)
    const start = { z: a.z + (b.z - a.z) * t, y: cut }
    corner = [start, ...corner.slice(k)]
    side = [start, { ...start }]
  }
  const zt = Math.max(0, z0 - rt)
  const top = []
  for (let i = 0; i <= 20; i++) { const z = zt * (1 - i / 20); top.push({ z, y: yt - crown * (zt > 0 ? (z / zt) ** 2 : 0) }) }
  return halfSegments(side, corner, top)
}

export function lowerSection(shape, x) {
  return fullSlice(lowerHalf(shape, x), LOWER_COUNTS)
}

// One slice of the greenhouse, from the belt line on the left, over the roof, to the belt line on the right.
export function glassSection(shape, x) {
  const { spec, topY, belt } = shape
  const { w, rt } = lowerParams(shape, x)
  const yb = Math.min(belt(x), topY(x))
  const h = Math.max(0, topY(x) - yb)
  const mid = (spec.roofFrontX + spec.roofRearX) / 2
  const hRoof = Math.max(0.2, topY(mid) - belt(mid))
  const wb = Math.max(0.2, w * 0.955 - rt * 0.55)
  const f = Math.min(1, h / hRoof) ** 0.5
  const wt = wb + (w * spec.roofWidth - wb) * f
  const rr = Math.min(0.1, h * 0.45, wt * 0.45)
  const crown = Math.min(0.025, wt * 0.04, h * 0.3)
  const yt = yb + h
  const side = []
  for (let i = 0; i <= 20; i++) {
    const u = i / 20
    side.push({ z: wb + (wt - wb) * u + 0.012 * Math.sin(Math.PI * u) * f, y: yb + (yt - crown - rr - yb) * u })
  }
  const corner = []
  for (let i = 0; i <= 10; i++) { const a = (i / 10) * (Math.PI / 2); corner.push({ z: wt - rr + rr * Math.cos(a), y: yt - crown - rr + rr * Math.sin(a) }) }
  const zt = Math.max(0, wt - rr)
  const top = []
  for (let i = 0; i <= 14; i++) { const z = zt * (1 - i / 14); top.push({ z, y: yt - crown * (zt > 0 ? (z / zt) ** 2 : 0) }) }
  return fullSlice(halfSegments(side, corner, top), GLASS_COUNTS)
}

// Where the lower body's surface is at height y and distance z from the middle, near one end of the car: walks in
// from the nose (end = 1) or tail (end = -1) to the first slice that reaches that far out. For lights and grille.
export function surfacePoint(shape, end, y, z) {
  const reach = (x) => {
    const { side, corner, top } = lowerHalf(shape, x)
    const pts = [...side, ...corner.slice(1), ...top.slice(1)]
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i]
      if ((a.y - y) * (b.y - y) <= 0 && a.y !== b.y) return a.z + ((b.z - a.z) * (y - a.y)) / (b.y - a.y)
    }
    return 0
  }
  // Search between the very end and just outside the wheel arch (inside it the side wall is cut away).
  const archEdge = end > 0 ? shape.frontAxleX + shape.archRadius + 0.01 : shape.rearAxleX - shape.archRadius - 0.01
  let near = end * shape.half, far = archEdge
  if (reach(far) < Math.abs(z)) return null
  for (let i = 0; i < 30; i++) {
    const m = (near + far) / 2
    if (reach(m) >= Math.abs(z)) far = m
    else near = m
  }
  return [(near + far) / 2, y, z]
}

// --- Which panel a piece of the body belongs to --------------------------------------------------------------

export function landmarks(shape) {
  const { spec, half, frontAxleX: xF, rearAxleX: xR, archRadius: aR, topY } = shape
  const hlTop = topY(half - 0.12) - 0.035
  // Taillights sit under the rear glass, which on a wagon or hatchback comes down to the tail.
  const tlTop = Math.min(topY(-half + 0.12), topY(spec.deckX)) - 0.05
  const doorFrontEdge = Math.min(spec.cowlX - 0.02, xF - aR - 0.1)
  const doorRearEdge = Math.max(spec.deckX + 0.05, xR + aR * 0.55)
  return {
    hlTop, hlBot: hlTop - 0.085, tlTop, tlBot: tlTop - 0.1,
    frontEnd: xF + aR + 0.02, rearEnd: xR - aR - 0.02,
    doorFrontEdge, doorRearEdge, bX: (doorFrontEdge + doorRearEdge) / 2 + 0.08, frontSplit: half - 0.62,
  }
}

// tag: which segment of the slice (side, corner, top); u: how far up the side (0 bottom, 1 shoulder).
export function lowerPanel(shape, marks, x, y, z, tag, u) {
  const { spec, half } = shape
  const hood = () => (x > marks.frontSplit ? "hoodFront" : "hood")
  const fender = () => (x > marks.frontSplit ? "fenderFront" : "fender")
  if (x > marks.frontEnd) { // ahead of the front wheels
    if (tag === "top") return hood()
    if (tag === "corner") return x > half - 0.08 ? "hoodFront" : fender()
    return "frontBumper"
  }
  if (x < marks.rearEnd) { // behind the rear wheels
    if (tag === "top") return "trunk"
    if (tag === "corner") return x < -half + 0.08 ? "trunk" : "quarter"
    return "rearBumper"
  }
  if (tag === "top") {
    if (x > spec.cowlX) return hood()
    if (x < spec.deckX) return "trunk"
    return x > marks.bX ? "doorFront" : "doorRear"
  }
  if (x > marks.doorFrontEdge) return fender()
  if (x < marks.doorRearEdge) return "quarter"
  if (tag === "side" && u < 0.24) return "rocker"
  return x > marks.bX ? "doorFront" : "doorRear"
}

export function glassPanel(shape, marks, x, y, tag, u) {
  const { spec } = shape
  if (tag === "top") {
    if (x > spec.roofFrontX) return "windshield"
    if (x < spec.roofRearX) return "rearGlass"
    return x > spec.roofFrontX - 0.2 ? "roofFront" : "roof"
  }
  if (tag === "corner") {
    if (x > spec.roofFrontX) return "pillarA"
    if (x < spec.roofRearX) return "pillarC"
    return "roof"
  }
  if (u < 0.08) return "trim" // the strip along the bottom of the windows
  if (x > spec.cowlX - 0.07) return "pillarA"
  if (x < spec.deckX + 0.3) return "pillarC"
  if (Math.abs(x - marks.bX) < 0.05) return "trim" // B-pillar
  if (u > 0.93) return "trim" // the frame along the top
  return "sideGlass"
}

// Lights and the grille: thin shells laid on the body's nose and tail, with smooth outlines (finer than the body's
// own mesh). `outline(t)` gives the bottom and top height across the piece, t from its inner end (0) to its outer (1).
function decal(shape, end, z0, z1, outline, panel, { mirror = true, rows = 8, cols = 28 } = {}) {
  const positions = [], index = []
  const sides = mirror ? [-1, 1] : [1]
  for (const side of sides) {
    const base = positions.length / 3
    for (let i = 0; i < cols; i++) {
      const t = i / (cols - 1)
      const z = z0 + (z1 - z0) * t
      const [y0, y1] = outline(t)
      for (let j = 0; j < rows; j++) {
        const y = y0 + ((y1 - y0) * j) / (rows - 1)
        const p = surfacePoint(shape, end, y, z) || [end > 0 ? shape.frontAxleX + shape.archRadius : shape.rearAxleX - shape.archRadius, y, z]
        positions.push(p[0], p[1], side * p[2])
      }
    }
    for (let i = 0; i < cols - 1; i++) {
      for (let j = 0; j < rows - 1; j++) {
        const a = base + i * rows + j, b = a + 1, c = a + rows + 1, d = a + rows
        // Facing out of the car at either end and on either side.
        if (end * side > 0) index.push(a, b, c, a, c, d)
        else index.push(a, d, c, a, c, b)
      }
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  g.setIndex(index)
  g.computeVertexNormals()
  // Lift the shell 3 mm off the body so it never flickers through.
  const pos = g.attributes.position, nor = g.attributes.normal
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) + nor.getX(i) * 0.003, pos.getY(i) + nor.getY(i) * 0.003, pos.getZ(i) + nor.getZ(i) * 0.003)
  addUVs(g)
  g.addGroup(0, index.length, PANEL_INDEX[panel])
  return g
}

function lightsAndGrille(shape, marks) {
  const { spec } = shape
  const wMax = spec.width / 2
  const h = marks.hlTop - marks.hlBot
  // Headlights: a sweep from beside the grille out to the corner, a little taller at the outer end.
  const head = decal(shape, 1, wMax * 0.42, wMax * 0.9, (t) => [marks.hlBot + h * 0.18 * (1 - t) - 0.01 * t, marks.hlTop - h * 0.05 * (1 - t)], "headlight")
  // Grille: one wide opening across the middle of the bumper.
  const gTop = marks.hlBot + 0.005, gBot = Math.max(spec.noseBottomY + 0.07, gTop - 0.2)
  const grille = decal(shape, 1, 0, wMax * 0.36, (t) => [gBot + 0.02 * t, gTop - 0.012 * t * t], "grille", { cols: 16, rows: 8 })
  const lower = decal(shape, 1, 0, wMax * 0.62, () => [spec.noseBottomY + 0.035, spec.noseBottomY + 0.075], "grille", { cols: 20, rows: 4 })
  // Taillights: a band across each side of the tail, wrapping onto the rear quarters.
  const tl = marks.tlTop - marks.tlBot
  const tail = decal(shape, -1, wMax * 0.3, wMax * 0.9, (t) => [marks.tlBot + tl * 0.25 * (1 - t), marks.tlTop - tl * 0.1 * (1 - t)], "taillight")
  return [head, grille, lower, tail]
}

// --- Geometry -------------------------------------------------------------------------------------------------

// A surface through slices: `sections[i]` are the points at `xs[i]`. Faces are sorted into one group per panel.
function loft(xs, sections, panelOf) {
  const cols = sections[0].length
  const positions = new Float32Array(xs.length * cols * 3)
  xs.forEach((x, i) => sections[i].forEach((p, j) => positions.set([x, p.y, p.z], (i * cols + j) * 3)))
  const byPanel = new Map()
  const facePanel = []
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j, b = i * cols + j + 1, c = (i + 1) * cols + j + 1, d = (i + 1) * cols + j
      const p = sections[i][j], q = sections[i + 1][j + 1], next = sections[i][j + 1]
      const cx = (xs[i] + xs[i + 1]) / 2, cy = (p.y + q.y + next.y + sections[i + 1][j].y) / 4
      const cz = (p.z + q.z + next.z + sections[i + 1][j].z) / 4
      // A quad belongs to the segment its far edge is in (a segment's first point is the one before's last).
      const panel = panelOf(cx, cy, cz, next.tag, (p.u + next.u) / 2)
      facePanel.push(panel)
      if (!byPanel.has(panel)) byPanel.set(panel, [])
      byPanel.get(panel).push(a, b, c, a, c, d)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3))
  const index = []
  for (const [panel, list] of byPanel) {
    geometry.addGroup(index.length, list.length, PANEL_INDEX[panel])
    index.push(...list)
  }
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  addUVs(geometry)
  geometry.userData = { rows: xs.length, cols, facePanel }
  return geometry
}

// Two sets of texture coordinates, in meters: `uv` projects each vertex from whichever side it faces most (above,
// the side, or the front), so carbon weave and grille mesh aren't stretched; `uv1` always projects from above, so
// stripes run straight down the car across every panel.
function addUVs(geometry) {
  const pos = geometry.attributes.position, nor = geometry.attributes.normal
  const uv = new Float32Array(pos.count * 2), uv1 = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i))
    if (ny >= nx && ny >= nz) { uv[i * 2] = x; uv[i * 2 + 1] = z }
    else if (nx >= nz) { uv[i * 2] = z; uv[i * 2 + 1] = y }
    else { uv[i * 2] = x; uv[i * 2 + 1] = y }
    uv1[i * 2] = x; uv1[i * 2 + 1] = z
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2))
  geometry.setAttribute("uv1", new THREE.BufferAttribute(uv1, 2))
}

// Thin dark lines where one painted panel meets another: the shut lines around the doors, hood and trunk.
function seams(geometry, painted) {
  const { rows, cols, facePanel } = geometry.userData
  const pos = geometry.attributes.position, nor = geometry.attributes.normal
  const out = []
  const v = (k) => [pos.getX(k) + nor.getX(k) * 0.0015, pos.getY(k) + nor.getY(k) * 0.0015, pos.getZ(k) + nor.getZ(k) * 0.0015]
  const face = (i, j) => facePanel[i * (cols - 1) + j]
  const xs = [], half = Math.abs(pos.getX(0))
  for (let i = 0; i < rows; i++) xs.push(pos.getX(i * cols))
  for (let i = 0; i < rows - 1; i++) {
    // No shut lines across the nose and tail faces, where every row of the mesh bunches together.
    if (Math.abs(xs[i]) > half - 0.12 || Math.abs(xs[i + 1]) > half - 0.12) continue
    for (let j = 0; j < cols - 1; j++) {
      const here = face(i, j)
      if (!painted.has(here)) continue
      if (j + 1 < cols - 1) {
        const next = face(i, j + 1)
        if (next !== here && painted.has(next)) out.push(...v(i * cols + j + 1), ...v((i + 1) * cols + j + 1))
      }
      if (i + 1 < rows - 1) {
        const next = face(i + 1, j)
        if (next !== here && painted.has(next)) out.push(...v((i + 1) * cols + j), ...v((i + 1) * cols + j + 1))
      }
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(out), 3))
  return g
}

// The side mirrors: a rounded housing on a short arm at the base of each A-pillar.
function mirrorGeometry(shape) {
  const { spec, belt } = shape
  const x = spec.cowlX - 0.12
  const { w, rt } = lowerParams(shape, x)
  const base = w * 0.955 - rt * 0.55
  const parts = []
  for (const side of [-1, 1]) {
    const housing = new THREE.SphereGeometry(1, 20, 14)
    housing.scale(0.085, 0.062, 0.12)
    housing.translate(x - 0.02, belt(x) + 0.085, side * (base + 0.15))
    const arm = new THREE.BoxGeometry(0.06, 0.03, 0.11)
    arm.translate(x, belt(x) + 0.05, side * (base + 0.05))
    parts.push(housing, arm)
  }
  const merged = mergeSimple(parts)
  merged.addGroup(0, merged.index.count, PANEL_INDEX.mirror)
  addUVs(merged)
  return merged
}

// Joins plain indexed geometries (same attributes) into one.
function mergeSimple(list) {
  const pos = [], nor = [], idx = []
  let offset = 0
  for (const g of list) {
    const p = g.attributes.position, n = g.attributes.normal
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)) }
    for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + offset)
    offset += p.count
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3))
  out.setIndex(idx)
  return out
}

// Builds the body for a shape. `materials` is one material per entry in PANELS (materials.js makes them).
export function buildBody(specInput, materials) {
  const shape = shapeOf(specInput)
  const { spec, half, frontAxleX, rearAxleX, archRadius } = shape
  const marks = landmarks(shape)
  const group = new THREE.Group()
  group.name = "body"

  const xs = slicePositions(shape)
  const lower = loft(xs, xs.map((x) => lowerSection(shape, x)), (x, y, z, tag, u) => lowerPanel(shape, marks, x, y, z, tag, u))
  const lowerMesh = new THREE.Mesh(lower, materials)
  lowerMesh.name = "lower"

  const gxs = [spec.deckX, ...xs.filter((x) => x > spec.deckX + 0.003 && x < spec.cowlX - 0.003), spec.cowlX]
  for (let i = 1; i <= 16; i++) gxs.push(spec.cowlX - (spec.cowlX - spec.roofFrontX) * (i / 17)) // a smoother windshield
  gxs.sort((a, b) => a - b)
  const glassXs = gxs.filter((x, i) => i === 0 || x - gxs[i - 1] > 0.002)
  const glass = loft(glassXs, glassXs.map((x) => glassSection(shape, x)), (x, y, z, tag, u) => glassPanel(shape, marks, x, y, tag, u))
  const glassMesh = new THREE.Mesh(glass, materials)
  glassMesh.name = "greenhouse"

  const mirrorMesh = new THREE.Mesh(mirrorGeometry(shape), materials)
  mirrorMesh.name = "mirrors"
  const lights = lightsAndGrille(shape, marks).map((g, i) => Object.assign(new THREE.Mesh(g, materials), { name: `lights-${i}` }))
  for (const mesh of [lowerMesh, glassMesh, mirrorMesh]) { mesh.castShadow = true; mesh.receiveShadow = true }

  const painted = new Set(["frontBumper", "hoodFront", "hood", "fenderFront", "fender", "doorFront", "doorRear", "rocker", "quarter", "trunk", "rearBumper", "roofFront", "roof", "pillarA", "pillarC"])
  const lineMaterial = new THREE.LineBasicMaterial({ color: 0x050505, transparent: true, opacity: 0.55 })
  const lines = new THREE.LineSegments(mergeLines([seams(lower, painted), seams(glass, painted)]), lineMaterial)
  lines.name = "seams"

  // What you'd see through the arches and under the car: dark liners and a floor pan.
  const dark = new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.9, side: THREE.DoubleSide })
  const underside = new THREE.Group()
  underside.name = "underside"
  for (const ax of [frontAxleX, rearAxleX]) {
    for (const side of [-1, 1]) {
      const liner = new THREE.CylinderGeometry(archRadius - 0.006, archRadius - 0.006, 0.42, 28, 1, true, 0, Math.PI)
      liner.rotateX(Math.PI / 2)
      liner.rotateZ(-Math.PI / 2)
      const m = new THREE.Mesh(liner, dark)
      m.position.set(ax, spec.tireRadius, side * (shape.halfWidth(ax) - 0.24))
      // The well's inner wall, so the gap between the tire and the arch looks into the dark, not through the car.
      const wall = new THREE.Mesh(new THREE.CircleGeometry(archRadius, 40), dark)
      wall.position.set(ax, spec.tireRadius, side * (shape.halfWidth(ax) - 0.45))
      underside.add(m, wall)
    }
  }
  const pan = new THREE.Mesh(new THREE.PlaneGeometry(2 * half - 0.4, spec.width - 0.22), dark)
  pan.rotation.x = Math.PI / 2
  pan.position.y = spec.sillY + 0.03
  underside.add(pan)

  // Two exhaust tips under the rear bumper.
  const tipMaterial = new THREE.MeshStandardMaterial({ color: 0xb9bdc4, metalness: 1, roughness: 0.25 })
  for (const side of [-1, 1]) {
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.16, 24, 1, true), tipMaterial)
    tip.rotation.z = Math.PI / 2
    tip.position.set(-half + 0.08, spec.tailBottomY + 0.035, side * spec.width * 0.27)
    underside.add(tip)
  }

  group.add(lowerMesh, glassMesh, mirrorMesh, ...lights, lines, underside)
  return { group, shape, marks, meshes: [lowerMesh, glassMesh, mirrorMesh, ...lights] }
}

function mergeLines(list) {
  const all = []
  for (const g of list) all.push(...g.attributes.position.array)
  const out = new THREE.BufferGeometry()
  out.setAttribute("position", new THREE.BufferAttribute(new Float32Array(all), 3))
  return out
}

// Which panel a ray hit, for clicking panels on the car.
export function panelOfHit(hit) {
  if (!hit || !hit.face) return null
  return PANELS[hit.face.materialIndex] ?? null
}
