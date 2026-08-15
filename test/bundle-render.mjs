/**
 * Executes the client bundle in Node with a simulated browser module loader,
 * runs its apply() against a stub cordis ctx, and SSR-renders both composer
 * occupants to prove the wiring and marker round-trip.
 *
 * Run: node test/bundle-render.mjs   (requires react/react-dom + primitives
 * from the DSH installation; point DSH_NODE_MODULES there if not default).
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { register } from 'node:module'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

// The primitives package's ESM source imports CSS side-effect files; Node
// cannot load them, so stub those imports out for this harness.
register('./css-stub-loader.mjs', import.meta.url)

const NODE_MODULES = process.env.DSH_NODE_MODULES ?? '/Users/panda/.npm/_npx/1e7f6d9597241db0/node_modules'
const require = createRequire(pathToFileURL(`${NODE_MODULES}/react/package.json`))

// ── simulate the browser shell globals the bundle touches ────────────────────
globalThis.window = globalThis

let loaded = null
window.__ModuleLoader__ = {
  load(entry) {
    loaded = entry
  }
}

// ── evaluate the bundle (data: URL keeps it in its own module scope) ─────────
const source = await readFile(new URL('../client/client.js', import.meta.url), 'utf8')
await import(`data:text/javascript,${encodeURIComponent(source)}`)
assert.ok(loaded !== null, 'bundle registered with the module loader')
assert.equal(loaded.id, 'dsh-file-attach')

// ── provide the factory's requires ───────────────────────────────────────────
const react = require('react')
const primitives = await import(pathToFileURL(`${NODE_MODULES}/@deepseek-ai/dsh-client-ui-primitives/lib/index.js`))
const req = (name) => {
  if (name === 'react') return react
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  throw new Error(`unexpected require: ${name}`)
}
const mod = loaded.factory(req)
assert.deepEqual(mod.inject, ['slots', 'locale'], 'service inject list')

// ── paste-claim predicate ────────────────────────────────────────────────────
const internals = mod.__internals
assert.ok(internals, 'test hooks exported')
const { shouldClaimPaste, isImageFile, parseMarkers } = internals
const file = (type) => ({ type })
assert.equal(isImageFile(file('image/png')), true)
assert.equal(isImageFile(file('image/webp')), true)
assert.equal(isImageFile(file('application/pdf')), false)
assert.equal(isImageFile(file('')), false, 'empty MIME (OS copies) counts as non-image')
assert.equal(shouldClaimPaste([file('application/pdf')]), true)
assert.equal(shouldClaimPaste([file('')]), true, 'Finder-copied files are claimed')
assert.equal(shouldClaimPaste([file('image/png')]), false, 'image paste stays native')
assert.equal(shouldClaimPaste([file('image/png'), file('application/pdf')]), false, 'mixed paste stays native (all-or-nothing)')
assert.equal(shouldClaimPaste([]), false, 'text-only paste is not claimed')
const parsedMarkers = parseMarkers('x\n📎 .dsh-uploads/s-1/a.txt\ny')
assert.equal(parsedMarkers.length, 1)
assert.equal(parsedMarkers[0].name, 'a.txt')
assert.equal(parsedMarkers[0].path, '.dsh-uploads/s-1/a.txt')
assert.equal(parseMarkers('📎 .dsh-uploads/a/b/c.txt').length, 0, 'deep paths are not markers')

// ── apply() against a stub ctx ───────────────────────────────────────────────
const registrations = []
const localeRegs = []
const ctx = {
  effect: (fn) => fn(),
  locale: {
    register(ns, dict) {
      localeRegs.push([ns, dict])
      return () => {}
    }
  },
  slots: {
    inject(name, cb) {
      return cb()
    },
    register(options, component) {
      registrations.push({ options, component })
      return () => {}
    }
  }
}
mod.apply(ctx)
assert.equal(localeRegs.length, 1, 'locale registered')
assert.equal(localeRegs[0][0], 'file-attach')
const en = localeRegs[0][1].en
const names = registrations.map((r) => r.options.name).sort()
assert.deepEqual(names, ['conversation.input.dock', 'conversation.input.left'], 'both composer slots registered')
assert.ok(registrations.every((r) => r.options.locale === 'file-attach'))

// ── render both occupants (SSR) ──────────────────────────────────────────────
const { renderToString } = require('react-dom/server')
const left = registrations.find((r) => r.options.name === 'conversation.input.left').component
const dock = registrations.find((r) => r.options.name === 'conversation.input.dock').component
const t = (key, params) => {
  let text = en[key] ?? key
  for (const [k, v] of Object.entries(params ?? {})) text = text.replace(`{${k}}`, String(v))
  return text
}
const noopActions = { setDraft: () => {}, submit: () => {} }
const useInputFor = (draft) => (sel) => sel({ draft })

// dock with one marker line in the draft → chip renders, remove control present
const dockHtml = renderToString(react.createElement(dock, {
  sessionId: 's-1',
  useInput: useInputFor('hello\n📎 .dsh-uploads/s-1/a.txt'),
  inputActions: noopActions,
  t
}))
assert.ok(dockHtml.includes('a.txt'), 'chip shows the file name')
assert.ok(dockHtml.includes('.dsh-uploads/s-1/a.txt'), 'chip shows the relative path')
assert.ok(dockHtml.includes('Remove a.txt'), 'chip remove aria-label')

// dock with empty draft → renders nothing
const emptyDock = renderToString(react.createElement(dock, {
  sessionId: 's-1',
  useInput: useInputFor(''),
  inputActions: noopActions,
  t
}))
assert.equal(emptyDock.trim(), '', 'empty dock renders null')

// paperclip button renders with its label; hidden file input present
const leftHtml = renderToString(react.createElement(left, {
  sessionId: 's-1',
  useInput: useInputFor(''),
  inputActions: noopActions,
  t
}))
assert.ok(leftHtml.includes('Attach files'), 'button aria-label')
assert.ok(leftHtml.includes('type="file"'), 'file input present')
assert.ok(leftHtml.includes('multiple'), 'file input accepts multiple')

// hero (no session) → both render nothing
assert.equal(renderToString(react.createElement(left, { sessionId: undefined, useInput: useInputFor(''), inputActions: noopActions, t })).trim(), '')
assert.equal(renderToString(react.createElement(dock, { sessionId: undefined, useInput: useInputFor(''), inputActions: noopActions, t })).trim(), '')

// marker with spaces and parens round-trips through the rail
const tricky = renderToString(react.createElement(dock, {
  sessionId: 's-9',
  useInput: useInputFor('📎 .dsh-uploads/s-9/my notes (1).pdf'),
  inputActions: noopActions,
  t
}))
assert.ok(tricky.includes('my notes (1).pdf'), 'tricky names survive the marker round-trip')
assert.ok(tricky.includes('.dsh-uploads/s-9/my notes (1).pdf'), 'tricky path survives')

console.log('bundle-render: all assertions passed')
