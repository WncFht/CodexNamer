# 当前状态与 Pipeline 审查

更新时间：`2026-04-04`

## 1. Web / TUI / Local API 设计书当前状态

主文档：

- [WebUI / TUI / Local API 详细设计](./web-tui-local-api-design.md)

当前判断：

- 这份设计书已经足够支撑 v1 的接口和前端实现开工。
- 它已经明确了：
  - 参考项目取舍
  - 本地 API 路由
  - WebUI 信息架构
  - TUI 交互骨架
  - 安全边界
  - 实现顺序

参考项目吸收情况：

- `TokenArena`
  - 已吸收 parser / extractor / service 分层思想
- `CLI History Hub`
  - 已吸收本地服务 + 浏览器形态、session 浏览入口和本地索引思路
- `CodexMate`
  - 已吸收本地 API + Web 功能区拆分思路

还没真正落地的部分：

- Local API 已完成第一阶段基础实现：
  - `packages/api`
  - health
  - sessions list/detail/history
  - suggest/apply/rename/freeze/manual-override
  - batch apply/suggest
  - config/providers/doctor/compact routes
- WebUI 还未实现
- TUI 还未实现
- SSE / events 游标接口还只是设计，没有运行时代码

设计书还缺的细节，但不阻塞实现：

- API 错误码和错误 JSON 统一格式
- Providers 页的字段级校验与连通性反馈文案
- Session 列表分页和 cursor 细节
- TUI 详情页的 history 展示形式

结论：

- 设计书不是当前瓶颈。
- 真正的瓶颈已经从“怎么设计”转成“先实现 Local API，再把 WebUI 最小闭环做出来”。

## 2. 当前 Pipeline 已完成的部分

- rollout 扫描与增量 ingest
- `session_index.jsonl` 读取、追加、compact
- SQLite 状态库
- revision / dirty tracking
- heuristic rename
- `backend = openai-compatible`
- `backend = codex`
  - 当前语义已经调整为：
    - 优先继承 `~/.codex/config.toml`
    - 优先继承 `~/.codex/auth.json`
    - 优先直连 HTTP
    - 仅在必要时回退 `codex exec`
- rename history
- manual override / freeze
- `config print`
- `provider test`
- auto-rename preview 的 cooldown / max-auto-rename 守卫
- Local API foundation

## 3. 当前 Pipeline 仍然存在的问题

### 3.1 auto-rename 已经闭环到 daemon auto-apply

当前 daemon 已经会在 `rename.auto_apply = "idle-finalize"` 时，对 `finalize_ready` 会话真正调用 `apply()`。

当前闭环范围：

- 统一仍然先走 `evaluateAutoRename()`
- 只对 `finalize_ready + 非 frozen + 非 manual_override + 非 cooldown` 的 session 生效
- `rename.auto_apply = "disabled"` 时，仍然保持 preview-only

当前剩余问题：

- 还没有“候选稳定一轮 scan 后再 apply”的额外保护
- 还没有把 ingest 增量信号真正纳入调度核心

### 3.2 “实质更新”阈值还没真正进入调度判断

配置里已经有：

- `min_rollout_growth_bytes`
- `min_task_complete_delta`

但当前 preview / finalize 判定主要还是：

- dirty
- idle
- cooldown
- max_auto_renames

影响：

- 还没完全达到最初设计里“不是每次小更新都触发”的目标

建议：

- 把每次 ingest 的：
  - `growthBytes`
  - `taskCompleteDelta`
  - `lastAgentChanged`
  持久化进 DB
- 调度器改成依赖这些信号，而不只依赖 revision/idle

### 3.3 startup 扫描仍然是 O(全部 rollout)

现在已经做了：

- 读取前先比对 `size + mtime`
- unchanged 文件跳过重新 ingest

但每轮 scan 仍然要：

- 枚举全部 rollout 文件
- 对每个文件 `stat`

影响：

- 历史 session 越多，启动和全量 sweep 越重

建议：

- 下一步引入目录级 cursor 或 watcher-first 模式
- 把“最近活跃 rollout 集合”单独缓存

### 3.4 `doctor` 还没有纳入 provider 连通性

现在 `provider test` 已经单独可用，但 `doctor` 还没有把 provider 诊断合并进去。

影响：

- 用户做环境检查时，要分两条命令看结果

建议：

- 把 `resolvedProvider` 摘要和最近一次 provider test 结果并进 `doctor`

### 3.5 compact 仍是“用户纪律安全”，不是“强并发安全”

当前 compact 的风险模型仍是：

- 建议用户在没有活跃 Codex 写入时执行

还没有：

- 与 Codex 建立共享锁协议
- 进程级写入协调

影响：

- 并发时仍有丢 append 风险

建议：

- 继续保持 compact 为手动维护命令
- 在 WebUI / CLI 上明确风险

### 3.6 WebUI / TUI 已经落地，但旧状态描述和当前实现脱节

领域层、本地 API、WebUI、TUI 现在都已经有可运行实现，真正的问题已经从“界面缺失”变成了“文档和信息架构滞后”。

影响：

- 新读者可能误以为当前仍然只有 CLI
- 一些老文档还在描述多页式 IA，而当前实现已经更偏统一控制面板
- API、WebUI、TUI 的扩展能力没有完全同步回规格文档

建议：

- 继续把当前实现回写到规格文档
- 保留历史设计稿，但明确标注其历史性质

## 4. 建议的下一阶段顺序

1. 完善 Local API 契约
2. `doctor` 合并 provider 诊断
3. auto-apply 真正闭环
4. 持久化“实质更新信号”
5. 统一旧规格文档与当前 UI / API 契约
6. 继续优化 WebUI / TUI 的默认阅读路径

## 5. 结论

目前最关键的结论有两条：

- Web / TUI / API 的实现已经接上，当前主要问题不再是“有没有入口”，而是“旧文档是否准确描述了当前入口和行为”。
- 现有 pipeline 最大的真实缺口不在 rename 核心，而在：
  - “实质更新”阈值还没真正进入调度判断
  - 文档与实现之间还有残留时差
  - UI 的信息架构和默认浏览路径仍需继续优化
