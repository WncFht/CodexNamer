import type { SessionSummary } from "@codexnamer/shared";

export function parseBooleanQuery(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }

  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }

  return undefined;
}

export function parseNumberQuery(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeSearchValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : undefined;
}

export async function filterAndSortSessions(
  sessions: SessionSummary[],
  query: Record<string, unknown> | undefined,
  options?: {
    loadDetailText?: (threadId: string) => {
      firstUserMessage?: string;
      lastUserMessage?: string;
      lastAgentMessage?: string;
    } | undefined;
  }
): Promise<SessionSummary[]> {
  const dirty = parseBooleanQuery(query?.dirty);
  const frozen = parseBooleanQuery(query?.frozen);
  const status = typeof query?.status === "string" ? query.status : undefined;
  const project = normalizeSearchValue(typeof query?.project === "string" ? query.project : undefined);
  const provider = normalizeSearchValue(typeof query?.provider === "string" ? query.provider : undefined);
  const workspace = normalizeSearchValue(typeof query?.workspace === "string" ? query.workspace : undefined);
  const search = normalizeSearchValue(typeof query?.search === "string" ? query.search : undefined);
  const sort = typeof query?.sort === "string" ? query.sort : "updatedAt";
  const order = query?.order === "asc" ? "asc" : "desc";
  const limit = parseNumberQuery(query?.limit);

  const filtered: SessionSummary[] = [];
  for (const item of sessions) {
    if (dirty !== undefined && item.dirty !== dirty) {
      continue;
    }
    if (frozen !== undefined && item.frozen !== frozen) {
      continue;
    }
    if (status && item.statusEstimate !== status) {
      continue;
    }
    if (project && !item.projectName?.toLowerCase().includes(project)) {
      continue;
    }
    if (provider && !item.provider?.toLowerCase().includes(provider)) {
      continue;
    }
    if (workspace) {
      const workspaceHaystack = [item.workspaceId, item.workspaceLabel, item.cwd]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!workspaceHaystack.includes(workspace)) {
        continue;
      }
    }
    if (search) {
      const detail = options?.loadDetailText?.(item.threadId);
      const haystack = [
        item.threadId,
        item.projectName,
        item.workspaceLabel,
        item.workspaceId,
        item.officialName,
        item.candidateName,
        item.provider,
        item.model,
        item.statusEstimate,
        detail?.firstUserMessage,
        detail?.lastUserMessage,
        detail?.lastAgentMessage
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search)) {
        continue;
      }
    }
    filtered.push(item);
  }

  const sorted = filtered.sort((left, right) => {
    const leftValue =
      sort === "project"
        ? left.projectName ?? ""
        : sort === "officialName"
          ? left.officialName ?? ""
          : left.updatedAt ?? "";
    const rightValue =
      sort === "project"
        ? right.projectName ?? ""
        : sort === "officialName"
          ? right.officialName ?? ""
          : right.updatedAt ?? "";

    const compare = String(leftValue).localeCompare(String(rightValue));
    return order === "asc" ? compare : -compare;
  });

  return limit && limit > 0 ? sorted.slice(0, limit) : sorted;
}
