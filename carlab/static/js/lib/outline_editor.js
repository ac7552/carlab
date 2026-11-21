// The photo with the car's outline drawn over it, and handles to fix it: dots along the top, lines where the
// windshield, roof and rear glass start and end, the two wheels, and the ground. Works in the photo's own pixels
// (the small copy the outline was found in) and draws scaled to the canvas.
import { samplePositions } from "./outline.js"

const BREAKS = [
  ["cowl", "windshield"], ["roofFront", "roof"], ["roofRear", "roof end"], ["deck", "rear glass"],
]

export class OutlineEditor {
  constructor(canvas, { onChange } = {}) {
    this.canvas = canvas
    this.ctx = canvas.getContext("2d")
    this.onChange = onChange || (() => {})
    this.image = null
    this.outline = null
    this.drag = null
    canvas.addEventListener("pointerdown", (e) => this.down(e))
    canvas.addEventListener("pointermove", (e) => this.move(e))
    canvas.addEventListener("pointerup", (e) => this.up(e))
    canvas.addEventListener("pointercancel", (e) => this.up(e))
    new ResizeObserver(() => this.draw()).observe(canvas)
  }

  // `image`: something drawable at the photo's working size (width × height of the outline).
  load(image, outline) {
    this.image = image
    this.outline = { ...outline, wheels: outline.wheels.map((w) => ({ ...w })) }
    if (!this.outline.points) {
      const { left, right, top, groundY } = outline
      const len = right - left
      this.outline.points = samplePositions().map((t) => {
        const x = left + t * len
        const y = top[Math.round(x)]
        return [x, Number.isFinite(y) ? y : groundY - len * 0.2]
      })
    }
    this.draw()
  }

  value() {
    const o = this.outline
    const xs = o.points.map((p) => p[0])
    return { ...o, left: Math.min(...xs), right: Math.max(...xs), points: o.points.map((p) => [...p]) }
  }

  // Swap which end is the front: the breaks trade places (windshield base ⇄ rear glass base, roof front ⇄ end).
  flip() {
    const o = this.outline
    o.facing = o.facing === "left" ? "right" : "left";
    [o.cowl, o.deck] = [o.deck, o.cowl];
    [o.roofFront, o.roofRear] = [o.roofRear, o.roofFront]
    this.draw()
    this.onChange(this.value())
  }

  // --- Drawing ---------------------------------------------------------------------------------------------------

  scale() {
    const w = this.canvas.clientWidth || 360
    return w / this.outline.width
  }

  draw() {
    if (!this.image || !this.outline) return
    const o = this.outline
    const s = this.scale()
    const dpr = window.devicePixelRatio || 1
    const W = Math.round(o.width * s), H = Math.round(o.height * s)
    if (this.canvas.width !== W * dpr) { this.canvas.width = W * dpr; this.canvas.height = H * dpr; this.canvas.style.height = `${H}px` }
    const ctx = this.ctx
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    ctx.drawImage(this.image, 0, 0, W, H)
    ctx.fillStyle = "rgba(0,0,0,0.25)"
    ctx.fillRect(0, 0, W, H)

    // Ground
    ctx.strokeStyle = "rgba(255,255,255,0.7)"
    ctx.setLineDash([4, 4])
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0, o.groundY * s); ctx.lineTo(W, o.groundY * s); ctx.stroke()

