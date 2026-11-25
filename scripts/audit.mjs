#!/usr/bin/env node
// Static security audit: checks the promises in SECURITY.md against the source, with no
// dependencies and no network. Runs in CI and in `npm run check`. Exit code 1 on any finding.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const findings = []
const fail = (file, message) => findings.push(`${file}: ${message}`)

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

const rel = (path) => relative(root, path).split(sep).join('/')
const src = files(join(root, 'src')).filter((path) => /\.(ts|html|css)$/.test(path))

const ALLOWED_HOSTS = new Set(['api.vapi.ai', 'dashboard.vapi.ai'])
const MAX_SOURCE_BYTES = 1024 * 1024

const RULES = [
  { pattern: /\beval\s*\(|new\s+Function\s*\(/, message: 'eval / new Function is not allowed' },
  {
    pattern: /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML\s*\(|document\.write\s*\(/,
    message: 'HTML injection sinks are not allowed; use textContent'
  },
  { pattern: /from\s+['"]node:|\brequire\s*\(|import\s*\(\s*['"]node:/, message: 'Node built-ins (fs, net, child_process, ...) are not used' },
  { pattern: /\bconsole\.(log|error|warn|info|debug)\s*\(/, message: 'console output is not allowed (use orca.log with scrub)' },
  { pattern: /['"](PUT|PATCH|DELETE)['"]/, message: 'write HTTP methods must not appear in source' },
  { pattern: /TEMP-DEBUG/, message: 'leftover temporary debug code' }
]

for (const path of src) {
  const file = rel(path)
  const text = readFileSync(path, 'utf8')
  if (statSync(path).size > MAX_SOURCE_BYTES) fail(file, 'over 1 MiB (Orca transpile limit)')

  for (const rule of RULES) if (rule.pattern.test(text)) fail(file, rule.message)

  for (const match of text.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) {
    if (match[0].startsWith('http://')) fail(file, `plain http URL: ${match[0]}`)
    if (!ALLOWED_HOSTS.has(match[1])) fail(file, `host not on the allowlist: ${match[1]}`)
  }

  if (/\bfetch\s*\(/.test(text) && file !== 'src/worker/http.ts') {
    fail(file, 'network calls are only allowed in src/worker/http.ts')
  }

  if (file.startsWith('src/panel/') && /\b(orca\.)?secrets\.(get|set|delete)\s*\(|orca\.secrets\b/.test(text)) {
    fail(file, 'the panel must never touch secrets')
  }
}

const manifest = JSON.parse(readFileSync(join(root, 'orca-plugin.json'), 'utf8'))
const capabilities = (manifest.capabilities ?? []).map((cap) => cap.kind).sort()
if (JSON.stringify(capabilities) !== JSON.stringify(['secrets:own'])) {
  fail('orca-plugin.json', `capabilities must be exactly secrets:own, got ${capabilities.join(', ')}`)
}
if (/\borca\.storage\b|['"]storage\.(get|set|delete|keys)['"]/.test(src.map((p) => readFileSync(p, 'utf8')).join('\n'))) {
  fail('src', 'storage is used but storage:own is not declared')
}
if (manifest.execution !== 'trusted-worker') fail('orca-plugin.json', 'unexpected execution profile')
for (const key of ['events', 'hooks', 'keybindings', 'customEditors']) {
  if (manifest.contributes?.[key]) fail('orca-plugin.json', `unexpected contribution: ${key}`)
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
  fail('package.json', 'runtime dependencies are not allowed')
}

const IMAGE_LIMITS = { [manifest.icon]: 256 * 1024, [manifest.cover?.path]: 1024 * 1024 }
for (const [path, limit] of Object.entries(IMAGE_LIMITS)) {
  if (!path || path === 'undefined') continue
  const size = statSync(join(root, path)).size
  if (size > limit) fail(path, `image is ${size} bytes, over ${limit}`)
}

if (findings.length) {
  console.error(`Security audit: ${findings.length} finding(s)`)
  for (const finding of findings) console.error(`  - ${finding}`)
  process.exit(1)
}
console.log(`Security audit: ok (${src.length} source files checked)`)
