// The 3D view: a studio with soft reflections and a floor, the car on it, a camera you can orbit, preset views,
// clicking panels, and saving a picture. It draws only when something changes.
import * as THREE from "../vendor/three.module.js"
import { OrbitControls } from "../vendor/three-addons/OrbitControls.js"
import { RoomEnvironment } from "../vendor/three-addons/RoomEnvironment.js"
import { buildBody, panelOfHit } from "./car.js"
import { buildWheel } from "./wheels.js"
import { createLook, applyLook } from "./materials.js"
import { normalizeSpec } from "./profile.js"

export const VIEWS = Object.freeze({
  front: { label: "Front ¾", position: [6.0, 1.55, 5.3] },
  side: { label: "Side", position: [0, 1.0, 8.2] },
  rear: { label: "Rear ¾", position: [-6.0, 1.7, 5.3] },
  nose: { label: "Front", position: [7.6, 1.1, 0] },
  top: { label: "Top", position: [0.01, 8.4, 0.6] },
})

export class Stage {
  constructor(canvas) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.toneMappingExposure = 1.0
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color("#1c1e22")
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture
    this.scene.environmentIntensity = 0.95

    const key = new THREE.DirectionalLight("#ffffff", 1.6)
    key.position.set(3, 7, 4)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 20 })
    key.shadow.radius = 6
    key.shadow.bias = -0.0004
    this.scene.add(key, new THREE.HemisphereLight("#ffffff", "#2a2c30", 0.35))

    const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 96), new THREE.MeshStandardMaterial({ color: "#2a2d32", roughness: 0.82, metalness: 0 }))
    floor.name = "floor"
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    this.scene.add(floor)

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100)
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.minDistance = 3.2
    this.controls.maxDistance = 14
    this.controls.maxPolarAngle = Math.PI / 2 - 0.03
    this.controls.target.set(0, 0.62, 0)
    this.controls.addEventListener("change", () => this.requestRender())
    this.view("front")

    this.look = createLook()
    this.car = new THREE.Group()
    this.car.name = "car"
    this.scene.add(this.car)
    this.body = null
    this.wheels = []
    this.specKey = ""
    this.wheelKey = ""
    this.build = null
    this.showFilm = false

    this.frames = 0
    this.loop = this.loop.bind(this)
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement)
    this.resize()
  }

  resize() {
    const box = this.canvas.parentElement.getBoundingClientRect()
    const w = Math.max(1, Math.floor(box.width)), h = Math.max(1, Math.floor(box.height))
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.requestRender()
  }

  requestRender(frames = 2) {
    const idle = this.frames === 0
    this.frames = Math.max(this.frames, frames)
    if (idle) requestAnimationFrame(this.loop)
  }

  loop() {
    if (this.controls.update()) this.frames = Math.max(this.frames, 2) // still easing to a stop
    this.renderer.render(this.scene, this.camera)
    this.frames -= 1
    if (this.frames > 0) requestAnimationFrame(this.loop)
    else this.frames = 0
  }

  view(name) {
    const v = VIEWS[name] || VIEWS.front
    this.camera.position.set(...v.position)
    this.controls.target.set(0, 0.62, 0)
    this.controls.update()
    this.requestRender()
  }

  // Shows a build: rebuilds the body or wheels only when their shape changed, and always updates the look.
  show(build) {
    this.build = build
    const spec = normalizeSpec(build.car.spec || {})
    const specKey = JSON.stringify(spec)
    if (specKey !== this.specKey) {
      if (this.body) { this.car.remove(this.body.group); dispose(this.body.group) }
      this.body = buildBody(spec, this.look.panels)
      this.car.add(this.body.group)
      this.specKey = specKey
      this.wheelKey = ""
    }
    const w = build.wheels
    const wheelKey = `${w.style}:${w.inches}:${spec.tireRadius}:${specKey.length}`
    if (wheelKey !== this.wheelKey) {
      for (const wheel of this.wheels) { this.car.remove(wheel); dispose(wheel) }
      this.wheels = []
      const { frontAxleX, rearAxleX } = this.body.shape
      for (const x of [frontAxleX, rearAxleX]) {
        for (const side of [-1, 1]) {
          const wheel = buildWheel({ inches: w.inches, style: w.style, tireRadius: spec.tireRadius }, this.look.wheel)
          wheel.position.set(x, spec.tireRadius, 0)
          wheel.userData.side = side
          if (side < 0) wheel.rotation.y = Math.PI
          this.wheels.push(wheel)
          this.car.add(wheel)
        }
      }
      this.wheelKey = wheelKey
    }
    // Ride height moves the body down over the wheels; spacers push the wheels out.
    this.body.group.position.y = -w.lowering / 1000
    for (const wheel of this.wheels) {
      const track = spec.width / 2 - 0.14 + w.spacer / 1000
      wheel.position.z = wheel.userData.side * track
    }
    applyLook(this.look, build, { showFilm: this.showFilm, width: spec.width, length: spec.length })
    this.requestRender()
  }

  setShowFilm(on) {
    this.showFilm = on
    if (this.build) this.show(this.build)
  }

  // The panel under a point on the canvas, or null.
  panelAt(clientX, clientY) {
    if (!this.body) return null
    const rect = this.canvas.getBoundingClientRect()
    const pointer = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    const ray = new THREE.Raycaster()
    ray.setFromCamera(pointer, this.camera)
    const [hit] = ray.intersectObjects(this.body.meshes, false)
    return panelOfHit(hit)
  }

  // The view as a PNG data URL (or a smaller JPEG for a saved build's thumbnail).
  picture({ type = "image/png", width = null } = {}) {
    this.renderer.render(this.scene, this.camera)
    if (!width) return this.canvas.toDataURL(type)
    const scale = width / this.canvas.width
    const c = document.createElement("canvas")
    c.width = width
    c.height = Math.round(this.canvas.height * scale)
    c.getContext("2d").drawImage(this.canvas, 0, 0, c.width, c.height)
    return c.toDataURL("image/jpeg", 0.82)
  }
}

function dispose(object) {
  object.traverse((o) => { if (o.geometry) o.geometry.dispose() })
}
