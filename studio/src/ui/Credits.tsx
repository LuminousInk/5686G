import objaverse from '../../tools/objaverse.json'
import art from '../../public/assets/art/manifest.json'

/** Asset credits, shared by the studio help sheet and the website footer. Objaverse entries come from the manifest. */
const objaverseCredits = Object.entries(objaverse as Record<string, { title: string; author: string; source: string }>)

export function Credits() {
  return (
    <>
      <p>
        Skies, textures, plants and some furniture by Poly Haven (CC0). GlamVelvetSofa and SheenChair by Wayfair via
        the Khronos glTF Sample Assets (CC BY 4.0). Trees by ez-tree (MIT).
      </p>
      <p>
        Finish maps (CC0){' '}
        <a href="https://polyhaven.com/a/oak_wood_planks" target="_blank" rel="noreferrer">Oak Wood Planks</a> by Dimitrios Savva via Poly Haven.
        {' '}<a href="https://ambientcg.com/view?id=Marble019" target="_blank" rel="noreferrer">Marble 019</a>,{' '}
        <a href="https://ambientcg.com/view?id=Tiles142" target="_blank" rel="noreferrer">Tiles 142</a> and{' '}
        <a href="https://ambientcg.com/view?id=Plaster001" target="_blank" rel="noreferrer">Plaster 001</a> by ambientCG.
      </p>
      <p>
        Atmosphere by Takram three-geospatial (MIT) and Eric Bruneton / INRIA, Precomputed Atmospheric
        Scattering (BSD-3-Clause).
      </p>
      <p>
        Furniture and fixtures from Sketchfab creators via Objaverse, CC BY 4.0:{' '}
        {objaverseCredits.map(([id, { title, author, source }], i) => (
          <span key={id}>
            {i ? ', ' : ''}
            <a href={source} target="_blank" rel="noreferrer">{title}</a> by {author}
          </span>
        ))}
        .
      </p>
      <p>
        Open-access artwork from the Art Institute of Chicago (CC0 1.0).{' '}
        {Object.entries(art).map(([id, { title, artist, source }], i) => (
          <span key={id}>
            {i ? ', ' : ''}
            <a href={source} target="_blank" rel="noreferrer">{title}</a> by {artist}
          </span>
        ))}
        .
      </p>
    </>
  )
}
