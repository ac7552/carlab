// A car's shape as numbers: its size, where the wheels are, and the outline of its side (the "top" line from the
// nose over the hood, windshield, roof, rear glass and trunk to the tail). The 3D body (car.js) is built from this,
// and an outline traced from a photo (outline.js) becomes one of these. No three.js here, so it runs anywhere.
//
// Coordinates are meters. x runs along the car, positive toward the nose, 0 at the middle; y is up from the ground
// at stock ride height; z is across.

// The built-in car: an original sport sedan, not any real model.
export const DEFAULT_SPEC = Object.freeze({
  name: "Sport sedan",
  length: 4.76,
  width: 1.83,
  wheelbase: 2.85,
  frontOverhang: 0.95,
  tireRadius: 0.33,
  sillY: 0.17,
  noseBottomY: 0.24,
  tailBottomY: 0.28,
  roofWidth: 0.72, // the roof's width as a share of the body's
  // The side outline from the nose (largest x) to the tail.
  top: Object.freeze([
    [2.38, 0.5], [2.34, 0.63], [2.24, 0.7], [1.8, 0.76], [1.3, 0.83], [0.82, 0.94], [0.45, 1.18], [0.1, 1.38],
    [-0.3, 1.43], [-0.72, 1.4], [-1.05, 1.24], [-1.4, 1.02], [-1.8, 1.02], [-2.2, 1.0], [-2.33, 0.95], [-2.38, 0.84],
  ].map((p) => Object.freeze(p))),
  // Where the outline changes from hood to windshield, windshield to roof, roof to rear glass, rear glass to trunk.
  cowlX: 0.82,
  roofFrontX: 0.1,
  roofRearX: -0.72,
  deckX: -1.4,
})

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback)

// A smooth curve through points (monotone cubic: it never overshoots between points, so a flat roof stays flat).
export function smoothCurve(points) {
  const pts = [...points].map(([x, y]) => [Number(x), Number(y)]).sort((a, b) => a[0] - b[0])
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  const n = pts.length
  if (n === 0) return () => 0
  if (n === 1) return () => ys[0]
  const d = [], m = new Array(n)
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-9, xs[i + 1] - xs[i]))
  m[0] = d[0]; m[n - 1] = d[n - 2]
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i] }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0]
    if (x >= xs[n - 1]) return ys[n - 1]
    let i = 0
    while (i < n - 2 && x > xs[i + 1]) i++
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h
    const t2 = t * t, t3 = t2 * t
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1]
  }
}

// Checks a shape and fills in anything missing or out of range, so every spec the body sees is buildable.
export function normalizeSpec(input = {}) {
  const d = DEFAULT_SPEC
  const length = clamp(num(input.length, d.length), 2.5, 6.5)
  const half = length / 2
  const width = clamp(num(input.width, d.width), 1.4, 2.3)
  const wheelbase = clamp(num(input.wheelbase, d.wheelbase), length * 0.45, length * 0.75)
  const frontOverhang = clamp(num(input.frontOverhang, d.frontOverhang), 0.3, length - wheelbase - 0.3)
  const tireRadius = clamp(num(input.tireRadius, d.tireRadius), 0.25, 0.48)
  let top = Array.isArray(input.top) && input.top.length >= 4 ? input.top : null
  if (top) {
    top = top.map((p) => [clamp(num(p[0], 0), -half, half), clamp(num(p[1], 0.5), 0.3, 2.6)]).sort((a, b) => b[0] - a[0])
  } else {
    // The default outline, stretched to this length.
    const k = length / d.length
    top = d.top.map(([x, y]) => [x * k, y])
  }
  const kx = Array.isArray(input.top) && input.top.length >= 4 ? 1 : length / d.length
  // The rear glass can end right at the tail (a wagon's or an SUV's upright tailgate); the windshield can't start at
  // the nose.
  const rearmost = -half + 0.05
  const breaks = ["cowlX", "roofFrontX", "roofRearX", "deckX"].map((key) => clamp(num(input[key], d[key] * kx), rearmost, half - 0.2))
  breaks.sort((a, b) => b - a)
  // Keep the breaks apart, front to back, and inside the car.
  for (let i = 1; i < 4; i++) if (breaks[i] > breaks[i - 1] - 0.1) breaks[i] = breaks[i - 1] - 0.1
  if (breaks[3] < rearmost) for (let i = 3; i >= 0; i--) breaks[i] = Math.max(breaks[i], rearmost + (3 - i) * 0.1)
  const [cowlX, roofFrontX, roofRearX, deckX] = breaks
  return {
    name: String(input.name || d.name).slice(0, 80),
    length, width, wheelbase, frontOverhang, tireRadius,
    sillY: clamp(num(input.sillY, d.sillY), 0.08, 0.5),
    noseBottomY: clamp(num(input.noseBottomY, d.noseBottomY), 0.1, 0.6),
    tailBottomY: clamp(num(input.tailBottomY, d.tailBottomY), 0.1, 0.6),
    roofWidth: clamp(num(input.roofWidth, d.roofWidth), 0.5, 0.95),
    top, cowlX, roofFrontX, roofRearX, deckX,
  }
}

