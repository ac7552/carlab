// The page: the 3D view and the panel beside it. Every change makes a new build (build.js), which the stage shows,
// the panel reflects, and the tab keeps until it's closed (sessionStorage). Saved builds go to the server.
import { Stage, VIEWS } from "./lib/stage.js"
import {
  normalizeBuild, togglePanel, carTitle, costSheet, DEFAULT_BUILD,
  PAINT_FINISHES, WRAP_FINISHES, WRAP_ZONES, PPF_COVERAGE, WHEEL_FINISHES,
} from "./lib/build.js"
import { WHEEL_STYLES, RIM_SIZES, sidewallMm } from "./lib/wheels.js"
import { PANEL_NAMES, normalizeSpec, shapeOf } from "./lib/profile.js"
import { carMask, readOutline, outlineToSpec, paintColor, widthFromFront, lengthFromPhoto } from "./lib/outline.js"
import { OutlineEditor } from "./lib/outline_editor.js"

const $ = (id) => document.getElementById(id)
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props)
  node.append(...children)
  return node
}

const PAINT_COLORS = [
  ["Black", "#0e0f11"], ["White", "#eceef0"], ["Silver", "#b5b9be"], ["Gray", "#5d6168"], ["Blue", "#1f3f73"],
  ["Red", "#a3121c"], ["Green", "#24503a"], ["Yellow", "#e0b81f"], ["Orange", "#d9621c"],
]
const WRAP_COLORS = [
  ["Black", "#16181b"], ["Flat gray", "#7b7e80"], ["White", "#f2f2f2"], ["Olive", "#4b5320"], ["Deep blue", "#14284b"],
  ["Purple", "#4a2a66"], ["Gold", "#b08d3f"], ["Red", "#b0121d"], ["Teal", "#1f6a6a"],
]
const CALIPERS = [
  ["Graphite", "#2b2d31"], ["Red", "#c8102e"], ["Yellow", "#e3b505"], ["Blue", "#1d4fa3"], ["Orange", "#e5641a"], ["Green", "#2f7d4f"], ["Silver", "#b9bdc4"],
]
const COVERAGE_NOTES = {
  none: "", partial: "Bumper, the front of the hood and fenders, mirrors, headlights",
  front: "Bumper, whole hood and fenders, mirrors, headlights", track: "Full front, plus rockers, A-pillars and the roof's front edge",
  full: "Every painted panel and the lights", custom: "Click panels on the car to add or take them off",
}

const state = {
  build: normalizeBuild(DEFAULT_BUILD),
  catalog: null,
  savedId: null,
  savedName: "",
  dirty: false,
  pick: null,
  listing: null,
  photos: [],
  selected: null,
  frontWidth: null, // set by a front photo
  lengthSet: false, // the person typed the car's length
}
let stage, editor

// --- Changing the build ---------------------------------------------------------------------------------------

function update(change, { dirty = true } = {}) {
  const next = structuredClone(state.build)
  change(next)
  state.build = normalizeBuild(next)
  if (dirty) state.dirty = true
  try { sessionStorage.setItem("carlab:build", JSON.stringify({ build: state.build, savedId: state.savedId, savedName: state.savedName, dirty: state.dirty })) } catch { /* private mode */ }
  stage.show(state.build)
  render()
}

function setBuild(build, { savedId = null, savedName = "" } = {}) {
  state.savedId = savedId
  state.savedName = savedName
  state.dirty = false
  update((b) => Object.assign(b, normalizeBuild(build)), { dirty: false })
}

// --- Drawing the panel ----------------------------------------------------------------------------------------

function chips(container, options, current, onPick) {
  container.replaceChildren(...Object.entries(options).map(([value, label]) => {
    const b = el("button", { type: "button", textContent: label })
    b.setAttribute("aria-pressed", String(value === String(current)))
    b.addEventListener("click", () => onPick(value))
    return b
  }))
}

function swatches(container, colors, current, onPick) {
  container.replaceChildren(...colors.map(([name, hex]) => {
    const b = el("button", { type: "button", title: name, ariaLabel: name })
    b.style.background = hex
    b.setAttribute("aria-pressed", String(hex === current))
    b.addEventListener("click", () => onPick(hex))
    return b
  }))
}

