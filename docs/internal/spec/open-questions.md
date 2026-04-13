# 开放问题

更新时间：`2026-04-13`

这是一份**内部待决问题清单**。判断当前已经落地的行为时，请优先看 `README.md` 与 `docs/spec/**`；这里记录的是仍可能变化的方向。

已经被代码移除的旧方案（如 `manual override`、`backend = "codex"`、`codex exec` fallback）不再作为待决事项记录。

## 1. AI 默认后端到底选什么

当前可选项：

- `backend = "responses"`
- `backend = "openai-compatible"`
- `backend = "none"`

当前默认实现：

- `backend = "responses"`
- `provider_source = "codex-config"`

仍待确认的问题：

- 是否继续把 `responses + codex-config` 作为最优默认组合
- 是否要在 provider 连通性失败时更主动地引导用户切到 `manual`

## 2. auto-apply 在正式落盘前是否要增加“稳定一轮”保护

当前现状：

- `evaluateAutoRename()` 只基于 `dirty + idle + frozen + cooldown + max_auto_renames`
- `finalize_ready` 会映射成 `apply`
- 当 `rename.auto_apply = "idle-finalize"` 且 daemon 正在运行时，会真正写回

仍待确认的问题：

- 是否要求候选名连续一轮 sweep 保持稳定后再自动 apply
- 是否要把“最近一次候选与本次候选完全一致”作为额外 gate

## 3. TUI 是否继续保持“高密度运维视图”

当前现状：

- TUI 已实现并可用
- 支持 browser / maintenance / daemon / settings 四个 screen mode
- 支持浏览、搜索、transcript、suggest/apply、freeze、manual rename、batch dirty apply、requeue、settings 编辑

仍待确认的问题：

- 是否要继续保持现在这种高密度单屏布局
- 是否要进一步对齐 Web 的阅读路径
- 是否要把更多运行态信息带进 TUI

## 4. 请求日志是否继续停留在“表格 + 分页”

当前现状：

- 状态页请求日志已经改成后端分页
- Web 每页显示 10 条
- 支持搜索、项目、状态、传输过滤，以及直接跳页

仍待确认的问题：

- 是否要继续增加导出能力
- 是否要支持更细的排序
- 是否要为明细区增加“复制字段 / 打开关联会话”等操作

## 5. 是否需要“恢复到上一条正式名”

当前现状：

- `rename_history` 已保留完整历史
- 当前没有单独的 undo 命令或 Web 操作

仍待确认的问题：

- 是否提供一个显式的 “restore previous applied name” 操作
- 如果提供，是否只允许恢复到“上一条 accepted official name”
