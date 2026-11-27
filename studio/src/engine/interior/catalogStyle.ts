export const INTERIOR_STYLES = {
  woodland: { kitchen: 'oliveCabinet', metal: 'bronze', pendant: 'bronze', bedAccent: false },
  coastal: { kitchen: 'sageCabinet', metal: 'brass', pendant: 'brass', bedAccent: false },
  desert: { kitchen: 'cabinet', metal: 'agedBrass', pendant: 'ivory', bedAccent: true },
} as const

export type InteriorStyle = (typeof INTERIOR_STYLES)[keyof typeof INTERIOR_STYLES]

export function interiorStyle(planId: string): InteriorStyle {
  if (planId === 'coastal-modern') return INTERIOR_STYLES.coastal
  if (planId === 'modern-farmhouse') return INTERIOR_STYLES.desert
  return INTERIOR_STYLES.woodland
}
