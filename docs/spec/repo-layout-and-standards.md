# 仓库结构与开发约束

## 目标

在开始写代码前，先固定仓库的大致组织方式，避免：

- watcher 逻辑散在 CLI / Web / TUI 中
- UI 直接依赖 rollout 解析细节
- writer 被多处重复实现
- AI provider 调用在多个入口复制一遍

## 建议仓库结构

```text
codexnamer/
  README.md
  docs/
    adr/
    research/
    spec/
  packages/
    core/
      src/
        domain/
        extractor/
        revision/
        rename/
        writer/
        config/
        provider/
    daemon/
      src/
        scheduler/
        ingest/
        api/
    cli/
      src/
    web/
      src/
        app/
        pages/
        components/
    tui/
      src/
    shared/
      src/
        dto/
        zod/
        constants/
```

## 模块边界

### `packages/core`

只放纯业务逻辑：

- rollout 解析
- revision 构建
- rename engine
- session index writer
- compact 算法
- 配置解析

### `packages/daemon`

只放：

- watcher
- ingest pipeline
- scheduler
- 本地 API server

### `packages/cli`

只做：

- 参数解析
- 调用 local API 或 core
- 格式化输出

### `packages/web`

只做：

- 可视化管理界面
- 不直接读本地文件

### `packages/tui`

只做：

- 终端交互
- 不直接写 `session_index.jsonl`

## 编码约束

### 1. 所有官方写回统一经由 writer 模块

禁止：

- WebUI 自己改 index
- CLI 自己拼 JSON 字符串写 index
- daemon 在别处绕开 writer 直接 append

### 2. rollout 解析必须可增量

不要每次 sweep 都全量重新解析完整 JSONL。

### 3. UI 只消费聚合 DTO

UI 层只接受：

- SessionSummary
- SessionDetail
- RenamePreview
- MaintenanceStats

### 4. 配置解析与运行时配置分离

- 原始 TOML -> ParsedConfig
- ParsedConfig + inherited Codex config -> EffectiveConfig

### 5. AI 调用必须有统一接口

不要让不同入口各写一套 prompt。

建议统一接口：

```ts
interface RenameInferenceService {
  suggestName(input: RenameInput): Promise<RenameSuggestion>
}
```

## 风格约束

- 所有时间统一存 UTC RFC3339
- 所有 thread 主键统一使用 `threadId`
- 所有 dirty 判定统一基于 revision
- 日志中不打印 API key
- 所有批量操作默认 dry-run preview 优先

## 依赖约束

建议：

- SQLite 只用一个驱动
- 配置校验只用一套 schema
- Web 与 CLI 共享 DTO

避免：

- Web、CLI、TUI 各自定义一套 Session 类型

## 版本纪律

在 v1 之前，不引入：

- 远程同步
- 多用户
- 插件 marketplace
- 复杂规则脚本执行
