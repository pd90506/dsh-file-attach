# DSH Plugin System — Factual Summary

Research date: 2026-08-15. Sources: the official docs site (develop branch) plus the
locally installed DSH 0.1.0-rc.6 distribution (package READMEs and emitted `.d.ts`
files under `/Users/panda/.local/lib/node_modules/@deepseek-ai/dsh/`), which is the
same code the docs are generated from.

## URLs actually read

- https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/ — "Your first plugin"
- https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/tool — "Build a tool"
- https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/config — "Plugin configuration"
- https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish — "Package and install a plugin"
- https://deepseek-harness.github.io/deepseek-harness/en/develop/cordis-tutorial/07-into-the-harness (+ chapters 01–06 fetched)
- https://deepseek-harness.github.io/deepseek-harness/en/develop/framework/ — "Plugins and lifecycle"
- https://deepseek-harness.github.io/deepseek-harness/en/develop/framework/service — "Services and dependencies"
- https://deepseek-harness.github.io/deepseek-harness/en/develop/practice/ — "Three-role capability design"
- https://deepseek-harness.github.io/deepseek-harness/en/develop/practice/llm-adapter — "LLM adapters"
- https://deepseek-harness.github.io/deepseek-harness/en/reference/ — architecture index (nav source)
- https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/extension-cookbook — "Cookbook: extension plugin shapes"
- https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/adding-a-tool — "Tool authoring reference"
- https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/adding-a-package — "Cookbook: adding a workspace package"
- https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/client-modules — "Client Modules"
- https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/tools — "Tools"
- https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/commands — "Human Commands"
- https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/skills — "Skills"
- https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/web-server — "HTTP Server"
- https://deepseek-harness.github.io/deepseek-harness/en/reference/cordis-api/context — "Context"
- Local: `@deepseek-ai/dsh-attachment`, `dsh-attachment-local`, `dsh-client-ui-attachment`, `dsh-client-modules`, `dsh-llm` package READMEs and `lib/types/*.d.ts`.

Other reference pages exist but were not fetched: `reference/subsystems/*` (approval, goal, jobs, session, system-prompt, sandbox, …), `reference/cordis-api/{events,fiber,registry,service,inherited}`, `reference/config-catalog`, `reference/tool-catalog`.

---

## 1. Kinds of plugins/extensions DSH supports

DSH is a **Cordis** microkernel: every extension is a Cordis plugin (`name` + optional `inject` + `apply(ctx, config)`), differentiated by *which service/extension point it uses*. From the docs:

| Kind | Mechanism | Source |
|---|---|---|
| **Tool plugin** | `ctx.tools.register(defineTool({...}))` or raw JSON-Schema `ToolDefinition` (how MCP tools arrive) | basic/tool, extension-cookbook |
| **Hook plugin** | Ordinary plugin listening on interception points: `agent/session-start`, `agent/pre-step`, `agent/request`, `tools/pre-execute`, `tools/post-execute`, `agent/turn-stopping`. Waterfalls return typed decisions (allow/deny/ask). "A 'native hook' is an ordinary Cordis plugin on an interception point; it needs no external protocol." | extension-cookbook |
| **Service provider / consumer** | Class form extending `Service`; three-role capability design (Service Definition / Provider / Consumer, e.g. dsh-shell / dsh-bash-local / dsh-tool-bash) | framework/service, practice/ |
| **LLM adapter plugin** | `ctx.llm.registerAdapter(['provider'], adapter)` with a `LlmAdapter` subclass implementing `stream()` | practice/llm-adapter |
| **Command plugin** (human slash-commands) | `ctx.commands.register(definition)` | subsystems/commands |
| **Skill provider** | `ctx.skills.registerProvider(create)` or `ctx.skills.register(skill)` | subsystems/skills |
| **UI / client plugin** (browser) | Package declares `dsh.client` in package.json, exports `./client`; served at `/plugins/<id>/client.js`, booted via `window.__DSH_BOOT__` | subsystems/client-modules |
| **Web Client chat node** | Register a `ConversationNodeDefinition` + keyed `conversation.chat.node` renderer | extension-cookbook |
| **Protocol driver** | Adapts a wire peer to `ctx.agents` (ACP / JSON-RPC stdio examples) | extension-cookbook |
| **HTTP route plugin** | `ctx.webServer.register(route)` / `tapIndex(transform)` / `registerFallback(handler)` | subsystems/web-server |
| **System-prompt section provider** | `ctx.systemPrompt.section()` with ordering/scope shadowing | extension-cookbook |
| **Background job producers** | `ctx.jobs.start({ kind, label, owner: exec.agent, run })` | adding-a-tool |

