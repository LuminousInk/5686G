import CameraControls from 'camera-controls'
import * as THREE from 'three'
import type { Engine } from '../Engine'
import { framePoint, inRect, levelAtHeight, levelFloor, levelId, stairFlight } from '../house/levels'
import { blockAt, roofHeightAt, roofThickness } from '../house/massing'
import type { CameraView, RoomDef } from '../house/types'
import type { Segment2 } from '../house/walls'
import type { CameraPose, NavMode } from './pose'

export type { NavMode } from './pose'

const EYE = 1.62
const RADIUS = 0.24
const STEP = 0.5
const DOUBLE_TAP_MS = 320
const ORBIT_SMOOTH = 0.24
const { ACTION } = CameraControls
CameraControls.install({ THREE })

interface Tween {
  t: number
  dur: number
  fromPos: THREE.Vector3
  fromQuat: THREE.Quaternion
  toPos: THREE.Vector3
  toQuat: THREE.Quaternion
  fromFov: number
  toFov: number
  done: () => void
  arrived?: () => void
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/**
 * Camera navigation for touch and mouse.
 *  - orbit: drag rotates (including looking up and down), pinch / wheel zooms, two-finger or right drag pans.
 *  - walk: drag looks around (full pitch), tap a spot to walk there, pinch / wheel moves forward,
 *    two-finger drag or the joystick moves, WASD / arrows on keyboards. Collides with walls and rails.
 *  - dollhouse: orbit with roofs and ceilings hidden; tap a room to walk into it.
 */
export class Navigator {
  mode: NavMode = 'orbit'
  // orbit state
  readonly target = new THREE.Vector3(0, 2, 0)
  private readonly orbit: CameraControls
  private orbitPending = false
  private orbitUpdated = false
  private orbitRested = false
  private orbitFov?: number
  private orbitArrival?: () => void
  private readonly orbitScratch = new THREE.Vector3()
  private dollyScale = 1
  private readonly orbitBounds = new THREE.Box3()
  private lastWheel = -Infinity
  private viewLevel?: string
  private cutWalls = true
  private cutawaySuspended = false
  private cutawayAt = -Infinity
  private sectionHouse?: Engine['house']
  private lastTap?: { x: number; y: number; room?: RoomDef; timer: ReturnType<typeof setTimeout> }
  private readonly removeHook?: () => void
  // walk state
  readonly feet = new THREE.Vector3()
  yaw = 0
  pitch = 0
  private eyeY = EYE
  private vYaw = 0
  private vPitch = 0
  /** joystick / keys: x = strafe, y = forward, in [-1, 1] */
  readonly moveInput = new THREE.Vector2()
  private keys = new Set<string>()
  private walkTarget: THREE.Vector3 | null = null
  private walkWaypoints: THREE.Vector3[] = []
  private tween: Tween | null = null
  private tweenPaused = false
  private holdPose = false
  private pointers = new Map<number, { x: number; y: number; sx: number; sy: number; t: number; suppressTap: boolean }>()
  private pinchDist = 0
  private pinchMid = new THREE.Vector2()
  private raycaster = new THREE.Raycaster()
  /** called when the user taps in walk mode on a spot (for the UI marker) */
  onWalkTo?: (p: THREE.Vector3) => void
  onModeChange?: (m: NavMode) => void
  onInteract?: () => boolean | void
  /** tap in orbit mode (for selection in the editor) */
  onTap?: (hit: THREE.Intersection | null, ev: PointerEvent) => void
  private inputEnabled = true
  private bounds = { minX: -60, maxX: 60, minZ: -60, maxZ: 60 }

  constructor(
    private engine: Engine,
    private dom: HTMLElement,
  ) {
    dom.addEventListener('pointerdown', this.down)
    dom.addEventListener('pointermove', this.move)
    dom.addEventListener('pointerup', this.up)
    dom.addEventListener('pointercancel', this.up)
    dom.addEventListener('wheel', this.wheel, { passive: false, capture: true })
    dom.addEventListener('contextmenu', this.contextmenu)
    window.addEventListener('keydown', this.keydown)
    window.addEventListener('keyup', this.keyup)
    this.orbit = new CameraControls(this.camera, dom.ownerDocument ? dom : undefined)
    this.orbit.smoothTime = ORBIT_SMOOTH
    this.orbit.draggingSmoothTime = 0.11
    this.orbit.restThreshold = 0.001
    this.orbit.dollyToCursor = true
    this.orbit.dollySpeed = 0.85
    this.orbit.azimuthRotateSpeed = 0.76
    this.orbit.polarRotateSpeed = 0.76
    this.orbit.mouseButtons.right = ACTION.TRUCK
    this.orbit.touches.two = ACTION.TOUCH_DOLLY_TRUCK
    this.orbit.touches.three = ACTION.TOUCH_TRUCK
    this.orbit.addEventListener('control', this.wakeOrbit)
    this.orbit.addEventListener('transitionstart', this.wakeOrbit)
    this.orbit.addEventListener('update', () => { this.orbitUpdated = true })
    this.orbit.addEventListener('rest', () => { this.orbitRested = true })
    this.orbit.addEventListener('sleep', () => { this.orbitPending = false })
    this.setOrbitLimits()
    this.removeHook = engine.addHook(dt => this.update(dt))
  }

  get camera() {
    return this.engine.camera
  }

