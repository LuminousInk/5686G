import type { CameraPose } from '../engine/nav/pose'

const modes = { o: 'orbit', w: 'walk', d: 'dollhouse' } as const
const MAX_METRES = 2000

// Millimetres and hundredths of a degree, packed in base 36. Zigzag keeps signs out of the hash.
export function encodePose({ mode, pos, target, fov }: CameraPose) {
  const key = mode === 'walk' ? 'w' : mode === 'dollhouse' ? 'd' : 'o'
  const values = [...pos, ...target, fov].map((value, i) => Math.round(value * (i === 6 ? 100 : 1000)))
  const code = [key, ...values.map(n => (n < 0 ? -2 * n - 1 : 2 * n).toString(36))].join('-')
  return decodePose(code) ? code : undefined
}

export function decodePose(code: string): CameraPose | undefined {
  const [key, ...parts] = code.split('-')
  if (!(key === 'o' || key === 'w' || key === 'd') || parts.length !== 7 ||
      parts.some(part => !/^[a-z0-9]{1,5}$/.test(part))) return
  const values = parts.map((part, i) => {
    const n = parseInt(part, 36)
    return (n % 2 ? -(n + 1) / 2 : n / 2) / (i === 6 ? 100 : 1000)
  })
  const [x, y, z, tx, ty, tz, fov] = values
  if (fov < 15 || fov > 100 || values.slice(0, 6).some(n => Math.abs(n) > MAX_METRES) ||
      Math.hypot(tx - x, ty - y, tz - z) < 0.01) return
  return { mode: modes[key], pos: [x, y, z], target: [tx, ty, tz], fov }
}
