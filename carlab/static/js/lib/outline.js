// Finds a car's outline in a side photo and turns it into a shape (profile.js) for the 3D body. No AI: it works on
// the pixels. The background is whatever touches the photo's edges, grown inward through similar colors; the car is
// the biggest thing left. From the car's silhouette come its outline over the top, where the roof starts and ends,
// the base of the windshield and rear glass, the overhangs and the wheels. A busy background can fool it, so the
// page shows the outline over the photo with handles to fix it (outline_editor.js).
//
// Images here are { width, height, data } with RGBA bytes, like canvas ImageData, so this runs without a browser.

import { normalizeSpec } from "./profile.js"

// --- Color -------------------------------------------------------------------------------------------------------

function srgbToLinear(c) {
  c /= 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

// CIE Lab, where distance roughly matches how different two colors look.
export function lab(r, g, b) {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b)
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047
  let y = R * 0.2126 + G * 0.7152 + B * 0.0722
  let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  x = f(x); y = f(y); z = f(z)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

function labImage(img) {
  const n = img.width * img.height
  const out = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const [L, A, B] = lab(img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2])
    out[i * 3] = L; out[i * 3 + 1] = A; out[i * 3 + 2] = B
  }
  return out
}

// A few colors that sum up a set of samples (k-means).
export function clusters(samples, k = 3, rounds = 12) {
  if (samples.length === 0) return []
  const centers = []
  for (let i = 0; i < k; i++) centers.push(samples[Math.floor(((i + 0.5) / k) * samples.length)].slice())
  for (let round = 0; round < rounds; round++) {
    const sums = centers.map(() => [0, 0, 0, 0])
    for (const s of samples) {
      let best = 0, bestD = Infinity
      centers.forEach((c, i) => { const d = dist(s, c); if (d < bestD) { bestD = d; best = i } })
      const acc = sums[best]
      acc[0] += s[0]; acc[1] += s[1]; acc[2] += s[2]; acc[3]++
    }
    sums.forEach((acc, i) => { if (acc[3]) centers[i] = [acc[0] / acc[3], acc[1] / acc[3], acc[2] / acc[3]] })
  }
  return centers
}

// --- Finding the car -------------------------------------------------------------------------------------------

// A mask (1 = car) for a side photo.
export function carMask(img) {
  const { width: W, height: H } = img
  const L = labImage(img)
  const at = (i) => [L[i * 3], L[i * 3 + 1], L[i * 3 + 2]]
  const border = []
  const edge = Math.max(2, Math.round(Math.min(W, H) * 0.01))
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (x < edge || y < edge || x >= W - edge || y >= H - edge) border.push(y * W + x)
    }
  }
  const backgrounds = clusters(border.map(at), 4)
  // How far each pixel's color is from the nearest background color.
  const away = new Float32Array(W * H)
  for (let i = 0; i < W * H; i++) away[i] = Math.min(...backgrounds.map((c) => dist(at(i), c)))
  const nearest = (i) => away[i]
  const spread = border.map(nearest).sort((a, b) => a - b)
  const limit = Math.min(30, Math.max(9, spread[Math.floor(spread.length * 0.9)] * 2.5))

  // Grow the background in from the edges through pixels that look like it, without jumping a sharp edge.
  const background = new Uint8Array(W * H)
  const queue = new Int32Array(W * H)
  let head = 0, tail = 0
  for (const i of border) if (nearest(i) < limit * 1.5) { background[i] = 1; queue[tail++] = i }
  while (head < tail) {
    const i = queue[head++]
    const x = i % W, y = (i - x) / W
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      const j = ny * W + nx
      if (background[j]) continue
      const step = dist(at(i), at(j))
      if (nearest(j) < limit && step < limit * 0.6) { background[j] = 1; queue[tail++] = j }
    }
  }
  let mask = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) mask[i] = background[i] ? 0 : 1
  mask = open(mask, W, H)
  mask = largestPart(mask, W, H)
  return fillHoles(mask, W, H)
}

// Removes specks one pixel wide (erode, then dilate).
function open(mask, W, H) {
  const pass = (src, keep) => {
    const out = new Uint8Array(W * H)
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x
        const n = src[i - 1] + src[i + 1] + src[i - W] + src[i + W]
        out[i] = keep(src[i], n) ? 1 : 0
      }
    }
    return out
  }
  return pass(pass(mask, (v, n) => v && n === 4), (v, n) => v || n > 0)
}