  get floorLevel() {
    const plan = this.engine.plan
    if (!plan) return
    if (!this.tween) return levelAtHeight(plan, this.feet.y)
    const { x, y, z } = this.camera.position
    return levelAtHeight(plan, this.floorHeight(x, z, y - EYE))
  }

  get enabled() { return this.inputEnabled }

  set enabled(value: boolean) {
    this.inputEnabled = value
    this.updateInputMode()
    if (!value) {
      this.keys.clear()
      this.moveInput.set(0, 0)
      this.pointers.clear()
      this.clearTap()
    }
  }

  private updateInputMode() {
    this.orbit.enabled = this.inputEnabled && this.mode !== 'walk'
  }

  private setOrbitLimits() {
    this.orbit.minPolarAngle = 0.10
    this.orbit.maxPolarAngle = this.mode === 'dollhouse' ? 1.22 : 1.60
    this.orbit.minDistance = this.mode === 'dollhouse' ? Math.max(2.1, this.dollyScale * 0.075) : Math.max(3.5, this.dollyScale * 0.24)
    this.orbit.maxDistance = Math.max(35, this.dollyScale * 4.5)
  }

  setBounds(box: THREE.Box3) {
    this.bounds = { minX: box.min.x - 40, maxX: box.max.x + 40, minZ: box.min.z - 40, maxZ: box.max.z + 40 }
    this.dollyScale = Math.max(box.max.x - box.min.x, box.max.z - box.min.z)
    this.setOrbitLimits()
    this.orbitBounds.copy(box).expandByVector(new THREE.Vector3(this.dollyScale * 0.4, 8, this.dollyScale * 0.4))
    this.setTargetBoundary()
  }

  private setTargetBoundary() {
    if (this.orbitBounds.isEmpty()) return
    const box = this.orbitBounds.clone()
    const plan = this.engine.plan
    if (this.mode === 'dollhouse' && plan?.levels) {
      const floor = levelFloor(plan, this.viewLevel)
      for (const level of plan.levels) {
        const y = levelFloor(plan, level.id)
        if (y > floor) box.max.y = Math.min(box.max.y, (floor + y) / 2 - 0.03)
        if (y < floor) box.min.y = Math.max(box.min.y, (floor + y) / 2 + 0.03)
      }
    }
    this.orbit.setBoundary(box)
  }

  get dollhouseLevel() { return this.viewLevel }

  setCutaway(cut: boolean) {
    this.cutWalls = cut
    this.updateCutaway()
  }

  suspendCutaway(suspended: boolean) {
    if (this.cutawaySuspended === suspended) return
    this.cutawaySuspended = suspended
    this.updateCutaway()
  }

  setDollhouseLevel(level: string) {
    const plan = this.engine.plan
    if (this.mode !== 'dollhouse' || !plan?.levels?.some(item => item.id === level) || level === this.viewLevel) return
    this.interruptTween()
    this.viewLevel = level
    this.updateCutaway()
    this.fitDollhouse(true, false)
  }

  private updateCutaway() {
    this.cutawayAt = performance.now()
    const house = this.engine.house
    this.sectionHouse = house
    if (!house?.cutaway) return
    const floor = this.mode === 'dollhouse' && !this.cutawaySuspended ? levelFloor(house.plan, this.viewLevel) : undefined
    this.engine.setDollhouseSection(floor, this.cutWalls, this.target)
  }

  // ------------------------------------------------------------------ modes and views

  setMode(mode: NavMode, animate = true) {
    if (mode === this.mode) return
    const prev = this.mode
    if (mode === 'dollhouse') {
      const plan = this.engine.house?.plan ?? this.engine.plan
      this.viewLevel = prev === 'walk' ? this.floorLevel : plan ? levelId(plan) : undefined
      this.fitDollhouse(animate)
    } else if (mode === 'walk') {
      const p = this.camera.position
      const y = this.floorHeight(p.x, p.z, p.y - EYE)
      const dir = this.camera.getWorldDirection(new THREE.Vector3())
      dir.y = THREE.MathUtils.clamp(dir.y, -0.56, 0.56)
      this.goToPose({ mode, pos: [p.x, y + EYE, p.z], target: [p.x + dir.x, y + EYE + dir.y, p.z + dir.z], fov: this.walkFov() }, animate)
    } else {
      const view = this.engine.plan?.views.find(v => v.kind === 'orbit')
      if (view) this.goToView(view, animate, mode)
      else this.goToPose({ ...this.capturePose(), mode }, animate)
    }
  }

  private walkFov() {
    return this.camera.aspect < 0.8 ? 72 : 64
  }

  private fitDollhouse(animate: boolean, initial = true) {
    const house = this.engine.house
    if (!house) return
    const floor = levelFloor(house.plan, this.viewLevel)
    const box = new THREE.Box3()
    for (const b of house.plan.blocks) {
      if (levelId(house.plan, b.level) !== this.viewLevel) continue
      const [x0, z0, x1, z1] = b.rect
      for (const x of [x0, x1]) for (const z of [z0, z1]) {
        const [wx, wz] = framePoint(b, x, z)
        box.expandByPoint(new THREE.Vector3(wx, floor, wz))
        box.expandByPoint(new THREE.Vector3(wx, floor + 2.7, wz))
      }
    }
    if (box.isEmpty()) box.copy(house.bounds)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const azimuth = initial ? house.plan.levels && house.plan.landscape.site
      ? THREE.MathUtils.degToRad(house.plan.landscape.site.downhill) - 0.38 : 0.48 : this.orbit.azimuthAngle
    const polar = initial ? 0.75 : this.orbit.polarAngle
    const fov = 45
    center.y = floor + 0.8
    const halfWidth = Math.tan(THREE.MathUtils.degToRad(fov) / 2) * this.camera.aspect
    const radius = Math.max(size.x, size.z) * Math.max(1.04, 0.47 / halfWidth)
    const pos = new THREE.Vector3().setFromSphericalCoords(radius, polar, azimuth).add(center)
    this.applyPose({ mode: 'dollhouse', pos: pos.toArray(), target: center.toArray(), fov }, animate)
  }