function render() {
  const b = state.build
  $("car-title").textContent = carTitle(b)
  $("build-state").textContent = state.savedId ? `${state.savedName}${state.dirty ? " · changed" : " · saved"}` : state.dirty ? "Not saved" : ""
  for (const [id, key] of [["car-year", "year"], ["car-make", "make"], ["car-model", "model"], ["car-trim", "trim"]]) {
    if (document.activeElement !== $(id)) $(id).value = b.car[key]
  }

  swatches($("paint-swatches"), PAINT_COLORS, b.paint.color, (hex) => update((n) => { n.paint.color = hex }))
  $("paint-color").value = b.paint.color
  chips($("paint-finish"), PAINT_FINISHES, b.paint.finish, (v) => update((n) => { n.paint.finish = v }))
  const factory = $("factory-note")
  factory.hidden = !b.car.factoryColor
  if (b.car.factoryColor) {
    factory.replaceChildren("From the car: ", el("button", { type: "button", className: "ghost", textContent: b.car.factoryColor === b.paint.color ? "its color (in use)" : "use its color" }))
    factory.querySelector("button").addEventListener("click", () => update((n) => { n.paint.color = n.car.factoryColor }))
  }

  chips($("wrap-zone"), WRAP_ZONES, b.wrap.zone, (v) => update((n) => { n.wrap.zone = v; if (v === "custom" && !n.wrap.panels.length) startPick("wrap") }))
  swatches($("wrap-swatches"), WRAP_COLORS, b.wrap.color, (hex) => update((n) => { n.wrap.color = hex; if (n.wrap.zone === "none") n.wrap.zone = "full" }))
  $("wrap-color").value = b.wrap.color
  chips($("wrap-finish"), WRAP_FINISHES, b.wrap.finish, (v) => update((n) => { n.wrap.finish = v; if (n.wrap.zone === "none") n.wrap.zone = "full" }))
  $("stripes-on").checked = b.stripes.on
  $("stripes-color").value = b.stripes.color
  $("stripes-width").value = b.stripes.width
  $("stripes-gap").value = b.stripes.gap
  $("stripes-width-out").textContent = `${Math.round(b.stripes.width * 100)} cm`
  $("stripes-gap-out").textContent = `${Math.round(b.stripes.gap * 100)} cm`

  const cov = $("ppf-coverage")
  cov.replaceChildren(...Object.entries(PPF_COVERAGE).map(([value, label]) => {
    const btn = el("button", { type: "button" }, label, COVERAGE_NOTES[value] ? el("small", { textContent: COVERAGE_NOTES[value] }) : "")
    btn.setAttribute("aria-pressed", String(value === b.ppf.coverage))
    btn.addEventListener("click", () => { update((n) => { n.ppf.coverage = value }); if (value === "custom") startPick("ppf") })
    return btn
  }))
  chips($("ppf-finish"), { gloss: "Gloss", matte: "Matte (stealth)" }, b.ppf.finish, (v) => update((n) => { n.ppf.finish = v; if (n.ppf.coverage === "none") n.ppf.coverage = "front" }))

  chips($("wheel-style"), WHEEL_STYLES, b.wheels.style, (v) => update((n) => { n.wheels.style = v }))
  chips($("wheel-size"), Object.fromEntries(RIM_SIZES.map((s) => [s, `${s}"`])), b.wheels.inches, (v) => update((n) => { n.wheels.inches = Number(v) }))
  const tire = normalizeSpec(b.car.spec || {}).tireRadius
  $("sidewall").textContent = `· ${sidewallMm(b.wheels.inches, tire)} mm of tire sidewall`
  chips($("wheel-finish"), WHEEL_FINISHES, b.wheels.finish, (v) => update((n) => { n.wheels.finish = v }))
  $("wheel-color-field").hidden = b.wheels.finish !== "custom"
  $("wheel-color").value = b.wheels.color
  swatches($("caliper-swatches"), CALIPERS, b.wheels.caliper, (hex) => update((n) => { n.wheels.caliper = hex }))
  $("lowering").value = b.wheels.lowering
  $("lowering-out").textContent = b.wheels.lowering ? `${b.wheels.lowering} mm` : "stock"
  $("spacer").value = b.wheels.spacer
  $("spacer-out").textContent = b.wheels.spacer ? `${b.wheels.spacer} mm each side` : "none"

  for (const button of document.querySelectorAll("button.pick")) button.setAttribute("aria-pressed", String(state.pick === button.dataset.pick))
  $("show-film").checked = $("show-film-2").checked = stage.showFilm
  renderSheet()
  if (document.activeElement !== $("build-name")) $("build-name").value = b.name
  $("save-new").hidden = !state.savedId
}