// The car: the biggest part of the mask, plus anything sizable touching its lower half (tires seen apart from the
// body through a gap under the arch).
function largestPart(mask, W, H) {
  const label = new Int32Array(W * H)
  const queue = new Int32Array(W * H)
  const parts = [null]
  for (let s = 0; s < W * H; s++) {
    if (!mask[s] || label[s]) continue
    const id = parts.length
    const part = { size: 0, minX: W, maxX: 0, minY: H, maxY: 0 }
    let head = 0, tail = 0
    label[s] = id; queue[tail++] = s
    while (head < tail) {
      const i = queue[head++]
      const x = i % W, y = (i - x) / W
      part.size++
      if (x < part.minX) part.minX = x; if (x > part.maxX) part.maxX = x
      if (y < part.minY) part.minY = y; if (y > part.maxY) part.maxY = y
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
        if (j >= 0 && j < W * H && mask[j] && !label[j]) { label[j] = id; queue[tail++] = j }
      }
    }
    parts.push(part)
  }
  const out = new Uint8Array(W * H)
  if (parts.length === 1) return out
  const main = parts.slice(1).reduce((a, b) => (b.size > a.size ? b : a))
  const h = main.maxY - main.minY
  const keep = parts.map((p) => p && (p === main || (
    p.size > main.size * 0.004 && p.minX >= main.minX - 2 && p.maxX <= main.maxX + 2 &&
    p.minY >= main.minY + h * 0.4 && p.minY <= main.maxY + 2 && p.maxY <= main.maxY + h * 0.6)))
  for (let i = 0; i < W * H; i++) out[i] = keep[label[i]] ? 1 : 0
  return out
}

// Windows that show the background through them are still car.
function fillHoles(mask, W, H) {
  const outside = new Uint8Array(W * H)
  const queue = new Int32Array(W * H)
  let head = 0, tail = 0
  for (let x = 0; x < W; x++) for (const y of [0, H - 1]) { const i = y * W + x; if (!mask[i] && !outside[i]) { outside[i] = 1; queue[tail++] = i } }
  for (let y = 0; y < H; y++) for (const x of [0, W - 1]) { const i = y * W + x; if (!mask[i] && !outside[i]) { outside[i] = 1; queue[tail++] = i } }
  while (head < tail) {
    const i = queue[head++]
    const x = i % W
    for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
      if (j >= 0 && j < W * H && !mask[j] && !outside[j]) { outside[j] = 1; queue[tail++] = j }
    }
  }
  const out = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) out[i] = outside[i] ? 0 : 1
  return out
}

// --- Reading the silhouette --------------------------------------------------------------------------------------

function smooth(values, radius) {
  return values.map((_, i) => {
    let sum = 0, n = 0
    for (let k = -radius; k <= radius; k++) {
      const v = values[i + k]
      if (Number.isFinite(v)) { sum += v; n++ }
    }
    return n ? sum / n : values[i]
  })
}

// Where a polyline bends: the point that best splits it into two straight runs (a windshield and a hood, say).
function knee(points) {
  if (points.length < 3) return points[0]
  const err = (a, b) => {
    const [ax, ay] = points[a], [bx, by] = points[b]
    let e = 0
    for (let i = a + 1; i < b; i++) {
      const t = (points[i][0] - ax) / ((bx - ax) || 1)
      e += (points[i][1] - (ay + (by - ay) * t)) ** 2
    }
    return e
  }
  const last = points.length - 1
  let best = 1, bestE = Infinity
  for (let k = 1; k < last; k++) {
    const e = err(0, k) + err(k, last)
    if (e < bestE) { bestE = e; best = k }
  }
  return points[best]
}

