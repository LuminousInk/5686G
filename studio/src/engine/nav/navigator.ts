import * as THREE from 'three'
import type { Engine } from '../Engine'
import { inRect, levelAtHeight, levelFloor, levelId, stairFlight } from '../house/levels'
import { blockAt } from '../house/massing'
import type { CameraView } from '../house/types'
import type { Segment2 } from '../house/walls'
import type { CameraPose, NavMode } from './pose'

export type { NavMode } from './pose'

const EYE = 1.62
const RADIUS = 0.24
const STEP = 0.5

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
  radius = 18
  private maxRadius = 120
  azimuth = 0
  polar = 1.35
  private vAz = 0
  private vPol = 0
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
  enabled = true
  private bounds = { minX: -60, maxX: 60, minZ: -60, maxZ: 60 }

  constructor(
    private engine: Engine,
    private dom: HTMLElement,
  ) {
    dom.addEventListener('pointerdown', this.down)
    dom.addEventListener('pointermove', this.move)
    dom.addEventListener('pointerup', this.up)
    dom.addEventListener('pointercancel', this.up)
    dom.addEventListener('wheel', this.wheel, { passive: false })
    dom.addEventListener('contextmenu', e => e.preventDefault())
    window.addEventListener('keydown', this.keydown)
    window.addEventListener('keyup', this.keyup)
    engine.addHook(dt => this.update(dt))
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

  setBounds(box: THREE.Box3) {
    this.bounds = { minX: box.min.x - 40, maxX: box.max.x + 40, minZ: box.min.z - 40, maxZ: box.max.z + 40 }
  }

  // ------------------------------------------------------------------ modes and views

  setMode(mode: NavMode, animate = true) {
    if (mode === this.mode) return
    this.interruptTween()
    this.holdPose = false
    const prev = this.mode
    this.walkTarget = null
    this.walkWaypoints = []
    this.mode = mode
    const house = this.engine.house
    if (house) {
      const hide = mode === 'dollhouse'
      house.roof.visible = !hide
      house.ceilings.visible = !hide
      this.engine.setDollhouse(hide)
    }
    if (mode === 'walk' && prev !== 'walk') {
      // start where the camera is, dropped to the ground
      const p = this.camera.position
      const fh = this.floorHeight(p.x, p.z, p.y - EYE)
      this.feet.set(p.x, fh, p.z)
      const dir = this.camera.getWorldDirection(new THREE.Vector3())
      this.yaw = Math.atan2(-dir.x, -dir.z)
      this.pitch = THREE.MathUtils.clamp(Math.asin(dir.y), -0.6, 0.6)
      this.eyeY = EYE
      if (animate) {
        const to = this.walkPose()
        this.animateTo(to.pos, to.quat, this.walkFov(), () => {})
      }
    } else if (mode !== 'walk' && prev === 'walk') {
      this.fitOrbitFromCamera(mode === 'dollhouse')
    } else if (mode === 'dollhouse') {
      this.fitOrbitFromCamera(true)
    }
    this.onModeChange?.(mode)
    this.engine.invalidate()
  }

  private walkFov() {
    return this.camera.aspect < 0.8 ? 72 : 64
  }

  /** Derive orbit parameters that keep the current view (or frame the house for the dollhouse). */
  private fitOrbitFromCamera(dollhouse: boolean) {
    const house = this.engine.house
    const c = house ? house.bounds.getCenter(new THREE.Vector3()) : new THREE.Vector3()
    if (dollhouse && house) {
      const size = house.bounds.getSize(new THREE.Vector3())
      this.target.set(c.x, this.engine.plan?.floorY ?? 0.5, c.z)
      const fit = this.camera.aspect < 1 ? (house.plan.levels ? Math.max(1.6, 1.18 / this.camera.aspect) : 1.6) : 1.05
      this.radius = Math.max(size.x, size.z) * fit
      this.polar = 0.82
      this.azimuth = house.plan.levels && house.plan.landscape.site ? THREE.MathUtils.degToRad(house.plan.landscape.site.downhill) - 0.38 : 0.35
    } else {
      const dir = this.camera.getWorldDirection(new THREE.Vector3())
      // aim at the house centre along the view direction
      const toC = new THREE.Vector3().subVectors(c, this.camera.position)
      const d = Math.max(6, toC.dot(dir))
      this.target.copy(this.camera.position).addScaledVector(dir, d)
      this.target.y = Math.max(1.2, this.target.y)
      this.syncOrbitFromCamera()
    }
    const to = this.orbitPose()
    this.animateTo(to.pos, to.quat, this.engine.plan ? 45 : 45, () => {})
  }

  private syncOrbitFromCamera() {
    const off = new THREE.Vector3().subVectors(this.camera.position, this.target)
    this.radius = off.length()
    this.maxRadius = Math.max(120, this.radius)
    this.polar = Math.acos(THREE.MathUtils.clamp(off.y / this.radius, -1, 1))
    this.azimuth = Math.atan2(off.x, off.z)
  }

  private viewPose(v: CameraView): CameraPose {
    const pos = new THREE.Vector3(...v.pos)
    const target = new THREE.Vector3(...v.target)
    if (v.id === 'tour-hero' && this.camera.aspect < 0.85) {
      pos.sub(target).multiplyScalar(Math.min(2.4, 1.1 / this.camera.aspect)).add(target)
    } else if (v.kind === 'orbit' && this.mode !== 'dollhouse' && this.engine.plan?.levels && this.camera.aspect < 0.9) {
      const fit = Math.min(2.5, 1.18 / this.camera.aspect)
      pos.sub(target).multiplyScalar(fit).add(target)
    } else if (v.kind === 'orbit' && v.id === 'hero' && this.camera.aspect < 0.8) {
      pos.sub(target).multiplyScalar(Math.min(1.55, 0.78 / this.camera.aspect)).add(target)
    }
    const fov = (v.fov ?? (v.kind === 'walk' ? 64 : 50)) + (v.kind === 'walk' && this.camera.aspect < 0.8 ? 6 : 0)
    return { mode: v.kind === 'orbit' && this.mode === 'dollhouse' ? 'dollhouse' : v.kind, pos: pos.toArray(), target: v.target, fov }
  }

  goToView(view: CameraView, animate = true) {
    this.goToPose(this.viewPose(view), animate)
  }

  goToTourView(view: CameraView, reducedMotion: boolean, arrived: () => void) {
    const destination = { ...this.viewPose(view), mode: view.kind }
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
      if (mesh.isMesh && !mesh.userData.shadowOnly && !Array.isArray(mesh.material) && mesh.material.colorWrite) solids.push(mesh)
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
    const distance = this.mode === 'walk' ? 10 : Math.max(0.1, cam.position.distanceTo(this.target))
    const target = cam.getWorldDirection(new THREE.Vector3()).multiplyScalar(distance).add(cam.position)
    return { mode: this.mode, pos: cam.position.toArray(), target: target.toArray(), fov: cam.fov }
  }

  atView(view: CameraView) {
    const expected = this.viewPose(view)
    const direction = new THREE.Vector3(...expected.target).sub(new THREE.Vector3(...expected.pos)).normalize()
    return !this.tween && this.mode === view.kind && Math.abs(this.camera.fov - expected.fov) < 0.01 &&
      this.camera.position.distanceToSquared(new THREE.Vector3(...expected.pos)) < 0.0001 &&
      direction.dot(this.camera.getWorldDirection(new THREE.Vector3())) > 0.999999
  }

  goToPose(pose: CameraPose, animate = false, arrived?: () => void, duration?: number) {
    this.walkTarget = null
    this.walkWaypoints = []
    this.vAz = this.vPol = this.vYaw = this.vPitch = 0
    this.tween = null
    const { mode, fov } = pose
    const pos = new THREE.Vector3(...pose.pos)
    const target = new THREE.Vector3(...pose.target)
    const m = new THREE.Matrix4().lookAt(pos, target, new THREE.Vector3(0, 1, 0))
    const quat = new THREE.Quaternion().setFromRotationMatrix(m)
    const finish = () => {
      this.syncFromCamera(target)
      this.holdPose = true
    }
    const house = this.engine.house
    if (house && (mode === 'dollhouse') !== this.engine.dollhouse) {
      const hide = mode === 'dollhouse'
      house.roof.visible = !hide
      house.ceilings.visible = !hide
      this.engine.setDollhouse(hide)
    }
    this.mode = mode
    this.onModeChange?.(this.mode)
    if (animate) this.animateTo(pos, quat, fov, finish, arrived, duration)
    else {
      this.camera.position.copy(pos)
      this.camera.quaternion.copy(quat)
      this.camera.fov = fov
      this.camera.updateProjectionMatrix()
      finish()
      arrived?.()
    }
    this.engine.invalidate()
  }

  /** Stop a running camera move where it is, and carry on from that pose (no jump, no stale state). */
  interruptTween() {
    if (!this.tween) return
    this.tween = null
    this.syncFromCamera()
    this.holdPose = true
  }

  pauseTween(paused: boolean) {
    this.tweenPaused = paused
    if (!paused && this.tween && !this.engine.paused) this.engine.start()
  }

  private syncFromCamera(orbitTarget?: THREE.Vector3) {
    const cam = this.camera
    if (this.mode === 'walk') {
      const e = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ')
      this.yaw = e.y
      this.pitch = e.x
      const fh = this.floorHeight(cam.position.x, cam.position.z, cam.position.y - EYE)
      this.feet.set(cam.position.x, fh, cam.position.z)
      this.eyeY = cam.position.y - fh
    } else {
      if (orbitTarget) this.target.copy(orbitTarget)
      else this.target.copy(cam.getWorldDirection(new THREE.Vector3()).multiplyScalar(Math.max(2.5, this.radius)).add(cam.position))
      this.syncOrbitFromCamera()
    }
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
    this.engine.invalidate()
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

  private orbitPose() {
    const sp = Math.sin(this.polar)
    const pos = new THREE.Vector3(
      this.target.x + this.radius * sp * Math.sin(this.azimuth),
      this.target.y + this.radius * Math.cos(this.polar),
      this.target.z + this.radius * sp * Math.cos(this.azimuth),
    )
    // keep the camera above ground
    const g = (this.engine.site?.heightAt(pos.x, pos.z) ?? 0) + 0.35
    if (pos.y < g) pos.y = g
    const m = new THREE.Matrix4().lookAt(pos, this.target, new THREE.Vector3(0, 1, 0))
    return { pos, quat: new THREE.Quaternion().setFromRotationMatrix(m) }
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
    if (this.tween) {
      if (this.tweenPaused) return
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
    if (this.holdPose && !this.active) return
    this.holdPose = false
    if (this.mode === 'walk') this.updateWalk(dt)
    else this.updateOrbit(dt)
  }

  private updateOrbit(dt: number) {
    // inertia
    if (!this.pointers.size) {
      this.azimuth += this.vAz * dt
      this.polar += this.vPol * dt
      const damp = Math.exp(-dt * 6)
      this.vAz *= damp
      this.vPol *= damp
      if (Math.abs(this.vAz) < 1e-3) this.vAz = 0
      if (Math.abs(this.vPol) < 1e-3) this.vPol = 0
    }
    // keys orbit too
    const kx = (this.keys.has('ArrowLeft') || this.keys.has('a') ? 1 : 0) - (this.keys.has('ArrowRight') || this.keys.has('d') ? 1 : 0)
    const ky = (this.keys.has('ArrowUp') || this.keys.has('w') ? 1 : 0) - (this.keys.has('ArrowDown') || this.keys.has('s') ? 1 : 0)
    this.azimuth += kx * dt * 0.9
    this.radius *= 1 - ky * dt * 0.8
    const dh = this.mode === 'dollhouse'
    this.polar = THREE.MathUtils.clamp(this.polar, dh ? 0.15 : 0.12, dh ? 1.35 : 1.62)
    this.radius = THREE.MathUtils.clamp(this.radius, 2.5, this.maxRadius)
    const { pos, quat } = this.orbitPose()
    this.camera.position.copy(pos)
    this.camera.quaternion.copy(quat)
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

  private down = (e: PointerEvent) => {
    if (!this.enabled) return
    this.dom.setPointerCapture(e.pointerId)
    this.interruptTween()
    const suppressTap = this.onInteract?.() === true
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), suppressTap })
    this.vAz = this.vPol = this.vYaw = this.vPitch = 0
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()]
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y)
      this.pinchMid.set((a.x + b.x) / 2, (a.y + b.y) / 2)
    }
    this.engine.invalidate()
  }

  private move = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId)
    if (!p) return
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    if (!dx && !dy) return
    this.holdPose = false
    p.x = e.clientX
    p.y = e.clientY
    const h = this.dom.clientHeight || 800
    if (this.pointers.size === 1) {
      const pan = e.buttons === 2 || e.shiftKey
      if (this.mode === 'walk') {
        // grab the world: drag right turns left
        const k = (this.camera.fov * Math.PI) / 180 / h
        this.yaw += dx * k * 1.15
        this.pitch += dy * k * 1.15
        this.vYaw = (dx * k * 1.15) / Math.max(0.008, 1 / 60)
        this.vPitch = (dy * k * 1.15) / Math.max(0.008, 1 / 60)
        this.vYaw *= 0.35
        this.vPitch *= 0.35
      } else if (pan) {
        this.panOrbit(dx, dy)
      } else {
        const k = 4.2 / h
        this.azimuth -= dx * k
        this.polar -= dy * k
        this.vAz = -dx * k * 22
        this.vPol = -dy * k * 22
      }
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const mid = new THREE.Vector2((a.x + b.x) / 2, (a.y + b.y) / 2)
      const ratio = this.pinchDist > 0 ? dist / this.pinchDist : 1
      const mdx = mid.x - this.pinchMid.x
      const mdy = mid.y - this.pinchMid.y
      if (this.mode === 'walk') {
        // pinch apart = walk forward; two-finger drag = move (strafe / forward)
        const fwd = (ratio - 1) * 3.2 + (mdy / h) * 4
        const side = -(mdx / h) * 4
        const sin = Math.sin(this.yaw)
        const cos = Math.cos(this.yaw)
        this.walk(-sin * fwd + cos * side, -cos * fwd - sin * side)
      } else {
        this.radius /= Math.max(0.5, Math.min(2, ratio))
        this.panOrbit(mdx, mdy)
      }
      this.pinchDist = dist
      this.pinchMid.copy(mid)
    }
    this.engine.invalidate()
  }

  private up = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId)
    this.pointers.delete(e.pointerId)
    if (this.pointers.size < 2) this.pinchDist = 0
    if (!p) return
    const moved = Math.hypot(e.clientX - p.sx, e.clientY - p.sy)
    const quick = performance.now() - p.t < 320
    if (!p.suppressTap && e.type !== 'pointercancel' && moved < 8 && quick && this.pointers.size === 0) this.tap(e)
    this.engine.invalidate()
  }

  private wheel = (e: WheelEvent) => {
    if (!this.enabled) return
    e.preventDefault()
    this.interruptTween()
    this.holdPose = false
    const d = Math.sign(e.deltaY) * Math.min(1, Math.abs(e.deltaY) / 100)
    if (this.mode === 'walk') {
      const sin = Math.sin(this.yaw)
      const cos = Math.cos(this.yaw)
      this.walk(sin * d * 0.6, cos * d * 0.6)
    } else {
      this.radius *= 1 + d * 0.12
    }
    this.onInteract?.()
    this.engine.invalidate()
  }

  private panOrbit(dx: number, dy: number) {
    const h = this.dom.clientHeight || 800
    const k = (this.radius * 1.1) / h
    const right = new THREE.Vector3(Math.cos(this.azimuth), 0, -Math.sin(this.azimuth))
    const fwd = new THREE.Vector3(Math.sin(this.azimuth), 0, Math.cos(this.azimuth))
    this.target.addScaledVector(right, -dx * k)
    if (this.polar < 0.9) this.target.addScaledVector(fwd, -dy * k)
    else this.target.y += dy * k
    this.target.y = THREE.MathUtils.clamp(this.target.y, 0.3, 12)
    this.target.x = THREE.MathUtils.clamp(this.target.x, this.bounds.minX, this.bounds.maxX)
    this.target.z = THREE.MathUtils.clamp(this.target.z, this.bounds.minZ, this.bounds.maxZ)
  }

  private pick(e: PointerEvent): THREE.Intersection | null {
    const r = this.dom.getBoundingClientRect()
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    this.raycaster.setFromCamera(ndc, this.camera)
    const roots: THREE.Object3D[] = []
    const h = this.engine.house
    if (h) roots.push(h.shell, h.interior, h.outdoor, ...(h.roof.visible ? [h.roof] : []), ...(h.ceilings.visible ? [h.ceilings] : []))
    if (this.engine.interior) roots.push(this.engine.interior.group)
    const site = this.engine.site
    if (site) roots.push(...site.group.children.filter(c => c.name === 'terrain' || (c as THREE.Mesh).isMesh))
    const hits = this.raycaster.intersectObjects(roots, true).filter(x => {
      const m = x.object as THREE.Mesh
      return m.visible && (m.material as THREE.Material)?.name !== 'glass'
    })
    return hits[0] ?? null
  }

  private tap(e: PointerEvent) {
    const hit = this.pick(e)
    if (this.mode === 'walk') {
      if (!hit) return
      const n = hit.face?.normal.clone().transformDirection(hit.object.matrixWorld) ?? new THREE.Vector3(0, 1, 0)
      const to = hit.point.clone()
      if (n.y < 0.6) {
        // a wall: stop half a metre in front of it
        const back = new THREE.Vector3(this.feet.x - to.x, 0, this.feet.z - to.z).normalize().multiplyScalar(0.55)
        to.add(back)
      }
      this.walkWaypoints = this.stairRoute(to)
      this.walkTarget = this.walkWaypoints.shift() ?? to
      this.onWalkTo?.(hit.point.clone())
    } else if (this.mode === 'dollhouse') {
      if (!hit) return
      // tap a floor -> walk in there, looking across the room
      const p = hit.point
      this.feet.set(p.x, this.floorHeight(p.x, p.z, p.y), p.z)
      const c = this.engine.house?.bounds.getCenter(new THREE.Vector3()) ?? new THREE.Vector3()
      this.yaw = Math.atan2(-(c.x - p.x) || 0.001, -(c.z - p.z) || 0.001) + Math.PI
      this.pitch = -0.05
      this.eyeY = EYE
      const h = this.engine.house
      if (h) {
        h.roof.visible = true
        h.ceilings.visible = true
        this.engine.setDollhouse(false)
      }
      this.mode = 'walk'
      const pose = this.walkPose()
      this.animateTo(pose.pos, pose.quat, this.walkFov(), () => {})
      this.onModeChange?.('walk')
    } else {
      this.onTap?.(hit, e)
    }
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
      this.interruptTween()
      this.onInteract?.()
      this.engine.invalidate()
    }
  }

  private keyup = (e: KeyboardEvent) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
    this.keys.delete(k)
    if (!e.shiftKey) this.keys.delete('Shift')
  }

  /** Keep the loop running while a key is held or the joystick is used. */
  get active() {
    return this.keys.size > 0 || this.moveInput.lengthSq() > 0 || !!this.walkTarget || (!!this.tween && !this.tweenPaused) || Math.abs(this.vAz) + Math.abs(this.vPol) + Math.abs(this.vYaw) + Math.abs(this.vPitch) > 0.002
  }

  dispose() {
    this.dom.removeEventListener('pointerdown', this.down)
    this.dom.removeEventListener('pointermove', this.move)
    this.dom.removeEventListener('pointerup', this.up)
    this.dom.removeEventListener('pointercancel', this.up)
    this.dom.removeEventListener('wheel', this.wheel)
    window.removeEventListener('keydown', this.keydown)
    window.removeEventListener('keyup', this.keyup)
  }
}