function renderSheet() {
  if (!state.catalog) return
  const sheet = costSheet(state.build, state.catalog)
  const money = (n) => n.toLocaleString(undefined, { style: "currency", currency: sheet.currency, maximumFractionDigits: 0 })
  const rows = sheet.lines.map((l) => el("tr", {}, el("td", { textContent: l.item }), el("td", { textContent: `${money(l.low)}–${money(l.high)}` })))
  if (!rows.length) rows.push(el("tr", {}, el("td", { textContent: "Nothing added yet." }), el("td")))
  else rows.push(el("tr", { className: "total" }, el("td", { textContent: "Total" }), el("td", { textContent: `${money(sheet.total.low)}–${money(sheet.total.high)}` })))
  $("sheet").replaceChildren(...rows)
  $("sheet-note").textContent = state.catalog.note || ""
}

// --- Picking panels on the car --------------------------------------------------------------------------------

function startPick(layer) {
  state.pick = state.pick === layer ? null : layer
  $("pick-hint").hidden = !state.pick
  pickHintText()
  document.querySelector(".stage").classList.toggle("picking", Boolean(state.pick))
  if (state.pick === "ppf" && !stage.showFilm) stage.setShowFilm(true)
  render()
}

function bindStageClicks() {
  const canvas = $("view")
  let downAt = null
  canvas.addEventListener("pointerdown", (e) => { downAt = [e.clientX, e.clientY] })
  canvas.addEventListener("pointerup", (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return
    downAt = null
    if (!state.pick) return
    const panel = stage.panelAt(e.clientX, e.clientY)
    if (!panel) return
    const before = state.build
    const after = togglePanel(before, state.pick, panel)
    if (JSON.stringify(after) === JSON.stringify(before)) {
      flash(`${PANEL_NAMES[panel]} can't take ${state.pick === "wrap" ? "a wrap" : "film"}.`)
      return
    }
    update((n) => Object.assign(n, after))
    flash(PANEL_NAMES[panel])
  })
  $("pick-hint").addEventListener("click", () => startPick(state.pick))
}

let flashTimer
// Says which panel was just clicked, then goes back to the instructions.
function flash(text) {
  $("pick-hint").textContent = text
  clearTimeout(flashTimer)
  flashTimer = setTimeout(pickHintText, 1200)
}
function pickHintText() {
  if (!state.pick) return
  $("pick-hint").textContent = state.pick === "wrap" ? "Click panels to wrap them or take the wrap off. Click here when done." : "Click panels to add film or take it off. Click here when done."
}

// --- The car from a listing or photos -------------------------------------------------------------------------

// Starting on a different car: forget what was measured or typed for the last one.
function newCar() {
  state.frontWidth = null
  state.lengthSet = false
}

function carStatus(text, error = false) {
  $("car-status").textContent = text
  $("car-status").classList.toggle("error", error)
}

