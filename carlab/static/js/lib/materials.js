// How the car looks: one material per panel (profile.js PANELS), set from a build. Paint is the car's own color;
// a wrap replaces it on the panels it covers; stripes are drawn into the panel's color map; paint protection film
// adds a layer over whatever is underneath (glossier, or matte for "stealth" film).
import * as THREE from "../vendor/three.module.js"
import { PANELS, PAINTED } from "./profile.js"
import { wrapPanels, filmPanels, STRIPE_PANELS } from "./build.js"

const PAINT = {
  gloss: { metalness: 0, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.035 },
  metallic: { metalness: 0.55, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03 },
  pearl: { metalness: 0.3, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03, iridescence: 0.45, iridescenceIOR: 1.45, iridescenceThicknessRange: [250, 650] },
  matte: { metalness: 0.12, roughness: 0.64, clearcoat: 0, clearcoatRoughness: 0 },
}
const WRAP = {
  gloss: { metalness: 0.04, roughness: 0.34, clearcoat: 0.85, clearcoatRoughness: 0.08 },
  satin: { metalness: 0.15, roughness: 0.46, clearcoat: 0.3, clearcoatRoughness: 0.38 },
  matte: { metalness: 0.04, roughness: 0.8, clearcoat: 0, clearcoatRoughness: 0 },
  chrome: { metalness: 1, roughness: 0.06, clearcoat: 0, clearcoatRoughness: 0 },
  colorshift: { metalness: 0.6, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.04, iridescence: 1, iridescenceIOR: 2.0, iridescenceThicknessRange: [300, 900] },
  carbon: { metalness: 0.2, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.03 },
}
const WHEEL = {
  silver: { color: "#c3c7cd", metalness: 1, roughness: 0.28 },
  gunmetal: { color: "#4a4f56", metalness: 0.9, roughness: 0.32 },
  black: { color: "#111214", metalness: 0.3, roughness: 0.22, clearcoat: 1 },
  bronze: { color: "#8c6a3e", metalness: 1, roughness: 0.3 },
  chrome: { color: "#eceef2", metalness: 1, roughness: 0.04 },
}
const FILM_GLOW = new THREE.Color("#1aa3ff")
const NO_GLOW = new THREE.Color(0, 0, 0)

function physical(props) {
  return new THREE.MeshPhysicalMaterial({ side: THREE.FrontSide, envMapIntensity: 1, ...props })
}

// The panels' materials, in PANELS order (meshes index into this array), and the wheels'.
export function createLook() {
  const panels = PANELS.map((id) => {
    switch (id) {
      case "windshield": case "sideGlass": case "rearGlass":
        return physical({ color: "#0c0f13", metalness: 0.1, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.3 })
      case "trim":
        return physical({ color: "#0d0e10", roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.1 })
      case "grille":
        return physical({ color: "#ffffff", map: grilleTexture(), roughness: 0.55, metalness: 0.2 })
      case "headlight":
        return physical({ color: "#c7d0dc", metalness: 0.7, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.02, emissive: "#e8f0ff", emissiveIntensity: 0.28 })
      case "taillight":
        return physical({ color: "#4a0007", metalness: 0.2, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.02, emissive: "#ff1a24", emissiveIntensity: 0.45 })
      default:
        return physical({ color: "#1f3f73" })
    }
  })
  const wheel = {
    rim: physical({ side: THREE.DoubleSide, ...WHEEL.silver }),
    tire: physical({ color: "#151617", roughness: 0.88, metalness: 0, side: THREE.DoubleSide }),
    disc: physical({ color: "#5d6066", metalness: 0.9, roughness: 0.45 }),
    caliper: physical({ color: "#2b2d31", metalness: 0.1, roughness: 0.3, clearcoat: 1 }),
  }
  return { panels, wheel, film: new Set(), wrapped: new Set() }
}

const PHYSICAL_KEYS = ["metalness", "roughness", "clearcoat", "clearcoatRoughness", "iridescence", "iridescenceIOR"]

function setSurface(material, base) {
  for (const key of PHYSICAL_KEYS) material[key] = base[key] ?? (key === "iridescenceIOR" ? 1.3 : 0)
  material.iridescenceThicknessRange = base.iridescenceThicknessRange ?? [100, 400]
}

// Sets every material from a build. `showFilm` tints filmed panels blue so you can see where the film goes.
export function applyLook(look, build, { showFilm = false, width = 1.83, length = 4.76 } = {}) {
  const wrapped = new Set(wrapPanels(build))
  const film = new Set(filmPanels(build))
  PANELS.forEach((id, i) => {
    const m = look.panels[i]
    if (PAINTED.includes(id)) {
      const isWrapped = wrapped.has(id)
      const finish = isWrapped ? build.wrap.finish : build.paint.finish
      const surface = { ...(isWrapped ? WRAP[finish] : PAINT[finish]) }
      const baseColor = isWrapped ? build.wrap.color : build.paint.color
      let map = null
      if (isWrapped && finish === "carbon") {
        map = carbonTexture()
      } else if (build.stripes.on && STRIPE_PANELS.includes(id)) {
        map = stripeTexture(baseColor, build.stripes, width, length)
      }
      m.map = map
      m.color.set(map ? "#ffffff" : baseColor)
      if (film.has(id)) Object.assign(surface, filmOver(surface, build.ppf.finish))
      setSurface(m, surface)
    }
    const filmed = film.has(id)
    m.emissive.copy(showFilm && filmed ? FILM_GLOW : id === "headlight" ? new THREE.Color("#e8f0ff") : id === "taillight" ? new THREE.Color("#ff1a24") : NO_GLOW)
    if (showFilm && filmed) m.emissiveIntensity = 0.32
    else m.emissiveIntensity = id === "headlight" ? 0.28 : id === "taillight" ? 0.45 : 0
    m.needsUpdate = true
  })
  look.film = film
  look.wrapped = wrapped
  applyWheelLook(look.wheel, build.wheels)
}