// Everything the body needs to know about a shape, worked out once.
export function shapeOf(specInput) {
  const spec = normalizeSpec(specInput)
  const half = spec.length / 2
  const frontAxleX = half - spec.frontOverhang
  const rearAxleX = frontAxleX - spec.wheelbase
  const archRadius = spec.tireRadius * 1.13
  const topY = smoothCurve(spec.top)
  // The belt line under the side windows: from the base of the windshield to the base of the rear glass.
  const beltAtCowl = topY(spec.cowlX), beltAtDeck = topY(spec.deckX)
  const belt = (x) => beltAtDeck + (beltAtCowl - beltAtDeck) * ((x - spec.deckX) / (spec.cowlX - spec.deckX))
  // The top of the lower body: hood and trunk where they are; the belt line through the cabin.
  const lowerTop = (x) => (x <= spec.cowlX && x >= spec.deckX ? Math.min(topY(x), belt(x)) : topY(x))
  const bottom = smoothCurve([
    [half, spec.noseBottomY], [frontAxleX + archRadius + 0.1, spec.sillY + 0.04], [frontAxleX, spec.sillY],
    [rearAxleX, spec.sillY], [rearAxleX - archRadius - 0.1, spec.sillY + 0.05], [-half, spec.tailBottomY],
  ])
  // Half the width, seen from above: square in the middle, rounded at the nose and tail, a little wider at the arches.
  const halfWidth = (x) => {
    const u = Math.min(1, Math.abs(x) / half)
    const p = x > 0 ? 4.2 : 5.5
    const base = Math.pow(Math.max(0, 1 - Math.pow(u, p)), 1 / p)
    const flare = 0.018 * (Math.exp(-(((x - frontAxleX) / 0.45) ** 2)) + Math.exp(-(((x - rearAxleX) / 0.45) ** 2)))
    return (spec.width / 2 - 0.018) * base + flare * base
  }
  // The lower edge of the body's side, raised around each wheel.
  const archEdge = (x) => {
    let y = -Infinity
    for (const ax of [frontAxleX, rearAxleX]) {
      const dx = x - ax
      if (Math.abs(dx) < archRadius) y = Math.max(y, spec.tireRadius + Math.sqrt(archRadius * archRadius - dx * dx))
    }
    return y
  }
  return { spec, half, frontAxleX, rearAxleX, archRadius, topY, lowerTop, belt, bottom, halfWidth, archEdge }
}

// Where to cut the body into slices along its length: evenly, plus extra slices where the shape changes quickly
// (the rounded nose and tail, and around the wheel arches so their curve is smooth).
export function slicePositions(shape, count = 150) {
  const { half, frontAxleX, rearAxleX, archRadius } = shape
  const xs = []
  for (let i = 0; i <= count; i++) xs.push(-half + (2 * half * i) / count)
  for (let i = 1; i <= 24; i++) {
    const t = 1 - Math.cos((i / 24) * (Math.PI / 2))
    xs.push(half - t * 0.35, -half + t * 0.35)
  }
  for (const ax of [frontAxleX, rearAxleX]) {
    for (let i = 0; i <= 40; i++) xs.push(ax + archRadius * Math.cos((i / 40) * Math.PI))
  }
  xs.sort((a, b) => a - b)
  const out = []
  for (const x of xs) if (x >= -half && x <= half && (!out.length || x - out[out.length - 1] > 0.002)) out.push(x)
  if (out[out.length - 1] < half) out.push(half)
  return out
}

// The panels a body is cut into. Painted panels take paint, wraps and film; the rest keep their own look.
export const PANELS = Object.freeze([
  "frontBumper", "hoodFront", "hood", "fenderFront", "fender", "doorFront", "doorRear", "rocker", "quarter", "trunk",
  "rearBumper", "roofFront", "roof", "pillarA", "pillarC", "mirror",
  "grille", "trim", "windshield", "sideGlass", "rearGlass", "headlight", "taillight",
])
export const PAINTED = Object.freeze(PANELS.slice(0, 16))
export const PANEL_NAMES = Object.freeze({
  frontBumper: "Front bumper", hoodFront: "Hood, front", hood: "Hood", fenderFront: "Fenders, front", fender: "Fenders",
  doorFront: "Front doors", doorRear: "Rear doors", rocker: "Rockers", quarter: "Rear quarters", trunk: "Trunk lid",
  rearBumper: "Rear bumper", roofFront: "Roof, front edge", roof: "Roof", pillarA: "A-pillars", pillarC: "C-pillars",
  mirror: "Mirrors", grille: "Grille", trim: "Window trim", windshield: "Windshield", sideGlass: "Side glass",
  rearGlass: "Rear glass", headlight: "Headlights", taillight: "Taillights",
})
