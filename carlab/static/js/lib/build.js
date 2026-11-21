// A build: the car (its shape and where it came from) and everything done to it: paint, wrap, stripes, paint
// protection film, wheels and ride height. Plain data, checked here, so a saved build always loads. Also the
// estimate of what a build costs, from the shop's price list (catalog.json).
import { PAINTED, PANELS } from "./profile.js"
import { WHEEL_STYLES, RIM_SIZES } from "./wheels.js"

export const PAINT_FINISHES = Object.freeze({ gloss: "Gloss", metallic: "Metallic", pearl: "Pearl", matte: "Matte" })
export const WRAP_FINISHES = Object.freeze({ gloss: "Gloss", satin: "Satin", matte: "Matte", chrome: "Chrome", colorshift: "Color shift", carbon: "Carbon fiber" })
export const WRAP_ZONES = Object.freeze({ none: "No wrap", full: "Full car", roof: "Roof and pillars", hood: "Hood", mirrors: "Mirrors", custom: "Panels I pick" })
export const PPF_COVERAGE = Object.freeze({ none: "No film", partial: "Partial front", front: "Full front", track: "Track pack", full: "Full body", custom: "Panels I pick" })
export const WHEEL_FINISHES = Object.freeze({ silver: "Silver", gunmetal: "Gunmetal", black: "Gloss black", bronze: "Bronze", chrome: "Chrome", custom: "Custom color" })

const WRAP_PANELS = {
  none: [], full: [...PAINTED], roof: ["roofFront", "roof", "pillarA", "pillarC", "mirror"], hood: ["hoodFront", "hood"], mirrors: ["mirror"],
}
const PPF_PANELS = (() => {
  const partial = ["frontBumper", "hoodFront", "fenderFront", "mirror", "headlight"]
  const front = [...partial, "hood", "fender"]
  return { none: [], partial, front, track: [...front, "rocker", "pillarA", "roofFront"], full: [...PAINTED, "headlight", "taillight"] }
})()
const FILMABLE = new Set([...PAINTED, "headlight", "taillight"])

export const DEFAULT_BUILD = Object.freeze({
  version: 1,
  name: "",
  car: { year: "", make: "", model: "", trim: "", factoryColor: null, source: null, spec: null },
  paint: { color: "#1f3f73", finish: "metallic" },
  wrap: { zone: "none", panels: [], color: "#16181b", finish: "satin" },
  stripes: { on: false, color: "#f2f2f2", width: 0.22, gap: 0.06 },
  ppf: { coverage: "none", panels: [], finish: "gloss" },
  wheels: { style: "five", inches: 19, finish: "silver", color: "#8a8f96", caliper: "#2b2d31", lowering: 0, spacer: 0 },
})

const HEX = /^#[0-9a-f]{6}$/i
const color = (v, fallback) => (typeof v === "string" && HEX.test(v) ? v.toLowerCase() : fallback)
const pick = (v, allowed, fallback) => (Object.hasOwn(allowed, v) ? v : fallback)
const text = (v, max = 60) => (typeof v === "string" ? v.trim().slice(0, max) : "")
const range = (v, lo, hi, fallback) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : fallback)
const panels = (list, allowed) => (Array.isArray(list) ? [...new Set(list.filter((p) => allowed.has(p)))] : [])

// Any object in, a complete, valid build out.
export function normalizeBuild(input = {}) {
  const d = DEFAULT_BUILD
  const car = input.car || {}, paint = input.paint || {}, wrap = input.wrap || {}, stripes = input.stripes || {}
  const ppf = input.ppf || {}, wheels = input.wheels || {}
  const source = car.source && typeof car.source === "object" && ["link", "photo", "sample"].includes(car.source.kind)
    ? { kind: car.source.kind, url: text(car.source.url, 500) } : null
  return {
    version: 1,
    name: text(input.name, 80),
    car: {
      year: text(String(car.year ?? ""), 4).replace(/\D/g, ""), make: text(car.make, 40), model: text(car.model, 60), trim: text(car.trim, 60),
      factoryColor: car.factoryColor ? color(car.factoryColor, null) : null,
      source,
      spec: car.spec && typeof car.spec === "object" ? car.spec : null,
    },
    paint: { color: color(paint.color, d.paint.color), finish: pick(paint.finish, PAINT_FINISHES, d.paint.finish) },
    wrap: {
      zone: pick(wrap.zone, WRAP_ZONES, d.wrap.zone), panels: panels(wrap.panels, new Set(PAINTED)),
      color: color(wrap.color, d.wrap.color), finish: pick(wrap.finish, WRAP_FINISHES, d.wrap.finish),
    },
    stripes: {
      on: Boolean(stripes.on), color: color(stripes.color, d.stripes.color),
      width: range(stripes.width, 0.05, 0.4, d.stripes.width), gap: range(stripes.gap, 0, 0.3, d.stripes.gap),
    },
    ppf: { coverage: pick(ppf.coverage, PPF_COVERAGE, d.ppf.coverage), panels: panels(ppf.panels, FILMABLE), finish: pick(ppf.finish, { gloss: 1, matte: 1 }, d.ppf.finish) },
    wheels: {
      style: pick(wheels.style, WHEEL_STYLES, d.wheels.style),
      inches: RIM_SIZES.includes(Number(wheels.inches)) ? Number(wheels.inches) : d.wheels.inches,
      finish: pick(wheels.finish, WHEEL_FINISHES, d.wheels.finish), color: color(wheels.color, d.wheels.color),
      caliper: color(wheels.caliper, d.wheels.caliper),
      lowering: Math.round(range(wheels.lowering, 0, 60, 0)), spacer: Math.round(range(wheels.spacer, 0, 25, 0)),
    },
  }
}

