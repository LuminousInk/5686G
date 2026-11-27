const CREATORS = [
  '13213213213', 'allenbranch', 'CioJay', 'classe-saga', 'crosslag', 'dearsindy', 'mohitoz', 'olamii',
  'Pablo.Portela', 'TabbieCat', 'trendforward', 'ubaid.kfat', 'wadeedchishty', 'williamozelimtorres', 'zhousongjiang',
]

export function Credits() {
  return (
    <p>
      Skies, textures, plants and some furniture: Poly Haven (CC0). Sofas and chairs: Wayfair via the Khronos glTF
      Sample Assets (CC BY 4.0). Furniture and fixtures from Sketchfab creators via Objaverse (CC BY 4.0):{' '}
      {CREATORS.join(', ')}. Trees: ez-tree (MIT).
    </p>
  )
}