// What film does to a surface: gloss film is a fresh clear coat; matte ("stealth") film turns anything satin.
export function filmOver(surface, finish) {
  if (finish === "matte") {
    return { clearcoat: 1, clearcoatRoughness: 0.62, roughness: Math.max(surface.roughness, 0.5) }
  }
  return { clearcoat: 1, clearcoatRoughness: Math.min(surface.clearcoatRoughness || 0.03, 0.02) }
}

export function applyWheelLook(wheel, w) {
  const finish = w.finish === "custom" ? { color: w.color, metalness: 0.4, roughness: 0.3, clearcoat: 1 } : WHEEL[w.finish] || WHEEL.silver
  wheel.rim.color.set(finish.color)
  wheel.rim.metalness = finish.metalness
  wheel.rim.roughness = finish.roughness
  wheel.rim.clearcoat = finish.clearcoat ?? 0
  wheel.caliper.color.set(w.caliper)
}

// --- Textures, drawn on canvases and kept, since the same few are asked for again and again ---------------------

const cache = new Map()
function canvas(w, h) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h)
  const c = document.createElement("canvas")
  c.width = w; c.height = h
  return c
}

// Two stripes down the middle of the car, `width` wide each with `gap` between, over the base color. The texture
// spans the car's length and width and is laid on with the top-down coordinates (uv1), so it lines up panel to panel.
export function stripeTexture(baseColor, stripes, carWidth, carLength) {
  const key = `stripes:${baseColor}:${stripes.color}:${stripes.width}:${stripes.gap}:${carWidth}:${carLength}`
  if (cache.has(key)) return cache.get(key)
  const H = 1024
  const c = canvas(4, H)
  const ctx = c.getContext("2d")
  ctx.fillStyle = baseColor
  ctx.fillRect(0, 0, 4, H)
  const span = carWidth + 0.4
  const px = (z) => ((z + span / 2) / span) * H
  ctx.fillStyle = stripes.color
  for (const side of [-1, 1]) {
    const inner = side * (stripes.gap / 2), outer = side * (stripes.gap / 2 + stripes.width)
    const a = px(Math.min(inner, outer)), b = px(Math.max(inner, outer))
    ctx.fillRect(0, a, 4, b - a)
  }
  const texture = new THREE.CanvasTexture(c)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.channel = 1
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping
  texture.repeat.set(1 / (carLength + 0.2), 1 / span)
  texture.offset.set(0.5, 0.5)
  texture.anisotropy = 8
  cache.set(key, texture)
  return texture
}

// A 2x2 twill carbon weave, about 2.4 cm per repeat.
export function carbonTexture() {
  if (cache.has("carbon")) return cache.get("carbon")
  const S = 256, T = S / 4
  const c = canvas(S, S)
  const ctx = c.getContext("2d")
  ctx.fillStyle = "#0c0d0f"
  ctx.fillRect(0, 0, S, S)
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const across = (row + col) % 4 < 2
      const x = col * T, y = row * T
      const g = across ? ctx.createLinearGradient(x, y, x, y + T) : ctx.createLinearGradient(x, y, x + T, y)
      g.addColorStop(0, "#1a1c20"); g.addColorStop(0.5, "#3a3e45"); g.addColorStop(1, "#16181b")
      ctx.fillStyle = g
      ctx.fillRect(x + 1, y + 1, T - 2, T - 2)
    }
  }
  const texture = new THREE.CanvasTexture(c)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(42, 42)
  texture.anisotropy = 8
  cache.set("carbon", texture)
  return texture
}

function grilleTexture() {
  if (cache.has("grille")) return cache.get("grille")
  const S = 128
  const c = canvas(S, S)
  const ctx = c.getContext("2d")
  ctx.fillStyle = "#050506"
  ctx.fillRect(0, 0, S, S)
  ctx.strokeStyle = "#2a2c30"
  ctx.lineWidth = 3
  const r = 14
  for (let row = -1; row < 6; row++) {
    for (let col = -1; col < 6; col++) {
      const cx = col * r * 1.75 + (row % 2 ? r * 0.875 : 0), cy = row * r * 1.5
      ctx.beginPath()
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 6 + (k * Math.PI) / 3
        ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a))
      }
      ctx.closePath()
      ctx.stroke()
    }
  }
  const texture = new THREE.CanvasTexture(c)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(22, 22)
  cache.set("grille", texture)
  return texture
}