    // Breaks
    ctx.font = "600 10px ui-monospace, Menlo, monospace"
    ctx.textAlign = "center"
    for (const [key, label] of BREAKS) {
      const x = o[key] * s
      ctx.strokeStyle = "rgba(255,214,102,0.9)"
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, o.groundY * s); ctx.stroke()
      ctx.fillStyle = "rgba(255,214,102,1)"
      ctx.fillText(label, x, 11 + (key === "roofFront" || key === "deck" ? 12 : 0))
    }
    ctx.setLineDash([])

    // Outline across the top
    ctx.strokeStyle = "#5cc8ff"
    ctx.lineWidth = 2
    ctx.beginPath()
    o.points.forEach(([x, y], i) => (i ? ctx.lineTo(x * s, y * s) : ctx.moveTo(x * s, y * s)))
    ctx.stroke()
    for (const [x, y] of o.points) {
      ctx.fillStyle = "#ffffff"
      ctx.beginPath(); ctx.arc(x * s, y * s, 4, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = "#0b6fa8"; ctx.lineWidth = 1.5; ctx.stroke()
    }

    // Wheels
    for (const w of o.wheels) {
      ctx.strokeStyle = "#ff8a3d"
      ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(w.x * s, w.y * s, w.r * s, 0, Math.PI * 2); ctx.stroke()
      ctx.fillStyle = "#ff8a3d"
      ctx.beginPath(); ctx.arc(w.x * s, w.y * s, 3.5, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.arc((w.x + w.r) * s, w.y * s, 3.5, 0, Math.PI * 2); ctx.fill()
    }

    // Which end is the front
    const xs = o.points.map((p) => p[0])
    const noseX = (o.facing === "left" ? Math.min(...xs) : Math.max(...xs)) * s
    ctx.fillStyle = "#ffffff"
    ctx.textAlign = o.facing === "left" ? "left" : "right"
    ctx.font = "600 11px ui-monospace, Menlo, monospace"
    ctx.fillText("FRONT", noseX + (o.facing === "left" ? 2 : -2), o.groundY * s - 6)
  }

  // --- Dragging --------------------------------------------------------------------------------------------------

  at(e) {
    const rect = this.canvas.getBoundingClientRect()
    const s = this.scale()
    return [(e.clientX - rect.left) / s, (e.clientY - rect.top) / s]
  }

  // The handle nearest a point, within reach.
  hit([x, y]) {
    const o = this.outline
    const reach = 9 / this.scale()
    let best = null, bestD = reach
    const consider = (d, handle) => { if (d < bestD) { bestD = d; best = handle } }
    o.points.forEach(([px, py], i) => consider(Math.hypot(px - x, py - y), { kind: "point", i }))
    o.wheels.forEach((w, i) => {
      consider(Math.hypot(w.x + w.r - x, w.y - y), { kind: "radius", i })
      consider(Math.hypot(w.x - x, w.y - y), { kind: "wheel", i })
    })
    if (best) return best
    for (const [key] of BREAKS) consider(Math.abs(o[key] - x) * (y < o.groundY ? 1 : 3), { kind: "break", key })
    consider(Math.abs(o.groundY - y) * 1.5, { kind: "ground" })
    return best
  }

  down(e) {
    if (!this.outline) return
    const handle = this.hit(this.at(e))
    if (!handle) return
    this.drag = handle
    this.canvas.setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  move(e) {
    const o = this.outline
    if (!o) return
    const [x, y] = this.at(e)
    if (!this.drag) {
      const h = this.hit([x, y])
      this.canvas.style.cursor = !h ? "default" : h.kind === "break" ? "ew-resize" : h.kind === "ground" ? "ns-resize" : "grab"
      return
    }
    const clampX = (v) => Math.min(o.width - 1, Math.max(0, v))
    const clampY = (v) => Math.min(o.height - 1, Math.max(0, v))
    const d = this.drag
    if (d.kind === "point") {
      const p = o.points[d.i]
      const last = o.points.length - 1
      // The end dots also move along the car (they set its length); the rest only up and down.
      if (d.i === 0) p[0] = Math.min(clampX(x), o.points[1][0] - 1)
      if (d.i === last) p[0] = Math.max(clampX(x), o.points[last - 1][0] + 1)
      p[1] = Math.min(clampY(y), o.groundY - 2)
    } else if (d.kind === "wheel") {
      o.wheels[d.i].x = clampX(x)
      o.wheels[d.i].y = clampY(y)
    } else if (d.kind === "radius") {
      const w = o.wheels[d.i]
      const r = Math.max(4, Math.hypot(x - w.x, y - w.y))
      for (const wheel of o.wheels) { wheel.r = r; wheel.y = o.groundY - r } // both wheels are the same size, on the ground
    } else if (d.kind === "break") {
      o[d.key] = clampX(x)
    } else if (d.kind === "ground") {
      const dy = clampY(y) - o.groundY
      o.groundY += dy
      for (const w of o.wheels) w.y += dy
    }
    this.draw()
  }

  up(e) {
    if (!this.drag) return
    this.drag = null
    try { this.canvas.releasePointerCapture(e.pointerId) } catch { /* already released */ }
    this.onChange(this.value())
  }
}
