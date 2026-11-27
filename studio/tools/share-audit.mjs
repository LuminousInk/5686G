// Heuristic check for the public-sharing review. Run after building: node tools/share-audit.mjs [distDir].
import { readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'

const allowed = new Set('html js css json txt png jpg jpeg gif webp mp4 webm mp3 wav'.split(' '))
const largeJson = 1024 * 1024
const root = resolve(process.argv[2] ?? 'dist')

// Catch MIME-bearing data URLs as well as bare, long base64 strings in data files.
const dataUri = /\bdata:[\w/+.;=:%-]*,[^\s"'<>]+/i
const base64 = /(?:^|[^\w+/-])[\w+/-]{128,}={0,2}(?![\w+/-])/
const labeledBase64 = /\bbase64\s*[:=]\s*[\w+/-]{4,}={0,2}\s*$/im
const base64Value = /^(?:[\w+/-]{4})*(?:[\w+/-]{4}|[\w+/-]{3}=|[\w+/-]{2}==)$/
const hasPayload = value => dataUri.test(value) || base64.test(value) || labeledBase64.test(value)

function jsonHasPayload(text) {
  // The parser also exposes escaped content, such as a JSON string with an escaped colon.
  try {
    let found = false
    JSON.parse(text, (key, value) => {
      found ||= hasPayload(key) || (typeof value === 'string' &&
        (hasPayload(value) || (key.toLowerCase() === 'base64' && base64Value.test(value))))
      return value
    })
    return found
  } catch {
    return hasPayload(text)
  }
}

function audit(dir, issues) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name)
    if (entry.isDirectory()) {
      audit(file, issues)
      continue
    }
    const type = extname(entry.name).slice(1).toLowerCase()
    const reasons = []
    if (!entry.isFile()) reasons.push('not a regular file')
    else if (!allowed.has(type)) reasons.push(type ? `unsupported file type .${type}` : 'missing file extension')
    else if (type === 'json' || type === 'txt') {
      const data = readFileSync(file)
      const text = data.toString('utf8')
      if (type === 'json' ? jsonHasPayload(text) : hasPayload(text)) reasons.push('inline base64 or data URI payload')
      if (type === 'json' && data.length >= largeJson) reasons.push(`large JSON (${data.length} bytes, threshold ${largeJson})`)
    } else if (type === 'html' || type === 'css') {
      if (dataUri.test(readFileSync(file, 'utf8'))) reasons.push('inline data URI payload')
    }
    if (reasons.length) issues.push(`${relative(root, file)} — ${reasons.join(', ')}`)
  }
}

try {
  const issues = []
  audit(root, issues)
  for (const issue of issues.sort()) console.log(issue)
  if (issues.length) {
    console.error(`Public-sharing audit flagged ${issues.length} file(s).`)
    process.exitCode = 1
  } else console.log('Public-sharing audit passed.')
} catch (error) {
  console.error(`Could not audit ${root}: ${error.message}`)
  process.exitCode = 1
}