// The panels a build wraps, and the panels it covers in film.
export function wrapPanels(build) {
  return build.wrap.zone === "custom" ? build.wrap.panels : WRAP_PANELS[build.wrap.zone] || []
}
export function filmPanels(build) {
  return build.ppf.coverage === "custom" ? build.ppf.panels : PPF_PANELS[build.ppf.coverage] || []
}
export const STRIPE_PANELS = Object.freeze(["frontBumper", "hoodFront", "hood", "roofFront", "roof", "trunk", "rearBumper"])

// Clicking a panel in "Panels I pick" mode: add it, or take it off.
export function togglePanel(build, layer, panel) {
  const next = normalizeBuild(build)
  if (layer === "wrap" && PAINTED.includes(panel)) {
    const current = new Set(wrapPanels(next))
    current.has(panel) ? current.delete(panel) : current.add(panel)
    next.wrap.zone = "custom"
    next.wrap.panels = PANELS.filter((p) => current.has(p))
  } else if (layer === "ppf" && FILMABLE.has(panel)) {
    const current = new Set(filmPanels(next))
    current.has(panel) ? current.delete(panel) : current.add(panel)
    next.ppf.coverage = "custom"
    next.ppf.panels = PANELS.filter((p) => current.has(p))
  }
  return next
}

// A one-line title: "2021 Make Model Trim", or the build's own name.
export function carTitle(build) {
  const c = build.car
  return [c.year, c.make, c.model, c.trim].filter(Boolean).join(" ") || build.car.spec?.name || "Sport sedan"
}

// What the build would cost, as low and high estimates per line, from the shop's price list.
export function costSheet(build, catalog) {
  const lines = []
  const add = (item, [low, high], factor = 1) => lines.push({ item, low: Math.round(low * factor), high: Math.round(high * factor) })
  const c = catalog
  if (build.car.factoryColor && build.paint.color !== build.car.factoryColor) add(`Respray, ${PAINT_FINISHES[build.paint.finish].toLowerCase()}`, c.paint.respray)
  const wrapped = wrapPanels(build)
  if (wrapped.length) {
    const factor = c.wrap.finishFactor[build.wrap.finish] ?? 1
    const zone = build.wrap.zone
    if (zone !== "custom") add(`Wrap: ${WRAP_ZONES[zone].toLowerCase()}, ${WRAP_FINISHES[build.wrap.finish].toLowerCase()}`, c.wrap[zone], factor)
    else add(`Wrap: ${wrapped.length} panel${wrapped.length === 1 ? "" : "s"}, ${WRAP_FINISHES[build.wrap.finish].toLowerCase()}`, c.wrap.perPanel.map((p) => p * wrapped.length), factor)
  }
  if (build.stripes.on) add("Stripes", c.stripes)
  const filmed = filmPanels(build)
  if (filmed.length) {
    const factor = build.ppf.finish === "matte" ? c.ppf.matteFactor : 1
    const cov = build.ppf.coverage
    const label = `Paint protection film: ${cov === "custom" ? `${filmed.length} panels` : PPF_COVERAGE[cov].toLowerCase()}${build.ppf.finish === "matte" ? ", matte" : ""}`
    add(label, cov === "custom" ? c.ppf.perPanel.map((p) => p * filmed.length) : c.ppf[cov], factor)
  }
  const w = build.wheels
  if (w.style !== DEFAULT_BUILD.wheels.style || w.inches !== DEFAULT_BUILD.wheels.inches || w.finish !== DEFAULT_BUILD.wheels.finish) {
    add(`Wheels: ${w.inches}" ${WHEEL_STYLES[w.style].toLowerCase()}, ${WHEEL_FINISHES[w.finish].toLowerCase()} (set of 4, with tires)`, c.wheels[String(w.inches)], c.wheels.finishFactor[w.finish] ?? 1)
  }
  if (w.caliper !== DEFAULT_BUILD.wheels.caliper) add("Caliper paint", c.calipers)
  if (w.lowering > 0) add(w.lowering > 30 ? `Coilovers (${w.lowering} mm lower)` : `Lowering springs (${w.lowering} mm)`, w.lowering > 30 ? c.suspension.coilovers : c.suspension.springs)
  if (w.spacer > 0) add(`Wheel spacers (${w.spacer} mm)`, c.spacers)
  const total = lines.reduce((t, l) => ({ low: t.low + l.low, high: t.high + l.high }), { low: 0, high: 0 })
  return { lines, total, currency: c.currency || "USD" }
}