  private viewPose(v: CameraView, mode: NavMode = v.kind === 'orbit' && this.mode === 'dollhouse' ? 'dollhouse' : v.kind): CameraPose {
    const pos = new THREE.Vector3(...v.pos)
    const target = new THREE.Vector3(...v.target)
    if (v.id === 'tour-hero' && this.camera.aspect < 0.85) {
      pos.sub(target).multiplyScalar(Math.min(2.4, 1.1 / this.camera.aspect)).add(target)
    } else if (mode === 'orbit' && this.engine.plan?.levels && this.camera.aspect < 0.9) {
      const fit = Math.min(2.5, 1.18 / this.camera.aspect)
      pos.sub(target).multiplyScalar(fit).add(target)
    } else if (v.kind === 'orbit' && v.id === 'hero' && this.camera.aspect < 0.8) {
      pos.sub(target).multiplyScalar(Math.min(1.55, 0.78 / this.camera.aspect)).add(target)
    }
    const fov = (v.fov ?? (v.kind === 'walk' ? 64 : 50)) + (v.kind === 'walk' && this.camera.aspect < 0.8 ? 6 : 0)
    return { mode, pos: pos.toArray(), target: v.target, fov }
  }

  goToView(view: CameraView, animate = true, mode?: NavMode) {
    this.goToPose(this.viewPose(view, mode), animate)
  }

  goToTourView(view: CameraView, reducedMotion: boolean, arrived: () => void) {
    const destination = this.viewPose(view, view.kind)
    const house = this.engine.house
    if (reducedMotion || !house) {
      this.goToPose(destination, false, arrived)
      return
    }
    // Where the next space is nearby, try one continuous move. For separated
    // spaces, cut to a short, geometry-checked approach to the composition.
    const end = new THREE.Vector3(...destination.pos)
    const back = end.clone().sub(new THREE.Vector3(...destination.target)).normalize()
    const side = new THREE.Vector3().crossVectors(back, this.camera.up).normalize()
    const distance = view.kind === 'orbit' ? 3 : 0.65
    const groups = [house.group]
    if (this.engine.interior) groups.push(this.engine.interior.group)
    const solids: THREE.Object3D[] = []
    for (const group of groups) group.traverseVisible(object => {
      const mesh = object as THREE.Mesh
      if (mesh.isMesh && mesh.layers.test(this.camera.layers) && !mesh.userData.shadowOnly && !Array.isArray(mesh.material) && mesh.material.colorWrite) solids.push(mesh)
    })
    const ray = new THREE.Raycaster()
    const isClear = (start: THREE.Vector3) => {
      const dir = end.clone().sub(start).normalize()
      const shoulder = new THREE.Vector3().crossVectors(dir, this.camera.up).normalize()
      ray.far = start.distanceTo(end) + 0.16
      return [0, -0.18, 0.18].every(offset => {
        const origin = start.clone().addScaledVector(shoulder, offset).addScaledVector(dir, -0.08)
        ray.set(origin, dir)
        if (ray.intersectObjects(solids, false).length) return false
        ray.set(origin.addScaledVector(dir, ray.far), dir.clone().negate())
        return !ray.intersectObjects(solids, false).length
      })
    }
    const from = this.camera.position
    const travel = end.distanceToSquared(from)
    if (this.mode === 'walk' && view.kind === 'walk' && travel > 0.1 && travel < 25 &&
        Math.abs(end.y - from.y) < 0.25 && isClear(from)) {
      this.goToPose(destination, true, arrived, 1.8)
      return
    }
    const start = [back, side, side.clone().negate()]
      .map(direction => end.clone().addScaledVector(direction, distance))
      .find(candidate => candidate.y > this.floorHeight(candidate.x, candidate.z, candidate.y - EYE) + 0.35 && isClear(candidate))
    if (!start) {
      this.goToPose(destination, false, arrived)
      return
    }
    this.goToPose({ ...destination, pos: start.toArray() })
    this.goToPose(destination, true, arrived, 1.25)
  }

  capturePose(): CameraPose {
    const cam = this.camera
    const target = this.mode === 'walk' ? cam.getWorldDirection(new THREE.Vector3()).multiplyScalar(10).add(cam.position) : this.target
    return { mode: this.mode, pos: cam.position.toArray(), target: target.toArray(), fov: cam.fov }
  }

  atView(view: CameraView) {
    const expected = this.viewPose(view, view.kind)
    const direction = new THREE.Vector3(...expected.target).sub(new THREE.Vector3(...expected.pos)).normalize()
    return !this.tween && !this.orbitFov && this.mode === view.kind && Math.abs(this.camera.fov - expected.fov) < 0.01 &&
      this.camera.position.distanceToSquared(new THREE.Vector3(...expected.pos)) < 0.0001 &&
      direction.dot(this.camera.getWorldDirection(new THREE.Vector3())) > 0.999999
  }