// The car in a photo, in the photo's pixels: its top and bottom edge per column, where it starts and ends, the
// ground, which way it faces, the wheels, and the four places its outline changes (hood/windshield/roof/rear
// glass/trunk). Everything an editor needs to draw and move.
export function readOutline(img, mask = carMask(img)) {
  const { width: W, height: H } = img
  const top = new Array(W).fill(NaN), bottom = new Array(W).fill(NaN)
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) if (mask[y * W + x]) { top[x] = y; break }
    for (let y = H - 1; y >= 0; y--) if (mask[y * W + x]) { bottom[x] = y; break }
  }
  const columns = top.map((t, x) => (Number.isFinite(t) ? bottom[x] - t : 0))
  const tallest = Math.max(...columns)
  if (!(tallest > H * 0.05)) throw new Error("Couldn't find a car in that photo. Try a photo of its side, or trace it by hand.")
  // The car's ends: the first and last columns at least a fifth as tall as the car (a shadow on the ground isn't).
  let left = columns.findIndex((h) => h > tallest * 0.2)
  let right = W - 1 - [...columns].reverse().findIndex((h) => h > tallest * 0.2)
  const groundY = Math.max(...bottom.slice(left, right + 1).filter(Number.isFinite))
  const length = right - left
  const heightAt = (x) => groundY - top[Math.round(x)]

  // The front is the lower end (a hood sits lower than a trunk or a hatch).
  const endHeight = (from, to) => { let s = 0; for (let x = from; x <= to; x++) s += heightAt(x); return s / (to - from + 1) }
  const span = Math.max(2, Math.round(length * 0.12))
  const facing = endHeight(left, left + span) <= endHeight(right - span, right) ? "left" : "right"

  const { wheels, found } = findWheels(img, left, right, groundY, facing)
  return { width: W, height: H, top, bottom, left, right, groundY, facing, wheels, wheelsFound: found, ...findBreaks(top, left, right, groundY, facing) }
}

// The four breaks, as x in the photo: windshield base (cowl), roof front, roof rear, rear glass base (deck).
function findBreaks(top, left, right, groundY, facing) {
  const xs = []
  for (let x = left; x <= right; x++) xs.push(x)
  const heights = smooth(xs.map((x) => groundY - top[x]), 2)
  const max = Math.max(...heights)
  const roof = xs.filter((_, i) => heights[i] >= max - (max * 0.05))
  const roofFront = facing === "left" ? Math.min(...roof) : Math.max(...roof)
  const roofRear = facing === "left" ? Math.max(...roof) : Math.min(...roof)
  const length = right - left
  const nose = facing === "left" ? left + length * 0.04 : right - length * 0.04
  const tail = facing === "left" ? right - length * 0.012 : left + length * 0.012 // a tailgate can be upright at the very end
  const pts = (a, b) => {
    const out = []
    const step = a < b ? 1 : -1
    for (let x = Math.round(a); x !== Math.round(b); x += step) out.push([x, heights[x - left]])
    return out
  }
  const cowl = knee(pts(roofFront, nose))[0]
  let deck = knee(pts(roofRear, tail))[0]
  // An upright tailgate (a wagon's, an SUV's) drops straight from the roof, and its glass ends about where the side
  // windows do, a little above the hood. A bend found far above that is the roof's end, so follow the drop down.
  const at = (x) => heights[Math.round(x) - left]
  if (at(deck) > at(cowl) + length * 0.055) {
    const step = facing === "left" ? 1 : -1
    let x = Math.round(deck)
    while (x !== Math.round(tail) && at(x) > at(cowl) + length * 0.032) x += step
    deck = x
  }
  return { cowl, roofFront, roofRear, deck }
}

