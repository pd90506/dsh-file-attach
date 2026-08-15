/**
 * dsh-file-attach — client half.
 *
 * Hand-written browser bundle for the DSH web shell's module loader
 * (`window.__ModuleLoader__.load`). No build step: plain JavaScript, only
 * `react` + `@deepseek-ai/dsh-client-ui-primitives` (static modules in the
 * shell vendor bundle).
 *
 * Registers two composer-slot occupants:
 *  - `conversation.input.left`  — a paperclip button opening a file picker;
 *    each picked file is uploaded to the host route `/dsh-file-attach/upload`
 *    and a marker line is appended to the draft:
 *        📎 .dsh-uploads/<sessionId>/report.pdf
 *    The same upload path also claims Cmd/Ctrl+V clipboard pastes that carry
 *    non-image files (image pastes stay on the native image-attachment path).
 *  - `conversation.input.dock`  — a chips rail derived from those marker
 *    lines (the draft text is the single source of truth, so editing or
 *    deleting a marker line updates the rail automatically) plus transient
 *    uploading/error rows.
 *
 * The marker line shape MUST stay in sync with `markerFor()` in
 * ../src/index.js.
 */
window.__ModuleLoader__.load({
  id: '@pd90506/dsh-file-attach',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')

    // ── styles ──────────────────────────────────────────────────────────────
    const CSS_TAG = 'dsh-file-attach'
    const css = [
      '.dshfa_button{background:var(--dsw-specific-selector);width:28px;height:28px;color:var(--dsw-alias-label-primary);cursor:pointer;border:none;border-radius:999px;flex:none;place-items:center;display:grid}',
      '.dshfa_button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.dshfa_button:focus-visible{outline:2px solid var(--dsw-alias-state-focus-ring,var(--dsw-alias-label-primary));outline-offset:2px}',
      '.dshfa_button:disabled{opacity:.6;cursor:default}',
      '.dshfa_rail{box-sizing:border-box;width:100%;max-width:var(--dsh-composer-card-max-width,760px);flex-wrap:wrap;gap:8px;padding:0 var(--dsh-composer-side-clearance,0) 2px;display:flex}',
      '.dshfa_chip{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);border-radius:999px;align-items:center;gap:6px;padding:2px 6px 2px 10px;font-size:12px;line-height:20px;display:inline-flex}',
      '.dshfa_chipName{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshfa_chipPath{color:var(--dsw-alias-label-tertiary);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshfa_remove{background:none;border:none;color:var(--dsw-alias-label-secondary);cursor:pointer;border-radius:999px;place-items:center;padding:2px;display:grid}',
      '.dshfa_remove:hover{color:var(--dsw-alias-state-error-primary)}',
      '.dshfa_meta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}',
      '.dshfa_error{color:var(--dsw-alias-state-error-primary)}'
    ].join('')
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + CSS_TAG + '"]') === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-file-attach'
      tag.dataset.pluginCss = CSS_TAG
      tag.textContent = css
      document.head.appendChild(tag)
    }

    // ── wire protocol (must mirror src/index.js) ────────────────────────────
    const UPLOAD_URL = '/dsh-file-attach/upload'
    const MAX_FILE_BYTES = 24 * 1024 * 1024
    // Marker shape: "📎 .dsh-uploads/<sessionId>/<name>" — one token, no
    // delimiters that could clash with file names (parentheses, spaces, …).
    const MARKER_RE = /^📎 (\.dsh-uploads\/[^/\n]+\/[^/\n]+)$/
    // Native DSH image attachment only accepts these MIME types; pastes
    // carrying them are left to the composer's own image path.
    const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

    /** Split a draft into its marker entries: [{ name, path, line }]. */
    function parseMarkers(draft) {
      const markers = []
      for (const line of String(draft ?? '').split('\n')) {
        const match = MARKER_RE.exec(line)
        if (match !== null) {
          const path = match[1]
          const name = path.slice(path.lastIndexOf('/') + 1)
          markers.push({ name, path, line })
        }
      }
      return markers
    }

    /** Whether a File is handled by the native image-attachment path. */
    function isImageFile(file) {
      return IMAGE_TYPES.includes(file.type)
    }

    /** Files carried by a clipboard paste event (empty when none). */
    function fileItemsOf(event) {
      const items = event.clipboardData?.items
      if (items === undefined) return []
      const files = []
      for (const item of items) {
        if (item.kind === 'file') {
          const file = item.getAsFile()
          if (file !== null) files.push(file)
        }
      }
      return files
    }

    /**
     * Whether this plugin should claim a paste: at least one file and no
     * image among them (images belong to the native path). Files copied from
     * the OS often carry an empty MIME type — those count as non-image.
     */
    function shouldClaimPaste(files) {
      return files.length > 0 && !files.some(isImageFile)
    }

    // ── transient per-session upload status (uploading/error rows) ──────────
    // Deliberately NOT the source of truth for attached files: chips come from
    // the draft markers. This store only carries in-flight and failed uploads.
    const statuses = new Map()
    const listeners = new Set()
    function emit() {
      for (const listener of listeners) listener()
    }
    function statusOf(sessionId) {
      return statuses.get(sessionId)
    }
    function patchStatus(sessionId, patch) {
      const prev = statuses.get(sessionId) ?? { uploads: [] }
      const next = { ...prev, ...patch }
      statuses.set(sessionId, next)
      emit()
    }
    function useAttachStatus(sessionId) {
      const snapshot = () => statusOf(sessionId)
      return React.useSyncExternalStore(
        (listener) => {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        snapshot,
        snapshot
      )
    }

    /** Read a File as base64 (data URL prefix stripped). */
    function readAsBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const result = String(reader.result)
          const comma = result.indexOf(',')
          resolve(comma === -1 ? result : result.slice(comma + 1))
        }
        reader.onerror = () => reject(new Error('failed to read file'))
        reader.readAsDataURL(file)
      })
    }

    /** Upload one file; returns the server marker line on success. */
    async function uploadOne({ sessionId, file, t }) {
      if (file.size > MAX_FILE_BYTES) {
        throw new Error(t('error.tooLarge', { size: String(Math.round(MAX_FILE_BYTES / 1024 / 1024)) + 'MB' }))
      }
      const base64 = await readAsBase64(file)
      const res = await fetch(UPLOAD_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          name: file.name,
          mime: file.type ?? '',
          base64
        })
      })
      let data = null
      try {
        data = await res.json()
      } catch {
        data = null
      }
      if (!res.ok || data === null || data.ok !== true) {
        throw new Error((data !== null && typeof data.error === 'string' && data.error !== '') ? data.error : t('error.uploadFailed'))
      }
      return data.marker
    }

    /**
     * Upload a batch and append the resulting marker lines to the draft once.
     * The latest draft is read through `draftRef` (refreshed every render), so
     * typing during a slow upload is not clobbered.
     */
    async function uploadBatch({ sessionId, files, draftRef, inputActions, t }) {
      const attached = new Set(parseMarkers(draftRef.current).map((marker) => marker.name))
      const markers = []
      for (const file of files) {
        const entry = { name: file.name, phase: 'uploading' }
        patchStatus(sessionId, { uploads: [...(statusOf(sessionId)?.uploads ?? []), entry] })
        let error = null
        if (attached.has(file.name)) {
          error = t('error.alreadyAttached', { name: file.name })
        } else {
          try {
            const marker = await uploadOne({ sessionId, file, t })
            markers.push(marker)
            attached.add(file.name)
          } catch (cause) {
            error = cause instanceof Error ? cause.message : t('error.uploadFailed')
          }
        }
        const list = statusOf(sessionId)?.uploads ?? []
        patchStatus(sessionId, { uploads: list.filter((item) => item !== entry) })
        if (error !== null) {
          patchStatus(sessionId, { errors: [...(statusOf(sessionId)?.errors ?? []), { name: file.name, message: error }] })
        }
      }
      if (markers.length > 0 && inputActions !== undefined) {
        const draft = draftRef.current
        const base = draft.trimEnd()
        inputActions.setDraft(base === '' ? markers.join('\n') : base + '\n' + markers.join('\n'))
      }
    }

    // ── composer occupants ───────────────────────────────────────────────────
    /** The paperclip button in the composer tools row. */
    function AttachButton(props) {
      const { sessionId, useInput, inputActions, t } = props
      const inputRef = React.useRef(null)
      const draftRef = React.useRef('')
      const draft = useInput === undefined ? '' : useInput((state) => state?.draft ?? '')
      draftRef.current = draft
      const sessionRef = React.useRef(sessionId)
      sessionRef.current = sessionId
      const actionsRef = React.useRef(inputActions)
      actionsRef.current = inputActions
      const tRef = React.useRef(t)
      tRef.current = t
      const status = useAttachStatus(sessionId)
      const uploading = (status?.uploads ?? []).length > 0

      // Claim clipboard pastes (Cmd/Ctrl+V) that carry non-image files while
      // the composer is the paste target: upload them exactly like picker
      // files. Image pastes are left untouched so the composer's native
      // image-attachment path keeps working. Capture phase + stopPropagation
      // keep the composer's own paste handler from seeing claimed pastes.
      React.useEffect(() => {
        const onPaste = (event) => {
          const session = sessionRef.current
          const actions = actionsRef.current
          if (session === undefined || actions === undefined) return
          if (typeof Element !== 'undefined' && !(event.target instanceof Element)) return
          if (event.target.closest('[data-composer-card]') === null) return
          const files = fileItemsOf(event)
          if (!shouldClaimPaste(files)) return
          event.preventDefault()
          event.stopPropagation()
          void uploadBatch({ sessionId: session, files, draftRef, inputActions: actions, t: tRef.current })
        }
        document.addEventListener('paste', onPaste, true)
        return () => document.removeEventListener('paste', onPaste, true)
      }, [])

      if (sessionId === undefined || inputActions === undefined) return null

      const onPick = () => {
        if (inputRef.current !== null) inputRef.current.click()
      }
      const onChange = (event) => {
        const files = Array.from(event.target.files ?? [])
        event.target.value = ''
        if (files.length === 0) return
        void uploadBatch({ sessionId, files, draftRef, inputActions, t })
      }

      return React.createElement(
        React.Fragment,
        null,
        React.createElement('input', {
          ref: inputRef,
          type: 'file',
          multiple: true,
          hidden: true,
          onChange
        }),
        React.createElement(
          primitives.Tooltip,
          { label: t('attach.title'), side: 'top', delayMs: 500 },
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'dshfa_button',
              'aria-label': t('attach.title'),
              disabled: uploading,
              onMouseDown: (event) => event.preventDefault(),
              onClick: onPick
            },
            React.createElement(primitives.IconPaperclipOutline16, { size: 16 })
          )
        )
      )
    }

    /** The chips rail above the composer card (draft markers + status rows). */
    function AttachRail(props) {
      const { sessionId, useInput, inputActions, t } = props
      const draft = useInput === undefined ? '' : useInput((state) => state?.draft ?? '')
      const markers = parseMarkers(draft)
      const status = useAttachStatus(sessionId)
      const uploads = status?.uploads ?? []
      const errors = status?.errors ?? []
      if (markers.length === 0 && uploads.length === 0 && errors.length === 0) return null

      const remove = (line) => {
        if (inputActions === undefined) return
        const next = String(draft).split('\n').filter((entry) => entry !== line).join('\n')
        inputActions.setDraft(next)
      }

      const children = []
      for (const marker of markers) {
        children.push(
          React.createElement(
            'span',
            { key: marker.path, className: 'dshfa_chip', title: marker.path },
            React.createElement('span', { className: 'dshfa_chipName' }, marker.name),
            React.createElement('span', { className: 'dshfa_chipPath' }, marker.path),
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'dshfa_remove',
                'aria-label': t('remove.title', { name: marker.name }),
                onClick: () => remove(marker.line)
              },
              React.createElement(primitives.IconCloseFill14, { size: 12 })
            )
          )
        )
      }
      for (const upload of uploads) {
        children.push(
          React.createElement(
            'span',
            { key: `up-${upload.name}-${children.length}`, className: 'dshfa_meta' },
            React.createElement(primitives.IconLoadingOutline16, { size: 12 }),
            ` ${t('rail.uploading', { name: upload.name })}`
          )
        )
      }
      for (const error of errors) {
        children.push(
          React.createElement(
            'span',
            { key: `err-${error.name}-${children.length}`, className: 'dshfa_meta dshfa_error' },
            `${error.name}: ${error.message}`
          )
        )
      }
      return React.createElement('div', { className: 'dshfa_rail' }, children)
    }

    // ── plugin ───────────────────────────────────────────────────────────────
    const NS = 'file-attach'
    const zh = {
      'attach.title': '附加文件',
      'remove.title': '移除 {name}',
      'rail.uploading': '正在上传 {name}…',
      'error.uploadFailed': '上传失败',
      'error.tooLarge': '文件超过 {size}，无法附加',
      'error.alreadyAttached': '{name} 已附加'
    }
    const en = {
      'attach.title': 'Attach files',
      'remove.title': 'Remove {name}',
      'rail.uploading': 'Uploading {name}…',
      'error.uploadFailed': 'Upload failed',
      'error.tooLarge': 'File exceeds {size}, cannot attach',
      'error.alreadyAttached': '{name} is already attached'
    }
    const inject = ['slots', 'locale']

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'file-attach: locale')
      ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
        name: 'conversation.input.left',
        id: 'file-attach',
        order: 0,
        locale: NS
      }, AttachButton))
      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'file-attach',
        order: 0,
        locale: NS
      }, AttachRail))
    }

    exports.apply = apply
    exports.inject = inject
    // Test hooks (bundle-render.mjs) — ignored by the loader, which only
    // reads apply/inject.
    exports.__internals = { parseMarkers, isImageFile, fileItemsOf, shouldClaimPaste }
    return module.exports
  }
})

//# sourceMappingURL=client.js.map