  goToPose(pose: CameraPose, animate = false, arrived?: () => void, duration?: number) {
    if (pose.mode === 'dollhouse' && this.engine.plan) this.viewLevel = levelAtHeight(this.engine.plan, pose.target[1])
    this.applyPose(pose, animate, arrived, duration)
  }

  private applyPose(pose: CameraPose, animate: boolean, arrived?: () => void, duration?: number) {
    this.interruptTween()
    this.clearTap()
    this.walkTarget = null
    this.walkWaypoints = []
    this.vYaw = this.vPitch = 0
    const { mode, fov } = pose
    const previousMode = this.mode
    const previousPose = this.capturePose()
    this.mode = mode
    this.updateInputMode()
    this.setOrbitLimits()
    this.setTargetBoundary()
    const house = this.engine.house
    if (house?.roof) {
      const hide = mode === 'dollhouse' || (mode === 'orbit' && this.engine.dollhouse && previousMode !== 'dollhouse')
      house.roof.visible = house.ceilings.visible = !hide
      if (this.engine.dollhouse !== hide) this.engine.setDollhouse(hide)
    }
    this.onModeChange?.(mode)
    if (mode !== 'walk') {
      this.orbit.smoothTime = duration ? duration / 4.6 : ORBIT_SMOOTH
      if (animate && previousMode === 'walk') {
        // Start above the roof when leaving a walking camera. The approach then stays outdoors.
        this.orbitScratch.fromArray(previousPose.pos)
        this.guardOrbitPosition(this.orbitScratch)
        void this.orbit.setLookAt(...this.orbitScratch.toArray(), ...previousPose.target, false)
      }
      this.orbitFov = animate ? fov : undefined
      this.orbitArrival = animate ? arrived : undefined
      if (!animate) {
        this.camera.fov = fov
        this.camera.updateProjectionMatrix()
      }
      void this.orbit.setLookAt(...pose.pos, ...pose.target, animate)
      this.orbit.normalizeRotations()
      this.orbitPending = true
      if (!animate) {
        this.updateOrbit(0)
        this.orbitPending = false
        arrived?.()
      }
    } else {
      const pos = new THREE.Vector3(...pose.pos)
      const target = new THREE.Vector3(...pose.target)
      const m = new THREE.Matrix4().lookAt(pos, target, this.camera.up)
      const quat = new THREE.Quaternion().setFromRotationMatrix(m)
      const finish = () => {
        this.syncWalkFromCamera()
        this.holdPose = true
      }
      if (animate) this.animateTo(pos, quat, fov, finish, arrived, duration)
      else {
        this.camera.position.copy(pos)
        this.camera.quaternion.copy(quat)
        this.camera.fov = fov
        this.camera.updateProjectionMatrix()
        finish()
        arrived?.()
      }
    }
    this.updateCutaway()
    if (!this.engine.paused) this.engine.start()
  }

  /** Stop a running camera move at the currently displayed pose. */
  interruptTween() {
    if (this.tween) {
      this.tween = null
      this.syncWalkFromCamera()
      this.holdPose = true
    }
    if (this.mode === 'walk' || !this.orbitPending) return
    const p = this.camera.position
    void this.orbit.setLookAt(p.x, p.y, p.z, this.target.x, this.target.y, this.target.z, false)
    this.orbit.stop()
    this.orbitFov = undefined
    this.orbitArrival = undefined
    this.orbitPending = false
    this.orbit.smoothTime = ORBIT_SMOOTH
  }

  pauseTween(paused: boolean) {
    this.tweenPaused = paused
    if (!paused && (this.tween || this.orbitPending) && !this.engine.paused) this.engine.start()
  }

  private syncWalkFromCamera() {
    const cam = this.camera
    const e = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ')
    this.yaw = e.y
    this.pitch = e.x
    const fh = this.floorHeight(cam.position.x, cam.position.z, cam.position.y - EYE)
    this.feet.set(cam.position.x, fh, cam.position.z)
    this.eyeY = cam.position.y - fh
  }

  private animateTo(pos: THREE.Vector3, quat: THREE.Quaternion, fov: number, done: () => void, arrived?: () => void, duration?: number) {
    const dist = this.camera.position.distanceTo(pos)
    this.tween = {
      t: 0,
      dur: duration ?? THREE.MathUtils.clamp(0.6 + dist * 0.03, 0.7, 1.8),
      fromPos: this.camera.position.clone(),
      fromQuat: this.camera.quaternion.clone(),
      toPos: pos.clone(),
      toQuat: quat.clone(),
      fromFov: this.camera.fov,
      toFov: fov,
      done,
      arrived,
    }
    if (!this.engine.paused) this.engine.start()
  }

  // ------------------------------------------------------------------ helpers

  floorHeight(x: number, z: number, nearY = this.feet.y) {
    const h = this.engine.house?.floorAt(x, z, nearY)
    if (h !== null && h !== undefined) return h
    return this.engine.site?.heightAt(x, z) ?? 0
  }

  private walkPose() {
    const pos = new THREE.Vector3(this.feet.x, this.feet.y + this.eyeY, this.feet.z)
    const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'))
    return { pos, quat }
  }

