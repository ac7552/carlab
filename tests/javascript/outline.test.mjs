import { test } from "node:test"
import assert from "node:assert/strict"
import { carMask, readOutline, outlineToSpec, paintColor, widthFromFront, lengthFromPhoto, lab } from "../../carlab/static/js/lib/outline.js"
import { DEFAULT_SPEC, shapeOf, normalizeSpec } from "../../carlab/static/js/lib/profile.js"

// A side "photo" of a known shape: a red car with dark tires on a light, slightly noisy studio wall and floor.
// 100 pixels to the meter. facing "left" puts the nose at the left.
function photoOf(specInput, { facing = "left", paint = [170, 24, 32], background = "studio", seed = 7, wellShows = true, rim = [150, 152, 156] } = {}) {
  const shape = shapeOf(specInput)
  const { spec, half, frontAxleX, rearAxleX } = shape
  const ppm = 100, W = Math.round(spec.length * ppm) + 120, H = 260
  const groundY = 220
  const data = new Uint8ClampedArray(W * H * 4)
  let s = seed
  const noise = () => { s = (s * 16807) % 2147483647; return (s / 2147483647 - 0.5) * 10 }
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const x = (facing === "left" ? (W / 2 - px) : (px - W / 2)) / ppm
      const y = (groundY - py) / ppm
      let rgb
      if (background === "busy") rgb = [(px * 7) % 255, (py * 13) % 255, ((px + py) * 5) % 255]
      else rgb = py > groundY ? [196, 198, 202] : [232 - py * 0.05, 233 - py * 0.05, 236 - py * 0.05]
      const inBody = Math.abs(x) <= half && y <= shape.topY(x) && y >= Math.max(shape.bottom(x), shape.archEdge(x))
      if (inBody) rgb = y > shape.belt(x) + 0.02 && x < spec.cowlX - 0.05 && x > spec.deckX + 0.05 ? [20, 24, 30] : paint
      const inWell = Math.abs(x) <= half && y < shape.archEdge(x) && y > spec.tireRadius && y <= shape.topY(x)
      if (inWell && wellShows) rgb = [26, 26, 29]
      for (const ax of [frontAxleX, rearAxleX]) {
        const d = Math.hypot(x - ax, y - spec.tireRadius)
        if (d < spec.tireRadius) rgb = d < spec.tireRadius * 0.72 ? rim : [18, 18, 20]
      }
      const i = (py * W + px) * 4
      data[i] = rgb[0] + noise(); data[i + 1] = rgb[1] + noise(); data[i + 2] = rgb[2] + noise(); data[i + 3] = 255
    }
  }
  return { width: W, height: H, data }
}

test("finds the car's outline in a side photo and rebuilds its shape", () => {
  const img = photoOf(DEFAULT_SPEC)
  const outline = readOutline(img)
  assert.equal(outline.facing, "left", "the lower end is the front")
  const spec = outlineToSpec(outline, { lengthM: DEFAULT_SPEC.length })
  const truth = shapeOf(DEFAULT_SPEC), found = shapeOf(spec)
  for (let x = -2.2; x <= 2.2; x += 0.2) {
    assert.ok(Math.abs(found.topY(x) - truth.topY(x)) < 0.05, `outline at x=${x.toFixed(1)}: ${found.topY(x).toFixed(3)} vs ${truth.topY(x).toFixed(3)}`)
  }
  for (const key of ["cowlX", "roofFrontX", "roofRearX", "deckX"]) {
    assert.ok(Math.abs(spec[key] - DEFAULT_SPEC[key]) < 0.25, `${key}: ${spec[key].toFixed(2)} vs ${DEFAULT_SPEC[key]}`)
  }
  assert.ok(Math.abs(spec.wheelbase - DEFAULT_SPEC.wheelbase) < 0.12, `wheelbase ${spec.wheelbase}`)
  assert.ok(Math.abs(spec.frontOverhang - DEFAULT_SPEC.frontOverhang) < 0.12, `front overhang ${spec.frontOverhang}`)
})

test("finds the tires even when the background shows between them and the arches", () => {
  const outline = readOutline(photoOf(DEFAULT_SPEC, { wellShows: false }))
  assert.ok(Math.abs(outline.groundY - 220) <= 2, `ground at ${outline.groundY}`)
})

test("works facing the other way, and on a tall wagon", () => {
  const wagon = normalizeSpec({
    length: 4.9, width: 1.95, wheelbase: 2.95, frontOverhang: 0.92, tireRadius: 0.37, sillY: 0.24,
    top: [[2.45, 0.62], [2.3, 0.86], [1.6, 0.98], [0.95, 1.08], [0.4, 1.55], [-0.6, 1.72], [-1.95, 1.68], [-2.35, 1.5], [-2.45, 1.1]],
    cowlX: 0.95, roofFrontX: 0.35, roofRearX: -1.95, deckX: -2.35,
  })
  const outline = readOutline(photoOf(wagon, { facing: "right", paint: [30, 70, 140] }))
  assert.equal(outline.facing, "right")
  const spec = outlineToSpec(outline, { lengthM: 4.9 })
  const truth = shapeOf(wagon), found = shapeOf(spec)
  for (let x = -2.2; x <= 2.2; x += 0.2) assert.ok(Math.abs(found.topY(x) - truth.topY(x)) < 0.06, `x=${x.toFixed(1)}`)
  assert.ok(spec.roofRearX < -1.5, "a long roof stays long")
})

test("reads the paint color off the body, not the glass or tires", () => {
  const img = photoOf(DEFAULT_SPEC, { paint: [170, 24, 32] })
  const hex = paintColor(img)
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const [L1, a1, b1] = lab(r, g, b), [L2, a2, b2] = lab(170, 24, 32)
  assert.ok(Math.hypot(L1 - L2, a1 - a2, b1 - b2) < 8, `${hex}`)
})

test("says so when there's no car to find", () => {
  const W = 200, H = 120, data = new Uint8ClampedArray(W * H * 4).fill(230)
  assert.throws(() => readOutline({ width: W, height: H, data }), /Couldn't find a car/)
})

test("a front photo's proportions set the width", () => {
  // A 1.9 m wide, 1.43 m tall car, front on, at 100 px per meter.
  const W = 300, H = 200, data = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    const inCar = x >= 55 && x < 245 && y >= 40 && y < 183 && !(y < 80 && (x < 75 || x >= 225))
    const v = inCar ? [40, 60, 120] : [230, 230, 232]
    data[i] = v[0]; data[i + 1] = v[1]; data[i + 2] = v[2]; data[i + 3] = 255
  }
  const width = widthFromFront({ width: W, height: H, data }, 1.43)
  assert.ok(Math.abs(width - 1.9) < 0.06, `width ${width}`)
})

test("measures the tires, so the car's length comes out about right from a photo with no scale", () => {
  for (const rim of [[150, 152, 156], [24, 24, 26]]) {
    const outline = readOutline(photoOf(DEFAULT_SPEC, { rim }))
    assert.ok(outline.wheelsFound, `found the wheels (rim ${rim})`)
    const length = lengthFromPhoto(outline)
    assert.ok(Math.abs(length - DEFAULT_SPEC.length) / DEFAULT_SPEC.length < 0.08, `${length} m with rim ${rim}`)
  }
  // Without wheels to measure, it's the body style's usual length.
  assert.equal(lengthFromPhoto({ wheelsFound: false }, "hatchback"), 4.2)
  assert.equal(lengthFromPhoto({ wheelsFound: false }), 4.7)
})
