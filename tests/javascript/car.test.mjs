import { test } from "node:test"
import assert from "node:assert/strict"
import * as THREE from "../../carlab/static/js/vendor/three.module.js"
import { buildBody, lowerSection, glassSection } from "../../carlab/static/js/lib/car.js"
import { DEFAULT_SPEC, PANELS, PAINTED, shapeOf, normalizeSpec, smoothCurve } from "../../carlab/static/js/lib/profile.js"
import { buildWheel, rimRadius, sidewallMm, spokeGeometries, WHEEL_STYLES } from "../../carlab/static/js/lib/wheels.js"

const materials = PANELS.map(() => new THREE.MeshStandardMaterial())
const usedPanels = (mesh) => new Set(mesh.geometry.groups.map((g) => PANELS[g.materialIndex]))

test("the default car is built from panels, with every face in one", () => {
  const { meshes } = buildBody(DEFAULT_SPEC, materials)
  const [lower, glass, mirrors, ...lights] = meshes
  for (const mesh of meshes) {
    const covered = mesh.geometry.groups.reduce((n, g) => n + g.count, 0)
    assert.equal(covered, mesh.geometry.index.count, `${mesh.name}: every triangle belongs to a panel`)
  }
  for (const id of ["frontBumper", "hoodFront", "hood", "fenderFront", "fender", "doorFront", "doorRear", "rocker", "quarter", "trunk", "rearBumper"]) {
    assert.ok(usedPanels(lower).has(id), `lower body has ${id}`)
  }
  const lit = new Set(lights.flatMap((m) => [...usedPanels(m)]))
  assert.deepEqual([...lit].sort(), ["grille", "headlight", "taillight"])
  for (const id of ["windshield", "sideGlass", "rearGlass", "roof", "roofFront", "pillarA", "pillarC", "trim"]) {
    assert.ok(usedPanels(glass).has(id), `greenhouse has ${id}`)
  }
  assert.deepEqual([...usedPanels(mirrors)], ["mirror"])
})

test("the body is sound: no bad numbers, and its faces point outward", () => {
  const { meshes } = buildBody(DEFAULT_SPEC, materials)
  for (const mesh of meshes) {
    for (const name of ["position", "normal", "uv", "uv1"]) {
      assert.ok(mesh.geometry.attributes[name].array.every(Number.isFinite), `${mesh.name} ${name}`)
    }
  }
  const lower = meshes[0].geometry
  const pos = lower.attributes.position, nor = lower.attributes.normal
  let up = 0, out = 0, checked = 0
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
    if (Math.abs(x) > 1.5) continue
    if (Math.abs(z) < 0.2 && y > 0.7) { checked++; if (nor.getY(i) > 0.5) up++ }
    if (Math.abs(z) > 0.85 && y > 0.35 && y < 0.65) { checked++; if (Math.sign(nor.getZ(i)) === Math.sign(z)) out++ }
  }
  assert.ok(checked > 50)
  assert.equal(up + out, checked, "tops face up and sides face out")
})

test("the car is the same on both sides", () => {
  const { meshes } = buildBody(DEFAULT_SPEC, materials)
  const g = meshes[0].geometry
  const { rows, cols } = g.userData
  const pos = g.attributes.position
  for (let i = 0; i < rows; i += 7) {
    for (let j = 0; j < cols; j++) {
      const a = i * cols + j, b = i * cols + (cols - 1 - j)
      assert.ok(Math.abs(pos.getY(a) - pos.getY(b)) < 1e-5 && Math.abs(pos.getZ(a) + pos.getZ(b)) < 1e-5)
    }
  }
})

test("its side outline follows the spec's outline", () => {
  const shape = shapeOf(DEFAULT_SPEC)
  for (const x of [1.8, 1.0, -0.3, -1.8]) {
    const section = lowerSection(shape, x)
    const glass = glassSection(shape, x)
    const highest = Math.max(...section.map((p) => p.y), ...glass.map((p) => p.y))
    assert.ok(Math.abs(highest - shape.topY(x)) < 0.01, `top at x=${x}: ${highest} vs ${shape.topY(x)}`)
  }
})