  /** Keep the near plane clear of grade and the outside of each (possibly rotated) volume. */
  private guardOrbitPosition(p: THREE.Vector3) {
    const terrain = this.engine.site?.heightAt(p.x, p.z) ?? 0
    let safeY = terrain + 0.35
    const plan = this.engine.plan
    if (plan) {
      const visibleFloor = this.mode === 'dollhouse' ? levelFloor(plan, this.viewLevel) : Infinity
      for (const b of plan.blocks ?? []) {
        const floor = levelFloor(plan, b.level)
        if (floor > visibleFloor) continue
        let x = p.x, z = p.z
        if (b.yaw) [x, z] = framePoint(b, x, z, true)
        const [x0, z0, x1, z1] = b.rect
        const edge = Math.max(x0 - x, x - x1, z0 - z, z - z1)
        if (edge >= 0.65) continue
        const roof = floor + roofHeightAt(b, x, z) + roofThickness(b.roof) + 0.35
        // Blend the approach outside the facade so a sideways truck clears the roof
        // before the camera crosses the wall, even at low elevations.
        const weight = 1 - THREE.MathUtils.smoothstep(edge, 0.28, 0.65)
        safeY = Math.max(safeY, THREE.MathUtils.lerp(terrain + 0.35, roof, weight))
      }
    }
    if (p.y < safeY) {
      p.y = safeY
      return true
    }
    return false
  }

  private get colliders(): Segment2[] {
    const h = this.engine.house
    const i = this.engine.interior
    const segments = [...(h?.colliders ?? []), ...(i?.colliders ?? [])]
    return h?.plan.levels ? segments.filter(s => this.feet.y >= (s.bottom ?? -Infinity) && this.feet.y < (s.top ?? Infinity)) : segments
  }

