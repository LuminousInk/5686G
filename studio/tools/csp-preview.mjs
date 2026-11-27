// Serves dist/ the way a locked-down host would: a strict Content-Security-Policy, so features that a plain
// `vite preview` allows but an artifact host may block (WebAssembly, fetching data: or blob: URLs) fail here too.
//
//   node tools/csp-preview.mjs [port] [distDir]   then BASE=http://localhost:4174/ node tools/interact.mjs
//   CSP="..." node tools/csp-preview.mjs     to try a different policy
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const port = Number(process.argv[2] ?? 4174)
const root = path.resolve(process.argv[3] ?? 'dist')
const csp =
  process.env.CSP ??
  [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'", // no 'wasm-unsafe-eval' / 'unsafe-eval'
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "media-src 'self' data: blob:",
    "connect-src 'self'", // fetch() of data: or blob: URLs is refused
    "worker-src 'self' blob:",
  ].join('; ')

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
}

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    let file = path.join(root, decodeURIComponent(url.pathname))
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403).end()
      return
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
    if (!fs.existsSync(file)) {
      res.writeHead(404).end('not found')
      return
    }
    res.writeHead(200, {
      'Content-Type': types[path.extname(file)] ?? 'application/octet-stream',
      'Content-Security-Policy': csp,
      'Cache-Control': 'no-store',
    })
    fs.createReadStream(file).pipe(res)
  })
  .listen(port, () => console.log(`${path.relative(process.cwd(), root)}/ with CSP on http://localhost:${port}/\n  ${csp}`))
