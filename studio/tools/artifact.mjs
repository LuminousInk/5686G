// Prepares the production build for publishing as a claude.ai Artifact.
//  - dist/artifact.html: the page body (the host adds doctype/html/head/body), with title + side-gutter meta
//  - dist/artifact-files.json: { "<published path>": { from, contentType } } for every supporting file
// Run after `npm run build`.
import fs from 'node:fs'
import path from 'node:path'

const dist = path.resolve('dist')
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8')
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1]
const keep = head
  .split('\n')
  .map(l => l.trim())
  .filter(l => l && !l.startsWith('<meta charset') && !l.startsWith('<title'))
const page = [
  '<title>Cuby Studio</title>',
  '<meta name="claude:viewport-fit-sides" content="cover">',
  ...keep,
  body.trim(),
].join('\n')
fs.writeFileSync(path.join(dist, 'artifact.html'), page + '\n')

const types = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.png': 'image/png',
}
const files = {}
let total = 0
const walk = dir => {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const rel = path.relative(dist, p).split(path.sep).join('/')
    if (fs.statSync(p).isDirectory()) walk(p)
    else if (!['index.html', 'artifact.html', 'artifact-files.json'].includes(rel)) {
      const ext = path.extname(name)
      files[rel] = { from: path.relative(process.cwd(), p), contentType: types[ext] ?? 'application/octet-stream' }
      total += fs.statSync(p).size
    }
  }
}
walk(dist)
fs.writeFileSync(path.join(dist, 'artifact-files.json'), JSON.stringify(files, null, 1))
console.log(`artifact.html ${page.length} bytes, ${Object.keys(files).length} files, ${(total / 1e6).toFixed(1)} MB`)
const big = Object.entries(files).filter(([, v]) => fs.statSync(v.from).size > 15e6)
if (big.length) console.log('TOO BIG:', big.map(([k]) => k))