async function readListing(url) {
  carStatus("Reading the listing…")
  $("listing-read").disabled = true
  try {
    const res = await fetch("/api/v1/listings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || "Couldn't read that listing.")
    const facts = data.listing
    state.listing = facts
    newCar()
    showFacts(facts)
    update((n) => {
      Object.assign(n.car, { year: facts.year, make: facts.make, model: facts.model, trim: facts.trim, source: { kind: url.includes("/static/samples/") ? "sample" : "link", url } })
      if (facts.color) { n.car.factoryColor = facts.color.hex; n.paint.color = facts.color.hex; n.paint.finish = facts.color.finish }
    })
    state.photos = state.photos.filter((p) => p.source !== "listing")
    carStatus(facts.photos.length ? `Found ${facts.photos.length} photo${facts.photos.length === 1 ? "" : "s"}. Looking for the car's side…` : "The listing has no photos. Add one of the car's side.")
    const loaded = await Promise.all(facts.photos.slice(0, 8).map((src) => loadPhoto(photoUrl(src), "listing", src.split("/").pop())))
    await usePhotos(loaded.filter(Boolean), { fromListing: true })
  } catch (error) {
    carStatus(error.message, true)
  } finally {
    $("listing-read").disabled = false
  }
}

function photoUrl(src) {
  return src.startsWith("/static/") ? src : `/api/v1/listings/photo?url=${encodeURIComponent(src)}`
}

function showFacts(f) {
  const title = [f.year, f.make, f.model, f.trim].filter(Boolean).join(" ") || f.name
  const color = f.color ? el("p", { className: "note" }, el("span", { className: "swatch" }), `${f.color.name} (${f.color.finish})`) : el("p", { className: "note", textContent: "No color listed." })
  if (f.color) color.querySelector(".swatch").style.background = f.color.hex
  const body = f.body_style ? el("p", { className: "note", textContent: `Body: ${f.body_style}` }) : ""
  $("facts").replaceChildren(el("h3", { textContent: title }), color, body)
  $("listing").hidden = false
}

// Loads a photo, shrinks it to a working size, and works out whether it shows the car's side or front.
async function loadPhoto(url, source, name) {
  try {
    const img = new Image()
    img.decoding = "async"
    img.src = url
    await img.decode()
    const scale = Math.min(1, 420 / img.naturalWidth)
    const work = document.createElement("canvas")
    work.width = Math.max(1, Math.round(img.naturalWidth * scale))
    work.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const ctx = work.getContext("2d", { willReadFrequently: true })
    ctx.drawImage(img, 0, 0, work.width, work.height)
    const pixels = ctx.getImageData(0, 0, work.width, work.height)
    const mask = carMask(pixels)
    let outline = null, kind = null
    try {
      outline = readOutline(pixels, mask)
      const tall = outline.groundY - Math.min(...outline.top.slice(outline.left, outline.right + 1).filter(Number.isFinite))
      const ratio = (outline.right - outline.left) / Math.max(1, tall)
      kind = ratio > 2.1 ? "side" : ratio < 1.75 ? "front" : null
    } catch { /* no car found */ }
    return { id: crypto.randomUUID(), url, source, name, img, work, pixels, mask, outline, kind }
  } catch {
    return null
  }
}

async function usePhotos(photos, { fromListing = false } = {}) {
  state.photos.push(...photos)
  renderPhotos()
  const side = photos.find((p) => p.kind === "side")
  const front = photos.find((p) => p.kind === "front")
  if (front) applyFront(front)
  if (side) {
    selectPhoto(side, { setColor: !fromListing || !state.build.car.factoryColor })
    carStatus("Built from the outline in the highlighted photo. Drag the handles over the photo to fix it.")
  } else if (photos.length) {
    carStatus("Couldn't tell which photo shows the car's side. Click the one that does.", !photos.length)
  }
}

function renderPhotos() {
  $("photos").replaceChildren(...state.photos.map((p) => {
    const b = el("button", { type: "button", title: p.name || "Photo" }, el("img", { src: p.url, alt: "" }))
    if (p.kind) b.append(el("span", { className: "tag", textContent: p.kind }))
    else if (!p.outline) b.append(el("span", { className: "tag", textContent: "no car" }))
    b.setAttribute("aria-pressed", String(state.selected === p))
    b.addEventListener("click", () => {
      if (p.kind === "front") { applyFront(p); carStatus("Set the car's width from this front photo.") }
      else if (p.outline) selectPhoto(p, { setColor: false })
      else carStatus("Couldn't find a car in that photo.", true)
    })
    return b
  }))
}

function selectPhoto(photo, { setColor = true } = {}) {
  state.selected = photo
  $("tracer").hidden = false
  if (!state.lengthSet) {
    const length = lengthFromPhoto(photo.outline, state.listing?.body_style)
    $("trace-length").value = length.toFixed(2)
    $("length-note").textContent = photo.outline.wheelsFound
      ? "The length is worked out from the size of the tires. If you know it, type it in."
      : "A photo has no scale, so the length is a typical one. If you know it, type it in."
  }
  if (!state.frontWidth) $("trace-width").value = Math.min(2.0, Math.max(1.72, Number($("trace-length").value) * 0.385)).toFixed(2)
  editor.load(photo.work, photo.outline)
  renderPhotos()
  buildFromTrace({ setColor, photo })
}

function applyFront(photo) {
  const spec = normalizeSpec(state.build.car.spec || {})
  const height = Math.max(...spec.top.map((p) => p[1]))
  const width = widthFromFront(photo.pixels, height, photo.mask)
  if (!width) return
  state.frontWidth = width
  $("trace-width").value = width.toFixed(2)
  if (state.build.car.spec) update((n) => { n.car.spec = { ...normalizeSpec(n.car.spec), width } })
}

function buildFromTrace({ setColor = false, photo = state.selected } = {}) {
  if (!editor.outline) return
  const lengthM = Number($("trace-length").value) || 4.7
  const widthM = Number($("trace-width").value) || null
  const spec = outlineToSpec(editor.value(), { lengthM, widthM, name: carTitle(state.build) })
  const color = setColor && photo ? paintColor(photo.pixels, photo.mask) : null
  update((n) => {
    n.car.spec = spec
    if (!n.car.source) n.car.source = { kind: "photo", url: "" }
    if (color) { n.car.factoryColor = color; n.paint.color = color }
  })
}

// --- Saving ---------------------------------------------------------------------------------------------------

async function api(path, options = {}) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options })
  const data = res.status === 204 ? {} : await res.json()
  if (!res.ok) throw new Error(data.error || "Something went wrong.")
  return data
}