// Wheels: a tire is a dark ring standing on the ground. Try circles of tire sizes along the front and rear thirds
// and keep the ones whose ring is darkest, with the ground beside and under them not (that's not a tire). Their
// size is measured, which later sets the car's scale. If nothing stands out, use where wheels usually sit.
function findWheels(img, left, right, groundY, facing) {
  const length = right - left
  const { width: W, height: H, data } = img
  const y0 = Math.max(0, Math.round(groundY - length * 0.2)), y1 = Math.min(H - 1, Math.round(groundY + length * 0.04))
  const dark = new Uint8Array(W * (y1 - y0 + 1))
  for (let y = y0; y <= y1; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      dark[(y - y0) * W + x] = lab(data[i], data[i + 1], data[i + 2])[0] < 30 ? 1 : 0
    }
  }
  const at = (x, y) => {
    x = Math.round(x); y = Math.round(y)
    return x < 0 || x >= W || y < y0 || y > y1 ? 0 : dark[(y - y0) * W + x]
  }
  const ring = (cx, cy, radius, from, to, n) => {
    let sum = 0
    for (let k = 0; k < n; k++) {
      const a = from + ((to - from) * (k + 0.5)) / n
      sum += at(cx + radius * Math.cos(a), cy - radius * Math.sin(a))
    }
    return sum / n
  }
  // Every ring size from a bit under the tire to a bit over it (the wheel well above is dark too) fits about as
  // well, so take the middle of the sizes that fit best: that lands close to the tire's own size.
  const search = (from, to) => {
    const sizes = []
    for (let r = Math.round(length * 0.055); r <= Math.round(length * 0.092); r++) {
      const cy = groundY - r
      let best = { score: -Infinity, x: from, r }
      for (let x = from; x <= to; x++) {
        const score = ring(x, cy, r * 0.86, 0, 2 * Math.PI, 36) - 0.6 * ring(x, cy, r * 1.3, Math.PI * 1.1, Math.PI * 1.9, 14)
        if (score > best.score) best = { score, x, r }
      }
      sizes.push(best)
    }
    const top = Math.max(...sizes.map((w) => w.score))
    const fits = sizes.filter((w) => w.score >= top * 0.97)
    const r = (fits[0].r + fits[fits.length - 1].r) / 2 / 1.03
    const x = fits.reduce((sum, w) => sum + w.x, 0) / fits.length
    return { score: top, x, r }
  }
  const a = search(left + Math.round(length * 0.08), left + Math.round(length * 0.36))
  const b = search(right - Math.round(length * 0.36), right - Math.round(length * 0.08))
  const found = a.score > 0.55 && b.score > 0.55
  if (found) return { found, wheels: [a, b].map((w) => ({ x: w.x, y: groundY - w.r, r: w.r })) }
  const r = length * 0.069
  const typical = [left + length * (facing === "left" ? 0.2 : 0.21), right - length * (facing === "left" ? 0.21 : 0.2)]
  return { found, wheels: typical.map((x) => ({ x, y: groundY - r, r })) }
}

// The car's length, which a photo can't give (it has no scale). Tires come in a narrow range of sizes, so the tires'
// size in the photo is a good ruler; the body style's usual length is the fallback and keeps a bad guess in range.
const TYPICAL_LENGTH = { sedan: 4.8, coupe: 4.55, convertible: 4.5, wagon: 4.8, hatchback: 4.2, suv: 4.75, truck: 5.6, van: 5.1 }
const TYPICAL_TIRE = { suv: 0.37, truck: 0.4, van: 0.35 }
export function lengthFromPhoto(outline, bodyStyle = null) {
  const typical = TYPICAL_LENGTH[bodyStyle] ?? null
  const round = (m) => Math.round(m * 20) / 20
  if (!outline?.wheelsFound) return typical ?? 4.7
  const r = (outline.wheels[0].r + outline.wheels[1].r) / 2
  const fromTires = ((outline.right - outline.left) / r) * (TYPICAL_TIRE[bodyStyle] ?? 0.335)
  const lo = typical ? typical * 0.85 : 3.4, hi = typical ? typical * 1.15 : 6.0
  return round(Math.min(hi, Math.max(lo, fromTires)))
}

// --- From the photo to a shape -----------------------------------------------------------------------------------

// Where to sample the outline: closer together near the ends, where the nose and tail curve.
export function samplePositions(count = 26) {
  const out = []
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1)
    out.push(0.5 - 0.5 * Math.cos(Math.PI * t))
  }
  return out
}

