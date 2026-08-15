# dsh-file-attach

DSH web 插件：在 Composer 中附加**任意类型文件**（图片之外也支持：PDF、DOCX、ZIP、代码文件……）。DSH 原生附件通道只接受图片（PNG/JPEG/WebP/GIF），本插件补上其余文件类型的空缺。

## 原理

- **客户端**：Composer 工具行左端新增 📎 回形针按钮（`conversation.input.left`），选择/多选文件后上传；也接管 **Cmd/Ctrl+V 粘贴**的非图片文件（图片粘贴仍走 DSH 原生图片通道）。上传成功后草稿末尾追加 marker 行：
  `📎 .dsh-uploads/<sessionId>/report.pdf`
  Composer 上方（`conversation.input.dock`）出现文件 chips 栏，可点 × 单独移除（同时删除草稿中的 marker 行），也可直接编辑草稿文本——草稿是唯一事实来源。
- **服务端**：`POST /dsh-file-attach/upload` 路由把文件写入**当前会话工作区**的 `.dsh-uploads/<sessionId>/` 目录——位于工作区内，模型的 read/glob/bash 工具可直接读取；同时注入 system-prompt 段说明约定：用户提到附件时按 marker 路径读取，不要向用户索要内容。

marker 行是单个 token（无与文件名冲突的分隔符），配合 prompt 段让模型按需取文件——不产生文件内容的 token 开销，不撑爆上下文。

## 结构

```
├── package.json          dsh.client 清单（platform: web, inject 边）
├── src/index.js          宿主端：上传路由 + 文件名净化 + prompt 段
├── client/client.js      浏览器端 bundle（手写 ModuleLoader 格式，无构建步骤）
└── test/                 smoke.mjs（宿主端）+ bundle-render.mjs（客户端，真实 dsh-client-ui-primitives）
```

所用 API 均已对照 DSH 0.1.0-rc.6 源码核实：cordis `name`/`inject`/`apply`、`ctx.webServer.register`、`ctx.systemPrompt.section`、`ctx.sessions.get(...).header.cwd`、`ctx.slots.inject`/`register`（真实插槽 `conversation.input.left` / `conversation.input.dock`）、`ctx.locale.register`。

## 安装（web profile）

```bash
# 1. 把插件链接进 profile（与 dsh.profile.bundles 的 link 模式一致）
#    在 ~/.dsh/profiles/web/package.json 的 dependencies 中添加：
#      "dsh-file-attach": "link:/path/to/file-attach-plugin"
#    然后在 profile 目录里运行 pnpm install。

# 2. 在 ~/.dsh/profiles/web/cordis.patch.yml 末尾追加 loader 行：
#    - insert:
#        - id: file-attach
#          name: dsh-file-attach
#          config: {}

# 3. 重启 dsh web——客户端插件图在启动时构建，必须重启。
```

## 使用

1. 点击 📎（或在 Composer 中 Cmd/Ctrl+V 粘贴非图片文件）。
2. 上传成功后草稿末尾追加 marker 行，Composer 上方出现文件 chips。
3. 发送消息 → 模型看到 marker，用文件工具读取对应路径。
4. 移除：点 chip 上的 ×（同时删除草稿中的 marker 行），或直接编辑/删除草稿中的 marker 行。

注意：文件以 marker 行 + chips 形式存在，不渲染成消息卡片。

## 限制

- 单文件 ≤ 24 MB（请求体上限 32 MB，base64 编码开销）。
- 文件写入 `<workspace>/.dsh-uploads/<sessionId>/`；同名覆盖写。
- 上传状态（进行中/失败）为浏览器内存态，刷新即消失；已附加文件本体持久保留。
- `.dsh-uploads/` 跨会话无限增长，暂无清理机制（个人使用可接受，必要时再处理）。
- 图片仍走 DSH 原生附件通道；本插件对图片同样适用（作为普通文件）。

## 测试

```bash
node test/smoke.mjs          # 宿主端：纯函数 + 路由处理（fake ctx）
node test/bundle-render.mjs  # 客户端：真实 primitives 经 react-dom/server 渲染 bundle
```
