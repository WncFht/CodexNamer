# 当前状态与 Pipeline 审查

> 内部快照。更新时间：`2026-04-13`

这份文档用于维护者回看项目主线，不再作为对外主文档入口。当前代码真相请优先看：

- [README](../../README.md)
- [仓库总览](../../spec/repo-overview.md)
- [配置与 AI 后端](../../spec/config-and-ai.md)
- [Auto Rename 评估与 Context 构建](../../spec/rename-evaluation-and-context.md)
- [状态页说明](../../spec/status-page-guide.md)

## 1. 当前已经落地的主线

### 基础链路

- rollout 扫描与增量 ingest
- SQLite 状态库
- `session_index.jsonl` 读取 / 追加 / compact
- revision / dirty tracking

### rename 链路

- suggest / apply / manual rename
- freeze / unfreeze
- batch dirty apply
- auto-rename preview
- daemon auto-apply
- 按规则签名重新归队

### 配置与 AI

- builder-first naming policy
- prompt preview
- `responses | openai-compatible | none`
- `provider_source = codex-config | manual`
- provider parse / provider test

### UI / 运行态

- Web：Sessions / Settings / Rename Ops / Requeue / Daemon
- TUI：browser / maintenance / daemon / settings
- 状态页请求日志：后端分页、每页 10 条、支持直接跳页
- overview 统计：按会话去重
- daemon 面板：显示 controller 状态与下一次定时 sweep 倒计时
- CLI：`serve` 与用户级 service 流程可用

## 2. 最近收敛掉的旧语义

下面这些不再是当前行为：

- `manual override`
- `brief / detailed` 风格切换
- `backend = "codex"`
- `codex exec` fallback
- 状态页前端一次性只看固定 40 条请求日志
- 公开文档中的 ADR 页面

## 3. 当前仍然存在的实现边界

### 3.1 auto-apply 还没有“稳定一轮”保护

当前 `finalize_ready` 在 daemon auto-apply 生效时就可能直接落盘，尚未引入“候选稳定一轮 sweep”这类额外 gate。

### 3.2 provider 测试链仍需要持续整平

核心 provider 解析与请求路径已实现，但 provider 连通性相关测试仍有继续收敛空间。