The extension-cookbook "feature → mechanism map" states: "Every product feature maps to a listener on a documented extension point — the microkernel claim made checkable. No row modifies the loop."

## 2. Plugin structure on disk

### Single-module plugin (development form)

A plugin is one TypeScript/JavaScript module. Minimal shape (quoted from develop/basic):

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-plugin'

export function apply(ctx: Context) {
  // Register capabilities here.
}
```

Three forms — function (above), **object**:

```ts
export default {
  name: 'my-plugin',
  inject: ['tools'],
  apply(ctx: Context) { /* ... */ },
}
```

and **class** (for service providers):

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

export default class MyService extends Service {
  static inject = ['tools']
  constructor(ctx: Context) {
    super(ctx, 'myService')
  }
}
```

### Installable bundle (distribution form)

From develop/basic/publish — a bundle is an npm package carrying a `dsh.bundle` manifest:

```
hello-plugin/
├── package.json        # declares dsh.bundle
├── cordis.patch.yml    # the layer applied when a profile lists this bundle
└── index.js            # plugin modules the patch rows reference
```

```json
{
  "name": "dsh-hello-plugin",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

`cordis.patch.yml` rows reference the package by name so Node resolution finds installed code:

```yaml
- insert:
    - id: hello
      name: dsh-hello-plugin