test("the wheel arches clear the tires, even lowered 40 mm", () => {
  const { meshes, shape } = buildBody(DEFAULT_SPEC, materials)
  const pos = meshes[0].geometry.attributes.position
  const r = shape.spec.tireRadius
  let closest = Infinity
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i) - 0.04, z = Math.abs(pos.getZ(i))
    if (z < shape.spec.width / 2 - 0.25) continue // the tire is near the outside
    for (const ax of [shape.frontAxleX, shape.rearAxleX]) {
      const d = Math.hypot(x - ax, y - r)
      if (d < closest) closest = d
    }
  }
  assert.ok(closest >= r, `closest body point is ${closest.toFixed(3)} m from a wheel center (tire radius ${r})`)
})

test("other shapes build too: a tall wagon and a long low coupe", () => {
  const tall = normalizeSpec({
    length: 4.9, width: 1.95, wheelbase: 2.95, frontOverhang: 0.92, tireRadius: 0.37, sillY: 0.24,
    top: [[2.45, 0.62], [2.3, 0.86], [1.6, 0.98], [0.95, 1.08], [0.4, 1.55], [-0.6, 1.72], [-2.0, 1.68], [-2.35, 1.5], [-2.45, 1.1]],
    cowlX: 0.95, roofFrontX: 0.35, roofRearX: -2.0, deckX: -2.35,
  })
  const coupe = normalizeSpec({ ...DEFAULT_SPEC, top: DEFAULT_SPEC.top.map(([x, y]) => [x, y > 1 ? y - 0.1 : y]), roofRearX: -0.4, deckX: -1.6 })
  for (const spec of [tall, coupe]) {
    const { meshes } = buildBody(spec, materials)
    assert.ok(meshes.every((m) => m.geometry.attributes.position.array.every(Number.isFinite)))
    assert.ok(usedPanels(meshes[1]).has("sideGlass"))
  }
})

test("a shape with nonsense in it is made buildable", () => {
  const spec = normalizeSpec({ length: "huge", width: -1, top: [[0, 0]], cowlX: -9, roofFrontX: 9 })
  assert.equal(spec.length, DEFAULT_SPEC.length)
  assert.equal(spec.width, 1.4)
  assert.ok(spec.cowlX > spec.roofFrontX && spec.roofFrontX > spec.roofRearX && spec.roofRearX > spec.deckX)
})

test("the outline curve passes through its points without overshooting", () => {
  const f = smoothCurve([[0, 1], [1, 1], [2, 2], [3, 2]])
  assert.equal(f(1), 1)
  assert.equal(f(2), 2)
  for (let x = 0; x <= 3; x += 0.05) assert.ok(f(x) >= 1 - 1e-9 && f(x) <= 2 + 1e-9)
  assert.equal(f(0.5), 1, "a flat stretch stays flat")
})

test("bigger rims mean a thinner sidewall, the tire staying the same size", () => {
  const sizes = [17, 19, 21].map((inches) => sidewallMm(inches, 0.33))
  assert.ok(sizes[0] > sizes[1] && sizes[1] > sizes[2])
  assert.ok(rimRadius(30, 0.33) <= 0.33 - 0.05, "never a rim with no tire")
  const mats = { rim: new THREE.MeshStandardMaterial(), tire: new THREE.MeshStandardMaterial(), disc: new THREE.MeshStandardMaterial(), caliper: new THREE.MeshStandardMaterial() }
  for (const style of Object.keys(WHEEL_STYLES)) {
    const wheel = buildWheel({ inches: 19, style, tireRadius: 0.33 }, mats)
    const box = new THREE.Box3().setFromObject(wheel)
    assert.ok(Math.abs(box.max.y - 0.33) < 0.01 && Math.abs(box.min.y + 0.33) < 0.01, `${style} is a 0.66 m wheel`)
    assert.ok(spokeGeometries(style, 0.25).length >= 5)
  }
})
