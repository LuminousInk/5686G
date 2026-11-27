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