  /** Move the walker by (dx, dz) with wall sliding and step limits. Returns true if it moved. */
  private walk(dx: number, dz: number): boolean {
    if (!this.engine.plan?.levels) return this.walkStep(dx, dz)
    const count = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.15))
    let moved = false
    for (let i = 0; i < count; i++) {
      if (!this.walkStep(dx / count, dz / count)) break
      moved = true
    }
    return moved
  }

  private walkStep(dx: number, dz: number): boolean {
    const p = this.feet
    let nx = p.x + dx
    let nz = p.z + dz
    const colliders = this.colliders
    for (let it = 0; it < 3; it++) {
      for (const s of colliders) {
        const ex = s.bx - s.ax
        const ez = s.bz - s.az
        const L2 = ex * ex + ez * ez
        if (L2 < 1e-8) continue
        let t = ((nx - s.ax) * ex + (nz - s.az) * ez) / L2
        t = Math.max(0, Math.min(1, t))
        const cx = s.ax + ex * t
        const cz = s.az + ez * t
        const ddx = nx - cx
        const ddz = nz - cz
        const d = Math.hypot(ddx, ddz)
        if (d < RADIUS && d > 1e-6) {
          nx = cx + (ddx / d) * RADIUS
          nz = cz + (ddz / d) * RADIUS
        }
      }
    }
    nx = THREE.MathUtils.clamp(nx, this.bounds.minX, this.bounds.maxX)
    nz = THREE.MathUtils.clamp(nz, this.bounds.minZ, this.bounds.maxZ)
    const fh = this.floorHeight(nx, nz)
    if (fh - p.y > STEP || (this.engine.plan?.levels && p.y - fh > STEP)) return false
    const moved = Math.hypot(nx - p.x, nz - p.z) > 1e-5
    p.set(nx, p.y + (fh - p.y) * 0.5, nz)
    return moved
  }

  // ------------------------------------------------------------------ frame update

  update(dt: number) {
    if (this.sectionHouse !== this.engine.house) {
      if (this.engine.house?.bounds) this.setBounds(this.engine.house.bounds)
      this.updateCutaway()
    }
    if (this.tweenPaused) return
    if (this.tween) {
      const tw = this.tween
      tw.t += dt / tw.dur
      const k = ease(Math.min(1, tw.t))
      this.camera.position.lerpVectors(tw.fromPos, tw.toPos, k)
      this.camera.quaternion.slerpQuaternions(tw.fromQuat, tw.toQuat, k)
      this.camera.fov = tw.fromFov + (tw.toFov - tw.fromFov) * k
      this.camera.updateProjectionMatrix()
      if (tw.t >= 1) {
        this.tween = null
        tw.done()
        tw.arrived?.()
      }
      return
    }
    if (this.mode !== 'walk') {
      this.updateOrbit(dt)
      return
    }
    if (this.holdPose && !this.active) return
    this.holdPose = false
    this.updateWalk(dt)
  }

  private wakeOrbit = () => {
    this.orbitPending = true
    if (!this.engine.paused) this.engine.start()
  }

  private updateOrbit(dt: number) {
    const kx = (this.keys.has('ArrowLeft') || this.keys.has('a') ? 1 : 0) - (this.keys.has('ArrowRight') || this.keys.has('d') ? 1 : 0)
    const ky = (this.keys.has('ArrowUp') || this.keys.has('w') ? 1 : 0) - (this.keys.has('ArrowDown') || this.keys.has('s') ? 1 : 0)
    if (kx) void this.orbit.rotate(kx * dt * 0.9, 0, true)
    if (ky) void this.orbit.dollyTo(this.orbit.distance * (1 - ky * dt * 0.8), true)
    if (kx || ky) this.orbitPending = true

    this.orbitUpdated = this.orbitRested = false
    if (this.orbitPending || this.orbitFov !== undefined) {
      const updated = this.orbit.update(dt)
      if (!updated) this.orbitPending = false
      this.orbit.getTarget(this.target, false)
      if (this.guardOrbitPosition(this.camera.position)) this.camera.lookAt(this.target)
    }
    if (this.orbitFov !== undefined) {
      const delta = this.orbitFov - this.camera.fov
      if (Math.abs(delta) < 0.015) {
        this.camera.fov = this.orbitFov
        this.orbitFov = undefined
      } else this.camera.fov += delta * (1 - Math.exp(-dt * 10))
      this.camera.updateProjectionMatrix()
    }
    if (this.mode === 'dollhouse' && (this.orbitRested || (this.orbitUpdated && performance.now() - this.cutawayAt >= 95)))
      this.updateCutaway()
    if (!this.orbitPending && this.orbitFov === undefined && this.orbitArrival) {
      const arrived = this.orbitArrival
      this.orbitArrival = undefined
      this.orbit.smoothTime = ORBIT_SMOOTH
      arrived()
    }
  }

  private updateWalk(dt: number) {
    if (!this.pointers.size) {
      this.yaw += this.vYaw * dt
      this.pitch += this.vPitch * dt
      const damp = Math.exp(-dt * 8)
      this.vYaw *= damp
      this.vPitch *= damp
    }
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.45, 1.45)
    // keyboard + joystick
    let fx = this.moveInput.x
    let fy = this.moveInput.y
    if (this.keys.has('w') || this.keys.has('ArrowUp')) fy += 1
    if (this.keys.has('s') || this.keys.has('ArrowDown')) fy -= 1
    if (this.keys.has('a')) fx -= 1
    if (this.keys.has('d')) fx += 1
    if (this.keys.has('ArrowLeft')) this.yaw += dt * 1.6
    if (this.keys.has('ArrowRight')) this.yaw -= dt * 1.6
    if (this.keys.has('q')) this.pitch += dt
    if (this.keys.has('e')) this.pitch -= dt
    const speed = this.keys.has('Shift') ? 3.2 : 1.5
    if (fx || fy) {
      this.walkTarget = null
      this.walkWaypoints = []
      const sin = Math.sin(this.yaw)
      const cos = Math.cos(this.yaw)
      // forward is -z rotated by yaw
      const dx = (-sin * fy + cos * fx) * speed * dt
      const dz = (-cos * fy - sin * fx) * speed * dt
      this.walk(dx, dz)
    } else if (this.walkTarget) {
      const to = this.walkTarget
      const dx = to.x - this.feet.x
      const dz = to.z - this.feet.z
      const d = Math.hypot(dx, dz)
      if (d < 0.05) this.walkTarget = this.walkWaypoints.shift() ?? null
      else {
        const speed = Math.max(0.9, d * 2.2)
        const step = Math.min(d, (this.engine.plan?.levels ? Math.min(3.2, speed) : speed) * dt)
        const moved = this.walk((dx / d) * step, (dz / d) * step)
        if (!moved) {
          this.walkTarget = null
          this.walkWaypoints = []
        }
      }
    } else {
      // settle on the floor
      const fh = this.floorHeight(this.feet.x, this.feet.z)
      this.feet.y += (fh - this.feet.y) * Math.min(1, dt * 10)
    }
    this.eyeY += (EYE - this.eyeY) * Math.min(1, dt * 3)
    const { pos, quat } = this.walkPose()
    this.camera.position.copy(pos)
    this.camera.quaternion.copy(quat)
    if (Math.abs(this.camera.fov - this.walkFov()) > 0.1) {
      this.camera.fov += (this.walkFov() - this.camera.fov) * Math.min(1, dt * 4)
      this.camera.updateProjectionMatrix()
    }
  }

  // ------------------------------------------------------------------ input

  private contextmenu = (e: Event) => e.preventDefault()

  private down = (e: PointerEvent) => {
    if (!this.enabled) return
    this.dom.setPointerCapture(e.pointerId)
    this.interruptTween()
    const suppressTap = this.onInteract?.() === true || e.button > 0 || e.shiftKey || this.pointers.size > 0
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), suppressTap })
    this.vYaw = this.vPitch = 0
    this.orbit.mouseButtons.left = e.shiftKey ? ACTION.TRUCK : ACTION.ROTATE
    if (this.pointers.size > 1) {
      this.clearTap()
      for (const p of this.pointers.values()) p.suppressTap = true
    }
    if (this.mode === 'walk' && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()]
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y)
      this.pinchMid.set((a.x + b.x) / 2, (a.y + b.y) / 2)
    }
  }

  private move = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId)
    if (!p) return
    if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) >= 8) {
      p.suppressTap = true
      this.clearTap()
    }
    if (this.mode !== 'walk') return
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    if (!dx && !dy) return
    this.holdPose = false
    p.x = e.clientX
    p.y = e.clientY
    const h = this.dom.clientHeight || 800
    if (this.pointers.size === 1) {
      // Grab the world: drag right turns left.
      const k = THREE.MathUtils.degToRad(this.camera.fov) / h * 1.15
      this.yaw += dx * k
      this.pitch += dy * k
      this.vYaw = dx * k * 21
      this.vPitch = dy * k * 21
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2
      const ratio = this.pinchDist > 0 ? dist / this.pinchDist : 1
      const fwd = (ratio - 1) * 3.2 + (y - this.pinchMid.y) / h * 4
      const side = -(x - this.pinchMid.x) / h * 4
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw)
      this.walk(-sin * fwd + cos * side, -cos * fwd - sin * side)
      this.pinchDist = dist
      this.pinchMid.set(x, y)
    }
    this.engine.start()
  }

  private up = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId)
    this.pointers.delete(e.pointerId)
    if (this.pointers.size < 2) this.pinchDist = 0
    if (!p || p.suppressTap || e.type === 'pointercancel' || this.pointers.size > 0) return
    if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < 8 && performance.now() - p.t < DOUBLE_TAP_MS) this.tap(e)
  }

  private wheel = (e: WheelEvent) => {
    if (!this.enabled) return
    const now = performance.now()
    if (now - this.lastWheel > 140) this.interruptTween()
    this.lastWheel = now
    this.clearTap()
    this.onInteract?.()
    if (this.mode === 'walk') {
      e.preventDefault()
      this.holdPose = false
      const d = Math.sign(e.deltaY) * Math.min(1, Math.abs(e.deltaY) / 100)
      this.walk(Math.sin(this.yaw) * d * 0.6, Math.cos(this.yaw) * d * 0.6)
      this.engine.start()
    } else if (e.ctrlKey) {
      // Browsers deliver trackpad pinch as a control-wheel. Keep it a perspective dolly.
      e.preventDefault()
      e.stopImmediatePropagation()
      const rect = this.dom.getBoundingClientRect()
      const from = this.orbit.distance
      const distance = THREE.MathUtils.clamp(from * Math.exp(e.deltaY * 0.012), this.orbit.minDistance, this.orbit.maxDistance)
      const height = 2 * (from - distance) * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)
      const x = (e.clientX - rect.left) / rect.width - 0.5
      const y = (e.clientY - rect.top) / rect.height - 0.5
      void this.orbit.truck(x * height * this.camera.aspect, y * height, true)
      void this.orbit.dollyTo(distance, true)
      this.wakeOrbit()
    }
  }

  private pick(x: number, y: number): THREE.Intersection | null {
    const r = this.dom.getBoundingClientRect()
    const ndc = new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1)
    this.camera.updateMatrixWorld()
    this.raycaster.layers.mask = this.camera.layers.mask
    this.raycaster.setFromCamera(ndc, this.camera)
    const roots: THREE.Object3D[] = []
    const h = this.engine.house
    if (h) {
      roots.push(h.shell, h.interior, h.outdoor)
      if (h.cutaway?.group.visible) roots.push(h.cutaway.group)
      if (h.roof.visible) roots.push(h.roof)
      if (h.ceilings.visible) roots.push(h.ceilings)
    }
    if (this.engine.interior) roots.push(this.engine.interior.group)
    const site = this.engine.site
    if (site) roots.push(...site.group.children.filter(c => c.name === 'terrain' || (c as THREE.Mesh).isMesh))
    const hits = this.raycaster.intersectObjects(roots, true)
    return hits.find(({ object }) => object.visible && !object.userData.shadowOnly &&
      ((object as THREE.Mesh).material as THREE.Material)?.name !== 'glass') ?? null
  }

  private clearTap() {
    clearTimeout(this.lastTap?.timer)
    this.lastTap = undefined
  }

  private roomAt(x: number, z: number) {
    const plan = this.engine.plan
    if (!plan) return
    return plan.rooms.find(room => levelId(plan, room.level) === this.viewLevel &&
      inRect(room.rect, ...framePoint(plan.blocks.find(b => b.id === room.frame), x, z)))
  }

  private fitBox(box: THREE.Box3) {
    this.interruptTween()
    // Preserve the current azimuth and an oblique view while letting fitToBox
    // calculate the distance for this viewport, including portrait framing.
    const { minPolarAngle, maxPolarAngle, minAzimuthAngle, maxAzimuthAngle } = this.orbit
    const polar = THREE.MathUtils.clamp(this.orbit.polarAngle, 0.58, 0.89)
    const azimuth = this.orbit.azimuthAngle
    this.orbit.minPolarAngle = this.orbit.maxPolarAngle = polar
    this.orbit.minAzimuthAngle = this.orbit.maxAzimuthAngle = azimuth
    const padding = this.camera.aspect < 0.8 ? 0.38 : 0.62
    void this.orbit.fitToBox(box, true, { paddingLeft: padding, paddingRight: padding, paddingTop: padding, paddingBottom: padding })
    Object.assign(this.orbit, { minPolarAngle, maxPolarAngle, minAzimuthAngle, maxAzimuthAngle })
    this.wakeOrbit()
  }

  private frameRoom(room: RoomDef) {
    const plan = this.engine.plan!
    const floor = levelFloor(plan, room.level)
    const frame = plan.blocks.find(b => b.id === room.frame)
    const box = new THREE.Box3()
    for (const x of [room.rect[0], room.rect[2]]) for (const z of [room.rect[1], room.rect[3]]) {
      const [wx, wz] = framePoint(frame, x, z)
      box.expandByPoint(new THREE.Vector3(wx, floor, wz))
      box.expandByPoint(new THREE.Vector3(wx, floor + 1.65, wz))
    }
    this.fitBox(box)
  }

  frameSurface(x: number, y: number) {
    if (this.mode === 'walk') return
    const hit = this.pick(x, y)
    if (!hit) return
    const box = new THREE.Box3().setFromCenterAndSize(hit.point, new THREE.Vector3(3.4, 2, 3.4))
    this.fitBox(box)
  }

  private tap(e: PointerEvent) {
    const hit = this.pick(e.clientX, e.clientY)
    if (this.mode === 'walk') {
      if (!hit) return
      const n = hit.face?.normal.clone().transformDirection(hit.object.matrixWorld) ?? new THREE.Vector3(0, 1, 0)
      const to = hit.point.clone()
      if (n.y < 0.6) {
        const back = new THREE.Vector3(this.feet.x - to.x, 0, this.feet.z - to.z).normalize().multiplyScalar(0.55)
        to.add(back)
      }
      this.walkWaypoints = this.stairRoute(to)
      this.walkTarget = this.walkWaypoints.shift() ?? to
      this.onWalkTo?.(hit.point.clone())
      this.engine.start()
    } else if (this.mode === 'dollhouse') {
      if (!hit) return
      const p = hit.point
      const room = this.roomAt(p.x, p.z)
      if (room && this.lastTap?.room === room && Math.hypot(e.clientX - this.lastTap.x, e.clientY - this.lastTap.y) < 34) {
        this.clearTap()
        this.frameRoom(room)
        return
      }
      this.clearTap()
      this.lastTap = { x: e.clientX, y: e.clientY, room, timer: setTimeout(() => {
        this.lastTap = undefined
        const plan = this.engine.plan
        const y = this.floorHeight(p.x, p.z, plan ? levelFloor(plan, this.viewLevel) : p.y)
        const center = this.engine.house?.bounds.getCenter(new THREE.Vector3()) ?? new THREE.Vector3()
        this.goToPose({ mode: 'walk', pos: [p.x, y + EYE, p.z], target: [center.x, y + EYE - 0.24, center.z], fov: this.walkFov() }, true)
      }, DOUBLE_TAP_MS) }
    } else this.onTap?.(hit, e)
  }

  /** Route a tap across visible stair landings, while ordinary floor taps still walk in a straight line. */
  private stairRoute(to: THREE.Vector3): THREE.Vector3[] {
    const plan = this.engine.house?.plan
    if (!plan?.levels) return []
    const fromLevel = levelAtHeight(plan, this.feet.y)
    const toLevel = levelAtHeight(plan, this.floorHeight(to.x, to.z, to.y))
    if (fromLevel === toLevel) return []
    if (plan.stairs.some(s => s.between && inRect(stairFlight(s).rect, this.feet.x, this.feet.z))) return []
    const routes = plan.stairs.flatMap(stair => {
      const between = stair.between
      if (!between) return []
      const down = between.upper === fromLevel && between.lower === toLevel
      if (!down && !(between.lower === fromLevel && between.upper === toLevel)) return []
      const { dx, dz, end } = stairFlight(stair)
      const [x, z] = stair.from
      const top = new THREE.Vector3(x - dx * 0.35, levelFloor(plan, between.upper), z - dz * 0.35)
      const bottom = new THREE.Vector3(end[0] + dx * 0.35, levelFloor(plan, between.lower), end[1] + dz * 0.35)
      const lowerBlocks = plan.blocks.filter(b => levelId(plan, b.level) === between.lower)
      const lowerEnd = down ? to : this.feet
      const lowerBlock = blockAt(lowerBlocks, lowerEnd.x, lowerEnd.z)
      if (lowerBlock && lowerBlock !== blockAt(lowerBlocks, bottom.x, bottom.z)) return []
      return [{ start: down ? top : bottom, end: down ? bottom : top }]
    })
    const route = routes.sort((a, b) => a.start.distanceTo(this.feet) + a.end.distanceTo(to) - b.start.distanceTo(this.feet) - b.end.distanceTo(to))[0]
    return route ? [route.start, route.end, to] : []
  }

  private keydown = (e: KeyboardEvent) => {
    if (!this.enabled || (e.target as HTMLElement)?.closest?.('input, select, textarea, [contenteditable="true"], [data-tour-control]')) return
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
    if (['w', 'a', 's', 'd', 'q', 'e', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) {
      this.keys.add(k)
      if (e.shiftKey) this.keys.add('Shift')
      if (!e.repeat) this.interruptTween()
      this.clearTap()
      this.onInteract?.()
      this.engine.start()
    }
  }

  private keyup = (e: KeyboardEvent) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
    this.keys.delete(k)
    if (!e.shiftKey) this.keys.delete('Shift')
  }

  /** Keep the loop running while a key is held or the joystick is used. */
  get active() {
    if (this.tweenPaused) return false
    if (this.mode !== 'walk') return this.keys.size > 0 || this.orbitPending || this.orbitFov !== undefined
    return this.keys.size > 0 || this.moveInput.lengthSq() > 0 || !!this.walkTarget || !!this.tween ||
      Math.abs(this.vYaw) + Math.abs(this.vPitch) > 0.002
  }

  dispose() {
    this.dom.removeEventListener('pointerdown', this.down)
    this.dom.removeEventListener('pointermove', this.move)
    this.dom.removeEventListener('pointerup', this.up)
    this.dom.removeEventListener('pointercancel', this.up)
    this.dom.removeEventListener('wheel', this.wheel, true)
    this.dom.removeEventListener('contextmenu', this.contextmenu)
    this.clearTap()
    this.orbit.dispose()
    this.removeHook?.()
    window.removeEventListener('keydown', this.keydown)
    window.removeEventListener('keyup', this.keyup)
  }
}