// Turns an outline (in photo pixels, as readOutline gives it or the editor changed it) into a shape in meters.
// `lengthM` sets the scale: a photo has no size, so it comes from the listing or the person (or a typical sedan).
export function outlineToSpec(outline, { lengthM = 4.7, widthM = null, name = "" } = {}) {
  const { left, right, groundY, facing, top, bottom } = outline
  const lengthPx = right - left
  const ppm = lengthPx / lengthM
  const half = lengthM / 2
  // Photo x to car x (meters, +x toward the nose).
  const carX = (px) => (facing === "left" ? (left + lengthPx / 2 - px) : (px - left - lengthPx / 2)) / ppm
  const carY = (py) => (groundY - py) / ppm
  const topAt = (px) => {
    const x = Math.min(right, Math.max(left, Math.round(px)))
    for (let d = 0; d < 6; d++) for (const k of [x - d, x + d]) if (Number.isFinite(top[k])) return top[k]
    return groundY - lengthPx * 0.2
  }
  const points = (outline.points || samplePositions().map((t) => [left + t * lengthPx, topAt(left + t * lengthPx)]))
  const topM = points.map(([px, py]) => [carX(px), Math.max(0.3, carY(py))]).sort((a, b) => b[0] - a[0])

  const [w1, w2] = outline.wheels
  const front = facing === "left" ? (w1.x < w2.x ? w1 : w2) : (w1.x > w2.x ? w1 : w2)
  const rear = front === w1 ? w2 : w1
  const wheelbase = Math.abs(front.x - rear.x) / ppm
  const frontOverhang = half - carX(front.x)
  const tireRadius = ((front.r + rear.r) / 2) / ppm

  // The sill: the bottom edge between the wheels, away from the tires.
  const between = []
  const a = Math.min(front.x, rear.x) + front.r * 1.4, b = Math.max(front.x, rear.x) - rear.r * 1.4
  for (let x = Math.round(a); x <= b; x++) if (Number.isFinite(bottom?.[x])) between.push(carY(bottom[x]))
  between.sort((p, q) => p - q)
  const sillY = between.length ? between[Math.floor(between.length / 2)] : 0.17
  const endBottom = (px) => (Number.isFinite(bottom?.[Math.round(px)]) ? carY(bottom[Math.round(px)]) : null)
  const noseX = facing === "left" ? left + lengthPx * 0.03 : right - lengthPx * 0.03
  const tailX = facing === "left" ? right - lengthPx * 0.03 : left + lengthPx * 0.03

  return normalizeSpec({
    name: name || "From a photo",
    length: lengthM,
    width: widthM ?? Math.min(2.0, Math.max(1.72, lengthM * 0.385)),
    wheelbase, frontOverhang, tireRadius,
    sillY: sillY < 0.1 ? 0.17 : Math.min(0.4, sillY), // under 10 cm is the car's shadow, not its sill
    noseBottomY: endBottom(noseX) ?? 0.24,
    tailBottomY: endBottom(tailX) ?? 0.28,
    top: topM,
    cowlX: carX(outline.cowl), roofFrontX: carX(outline.roofFront), roofRearX: carX(outline.roofRear), deckX: carX(outline.deck),
  })
}

// A front photo's width-to-height, which sets the car's width once its height is known from the side.
export function widthFromFront(img, heightM, mask = carMask(img)) {
  const { width: W, height: H } = img
  let minX = W, maxX = -1, minY = H, maxY = -1
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) {
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y
  }
  if (maxX < 0) return null
  // Mirrors stick out past the body; take the width a little under the windows instead of the very widest row.
  const row = Math.round(minY + (maxY - minY) * 0.62)
  let l = W, r = -1
  for (let x = 0; x < W; x++) if (mask[row * W + x]) { l = Math.min(l, x); r = Math.max(r, x) }
  const widthPx = r >= l ? r - l : maxX - minX
  return Math.min(2.3, Math.max(1.4, (widthPx / Math.max(1, maxY - minY)) * heightM))
}

// The paint color: the biggest color on the car's body (not glass, tires or shadow), from the middle band of the
// silhouette. Returns a hex color.
export function paintColor(img, mask = carMask(img)) {
  const { width: W, height: H } = img
  let minY = H, maxY = -1
  for (let i = 0; i < W * H; i++) if (mask[i]) { const y = Math.floor(i / W); minY = Math.min(minY, y); maxY = Math.max(maxY, y) }
  const samples = []
  const y0 = Math.round(minY + (maxY - minY) * 0.45), y1 = Math.round(minY + (maxY - minY) * 0.75)
  const stride = Math.max(1, Math.round(Math.sqrt((W * (y1 - y0)) / 4000)))
  for (let y = y0; y <= y1; y += stride) for (let x = 0; x < W; x += stride) {
    if (!mask[y * W + x]) continue
    const i = (y * W + x) * 4
    samples.push([img.data[i], img.data[i + 1], img.data[i + 2]])
  }
  if (!samples.length) return null
  const centers = clusters(samples, 4)
  const counts = centers.map(() => 0)
  for (const s of samples) {
    let best = 0, bestD = Infinity
    centers.forEach((c, i) => { const d = dist(s, c); if (d < bestD) { bestD = d; best = i } })
    counts[best]++
  }
  const [r, g, b] = centers[counts.indexOf(Math.max(...counts))].map((v) => Math.round(Math.min(255, Math.max(0, v))))
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`
}
