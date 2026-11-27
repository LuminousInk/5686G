// Cuts the plan-card thumbnails (public/thumbs/<plan>.webp, 960×480) from the website's golden-hour elevation
// renders (public/gallery/<plan>-golden.webp), so the studio's home picker matches the website gallery.
//   node tools/thumbs-from-gallery.mjs [plan-id ...]
import sharp from 'sharp'

const plans = process.argv.slice(2)
const ids = plans.length ? plans : ['cedar-ridge', 'coastal-modern', 'woodland-modern', 'aspen-custom', 'modern-farmhouse']
for (const id of ids) {
  const src = new URL(`../public/gallery/${id}-golden.webp`, import.meta.url)
  const dst = new URL(`../public/thumbs/${id}.webp`, import.meta.url)
  // 16:9 → 2:1 keeps the full width and trims sky and foreground evenly (extract after resize crops the result).
  const info = await sharp(src).resize(960, 540).extract({ left: 0, top: 30, width: 960, height: 480 }).webp({ quality: 82 }).toFile(dst.pathname)
  console.log('thumb', id, `${info.width}×${info.height}`, info.size)
}