async function save(asNew) {
  const name = $("build-name").value.trim() || carTitle(state.build)
  update((n) => { n.name = name }, { dirty: false })
  const payload = { name, build: state.build, thumbnail: stage.picture({ width: 320 }) }
  try {
    const saved = state.savedId && !asNew
      ? await api(`/api/v1/builds/${state.savedId}`, { method: "PUT", body: JSON.stringify(payload) })
      : await api("/api/v1/builds", { method: "POST", body: JSON.stringify(payload) })
    state.savedId = saved.id
    state.savedName = saved.name
    state.dirty = false
    $("save-status").textContent = `Saved “${saved.name}”.`
    $("save-status").classList.remove("error")
    update(() => {}, { dirty: false })
    loadSaved()
  } catch (error) {
    $("save-status").textContent = error.message
    $("save-status").classList.add("error")
  }
}

async function loadSaved() {
  const { builds } = await api("/api/v1/builds")
  $("saved").replaceChildren(...(builds.length ? builds.map((b) => {
    const open = el("button", { type: "button", textContent: "Open" })
    const del = el("button", { type: "button", className: "ghost", textContent: "Delete" })
    open.addEventListener("click", async () => {
      const found = await api(`/api/v1/builds/${b.id}`)
      setBuild(found.build, { savedId: found.id, savedName: found.name })
      $("save-status").textContent = `Opened “${found.name}”.`
    })
    del.addEventListener("click", async () => {
      if (del.dataset.sure !== "1") { del.dataset.sure = "1"; del.textContent = "Sure?"; setTimeout(() => { del.dataset.sure = ""; del.textContent = "Delete" }, 3000); return }
      await api(`/api/v1/builds/${b.id}`, { method: "DELETE" })
      if (state.savedId === b.id) { state.savedId = null; state.savedName = ""; state.dirty = true; render() }
      loadSaved()
    })
    const picture = b.thumbnail ? el("img", { src: b.thumbnail, alt: "" }) : el("img", { alt: "" })
    return el("li", {}, picture, el("div", {}, el("div", { className: "name", textContent: b.name }), el("div", { className: "when", textContent: new Date(b.updated_at).toLocaleString() })), el("div", { className: "actions" }, open, del))
  }) : [el("li", { className: "note", textContent: "Nothing saved yet." })]))
}

// --- Wiring ---------------------------------------------------------------------------------------------------

