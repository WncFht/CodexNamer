# 仓库结构与开发约束

更新时间：`2026-04-13`

## 目标

固定当前仓库的真实边界，避免：

- rollout / writeback 逻辑散在 UI 层
- API route 直接访问数据库实现细节
- CLI、daemon、Web、TUI 各自复制 rename / provider 逻辑
- 配置解析、运行时解析和 provider 诊断混成一层

## 当前仓库结构

```text
codexnamer/
  README.md
  docs/
    README.md
    spec/
    internal/
      research/
      reviews/
      spec/
  packages/
    core/
      src/
        config/
        database/
        manager/
        *.ts
    shared/
      src/
        constants.ts
        schemas.ts
        types.ts
    api/
      src/
        routes/
        app.ts
        daemon-controller.ts
        event-log.ts
        index.ts
    cli/
      src/
        index.ts
        service-manager.ts
    daemon/
      src/
        index.ts
    web/
      src/
        app-shell/
        actions/
        resources/
        features/
        App.tsx
    tui/
      src/
        App.tsx
        *.tsx
```

## 模块边界

### `packages/core`

只放核心业务逻辑：

- rollout 解析与 ingest
- revision / dirty 判定
- rename engine
- session index writer / compact
- SQLite repository
- 配置加载与 provider 解析
- overview / doctor / runtime / maintenance 服务

### `packages/shared`

只放共享契约：

- DTO 类型
- API 输入 schema
- 常量

### `packages/api`

只放本地 API 进程相关内容：

- Fastify app 与 route registration
- daemon controller
- event log
- 静态 Web 资产托管

约束：

- route 不直接碰底层 DB 细节
- query/body 解析优先复用 `packages/shared` 的 schema

### `packages/daemon`

只放 standalone daemon sweep runner。

它负责：

- 周期性 / 文件变化触发 sweep
- 写 runtime summary
- 在独立进程模式下运行

### `packages/cli`

负责：

- 直接 core 命令入口
- `serve` 本地服务包装
- 用户级 service 安装 / 启停 / 状态

### `packages/web`

只做可视化管理界面：

- 通过 Local API 读取和操作数据
- 不直接读 rollout / SQLite / `session_index.jsonl`
- 页面状态、资源刷新、壳层布局与展示组件都留在前端包内

### `packages/tui`

只做终端交互界面：

- 通过 Local API 工作
- 不直接写 `session_index.jsonl`
- 不直接解析 rollout 文件

## 当前工程约束

### 1. 所有官方写回统一经由 core writer

禁止：

- WebUI 自己改 index
- CLI 自己拼 JSON 字符串写 index
- daemon 绕开 core writer 直接 append

### 2. rollout 解析必须可增量

不要让 sweep 每次都全量重新解析完整 JSONL。

### 3. UI 只消费共享 DTO 与 API 契约

UI 层只应基于：

- `packages/shared` 类型 / schema
- Local API 返回的聚合 DTO

### 4. 配置解析与运行态视图分离

当前要明确区分：

- 原始 TOML 文档
- `EffectiveConfig`
- `ConfigView`
- inherited Codex provider/auth 解析结果

### 5. provider / inference 入口统一

不要让不同入口各写一套 prompt 或 HTTP 调用协议。

当前 inference 语义应统一从 core provider 层进入。

## 风格约束

- 所有时间统一存 UTC RFC3339
- 所有 thread 主键统一使用 `threadId`
- 所有 dirty 判定统一基于 revision
- 日志中不打印 API key
- 所有批量操作默认 preview 优先

## 依赖约束

建议：

- SQLite 只用一套驱动
- 配置校验只用一套 schema
- Web / TUI 共享 DTO 与 query/body 契约

避免：

- Web、CLI、TUI 各自定义一套 Session 类型
- route 层和 UI 层各自维护不同的过滤语义

## 版本纪律

在 v1 之前，不引入：

- 远程同步
- 多用户
- 插件 marketplace
- 复杂规则脚本执行
