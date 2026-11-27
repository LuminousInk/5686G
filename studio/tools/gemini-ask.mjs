#!/usr/bin/env node
// One-shot Gemini API call (text + optional images), for batch "swarm" jobs that fit a free-tier key better than an
// agent loop: an agent re-sends its whole context every step, a one-shot call sends it once.
//
//   node tools/gemini-ask.mjs --model gemini-3-flash-preview --prompt brief.txt [--image a.jpg ...] [--json] --out result.txt
//
// The key comes from GEMINI_API_KEY, or from a network secret that the session proxy adds to requests to
// generativelanguage.googleapis.com (then run with NODE_USE_ENV_PROXY=1 so fetch goes through the proxy).
// Retries on 429 / 503 with the delay the API suggests.
import { readFileSync, writeFileSync } from 'node:fs'
import { extname } from 'node:path'

const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i < 0 ? def : args[i + 1]
}
const images = args.flatMap((a, i) => (a === '--image' ? [args[i + 1]] : []))
const model = opt('model', 'gemini-3-flash-preview')
const prompt = readFileSync(opt('prompt'), 'utf8')
const out = opt('out')
const json = args.includes('--json')
const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }

const body = {
  contents: [
    {
      role: 'user',
      parts: [
        ...images.map(f => ({ inline_data: { mime_type: mime[extname(f).toLowerCase()] ?? 'image/png', data: readFileSync(f).toString('base64') } })),
        { text: prompt },
      ],
    },
  ],
  generationConfig: json ? { responseMimeType: 'application/json' } : {},
}
const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
const headers = { 'content-type': 'application/json' }
if (process.env.GEMINI_API_KEY) headers['x-goog-api-key'] = process.env.GEMINI_API_KEY

for (let attempt = 0; attempt < 8; attempt++) {
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) }).catch(e => ({ ok: false, status: 0, text: async () => String(e) }))
  if (res.ok) {
    const data = await res.json()
    const text = (data.candidates?.[0]?.content?.parts ?? []).map(p => p.text ?? '').join('')
    if (out) writeFileSync(out, text)
    else process.stdout.write(text + '\n')
    process.exit(0)
  }
  const err = await res.text()
  if (res.status !== 429 && res.status !== 503 && res.status !== 0) {
    console.error(`HTTP ${res.status}: ${err.slice(0, 400)}`)
    process.exit(1)
  }
  if (/limit: 0\b/.test(err) || /exceeded your current quota/.test(err) && !/per minute/i.test(err)) {
    console.error(`quota exhausted for ${model}: ${err.slice(0, 300)}`)
    process.exit(2)
  }
  const wait = Number(/retry in ([\d.]+)s/.exec(err)?.[1] ?? 10 * (attempt + 1))
  console.error(`HTTP ${res.status}, retrying in ${Math.ceil(wait)} s`)
  await new Promise(r => setTimeout(r, Math.ceil(wait + 1) * 1000))
}
console.error('gave up')
process.exit(1)