function bind() {
  for (const tab of document.querySelectorAll(".tabs button")) {
    tab.addEventListener("click", () => {
      for (const t of document.querySelectorAll(".tabs button")) t.setAttribute("aria-selected", String(t === tab))
      for (const pane of document.querySelectorAll(".pane")) pane.hidden = pane.dataset.pane !== tab.dataset.tab
    })
  }
  $("views").replaceChildren(...Object.entries(VIEWS).map(([name, v]) => {
    const b = el("button", { type: "button", textContent: v.label })
    b.addEventListener("click", () => {
      stage.view(name)
      for (const other of $("views").children) other.setAttribute("aria-pressed", String(other === b))
    })
    return b
  }))
  for (const id of ["show-film", "show-film-2"]) $(id).addEventListener("change", (e) => { stage.setShowFilm(e.target.checked); render() })
  $("save-picture").addEventListener("click", () => {
    const a = el("a", { href: stage.picture(), download: `carlab-${carTitle(state.build).toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png` })
    document.body.append(a); a.click(); a.remove()
  })
  for (const button of document.querySelectorAll("button.pick")) button.addEventListener("click", () => startPick(button.dataset.pick))

  $("paint-color").addEventListener("input", (e) => update((n) => { n.paint.color = e.target.value }))
  $("wrap-color").addEventListener("input", (e) => update((n) => { n.wrap.color = e.target.value; if (n.wrap.zone === "none") n.wrap.zone = "full" }))
  $("stripes-on").addEventListener("change", (e) => update((n) => { n.stripes.on = e.target.checked }))
  $("stripes-color").addEventListener("input", (e) => update((n) => { n.stripes.color = e.target.value; n.stripes.on = true }))
  $("stripes-width").addEventListener("input", (e) => update((n) => { n.stripes.width = Number(e.target.value) }))
  $("stripes-gap").addEventListener("input", (e) => update((n) => { n.stripes.gap = Number(e.target.value) }))
  $("wheel-color").addEventListener("input", (e) => update((n) => { n.wheels.color = e.target.value }))
  $("lowering").addEventListener("input", (e) => update((n) => { n.wheels.lowering = Number(e.target.value) }))
  $("spacer").addEventListener("input", (e) => update((n) => { n.wheels.spacer = Number(e.target.value) }))
  for (const [id, key] of [["car-year", "year"], ["car-make", "make"], ["car-model", "model"], ["car-trim", "trim"]]) {
    $(id).addEventListener("input", (e) => update((n) => { n.car[key] = e.target.value }))
  }
  $("default-car").addEventListener("click", () => {
    state.selected = null
    state.listing = null
    state.photos = []
    newCar()
    $("tracer").hidden = true
    update((n) => { n.car = structuredClone(DEFAULT_BUILD.car) })
    carStatus("Showing the built-in sedan.")
    renderPhotos()
  })

  $("listing-form").addEventListener("submit", (e) => { e.preventDefault(); const url = $("listing-url").value.trim(); if (url) readListing(url) })
  $("photo-input").addEventListener("change", async (e) => {
    const files = [...e.target.files]
    e.target.value = ""
    if (!files.length) return
    carStatus("Looking for the car…")
    if (!state.photos.length) newCar()
    const loaded = (await Promise.all(files.map((f) => loadPhoto(URL.createObjectURL(f), "upload", f.name)))).filter(Boolean)
    if (!loaded.length) { carStatus("Couldn't open those photos.", true); return }
    if (!state.build.car.source || state.build.car.source.kind === "photo") update((n) => { n.car.source = { kind: "photo", url: "" } })
    await usePhotos(loaded)
  })
  $("trace-use").addEventListener("click", () => buildFromTrace())
  $("trace-length").addEventListener("change", () => { state.lengthSet = true; $("length-note").textContent = ""; buildFromTrace() })
  $("trace-width").addEventListener("change", () => { state.frontWidth = Number($("trace-width").value); buildFromTrace() })
  $("trace-flip").addEventListener("click", () => editor.flip())
  $("trace-reset").addEventListener("click", () => { if (state.selected) selectPhoto(state.selected, { setColor: false }) })

  $("save-form").addEventListener("submit", (e) => { e.preventDefault(); save(false) })
  $("save-new").addEventListener("click", () => save(true))
  $("build-name").addEventListener("change", (e) => update((n) => { n.name = e.target.value }))
}

async function start() {
  stage = new Stage($("view"))
  editor = new OutlineEditor($("trace-canvas"), { onChange: () => buildFromTrace() })
  bind()
  bindStageClicks()
  try {
    const saved = JSON.parse(sessionStorage.getItem("carlab:build") || "null")
    if (saved?.build) { state.savedId = saved.savedId; state.savedName = saved.savedName || ""; state.dirty = Boolean(saved.dirty); state.build = normalizeBuild(saved.build) }
  } catch { /* nothing kept */ }
  stage.show(state.build)
  $("loading").hidden = true
  render()
  const [catalog, samples] = await Promise.all([api("/api/v1/catalog"), api("/api/v1/samples")])
  state.catalog = catalog
  renderSheet()
  $("samples").append(...samples.samples.flatMap((s, i) => {
    const b = el("button", { type: "button", className: "ghost", textContent: s.name })
    b.addEventListener("click", () => { $("listing-url").value = new URL(s.url, location.href).href; readListing($("listing-url").value) })
    return i ? [" ", b] : [b]
  }))
  if (!samples.samples.length) $("samples").hidden = true
  loadSaved()
  document.body.dataset.ready = "true"
}

// For tests and for making the sample pictures.
window.carlab = {
  get build() { return state.build },
  set: (build) => setBuild(build),
  get stage() { return stage },
  shapeOf,
}

start()
