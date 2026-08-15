/**
 * Smoke test for dsh-file-attach host half: pure helpers + the upload route
 * handler driven through a minimal fake cordis context (no cordis install).
 * Run: node test/smoke.mjs
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { apply, sanitizeFileName, markerFor, UPLOAD_PATH, MAX_FILE_BYTES } from '../src/index.js'

// ── pure helpers ─────────────────────────────────────────────────────────────
assert.equal(sanitizeFileName('report.pdf'), 'report.pdf')
assert.equal(sanitizeFileName('../evil.txt'), 'evil.txt')
assert.equal(sanitizeFileName('a/b/c.txt'), 'c.txt')
assert.equal(sanitizeFileName('a\\b\\c.txt'), 'c.txt')
assert.equal(sanitizeFileName('  spaced  .md  '), 'spaced  .md')
assert.throws(() => sanitizeFileName('..'))
assert.throws(() => sanitizeFileName('.'))
assert.throws(() => sanitizeFileName(''))
assert.throws(() => sanitizeFileName('   '))
assert.throws(() => sanitizeFileName(null))
assert.throws(() => sanitizeFileName(undefined))

const marker = markerFor('.dsh-uploads/sess-1/a b.pdf')
assert.equal(marker, '📎 .dsh-uploads/sess-1/a b.pdf')
const parenMarker = markerFor('.dsh-uploads/sess-1/my notes (1).pdf')
assert.equal(parenMarker, '📎 .dsh-uploads/sess-1/my notes (1).pdf', 'parens in names survive')
assert.equal(markerFor('.dsh-uploads/sess-1/x/y.pdf'), null)
assert.equal(markerFor('nope'), null)
assert.equal(markerFor(''), null)

// ── route handler through a fake ctx ─────────────────────────────────────────
const work = await mkdtemp(join(tmpdir(), 'dsh-file-attach-smoke-'))
const cwd = join(work, 'workspace')
try {
  let captured = null
  const sections = []
  const fakeCtx = {
    webServer: {
      register: (route) => {
        captured = route
        return () => {
          captured = null
        }
      }
    },
    sessions: {
      get: (id) => (id === 'sess-1' ? { header: { cwd } } : undefined)
    },
    systemPrompt: {
      section: (section) => {
        sections.push(section)
      }
    },
    logger: { warn: () => {} },
    effect: (fn) => fn()
  }
  apply(fakeCtx)
  assert.ok(captured !== null, 'route registered')
  assert.equal(captured.kind, 'exact')
  assert.equal(captured.path, UPLOAD_PATH)
  assert.equal(sections.length, 1)
  assert.ok(sections[0].text().includes('.dsh-uploads'), 'prompt section mentions the store')

  const handler = captured.handler

  function request({ method = 'POST', body = null }) {
    const req = new EventEmitter()
    req.method = method
    req.headers = {}
    req.destroy = () => {}
    const res = {
      status: 0,
      payload: '',
      writeHead(status, headers) {
        this.status = status
        this.headers = headers
      },
      end(text) {
        this.payload = text ?? ''
      }
    }
    const done = handler(req, res)
    if (body !== null) {
      req.emit('data', Buffer.from(body))
    }
    req.emit('end')
    return Promise.resolve(done).then(() => ({ req, res }))
  }

  // happy path
  const content = 'hello attached world'
  const base64 = Buffer.from(content).toString('base64')
  let { res } = await request({ body: JSON.stringify({ sessionId: 'sess-1', name: 'note.txt', mime: 'text/plain', base64 }) })
  assert.equal(res.status, 200, 'upload accepted')
  const parsed = JSON.parse(res.payload)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.relativePath, '.dsh-uploads/sess-1/note.txt')
  assert.equal(parsed.marker, '📎 .dsh-uploads/sess-1/note.txt')
  const stored = await readFile(join(cwd, '.dsh-uploads/sess-1/note.txt'), 'utf8')
  assert.equal(stored, content, 'file content round-trips')

  // traversal is neutralized
  await request({ body: JSON.stringify({ sessionId: 'sess-1', name: '../../evil.txt', base64: Buffer.from('x').toString('base64') }) })
  const evil = join(cwd, '.dsh-uploads/sess-1/evil.txt')
  assert.equal(await readFile(evil, 'utf8'), 'x', 'traversal name sanitized')

  // method guard
  ;({ res } = await request({ method: 'GET' }))
  assert.equal(res.status, 405)

  // unknown session
  ;({ res } = await request({ body: JSON.stringify({ sessionId: 'ghost', name: 'a.txt', base64: Buffer.from('x').toString('base64') }) }))
  assert.equal(res.status, 404)

  // sessionId shape guard (path-join safety, defense in depth)
  for (const badId of ['../etc', 'a/b', 'a\\b', 'sess 1', 'sess\n1', 'sess/../../x']) {
    ;({ res } = await request({ body: JSON.stringify({ sessionId: badId, name: 'a.txt', base64: Buffer.from('x').toString('base64') }) }))
    assert.equal(res.status, 400, `sessionId ${JSON.stringify(badId)} rejected`)
  }
  ;({ res } = await request({ body: JSON.stringify({ name: 'a.txt', base64: 'eA==' }) }))
  assert.equal(res.status, 400, 'missing sessionId rejected')

  // bad payloads
  ;({ res } = await request({ body: JSON.stringify({ sessionId: 'sess-1', name: '..', base64: 'eA==' }) }))
  assert.equal(res.status, 400)
  ;({ res } = await request({ body: JSON.stringify({ sessionId: 'sess-1', name: 'a.txt', base64: '' }) }))
  assert.equal(res.status, 400)
  ;({ res } = await request({ body: 'not json' }))
  assert.equal(res.status, 400)

  // oversize file
  const big = Buffer.alloc(MAX_FILE_BYTES + 1, 7)
  ;({ res } = await request({ body: JSON.stringify({ sessionId: 'sess-1', name: 'big.bin', base64: big.toString('base64') }) }))
  assert.equal(res.status, 413)

  // oversized body (content cap) — 33MB of padding
  ;({ res } = await request({ body: '{"x":"' + 'a'.repeat(33 * 1024 * 1024) + '"}' }))
  assert.equal(res.status, 413)

  // disposer removes the route
  assert.ok(captured !== null)
  fakeCtx.effect(() => {}) // no-op: the registered disposer was already returned
  // re-apply to exercise the effect return contract
  let disposed = false
  fakeCtx.effect = (fn) => {
    const disposer = fn()
    if (typeof disposer === 'function') {
      disposed = true
      disposer()
    }
  }
  apply(fakeCtx)
  assert.equal(disposed, true, 'effect returns the route disposer')
  assert.equal(captured, null, 'disposer unregisters the route')

  console.log('smoke: all assertions passed')
} finally {
  await rm(work, { recursive: true, force: true })
}
