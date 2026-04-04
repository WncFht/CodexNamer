# 测试与可观测性

## 测试目标

这个项目最容易出问题的不是“页面不好看”，而是：

- dirty 判定不稳定
- 自动 rename 频率失控
- 写回 index 语义错误
- compact 破坏 latest-wins
- manual override 被误覆盖

所以测试应优先覆盖这些高风险点。

## 测试层次

### 1. 单元测试

重点覆盖：

- rollout 解析
- revision 构建
- 模板渲染
- heuristic rename
- cooldown 判断
- dirty 判定
- compact 算法

### 2. 集成测试

重点覆盖：

- 从 rollout 解析到本地 DB 落库
- 从候选名到 `session_index.jsonl` 追加
- 批量 rename dirty sessions
- manual override 检测

### 3. 端到端测试

重点覆盖：

- daemon 跑起来后扫描本地 fixture
- WebUI/CLI 对同一 session 的视图一致
- compact 前后结果一致

## 必测场景

### session_index writer

- 写入空名字应拒绝
- 写入与当前最新名字相同应跳过
- 连续两次写入不同名字应保留 latest-wins

### dirty tracking

- revision 不变时不应标 dirty
- `last_agent_message` 变化时应标 dirty
- 只改官方 name 不应把内容 revision 误判为 dirty

### 自动 rename

- 活跃 session 不应频繁写
- idle 到阈值后应进入 finalize_ready
- cooldown 中不应重复 apply
- 达到 `max_auto_renames_per_session` 后停止自动 apply

### manual override

- 外部新名字不是我们写的时，应标记 manual override
- manual override 后自动 apply 应停止

### compact

- compact 后同一 `thread_id` 只保留最后一条
- compact 后按 name 查找的 latest 语义保持不变
- compact 失败不应破坏原文件

## fixture 设计

应准备：

- 最小 rollout fixture
- 多次 `task_complete` 的 rollout fixture
- 有外部 rename 的 `session_index` fixture
- 同名不同 thread fixture
- 大文件 `session_index` fixture

## 诊断指标

daemon 应暴露：

- `sessions_scanned_total`
- `sessions_dirty_total`
- `rename_candidates_generated_total`
- `rename_apply_attempts_total`
- `rename_apply_success_total`
- `rename_apply_skipped_total`
- `manual_override_detected_total`
- `session_index_compact_total`
- `session_index_compact_fail_total`

## 运行日志

日志事件建议：

- `scan_started`
- `scan_completed`
- `session_discovered`
- `session_revision_changed`
- `candidate_generated`
- `rename_applied`
- `rename_skipped`
- `manual_override_detected`
- `compact_started`
- `compact_completed`
- `compact_failed`

## doctor 输出

`codex-session doctor` 至少输出：

- codex_home 是否存在
- rollout 目录是否可读
- session_index 是否可读写
- daemon 是否在线
- DB 是否健康
- 当前自动 rename 参数
- 最近 24 小时 rename 统计

## 验收口径

v1 验收至少满足：

- 对同一组 fixture，重复跑两次结果一致
- 批量 dirty rename 不会重复写完全相同的名字
- compact 前后，任意 thread 的最终 name 一致
