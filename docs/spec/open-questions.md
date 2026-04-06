# 开放问题

这些问题不阻塞 v1 开工，但需要在实现早期尽快收敛。

## 1. AI 默认后端到底选什么

候选：

- `backend = codex`
- `backend = openai-compatible`
- `backend = none`

当前建议：

- 默认 `codex`
- 但其含义更新为：
  - 优先继承 Codex 的 provider / model / auth
  - 优先直连 HTTP
  - 必要时才回退 `codex exec`

## 2. TUI 是否在 v1 内完成

当前现状：

- TUI 已经在仓库中实现并可运行。

当前更合理的问题是：

- 是否要继续把 TUI 保持为高密度运维视图
- 是否要拆成更明确的 `Browser / Transcript / Rename / Settings` 模式
- 是否要和 WebUI 的默认阅读路径进一步对齐

## 3. project name 如何定义

候选：

- `basename(cwd)`
- git repo 根目录名
- 用户手动映射

当前建议：

- 优先 git repo 根目录名
- 回退到 `basename(cwd)`

## 4. dirty 的严格定义是否需要更多字段

当前 revision 只考虑内容与结果字段，不考虑外部名字变化。

待确认：

- 是否应把 token_total 纳入 dirty 判定
- 是否应忽略非常短的 agent message 波动

## 5. 批量 rename 是否需要事务式回滚

当前建议：

- v1 不做强事务回滚
- 记录每项成功/失败
- 提供失败重试

## 6. `codex exec` fallback 的 prompt 和输出约束

需要后续定稿：

- prompt 模板
- JSON 输出约束
- 超时与失败回退

## 9. auto-rename 在正式 apply 之后还缺什么保护

当前现状：

- daemon 已经可以在 `idle-finalize` 下正式 auto-apply

当前更合理的问题是：

- 是否要增加“候选稳定一轮 scan 后再 apply”
- 是否要把 `growthBytes / taskCompleteDelta` 引入正式 apply 判定

## 10. “实质更新”阈值何时进入调度核心

当前现状：

- 配置里已有 `min_rollout_growth_bytes` / `min_task_complete_delta`
- 但调度逻辑还没有真正消费这些信号

当前建议：

- 下一阶段把 ingest 增量信号持久化进 DB
- 再让 auto-rename 判定依赖这些字段，而不只依赖 revision/idle

## 7. 是否需要导入已有手工名字为“受保护状态”

当前建议：

- 只要检测到最新官方名不是本项目上次写入的结果
- 就视为 manual override

## 8. 是否支持 rename undo

当前建议：

- v1 不提供完整 undo 栈
- 只支持“恢复到上一条成功 name”
