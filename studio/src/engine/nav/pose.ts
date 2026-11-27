export type NavMode = 'orbit' | 'walk' | 'dollhouse'

export interface CameraPose {
  mode: NavMode
  pos: [number, number, number]
  target: [number, number, number]
  fov: number
}
