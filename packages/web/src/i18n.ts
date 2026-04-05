import type { ConfigView } from "./types.js";

export type UiLanguage = "en-US" | "zh-CN";

const COPY = {
  "en-US": {
    allWorkspaces: "All workspaces",
    sessions: "Sessions",
    settings: "Settings",
    maintenance: "Maintenance",
    renameOps: "Rename Ops",
    workspaces: "Workspaces",
    visible: "Visible",
    applyQueue: "Apply queue",
    suggestQueue: "Suggest queue",
    selected: "Selected",
    lastSync: "Last Sync",
    refresh: "Refresh",
    refreshing: "Refreshing...",
    reload: "Reload",
    saveSettings: "Save settings",
    savingSettings: "Saving...",
    conversationArchive: "Conversation Archive",
    sessionCountSuffix: "sessions",
    showSessions: "Show Sessions",
    hideSessions: "Hide Sessions",
    dirtyOnly: "Dirty only",
    searchSessionsLabel: "Search sessions",
    filterSessions: "Filter sessions...",
    loadingSessions: "Loading sessions...",
    apiNotReady: "API not ready yet. The dashboard will retry automatically.",
    noSessions: "No sessions matched the current filter.",
    selectedSession: "Selected Session",
    unknownProvider: "unknown provider",
    unknownModel: "unknown model",
    dirty: "dirty",
    clean: "clean",
    frozen: "已冻结",
    manual: "manual",
    suggest: "Suggest",
    suggesting: "Suggesting...",
    apply: "Apply",
    applying: "Applying...",
    freeze: "Freeze",
    freezing: "Freezing...",
    unfreeze: "Unfreeze",
    unfreezing: "Unfreezing...",
    manualOverride: "Manual Override",
    clearManual: "Clear Manual",
    clearing: "Clearing...",
    saving: "Saving...",
    loadingSessionDetail: "Loading session detail...",
    timeline: "Timeline",
    renameHistory: "Rename history",
    noRenameHistory: "No rename history yet.",
    selectSessionHint: "Select a session to inspect transcript and rename history.",
    transcript: "Transcript",
    searchConversationLabel: "Search conversation",
    searchConversation: "Search in conversation...",
    showHidden: "Show hidden",
    visibleCount: "visible",
    hiddenCount: "hidden",
    toolEvents: "tool events",
    matched: "matched",
    loading: "Loading...",
    loadEarlierMessages: "Load earlier messages",
    noTranscript: "No transcript events matched the current filters.",
    controlState: "Control State",
    renameActivity: "Rename activity and queue health",
    indexedSessions: "Indexed sessions",
    dirtyQueue: "Dirty queue",
    aiApplied: "AI applied",
    manualControls: "Manual controls",
    pipeline: "Pipeline",
    renameSources: "Rename Sources",
    style: "Style",
    naming: "Naming",
    scheduler: "Scheduler",
    autoRenameWatch: "Auto Rename Watch",
    provider: "Provider",
    ai: "AI",
    housekeeping: "Housekeeping",
    runtime: "Runtime",
    resolvedEnvironment: "Resolved Environment",
    promptPreview: "AI prompt preview",
    promptPreviewCopy: "This is the exact prompt currently sent to the AI backend for naming.",
    promptForSelected: "Prompt for selected session",
    promptSynthetic: "Prompt for synthetic fallback",
    loadingPrompt: "Loading prompt preview...",
    selectedProfile: "Selected profile",
    uiLanguage: "UI language",
    language: "Language",
    defaultNamingStyle: "Default naming style",
    activeNamingStyle: "Naming style",
    preferredNamingStyle: "Preferred style",
    officialNamingStyle: "Official style",
    followDefault: "Follow default",
    detailed: "Detailed",
    brief: "Brief",
    maxLength: "Max length",
    contextStrategy: "Context strategy",
    contextMaxChars: "Context max chars",
    template: "Template",
    preset: "Preset",
    autoApply: "Auto apply",
    manualOverrideWins: "Manual override wins",
    freezeManualName: "Freeze manual name",
    scanInterval: "Scan interval",
    candidateIdle: "Candidate idle",
    finalizeIdle: "Finalize idle",
    renameCooldown: "Rename cooldown",
    minRolloutGrowth: "Min rollout growth",
    minTaskDelta: "Min task delta",
    maxAutoRenames: "Max auto renames / session",
    backend: "Backend",
    providerSource: "Provider source",
    activeProfile: "Active profile",
    editProfile: "Edit profile",
    timeoutSeconds: "Timeout seconds",
    temperature: "Temperature",
    displayName: "Display name",
    backendKind: "Backend kind",
    profileSource: "Profile source",
    providerRef: "Provider ref",
    baseUrl: "Base URL",
    model: "Model",
    wireApi: "Wire API",
    apiKey: "API key",
    apiKeyRef: "API key ref",
    enabled: "Enabled",
    defaultProfile: "Default profile",
    suggestCompactMb: "Suggest compact above MB",
    suggestCompactLines: "Suggest compact above lines",
    backupBeforeCompact: "Backup before compact",
    userConfig: "User config",
    projectOverride: "Project override",
    resolvedBackend: "Resolved backend",
    resolvedTransport: "Resolved transport",
    inheritedModelProvider: "Inherited model provider",
    inheritedModel: "Inherited model",
    inspectResolvedProvider: "Inspect resolved provider payload",
    doctor: "Doctor",
    autoRenamePreview: "Auto rename preview",
    status: "Status",
    reason: "Reason",
    candidateName: "Candidate",
    noPreviewLoaded: "No preview loaded.",
    warmEditorial: "Warm editorial control surface for session naming, history, and runtime observability.",
    open: "Open",
    fold: "Fold",
    expandWorkspacePane: "Expand workspace pane",
    collapseWorkspacePane: "Collapse workspace pane",
    resizeWorkspacePane: "Resize workspace pane",
    resizeSessionList: "Resize session list",
    candidateReady: "Candidate Ready",
    finalizeReady: "Finalize Ready",
    today: "Today",
    yesterday: "Yesterday",
    thisWeek: "This Week",
    thisMonth: "This Month",
    earlier: "Earlier",
    nA: "n/a"
  },
  "zh-CN": {
    allWorkspaces: "全部工作区",
    sessions: "会话",
    settings: "设置",
    maintenance: "维护",
    renameOps: "运行态",
    workspaces: "工作区",
    visible: "可见",
    applyQueue: "应用队列",
    suggestQueue: "建议队列",
    selected: "当前选择",
    lastSync: "上次同步",
    refresh: "刷新",
    refreshing: "刷新中...",
    reload: "重新加载",
    saveSettings: "保存设置",
    savingSettings: "保存中...",
    conversationArchive: "会话归档",
    sessionCountSuffix: "个会话",
    showSessions: "显示会话",
    hideSessions: "隐藏会话",
    dirtyOnly: "仅看 dirty",
    searchSessionsLabel: "搜索会话",
    filterSessions: "筛选会话...",
    loadingSessions: "正在加载会话...",
    apiNotReady: "API 还没有就绪，面板会自动重试。",
    noSessions: "当前筛选条件下没有匹配会话。",
    selectedSession: "当前会话",
    unknownProvider: "未知 provider",
    unknownModel: "未知模型",
    dirty: "dirty",
    clean: "clean",
    frozen: "frozen",
    manual: "manual",
    suggest: "建议命名",
    suggesting: "建议中...",
    apply: "应用命名",
    applying: "应用中...",
    freeze: "冻结",
    freezing: "冻结中...",
    unfreeze: "解冻",
    unfreezing: "解冻中...",
    manualOverride: "手动覆盖",
    clearManual: "清除手动覆盖",
    clearing: "清除中...",
    saving: "保存中...",
    loadingSessionDetail: "正在加载会话详情...",
    timeline: "时间线",
    renameHistory: "命名历史",
    noRenameHistory: "还没有命名历史。",
    selectSessionHint: "选择一个会话以查看 transcript 和命名历史。",
    transcript: "对话记录",
    searchConversationLabel: "搜索对话",
    searchConversation: "在对话中搜索...",
    showHidden: "显示隐藏项",
    visibleCount: "可见",
    hiddenCount: "隐藏",
    toolEvents: "工具事件",
    matched: "匹配",
    loading: "加载中...",
    loadEarlierMessages: "加载更早消息",
    noTranscript: "当前筛选条件下没有匹配的 transcript 事件。",
    controlState: "控制状态",
    renameActivity: "命名活动与队列健康度",
    indexedSessions: "已索引会话",
    dirtyQueue: "待处理队列",
    aiApplied: "AI 已应用",
    manualControls: "手动控制",
    pipeline: "流水线",
    renameSources: "命名来源",
    style: "样式",
    naming: "命名",
    scheduler: "调度器",
    autoRenameWatch: "自动命名监控",
    provider: "提供方",
    ai: "AI",
    housekeeping: "整理",
    runtime: "运行时",
    resolvedEnvironment: "解析后的环境",
    promptPreview: "AI Prompt 预览",
    promptPreviewCopy: "这里展示当前真正发送给 AI 命名后端的 prompt。",
    promptForSelected: "当前选中会话的 prompt",
    promptSynthetic: "synthetic 回退 prompt",
    loadingPrompt: "正在加载 prompt 预览...",
    selectedProfile: "当前配置",
    uiLanguage: "界面语言",
    language: "语言",
    defaultNamingStyle: "默认命名风格",
    activeNamingStyle: "命名风格",
    preferredNamingStyle: "偏好风格",
    officialNamingStyle: "正式名称风格",
    followDefault: "跟随默认",
    detailed: "详细",
    brief: "简略",
    maxLength: "最大长度",
    contextStrategy: "上下文策略",
    contextMaxChars: "上下文最大字符数",
    template: "模板",
    preset: "预设",
    autoApply: "自动应用",
    manualOverrideWins: "手动覆盖优先",
    freezeManualName: "冻结手动命名",
    scanInterval: "扫描间隔",
    candidateIdle: "候选空闲阈值",
    finalizeIdle: "终稿空闲阈值",
    renameCooldown: "重命名冷却",
    minRolloutGrowth: "最小会话增长字节",
    minTaskDelta: "最小任务完成增量",
    maxAutoRenames: "每会话自动重命名上限",
    backend: "后端",
    providerSource: "提供方来源",
    activeProfile: "当前配置",
    editProfile: "编辑配置",
    timeoutSeconds: "超时时间",
    temperature: "温度",
    displayName: "显示名",
    backendKind: "后端类型",
    profileSource: "配置来源",
    providerRef: "提供方引用",
    baseUrl: "接口地址",
    model: "模型",
    wireApi: "接口协议",
    apiKey: "API Key",
    apiKeyRef: "API Key 引用",
    enabled: "启用",
    defaultProfile: "默认配置",
    suggestCompactMb: "超过多少 MB 时建议压缩",
    suggestCompactLines: "超过多少行时建议压缩",
    backupBeforeCompact: "压缩前自动备份",
    userConfig: "用户配置",
    projectOverride: "项目覆盖",
    resolvedBackend: "解析后后端",
    resolvedTransport: "解析后传输",
    inheritedModelProvider: "继承的模型提供方",
    inheritedModel: "继承的模型",
    inspectResolvedProvider: "查看解析后的 provider 载荷",
    doctor: "诊断",
    autoRenamePreview: "自动命名预览",
    status: "状态",
    reason: "原因",
    candidateName: "候选名",
    noPreviewLoaded: "还没有加载预览。",
    warmEditorial: "用于会话命名、历史查看与运行态观测的控制台。",
    open: "展开",
    fold: "折叠",
    expandWorkspacePane: "展开工作区侧栏",
    collapseWorkspacePane: "折叠工作区侧栏",
    resizeWorkspacePane: "调整工作区侧栏宽度",
    resizeSessionList: "调整会话列表宽度",
    candidateReady: "候选已就绪",
    finalizeReady: "可直接应用",
    today: "今天",
    yesterday: "昨天",
    thisWeek: "本周",
    thisMonth: "本月",
    earlier: "更早",
    nA: "无"
  }
} as const;

