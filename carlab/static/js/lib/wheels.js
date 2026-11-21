// Wheels: a tire, a rim in one of several spoke styles, a brake disc and a caliper. Built facing +z (the outside of
// the car's right side); the left side's wheels are turned around. The tire's outside size stays the same whatever
// the rim size, as when you fit bigger wheels with lower-profile tires.
import * as THREE from "../vendor/three.module.js"

export const WHEEL_STYLES = Object.freeze({
  five: "5-spoke",
  split: "Split 5-spoke",
  multi: "10-spoke",
  y: "Y-spoke",
  mesh: "Mesh",
  dish: "Deep dish",
})
export const RIM_SIZES = Object.freeze([17, 18, 19, 20, 21, 22])

// The rim's outer radius (meters) for a size in inches, held so the tire keeps a sidewall.
export function rimRadius(inches, tireRadius) {
  return Math.min(inches * 0.0254 / 2 + 0.012, tireRadius - 0.05)
}

// How tall the tire's sidewall is, in millimeters, for a rim size: what a buyer sees change.
export function sidewallMm(inches, tireRadius) {
  return Math.round((tireRadius - rimRadius(inches, tireRadius)) * 1000)
}

function lathe(points, segments = 64) {
  const g = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments)
  g.rotateX(Math.PI / 2) // the lathe's axis (y) becomes the axle (z)
  return g
}

function tireGeometry(R, rr, w) {
  const pts = []
  const h = w / 2
  pts.push([rr - 0.004, -h * 0.86])
  for (let i = 0; i <= 8; i++) { // inner sidewall, bulging a little
    const t = i / 8
    pts.push([rr + (R - 0.03 - rr) * t, -h * (0.86 + 0.12 * Math.sin(Math.PI * t * 0.9))])
  }
  for (let i = 1; i <= 6; i++) { const a = (i / 6) * (Math.PI / 2); pts.push([R - 0.03 + 0.03 * Math.sin(a), -h + 0.03 * (1 - Math.cos(a)) - 0.0]) }
  pts.push([R, h - 0.03])
  for (let i = 1; i <= 6; i++) { const a = (i / 6) * (Math.PI / 2); pts.push([R - 0.03 * (1 - Math.cos(a)), h - 0.03 + 0.03 * Math.sin(a)]) }
  for (let i = 0; i <= 8; i++) {
    const t = i / 8
    pts.push([R - 0.03 - (R - 0.03 - rr) * t, h * (0.98 - 0.12 * Math.sin(Math.PI * (1 - t) * 0.9))])
  }
  pts.push([rr - 0.004, h * 0.86])
  // The lathe needs the points going around one way; sort out the order by walking the outline as written.
  return lathe(pts.map(([r, y]) => [r, -y]).reverse(), 72)
}

function barrelGeometry(rr, w, faceZ) {
  const h = w / 2
  return lathe([
    [rr - 0.035, -h * 0.8], [rr - 0.012, -h * 0.84], [rr - 0.012, faceZ + 0.01], [rr + 0.012, h * 0.82],
    [rr + 0.014, h * 0.9], [rr - 0.004, h * 0.93], [rr - 0.02, h * 0.88], [rr - 0.03, faceZ + 0.015],
  ].reverse(), 72)
}

// One straight spoke from radius r0 at angle a0 to radius r1 at angle a1, w0/w1 wide at each end.
function bar(r0, a0, w0, r1, a1, w1) {
  const p0 = new THREE.Vector2(r0 * Math.cos(a0), r0 * Math.sin(a0))
  const p1 = new THREE.Vector2(r1 * Math.cos(a1), r1 * Math.sin(a1))
  const dir = p1.clone().sub(p0).normalize()
  const perp = new THREE.Vector2(-dir.y, dir.x)
  const shape = new THREE.Shape([
    p0.clone().addScaledVector(perp, w0 / 2), p1.clone().addScaledVector(perp, w1 / 2),
    p1.clone().addScaledVector(perp, -w1 / 2), p0.clone().addScaledVector(perp, -w0 / 2),
  ])
  return new THREE.ExtrudeGeometry(shape, { depth: 0.026, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 4 })
}

