# 维护与压缩

## 背景

`session_index.jsonl` 是 append-only 文件。长期来看，如果自动 rename 设计不当，
它会持续增长。

设计目标不是“频繁清理”，而是：

1. 先减少无意义写入。
2. 再提供安全、低频、离线的 compact。

## 当前观测

基于本机 `2026-04-04` 的现状：

- 文件路径：`~/.codex/session_index.jsonl`
- 大小约 `25KB`
- 行数 `178`
- 唯一 `thread_id` 数量 `176`
- 重复 id 数量 `2`

这说明当前远未达到性能瓶颈，但设计上仍需要 compact 方案。

## 先控写，不先清理

项目应优先通过写入策略控制增长：

- 候选名只存本地 DB，不立刻写官方 index
- 只有正式 apply 时才 append
- 新名字与当前官方 name 一致时不写
- 单个 session 自动 apply 次数默认限制为 2
- 冷却期内不重复写

## 为什么不能自动后台 compact

原因：

- Codex 自己也可能正在 append `session_index.jsonl`
- 官方没有暴露共享锁协议
- 后台自动 rewrite 容易和 Codex 并发冲突

所以 compact 必须被定义为：

- 低频
- 显式
- 离线
- 可备份

## compact 的正确语义

compact 不能简单去重名字，而必须保持官方 latest-wins 语义。

正确算法：

1. 完整读取 `session_index.jsonl`
2. 对每个 `thread_id` 只保留最后一条记录
3. 按“最后出现的原始顺序”写出
4. 写入临时文件
5. `fsync`
6. 备份旧文件
7. 原子替换

这样保留两件事：

- `thread_id -> 最新 name`
- 同名 thread 的“最近一次命名记录”仍然在后面

## compact 前置检查

默认要求：

- 没有活跃的 `codex` 进程
- `session_index.jsonl` 可读可写
- 磁盘空间足够容纳临时文件和备份

若检测到活跃 Codex：

- 默认拒绝执行
- 允许 `--force`，但 UI 要明确高风险提示

## 建议阈值

当满足任一项时，在 UI 中提示可 compact：

- 文件超过 `5MB`
- 或超过 `20,000` 行
- 或批量 session 名查询明显变慢

## 维护页面指标

WebUI / CLI `doctor` 应展示：

- 文件大小
- 总行数
- 唯一 thread 数
- 重复记录数
- 最近 compact 时间
- 最近 compact 节省比例
- 最近写入频率

## 备份策略

compact 前自动生成：

- `~/.local/state/codex-session-manager/backups/session_index-YYYYMMDDTHHMMSSZ.jsonl`

默认保留：

- 最近 `20` 个备份
- 或最近 `30` 天

## 日志与 DB 维护

除了 index compact，还要支持：

- 项目日志轮转
- 删除超过 `30` 天的诊断日志
- 定期 `VACUUM app.db`
- 删除 orphaned ingest cursors
- 删除已不存在 rollout 的缓存记录

## 失败恢复

compact 失败时：

- 不覆盖原文件
- 保留临时文件以便诊断
- 记录失败原因到 maintenance history

## 维护命令

CLI：

```bash
codex-session compact-index
codex-session compact-index --dry-run
codex-session compact-index --force
codex-session doctor
codex-session maintenance prune
```

## 维护历史

建议在 `rename_history` 之外单独记录 maintenance 操作：

- 操作时间
- 操作类型
- 输入文件大小
- 输出文件大小
- 节省行数
- 是否成功
- 错误消息