export function normalizeUiLanguage(configView?: ConfigView | null): UiLanguage {
  const raw = (configView?.effectiveConfig as Record<string, unknown> | undefined)?.general as
    | Record<string, unknown>
    | undefined;
  return raw?.uiLanguage === "zh-CN" ? "zh-CN" : "en-US";
}

export function t(language: UiLanguage, key: keyof typeof COPY["en-US"]): string {
  return COPY[language][key];
}

export function formatUiWhen(value: string | undefined | null, language: UiLanguage): string {
  if (!value) {
    return t(language, "nA");
  }
  return new Date(value).toLocaleString(language, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function formatUiNumber(value: number | undefined, language: UiLanguage): string {
  return new Intl.NumberFormat(language).format(value ?? 0);
}

export function sessionStatusLabel(status: string | undefined, language: UiLanguage): string {
  const map =
    language === "zh-CN"
      ? {
          discovered: "已发现",
          active: "活跃中",
          candidate_ready: "候选就绪",
          finalize_ready: "可终稿",
          applied: "已应用",
          idle: "空闲",
          archived_hint: "疑似归档",
          missing: "缺失"
        }
      : {
          discovered: "Discovered",
          active: "Active",
          candidate_ready: "Candidate Ready",
          finalize_ready: "Finalize Ready",
          applied: "Applied",
          idle: "Idle",
          archived_hint: "Archive Hint",
          missing: "Missing"
        };
  return map[status as keyof typeof map] ?? status ?? "unknown";
}

export function autoRenameStatusLabel(status: string, language: UiLanguage): string {
  const map =
    language === "zh-CN"
      ? { skip: "跳过", suggest: "建议", apply: "应用" }
      : { skip: "Skip", suggest: "Suggest", apply: "Apply" };
  return map[status as keyof typeof map] ?? status;
}

export function autoRenameReasonLabel(reason: string, language: UiLanguage): string {
  const map =
    language === "zh-CN"
      ? {
          manual_override: "手动覆盖保护",
          frozen: "已冻结",
          max_auto_renames_reached: "达到自动命名上限",
          rename_cooldown: "处于重命名冷却期",
          candidate_ready: "已达到候选建议阈值",
          finalize_ready: "已达到最终应用阈值",
          discovered: "内容不足",
          active: "仍在活跃更新",
          applied: "已经应用",
          idle: "空闲中",
          archived_hint: "疑似归档",
          missing: "会话缺失"
        }
      : {
          manual_override: "Manual Override",
          frozen: "Frozen",
          max_auto_renames_reached: "Max Auto Renames Reached",
          rename_cooldown: "Rename Cooldown",
          candidate_ready: "Ready To Suggest",
          finalize_ready: "Ready To Apply",
          discovered: "Insufficient Content",
          active: "Still Active",
          applied: "Already Applied",
          idle: "Idle",
          archived_hint: "Archive Hint",
          missing: "Missing"
        };
  return map[reason as keyof typeof map] ?? reason;
}

export function namingStyleLabel(style: "brief" | "detailed", language: UiLanguage): string {
  if (style === "detailed") {
    return t(language, "detailed");
  }
  return t(language, "brief");
}

export function transcriptRoleLabel(role: string, language: UiLanguage): string {
  const map =
    language === "zh-CN"
      ? { all: "全部", user: "用户", assistant: "助手", tool: "工具", system: "系统" }
      : { all: "all", user: "user", assistant: "assistant", tool: "tool", system: "system" };
  return map[role as keyof typeof map] ?? role;
}

export function timeGroupLabel(label: string, language: UiLanguage): string {
  const map =
    language === "zh-CN"
      ? {
          Today: COPY["zh-CN"].today,
          Yesterday: COPY["zh-CN"].yesterday,
          "This Week": COPY["zh-CN"].thisWeek,
          "This Month": COPY["zh-CN"].thisMonth,
          Earlier: COPY["zh-CN"].earlier
        }
      : {
          Today: COPY["en-US"].today,
          Yesterday: COPY["en-US"].yesterday,
          "This Week": COPY["en-US"].thisWeek,
          "This Month": COPY["en-US"].thisMonth,
          Earlier: COPY["en-US"].earlier
        };
  return map[label as keyof typeof map] ?? label;
}