```

A **profile** is a directory under `$DSH_HOME/profiles/<name>` with `package.json` (declares `dsh.profile.bundles`, an ordered list) plus the user's own `cordis.patch.yml`. "A bundle is what you author and distribute; a profile is what a user boots with `dsh --profile <name>`. Nothing is both."

### Client (browser) plugin

From subsystems/client-modules: "A package joins the table by declaring `dsh.client` (`platform: 'web'`, optional `inject` edges, optional `immediately`) in its package.json and exporting its built bundle at `exports["./client"]`." Real shipped example manifests (from local install):

```json
"dsh": { "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-runtime", ...], "immediately": true } }
```

The repo-local cookbook (adding-a-package) adds: "a client plugin package declares `dsh.client` in package.json, exports `./client`, and calls the shared tsdown preset (`packages/client/tsdown.client.ts`)".

### In-monorepo package layout (adding-a-package checklist)

`packages/<group>/<pkg>/` with `package.json` (`main: "lib/index.js"`, `types: "lib/types/index.d.ts"`), `tsconfig.json`, `src/index.ts` ("service default export or plugin (name/inject/apply/Config)"), and a README with gated "Model Experience" and "Known Limitations and Deferred Work" sections. `files` contains exactly `lib/index.js`, `lib/invariant.js`, `lib/types/**/*.d.ts` (+ package-specific runtime artifacts). In-package relative imports use explicit `.ts` specifiers.

## 3. Registration / installation / enabling

- **Config rows (`cordis.yml`)**: plugins are Loader rows: `- id: <id>` + `name: '<module specifier or absolute path>'` + optional `config:` / `inject:` / `group:` / `isolate:`. Local dev uses an absolute path and a `--patch` overlay:

  ```sh
  pnpm dsh web --patch ./scratch-plugin/cordis.yml
  ```

  "The plugin path must be absolute. A patch file contributes configuration but does not change the profile directory from which the loader resolves module paths."

- **CLI install**: `dsh plugin --profile <name> <args...>` "forwards to pnpm in the profile directory, so every pnpm verb works." `dsh plugin --profile demo add ./hello-plugin` initializes the profile (with `@deepseek-ai/dsh-base` as first bundle), links the package, and appends it to `dsh.profile.bundles` *because the package declares `dsh.bundle`*. `remove` deletes both. Git installs (`add github:you/hello-plugin`) need a self-contained `prepare` build script author-side and a pnpm ≥10 `allowBuilds` entry in the profile's `pnpm-workspace.yaml` user-side. Tarball (`pnpm pack`) and npm-registry installs need no build permission.

- **Layer order** (effective config composes over an empty root, later wins per row, whole-row replace not deep-merge):
  1. each bundle patch in `dsh.profile.bundles` order (`@deepseek-ai/dsh-base` first),
  2. the profile's own `cordis.patch.yml`,
  3. home-level `$DSH_HOME/cordis.patch.yml`,
  4. each `--patch <path>` overlay in argv order.
  Verify with `dsh --profile demo --dump-config`.

- **Client plugin scanning**: `ctx.clientModules` "scans the host Loader's entries for packages declaring `dsh.client`", incremental per package; "Package metadata … is cached per name and never expires: plugin-set changes take effect on restart." Bundles are served at `GET /plugins/<id>/client.js` and the boot graph is injected into index.html as `window.__DSH_BOOT__`.

- **Skill directories scanned** (rank order, subsystems/skills): `<projectRoot>/.dsh/skills` (100), `<projectRoot>/.agents/skills` (200), `Config.customSkillDirs` (300), `<dshHome>/skills` (400), `<agentsHome>/skills` (500), `Config.bundledSkillDir` (600). Accepts `<name>/SKILL.md` bundles and flat `<name>.md`; names must match `^[a-z0-9]+(?:-[a-z0-9]+)*$`. Frontmatter keys `disable-model-invocation` and `user-invocable` control visibility.

## 4. Exact API surface

### Plugin module contract

```ts
export const name = 'my-tool-plugin'
export const inject = ['tools']            // required services; plugin waits in PENDING
export function apply(ctx: Context, config: Config) {
  ctx.tools.register(/* ... */)
}
```

Config is a Schemastery schema exported under the same name as the `Config` interface (develop/basic/config):

```ts
export const Config: Schema = Schema.object({
  greeting: Schema.string().default('Hello'),
  maxRetries: Schema.number().default(3),
  verbose: Schema.boolean().default(false),
})
```

"Do not export a plain object as Config; it does not implement the Standard Schema interface required by Cordis." Invalid config fails the load loudly.

### Lifecycle (develop/framework)

Fiber state machine: `PENDING → LOADING → ACTIVE` (or `FAILED`); `ACTIVE → UNLOADING → DISPOSED`. Everything registered through `ctx` (`ctx.on`, `ctx.tools.register`, `ctx.llm.registerAdapter`, `ctx.effect`) is auto-disposed on unload, in reverse registration order. `ctx.effect(() => disposer)` for custom resources; `ctx.plugin(child)` for nested fibers; `await fiber.dispose()` for manual teardown. If an injected service disappears, dependents dispose and reload when it returns. HMR: editing a plugin source file with `@deepseek-ai/cordis-plugin-hmr` loaded unloads + reloads the plugin.

### Tool API (subsystems/tools, adding-a-tool)

`defineTool` is the typed helper (raw JSON-Schema `ToolDefinition` also accepted):

```ts
ctx.tools.register(defineTool({
  name: 'greet',
  description: 'Greet someone by name.',
  parameters: {
    name: { type: 'string', required: true, description: 'The name to greet' },
  },
  output: {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
  },
  async execute(args) {
    return `Hello, ${args.name}!`
  },
}))
```

`ToolDefinition` fields (quoted types): `output: ToolOutputDefinition` (`schema: JsonSchemaNode`, `render(args, value): ContentBlock[]`, optional `presentationMeta(args, value): JsonValue`), `execute(args: unknown, exec: ToolRunContext): Promise<…>`, optional `finalizeContent?(exec, result): ContentBlock[] | undefined`, `timeoutMs?: number`, `isConcurrencySafe?(args): boolean`, `presentCall?(args): ToolCallView | undefined`, `presentResult?(args, result): ToolResultView | undefined`. `schemas()` whitelists only name/description/parameters for the model request — callbacks never leak onto the wire.

`ctx.tools` — ToolRuntime service signatures (generated catalog):

```ts
presentAs(mode: ToolPresentationMode): () => void
register(definition: ToolDefinition): () => void
restrict(filter: ToolRestriction): () => void   // { allow?: readonly string[], deny?: readonly string[] }
guard(guard: ToolGuard): () => void             // monotonic final deny
get(name: string, scope?: ScopeKey): ToolDefinition | undefined
schemas(scope?: ScopeKey): ToolSchema[]
executionMode(exec: ToolExecutionInput): ToolExecutionMode
async execute(exec: ToolExecutionInput): Promise<…>
```

Tool pipeline extension events (dispatch modes in parens):

- `'tools/pre-execute'` (waterfall): `(exec, next) => Promise<PreToolDecision>` — allow/deny/ask before dispatch.
- `'tools/execute'` (waterfall): around-dispatch; wrappers may replace only `exec.signal` (timeouts/retries/metrics).
- `'tools/post-execute'` (waterfall): accept/replace/enrich/block a normalized result.
- `'tools/result'` (emit): observe the frozen final outcome.
- `'tools/change'` (emit), `'tools/code-dispatch-log'` (waterfall, durable-log copy of `run_code` sub-dispatches).

### Commands (subsystems/commands)

```ts
interface CommandDefinition {
  readonly name: string                    // lowercase, no leading slash
  readonly description: string
  readonly input?: CommandInputDescriptor  // { readonly hint: string }
  readonly recordInput?: boolean           // default true
  readonly handler: (invocation: CommandInvocation) => CommandResult | Promise<CommandResult>
}
```

`CommandInvocation`: `{ commandId, agent, rawInput, signal }`. `CommandResult` = `{ kind: 'success', text?, sourceEventSeq? } | { kind: 'error', text }`.
`ctx.commands`: `register(definition): () => void`, `@Remote list(agent)`, `find(agent, name)`, `@Remote async execute(agent, line, signal)`. Event: `'commands/change'` (emit). Scoped registration through a command-injected child of an agent context shadows globals for that agent.

### Skills (subsystems/skills)

```ts
interface SkillProvider {
  readonly name: string
  readonly list: (options: SkillLookupOptions) => Promise<SkillCandidate[] | SkillProviderObservation>
  readonly get: (candidate: SkillCandidate, options: SkillLookupOptions) => Promise<…>
}
```

`ctx.skills`: `registerProvider(create: (control: SkillProviderControl) => SkillProvider): () => void`, `register(skill: SkillRegistration): () => void`, `async list(options?: SkillViewOptions)`, `async snapshot(options?)`, `async get(name, options?)`. Event: `'skills/change'` (emit).

### LLM adapters (practice/llm-adapter)

```ts
class MyAdapter extends LlmAdapter {
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> { … }
}
// in apply:
ctx.llm.registerAdapter(config.providers, adapter)
```

StreamChunk protocol: `block-start` / `text-delta` / `tool-call-delta` / `block-end` / `usage` / `finish`. Errors: throw `LlmError` with a stable code; merge `attributionHeaders()` and forward `options.signal`.

### Context API (cordis-api/context)

`ctx.extend(meta?)`, `ctx.isolate(name, label?)`, `ctx.intercept(name, config)`, `ctx.root`, `ctx.baseUrl?`, `ctx.events`, `ctx.logger(name)`, `ctx.reflect`, `ctx.registry`, `ctx.get(name, strict?)`, `ctx.set(name, value)`, `ctx.provide(name, value): () => void`, `ctx.accessor(name, options)`, `ctx.mixin(name, mixins)`. Services are typed into `Context` via declaration merging:

```ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    metrics: MetricsService
  }
}
```

### Client-module host API (subsystems/client-modules)

`ctx.clientModules` — ClientModuleRegistry: `graph(): WebBootGraph`, `clientPath(id)`, `rebuilt(id)`, `onRebuilt(listener)`, `onGraphChanged(listener)`. Wire types:

```ts
interface WebBootEntry {
  id: string            // entry name == package name
  url: string           // '/plugins/<id>/client.js?rev=<rev>'
  rev: string
  inject?: string[]
  immediately?: boolean // stage-one prefetch tier
}
interface WebBootGraph { rev: string; entries: WebBootEntry[] }
```

Browser half (`dsh-client-modules` README): lazy-CJS table; executing a bundle only registers its factory (`window.__ModuleLoader__.load({id, factory})`); `<id>/client` and the bare id resolve to the same exports; `invalidate` is the HMR hook; `dsh-client-hmr` stat-polls bundles and broadcasts rev changes over SSE. Dev-mode client HMR requires the dev web watcher rebuilding bundles.

### Web server (subsystems/web-server)

`ctx.webServer`: `register(route: WebRoute): () => void` (`WebRoute = { kind: 'exact'|'prefix', path, handler }`), `registerUpgrade(route)`, `registerFallback(handler)` (one owner), `tapIndex(transform: (html) => html)`, `applyIndexTaps(html)`. Config: `{ host: '127.0.0.1' | '0.0.0.0', port: number }`.

## 5. File attachments / upload / context injection / message content

There is a first-party attachment subsystem, shipped as three packages (local install, version 0.1.0-rc.6):

- **`@deepseek-ai/dsh-attachment`** — "Durable immutable attachment storage seam". Service `ctx.attachments` (`AttachmentStore`, abstract Cordis `Service`):

  ```ts
  export declare abstract class AttachmentStore extends Service {
    abstract readonly imageLimits: ImageAttachmentLimits
    abstract validateImage(input: SaveImageAttachment): Promise<void>
    abstract saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef>
    abstract readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment>
  }
  ```

  Types (from `lib/types/types.d.ts`):

  ```ts
  export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  export interface ImageAttachmentRef {
    attachmentId: AttachmentId   // opaque; "never a filesystem path or bearer URL"
    mediaType: ImageMediaType
    bytes: number
    width: number
    height: number
    name?: string
  }
  export interface ImageAttachmentLimits {
    maxImageBytes: number
    maxImagesPerMessage: number
    maxMessageImageBytes: number
    maxImagePixels: number
    mediaTypes: readonly ImageMediaType[]
  }
  export interface SaveImageAttachment { data: Uint8Array; mediaType: ImageMediaType; name?: string }
  export interface StoredImageAttachment { ref: ImageAttachmentRef; data: Uint8Array }
  ```

  Errors: `AttachmentError extends Error` with a stable machine-routing `code`. README contract: "consumers never persist browser paths, object URLs, provider URLs, or base64 in session events"; `saveImage` "commits each accepted image before any model-visible session event is published". **Known limitations (quoted): "Version one accepts PNG, JPEG, WebP, and GIF only… Generic files, audio, video, and persistent unsent drafts require separate lifecycle and provider contracts."**

- **`@deepseek-ai/dsh-attachment-local`** — content-addressed backend: "Objects land at `<DSH_HOME>/attachments/v1/objects/<sha256-prefix>/<sha256>` and are addressed by an opaque `sha256:` id", with staging dir + atomic hard-link publish; `DSH_HOME` resolves "explicit config, `$DSH_HOME`, then `~/.dsh`". Depends on `sharp` for full raster decode validation.

- **`@deepseek-ai/dsh-client-ui-attachment`** — "Pure React attachment atoms for the dsh web UI: draft-image rail, message image gallery, and original-image lightbox (zero cordis)". Note: it declares **no** `dsh.client` manifest — it's a library, not a client plugin.

Message content model (`@deepseek-ai/dsh-llm`, `lib/types/types.d.ts`) — merge-extensible block union:

```ts
export interface ImageBlock {
  type: 'image'
  /** Immutable bytes and intrinsic display metadata owned by the attachment service. */
  attachment: ImageAttachmentRef
}
export interface ContentBlockMap {
  'text': TextBlock
  'reasoning': ReasoningBlock
  'image': ImageBlock
  'tool-call': ToolCallBlock
  'tool-result': ToolResultBlock
}
export type ContentBlock = ContentBlockMap[ContentBlockType]  // "merge-extensible"
```

"The block `type` tag vocabulary; widens as plugins add entries to `ContentBlockMap`." Helper: `contentHasImage(content: readonly ContentBlock[]): boolean` (recursive walk shared by image policies). Messages are created via `createUserMessage({ content: ContentBlock[], source: { kind: 'user' } })`.

Context injection into a running/next agent turn (adding-a-tool): `agent.inject({ content, source: { kind: 'plugin', plugin: '<name>' } })` "appends durable context the NEXT model request sees — it is not a wake-up (an idle agent stays idle)." UI/protocol plugins push user input via `agent.followup(createUserMessage({...}))` / `agent.steer(...)`; cron-style plugins use `followup(…, { source: { kind: 'cron', … } })` (extension-cookbook).

## 6. Versioning / compatibility

- Current shipped version: **0.1.0-rc.6** (every `@deepseek-ai/dsh-*` package shares the root version; in-repo packages are `private: true` with "a version matching the root package.json").
- **Peer dependency contract** (adding-a-package, enforced by `pnpm run constraints`): `@deepseek-ai/cordis` in **both** `peerDependencies` and `devDependencies` at the same range (shipped packages use `"@deepseek-ai/cordis": "^4.0.1"`); every dsh peer dep mirrored in devDependencies; `@deepseek-ai/schemastery` in `dependencies` (runtime validator, `^3.18.1` shipped). Cross-package dsh deps use the shared `^0.1.0-rc.6` range.
- No `engines` field in the published root `package.json`; the running CLI here is Node v22.23.2. Package type is ESM (`"type": "module"`).
- Git installs require pnpm ≥10 `allowBuilds` allowlisting and a self-contained `prepare` script (see §3). "In-box bundle names always resolve from the dsh installation itself… your bundle can rely on `@deepseek-ai/dsh-base` being present and current."
- Client plugins: the composed boot graph is hash-anchored (`rev` per bundle + graph `rev`); "plugin-set changes take effect on restart" because package metadata cache never expires; HMR of client bundles goes through `dsh-client-hmr` → `rebuilt(id)`.

## Notes / gaps

- The docs site 404s for `/en/develop/reference/...`; the reference section lives at `/en/reference/...`.
- Generated "Cordis API" catalog blocks on subsystem pages are produced by `scripts/gen-cordis-catalog.ts` from source JSDoc and are byte-identical across languages — i.e., the docs track source.
- Not fetched (available for follow-up): `reference/subsystems/{approval,session,system-prompt,goal,jobs,...}`, `reference/cordis-api/{events,fiber,registry,service,inherited}`, `reference/config-catalog`, `reference/tool-catalog`, `reference/cookbook/adding-a-conversation-node` (Web Client chat business nodes), and `packages/client/AGENTS.md` (client-side contract, referenced by adding-a-package but not present in the published npm tarball).