// The spokes for a style, as a list of geometries lying in the wheel's plane.
export function spokeGeometries(style, rr) {
  const hub = 0.08, r1 = rr - 0.022
  const out = []
  const ring = (n, fn) => { for (let i = 0; i < n; i++) fn((i / n) * Math.PI * 2 + Math.PI / 2) }
  switch (style) {
    case "split":
      ring(5, (a) => { out.push(bar(hub, a - 0.05, 0.03, r1, a - 0.13, 0.026), bar(hub, a + 0.05, 0.03, r1, a + 0.13, 0.026)) })
      break
    case "multi":
      ring(10, (a) => out.push(bar(hub, a, 0.036, r1, a, 0.03)))
      break
    case "y":
      ring(5, (a) => {
        const mid = hub + (r1 - hub) * 0.5
        out.push(bar(hub, a, 0.05, mid, a, 0.042), bar(mid - 0.01, a, 0.03, r1, a - 0.16, 0.026), bar(mid - 0.01, a, 0.03, r1, a + 0.16, 0.026))
      })
      break
    case "mesh":
      ring(10, (a) => { out.push(bar(hub, a, 0.02, r1, a + 0.32, 0.016), bar(hub, a, 0.02, r1, a - 0.32, 0.016)) })
      break
    case "dish":
      ring(6, (a) => out.push(bar(hub, a, 0.055, rr * 0.7, a, 0.05)))
      break
    case "five":
    default:
      ring(5, (a) => out.push(bar(hub, a, 0.07, r1, a, 0.05)))
  }
  return out
}

function mergeAll(geometries) {
  // Keep only what the materials use (position, normal), so geometries from different builders join.
  const pos = [], nor = [], idx = []
  let offset = 0
  for (const src of geometries) {
    const g = src.index ? src : src
    const p = g.attributes.position, n = g.attributes.normal
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)) }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + offset)
    else for (let i = 0; i < p.count; i++) idx.push(i + offset)
    offset += p.count
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3))
  out.setIndex(idx)
  return out
}

// A whole wheel. `options`: { inches, style, tireRadius, tireWidth }. `materials`: { rim, tire, disc, caliper }.
export function buildWheel(options, materials) {
  const tireRadius = options.tireRadius ?? 0.33
  const w = options.tireWidth ?? 0.245
  const inches = options.inches ?? 19
  const style = WHEEL_STYLES[options.style] ? options.style : "five"
  const rr = rimRadius(inches, tireRadius)
  const faceZ = style === "dish" ? w * 0.05 : w * 0.28

  const wheel = new THREE.Group()
  wheel.name = "wheel"
  const spinning = new THREE.Group()
  spinning.name = "spinning"

  const tire = new THREE.Mesh(tireGeometry(tireRadius, rr, w), materials.tire)
  tire.castShadow = true

  const rimParts = [barrelGeometry(rr, w, faceZ)]
  for (const g of spokeGeometries(style, rr)) { g.translate(0, 0, faceZ - 0.013); rimParts.push(g) }
  const hubCap = new THREE.CylinderGeometry(0.085, 0.09, 0.035, 32)
  hubCap.rotateX(Math.PI / 2)
  hubCap.translate(0, 0, faceZ + 0.006)
  rimParts.push(hubCap)
  if (style === "dish") {
    const lip = new THREE.RingGeometry(rr * 0.7, rr - 0.004, 72, 1)
    lip.translate(0, 0, faceZ - 0.004)
    rimParts.push(lip)
    const step = new THREE.CylinderGeometry(rr * 0.7, rr * 0.7, w * 0.36, 72, 1, true)
    step.rotateX(Math.PI / 2)
    step.translate(0, 0, faceZ + w * 0.18)
    rimParts.push(step)
    const outerLip = new THREE.RingGeometry(rr * 0.7, rr - 0.004, 72, 1)
    outerLip.translate(0, 0, faceZ + w * 0.36)
    rimParts.push(outerLip)
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    const lug = new THREE.CylinderGeometry(0.011, 0.011, 0.02, 8)
    lug.rotateX(Math.PI / 2)
    lug.translate(0.055 * Math.cos(a), 0.055 * Math.sin(a), faceZ + 0.032)
    rimParts.push(lug)
  }
  const rim = new THREE.Mesh(mergeAll(rimParts), materials.rim)
  rim.castShadow = true
  rim.name = "rim"

  const disc = new THREE.Mesh(new THREE.CylinderGeometry(rr * 0.82, rr * 0.82, 0.026, 48), materials.disc)
  disc.rotation.x = Math.PI / 2
  disc.position.z = faceZ - 0.07
  spinning.add(tire, rim, disc)

  // The caliper sits on top of the disc and doesn't turn with the wheel.
  const caliperShape = new THREE.Shape()
  const a0 = Math.PI / 2 - 0.42, a1 = Math.PI / 2 + 0.42
  caliperShape.absarc(0, 0, rr * 0.88, a0, a1, false)
  caliperShape.absarc(0, 0, rr * 0.6, a1, a0, true)
  const caliper = new THREE.Mesh(new THREE.ExtrudeGeometry(caliperShape, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2 }), materials.caliper)
  caliper.position.z = faceZ - 0.115
  caliper.name = "caliper"

  wheel.add(spinning, caliper)
  wheel.userData = { inches, style, rimRadius: rr, tireRadius, faceZ }
  return wheel
}
