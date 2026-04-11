import * as React from "react";

import { fetchAiRequestLogs } from "./api.js";
import { t, type UiLanguage } from "./i18n.js";
import { deriveRuntimeDisplay } from "./runtime-display.js";
import type {
  AiRequestLogDetailResponse,
  AiRequestLogResponse,
  AutoRenamePreviewResponse,
  DaemonControlStatus,
  DoctorResponse,
  OverviewResponse
} from "./types.js";
import type { AiRequestLogsSectionProps } from "./features/maintenance/AiRequestLogsSection.js";
import {
  buildFlowOption,
  buildPipelineOption,
  buildRenameActivityOption,
  buildRuleCoverageOption,
  buildSweepActionOption,
  buildSweepTrendOption
} from "./features/maintenance/chart-options.js";
import { OpsActionSection } from "./features/maintenance/OpsActionSection.js";
import { OpsOverviewSection } from "./features/maintenance/OpsOverviewSection.js";
import { OpsPrimaryChartsSection } from "./features/maintenance/OpsPrimaryChartsSection.js";

const OpsAdvancedSection = React.lazy(() =>
  import("./features/maintenance/OpsAdvancedSection.js").then((module) => ({ default: module.OpsAdvancedSection }))
);

export function RenameOpsPanel(props: {
  aiRequestLogs: AiRequestLogResponse | null;
  aiRequestLogDetail: AiRequestLogDetailResponse | null;
  overview: OverviewResponse | null;
  daemon: DaemonControlStatus | null;
  preview: AutoRenamePreviewResponse | null;
  previewRefreshing: boolean;
  doctor: DoctorResponse | null;
  uiLanguage: UiLanguage;
  selectedRequestLogId?: number;
  onSelectRequestLog: (id?: number) => void;
  onRefreshRuntime: () => void | Promise<void>;
  onRefreshPreview: (options?: { includeCandidateNames?: boolean; urgent?: boolean }) => void | Promise<void>;
  onOpenRequeue: () => void;
}) {
  const {
    aiRequestLogs: initialAiRequestLogs,
    aiRequestLogDetail,
    daemon,
    doctor,
    onRefreshPreview,
    onRefreshRuntime,
    onOpenRequeue,
    onSelectRequestLog,
    overview,
    preview,
    previewRefreshing,
    selectedRequestLogId,
    uiLanguage
  } = props;
  const LOGS_PER_PAGE = 10;
  const [logQuery, setLogQuery] = React.useState("");
  const [logProjectFilter, setLogProjectFilter] = React.useState("all");
  const [logStatusFilter, setLogStatusFilter] = React.useState<"all" | "running" | "succeeded" | "failed">("all");
  const [logTransportFilter, setLogTransportFilter] = React.useState<"all" | "responses" | "openai-compatible">("all");
  const [logPage, setLogPage] = React.useState(1);
  const [logPageInput, setLogPageInput] = React.useState("1");
  const [requestLogReport, setRequestLogReport] = React.useState<AiRequestLogResponse | null>(initialAiRequestLogs);
  const [requestLogLoading, setRequestLogLoading] = React.useState(false);
  const [advancedOpen, setAdvancedOpen] = React.useState(() => Boolean(selectedRequestLogId));
  const [advancedLoaded, setAdvancedLoaded] = React.useState(() => Boolean(selectedRequestLogId));
  const requestLogRequestIdRef = React.useRef(0);

  const tt = React.useCallback((key: Parameters<typeof t>[1]) => t(uiLanguage, key), [uiLanguage]);
  const isChinese = uiLanguage === "zh-CN";
  const inline = React.useCallback((zh: string, en: string) => (isChinese ? zh : en), [isChinese]);
  const appliedLabel = isChinese ? "已应用" : "Applied";
  const previewLabel = isChinese ? "仅预览" : "Preview";
  const skippedLabel = isChinese ? "已跳过" : "Skipped";
  const noDataLabel = isChinese ? "暂无数据" : "No data";

  const runtimeDisplay = deriveRuntimeDisplay(overview, daemon);
  const aiRequestLogs = requestLogReport ?? initialAiRequestLogs;
  const previewItems = React.useMemo(() => preview?.items ?? [], [preview?.items]);
  const previewApplyCount = previewItems.filter((item) => item.status === "apply").length;
  const previewSuggestCount = previewItems.filter((item) => item.status === "suggest").length;
  const lastSweepSummary = overview?.runtime.lastSweepSummary;
  const recentSweeps = React.useMemo(
    () => (overview?.runtime.recentSweeps ?? []).slice().reverse(),
    [overview?.runtime.recentSweeps]
  );
  const latestAiRequest = aiRequestLogs?.items[0];
  const ruleBacklogCount = (overview?.ruleCoverage.outdated ?? 0) + (overview?.ruleCoverage.unknown ?? 0);

  React.useEffect(() => {
    if (!advancedLoaded) {
      setRequestLogReport(initialAiRequestLogs);
    }
  }, [advancedLoaded, initialAiRequestLogs]);

  const loadRequestLogPage = React.useCallback(async () => {
    const requestId = ++requestLogRequestIdRef.current;
    setRequestLogLoading(true);
    try {
      const payload = await fetchAiRequestLogs({
        page: logPage,
        pageSize: LOGS_PER_PAGE,
        search: logQuery.trim() || undefined,
        project:
          logProjectFilter === "all"
            ? undefined
            : logProjectFilter === "__none__"
              ? "__none__"
              : logProjectFilter,
        status: logStatusFilter === "all" ? undefined : logStatusFilter,
        transport: logTransportFilter === "all" ? undefined : logTransportFilter
      });
      if (requestId !== requestLogRequestIdRef.current) {
        return;
      }
      setRequestLogReport(payload);
      if (payload.page !== logPage) {
        setLogPage(payload.page);
      }
    } finally {
      if (requestId === requestLogRequestIdRef.current) {
        setRequestLogLoading(false);
      }
    }
  }, [LOGS_PER_PAGE, logPage, logProjectFilter, logQuery, logStatusFilter, logTransportFilter]);

  React.useEffect(() => {
    if (!advancedLoaded) {
      return;
    }
    void loadRequestLogPage();
  }, [advancedLoaded, loadRequestLogPage]);

  React.useEffect(() => {
    setLogPage(1);
  }, [logProjectFilter, logQuery, logStatusFilter, logTransportFilter]);

  React.useEffect(() => {
    setLogPageInput(String(logPage));
  }, [logPage]);

  React.useEffect(() => {
    if (!aiRequestLogs || !selectedRequestLogId) {
      return;
    }
    const stillVisible = (aiRequestLogs.items ?? []).some((item) => item.id === selectedRequestLogId);
    if (!stillVisible) {
      onSelectRequestLog(undefined);
    }
  }, [aiRequestLogs, onSelectRequestLog, selectedRequestLogId]);

  React.useEffect(() => {
    if (!selectedRequestLogId) {
      return;
    }
    setAdvancedLoaded(true);
    setAdvancedOpen(true);
  }, [selectedRequestLogId]);

  const handleLogPageJump = React.useCallback(() => {
    const parsed = Number(logPageInput);
    if (!Number.isFinite(parsed)) {
      setLogPageInput(String(logPage));
      return;
    }
    const totalPages = Math.max(1, aiRequestLogs?.totalPages ?? 1);
    const nextPage = Math.max(1, Math.min(totalPages, Math.trunc(parsed)));
    setLogPage(nextPage);
    setLogPageInput(String(nextPage));
  }, [aiRequestLogs?.totalPages, logPage, logPageInput]);

  const projectOptions = React.useMemo(() => {
    return (aiRequestLogs?.projects ?? [])
      .map((project) => ({
        value: project.trim() ? project : "__none__",
        label: project.trim() ? project : noDataLabel
      }))
      .sort((left, right) => left.label.localeCompare(right.label, uiLanguage));
  }, [aiRequestLogs?.projects, noDataLabel, uiLanguage]);

  const visibleAiRequests = React.useMemo(() => aiRequestLogs?.items ?? [], [aiRequestLogs?.items]);
  const totalFilteredAiRequests = aiRequestLogs?.total ?? 0;
  const totalLogPages = Math.max(1, aiRequestLogs?.totalPages ?? (Math.ceil(totalFilteredAiRequests / LOGS_PER_PAGE) || 1));
  const filteredRunningCount = aiRequestLogs?.statusCounts.running ?? 0;
  const filteredFailedCount = aiRequestLogs?.statusCounts.failed ?? 0;
  const filteredSucceededCount = aiRequestLogs?.statusCounts.succeeded ?? 0;

  const activityOption = React.useMemo(
    () =>
      buildRenameActivityOption({
        overview,
        appliedLabel,
        previewLabel,
        skippedLabel
      }),
    [appliedLabel, overview, previewLabel, skippedLabel]
  );
  const pipelineOption = React.useMemo(
    () =>
      buildPipelineOption({
        overview,
        inline,
        uiLanguage
      }),
    [inline, overview, uiLanguage]
  );
  const flowOption = React.useMemo(
    () =>
      buildFlowOption({
        previewItems,
        uiLanguage
      }),
    [previewItems, uiLanguage]
  );
  const sweepTrendOption = React.useMemo(
    () =>
      buildSweepTrendOption({
        recentSweeps,
        inline,
        uiLanguage
      }),
    [inline, recentSweeps, uiLanguage]
  );
  const sweepActionOption = React.useMemo(
    () =>
      buildSweepActionOption({
        recentSweeps,
        inline,
        uiLanguage
      }),
    [inline, recentSweeps, uiLanguage]
  );
  const ruleCoverageOption = React.useMemo(
    () =>
      buildRuleCoverageOption({
        overview,
        inline,
        uiLanguage
      }),
    [inline, overview, uiLanguage]
  );

  const aiRequestLogsSectionProps: AiRequestLogsSectionProps = {
    LOGS_PER_PAGE,
    aiRequestLogDetail,
    aiRequestLogs,
    filteredFailedCount,
    filteredRunningCount,
    filteredSucceededCount,
    inline,
    latestAiRequest,
    logPage,
    logPageInput,
    logProjectFilter,
    logQuery,
    logStatusFilter,
    logTransportFilter,
    noDataLabel,
    onHandleLogPageJump: handleLogPageJump,
    onRefreshPreview,
    onRefreshRuntime,
    onReloadRequestLogs: loadRequestLogPage,
    onSelectRequestLog,
    onSetLogPage: setLogPage,
    onSetLogPageInput: setLogPageInput,
    onSetLogProjectFilter: setLogProjectFilter,
    onSetLogQuery: setLogQuery,
    onSetLogStatusFilter: setLogStatusFilter,
    onSetLogTransportFilter: setLogTransportFilter,
    previewRefreshing,
    projectOptions,
    requestLogLoading,
    selectedRequestLogId,
    totalFilteredAiRequests,
    totalLogPages,
    uiLanguage,
    visibleAiRequests
  };

  const handleAdvancedToggle = React.useCallback((event: React.SyntheticEvent<HTMLDetailsElement>) => {
    const nextOpen = event.currentTarget.open;
    setAdvancedOpen(nextOpen);
    if (nextOpen) {
      setAdvancedLoaded(true);
    }
  }, []);
  const openAdvanced = React.useCallback(() => {
    setAdvancedLoaded(true);
    setAdvancedOpen(true);
  }, []);

  return (
    <section className="panel-grid ops-layout">
      <OpsOverviewSection
        activeAiRequestCount={aiRequestLogs?.activeCount}
        inline={inline}
        lastSweepSummary={lastSweepSummary}
        onRefreshRuntime={onRefreshRuntime}
        overview={overview}
        previewApplyCount={previewApplyCount}
        previewSuggestCount={previewSuggestCount}
        ruleBacklogCount={ruleBacklogCount}
        runtimeDisplay={runtimeDisplay}
        uiLanguage={uiLanguage}
      />

      <OpsActionSection
        activeAiRequestCount={aiRequestLogs?.activeCount ?? 0}
        failedAiRequestCount={aiRequestLogs?.statusCounts.failed ?? 0}
        inline={inline}
        onOpenDiagnostics={openAdvanced}
        onOpenLogs={openAdvanced}
        onOpenRequeue={onOpenRequeue}
        onRefreshPreview={() =>
          onRefreshPreview({
            includeCandidateNames: true,
            urgent: true
          })
        }
        onRefreshRuntime={onRefreshRuntime}
        previewApplyCount={previewApplyCount}
        previewRefreshing={previewRefreshing}
        previewSuggestCount={previewSuggestCount}
        ruleBacklogCount={ruleBacklogCount}
        uiLanguage={uiLanguage}
      />

      <section className="detail-panel ops-span-wide">
        <div className="panel-topline">
          <div>
            <p className="panel-kicker">{inline("趋势", "Trends")}</p>
            <h3>{inline("趋势与覆盖图", "Trend and coverage charts")}</h3>
            <p className="settings-copy">
              {inline(
                "图表保留给二级分析：先做动作判断，再展开看 sweep 趋势和规则覆盖。",
                "Charts stay in the secondary layer: decide on the next action first, then expand sweep and coverage trends."
              )}
            </p>
          </div>
        </div>
        <details className="settings-disclosure ops-disclosure">
          <summary>{inline("展开趋势与覆盖图", "Show trend and coverage charts")}</summary>
          <div className="ops-disclosure-grid">
            <OpsPrimaryChartsSection inline={inline} ruleCoverageOption={ruleCoverageOption} sweepTrendOption={sweepTrendOption} />
          </div>
        </details>
      </section>

      <section className="detail-panel ops-span-wide">
        <div className="panel-topline">
          <div>
            <p className="panel-kicker">{inline("高级", "Advanced")}</p>
            <h3>{inline("请求日志与深度诊断", "Request logs and deep diagnostics")}</h3>
            <p className="settings-copy">
              {inline(
                "模型请求日志和 doctor 原始诊断都保留，但默认收起，避免概览页一打开就进入排障模式。",
                "Request logs and doctor output stay available, but folded by default so the overview does not open straight into debugging mode."
              )}
            </p>
          </div>
        </div>
        <details className="settings-disclosure ops-disclosure" onToggle={handleAdvancedToggle} open={advancedOpen}>
          <summary>{inline("展开更多分析与诊断", "Show more analysis and diagnostics")}</summary>
          {advancedLoaded ? (
            <React.Suspense fallback={<div className="loading-state app-panel-loading">{tt("loading")}</div>}>
              <OpsAdvancedSection
                activityOption={activityOption}
                aiRequestLogsSectionProps={aiRequestLogsSectionProps}
                doctor={doctor}
                flowOption={flowOption}
                inline={inline}
                pipelineOption={pipelineOption}
                sweepActionOption={sweepActionOption}
              />
            </React.Suspense>
          ) : null}
        </details>
      </section>
    </section>
  );
}
