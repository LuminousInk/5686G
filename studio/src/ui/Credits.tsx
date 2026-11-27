import objaverse from '../../tools/objaverse.json'
import models from '../../tools/model-credits.json'
import art from '../../public/assets/art/manifest.json'

const modelCredits = Object.entries(models)
const polyHaven = modelCredits.filter(([, model]) => model.provider === 'Poly Haven')
const khronos = modelCredits.filter(([, model]) => model.provider === 'Khronos')

function modelLinks(credits: ReadonlyArray<[string, { title: string; author: string; source: string }]>) {
  return credits.map(([id, { title, author, source }], i) => (
    <span key={id}>
      {i ? ', ' : ''}
      <a href={source} target="_blank" rel="noreferrer">{title}</a> by {author}
    </span>
  ))
}

export function Credits() {
  return (
    <>
      <p>
        Skies and textures by Poly Haven (CC0). Trees by ez-tree (MIT).
      </p>
      <p>
        Finish maps (CC0){' '}
        <a href="https://polyhaven.com/a/oak_wood_planks" target="_blank" rel="noreferrer">Oak Wood Planks</a> by Dimitrios Savva via Poly Haven.
        {' '}<a href="https://ambientcg.com/view?id=Marble019" target="_blank" rel="noreferrer">Marble 019</a>,{' '}
        <a href="https://ambientcg.com/view?id=Tiles142" target="_blank" rel="noreferrer">Tiles 142</a> and{' '}
        <a href="https://ambientcg.com/view?id=Plaster001" target="_blank" rel="noreferrer">Plaster 001</a> by ambientCG.
      </p>
      <p>
        Models from Poly Haven and Khronos glTF Sample Assets (CC0). {modelLinks(polyHaven)}. {modelLinks(khronos)}.
      </p>
      <p>
        Models from Sketchfab via Objaverse (
        <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>).
        {' '}{modelLinks(Object.entries(objaverse))}. Adapted for the studio with mesh and texture optimization, material edits and placement.
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
