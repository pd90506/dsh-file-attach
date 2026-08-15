import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Cordis plugin name (also the loader entry id / client-modules row id). */
export const name = 'file-attach'

/** Hard service dependencies: the web HTTP server and the host session store. */
export const inject = ['webServer', 'sessions', 'systemPrompt']

/** Route serving composer file uploads. */
export const UPLOAD_PATH = '/dsh-file-attach/upload'
/** Relative store root below each session's workspace root (cwd). */
export const STORE_REL = '.dsh-uploads'
/** Hard caps: raw JSON body and decoded file bytes. */
export const MAX_BODY_BYTES = 32 * 1024 * 1024
export const MAX_FILE_BYTES = 24 * 1024 * 1024
export const MAX_NAME_BYTES = 240

/**
 * Sanitize a browser-provided file name into a safe single path segment:
 * strips any directory components (forward/back slashes) and control
 * characters, rejects traversal/dot entries and names that vanish or grow
 * past the cap. Windows separators are treated like POSIX ones.
 * @param raw - the client-sent file name.
 * @returns the sanitized segment.
 */
export function sanitizeFileName(raw) {
  if (typeof raw !== 'string') throw new Error('missing file name')
  let name = raw.replace(/\\/g, '/').split('/').pop() ?? ''
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  if (name === '' || name === '.' || name === '..') throw new Error('invalid file name')
  if (Buffer.byteLength(name, 'utf8') > MAX_NAME_BYTES) throw new Error('file name too long')
  return name
}

/**
 * Fold the marker line inserted into the composer draft for one upload.
 * Format: "📎 <relativePath>" — a single token with no delimiters that can
 * clash with file names (paths are sanitized and contain no newline), so
 * names with parentheses/spaces round-trip safely. The client parses lines
 * of this exact shape back out of the draft; the two halves must stay in
 * sync (see client/client.js).
 * @param relativePath - ".dsh-uploads/<sessionId>/<name>" as returned by the route.
 * @returns the marker line, or null for a malformed path.
 */
export function markerFor(relativePath) {
  const match = /^\.dsh-uploads\/[^/]+\/[^/]+$/.exec(relativePath ?? '')
  if (!match) return null
  return `📎 ${relativePath}`
}

/** Collect a request body with a hard byte cap; 413 past the cap. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    req.on('data', (chunk) => {
      total += chunk.length
      if (total > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('request body too large'), { status: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function json(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body)
  })
  res.end(body)
}

/**
 * Host half: store attached files inside the session's workspace so the
 * agent's existing file/bash tools can always read them, and teach the model
 * the convention through a system-prompt section.
 * @param ctx - host plugin context.
 */
export function apply(ctx) {
  ctx.effect(() => {
    const disposeRoute = ctx.webServer.register({
      kind: 'exact',
      path: UPLOAD_PATH,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          json(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        try {
          const body = await readBody(req)
          let payload
          try {
            payload = JSON.parse(body.toString('utf8'))
          } catch {
            throw Object.assign(new Error('malformed JSON body'), { status: 400 })
          }
          const { sessionId, name, mime, base64 } = payload
          // Shape guard: session ids are server-generated opaque tokens. Enforcing
          // a plain charset locally (rather than trusting generation policy) keeps
          // the id safe to embed in path joins and marker lines.
          if (typeof sessionId !== 'string' || sessionId === '') throw Object.assign(new Error('missing sessionId'), { status: 400 })
          if (!/^[A-Za-z0-9._-]+$/.test(sessionId)) throw Object.assign(new Error('invalid sessionId'), { status: 400 })
          let safeName
          try {
            safeName = sanitizeFileName(name)
          } catch (error) {
            throw Object.assign(error, { status: 400 })
          }
          if (typeof base64 !== 'string' || base64 === '') throw Object.assign(new Error('missing file data'), { status: 400 })
          const bytes = Buffer.from(base64, 'base64')
          if (bytes.length === 0) throw Object.assign(new Error('empty file'), { status: 400 })
          if (bytes.length > MAX_FILE_BYTES) throw Object.assign(new Error(`file exceeds ${MAX_FILE_BYTES} bytes`), { status: 413 })

          const session = ctx.sessions.get(sessionId)
          const cwd = session?.header?.cwd
          if (typeof cwd !== 'string' || !cwd.startsWith('/')) {
            throw Object.assign(new Error('session has no workspace root'), { status: 404 })
          }

          const dir = join(cwd, STORE_REL, sessionId)
          const filePath = join(dir, safeName)
          const tmpPath = `${filePath}.uploading-${process.pid}-${Date.now()}`
          await mkdir(dir, { recursive: true })
          await writeFile(tmpPath, bytes, { mode: 0o600 })
          await rename(tmpPath, filePath)

          const relativePath = `${STORE_REL}/${sessionId}/${safeName}`
          json(res, 200, {
            ok: true,
            relativePath,
            marker: markerFor(relativePath),
            bytes: bytes.length,
            mime: typeof mime === 'string' && mime !== '' ? mime : 'application/octet-stream'
          })
        } catch (error) {
          const status = error?.status ?? 500
          if (status === 500) ctx.logger.warn(`file-attach: upload failed: ${error instanceof Error ? error.message : String(error)}`)
          json(res, status, { ok: false, error: error instanceof Error ? error.message : 'upload failed' })
        }
      }
    })
    return disposeRoute
  }, 'file-attach: upload route')

  ctx.systemPrompt.section({
    name: 'file-attach:convention',
    order: 40,
    text: () =>
      'The user can attach files through the GUI composer. Attached files are stored inside the current ' +
      'workspace under .dsh-uploads/<sessionId>/, and the user message contains a marker line like ' +
      '"📎 .dsh-uploads/<sessionId>/report.pdf" naming the file\u2019s exact relative path. ' +
      'When the user references an attached file, read it from that path with your file tools (read/glob/bash) ' +
      'rather than asking for its content. Attached files persist after the message is sent.'
  })
}
