import { z } from "zod";

import type {
  AiRequestLogQuery,
  BatchApplyRequest,
  ConfigDocument,
  ConfigUpdateRequest,
  DaemonStartRequest,
  PromptPreviewRequest,
  ProviderTestRequest,
  RenameReplayRequest,
  RenameRequest,
  SessionDetailQuery,
  SessionListQuery,
  SessionTranscriptQuery,
} from "./types.js";

const sessionStatusEstimateSchema = z.enum([
  "discovered",
  "active",
  "candidate_ready",
  "finalize_ready",
  "applied",
  "idle",
  "archived_hint",
  "missing",
]);

const transcriptRoleSchema = z.enum(["all", "user", "assistant", "tool", "system"]);
const sessionSortFieldSchema = z.enum(["updatedAt", "project", "officialName"]);
const sortOrderSchema = z.enum(["asc", "desc"]);
const aiRequestStatusSchema = z.enum(["running", "succeeded", "failed"]);
const aiRequestTransportSchema = z.enum(["responses", "openai-compatible"]);
const replayBasisSchema = z.enum(["session-updated-at", "last-applied-at"]);

const optionalTrimmedStringSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().optional());

const optionalBooleanLikeSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value === true || value === "true") {
    return true;
  }
  if (value === false || value === "false") {
    return false;
  }
  return value;
}, z.boolean().optional());

const optionalPositiveIntegerSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "string") {
    return Number(value);
  }
  return value;
}, z.number().int().positive().optional());

const looseConfigDocumentSchema = z.object({}).catchall(z.unknown()) as z.ZodType<ConfigDocument>;

export const sessionIndexEntrySchema = z.object({
  id: z.string().min(1),
  thread_name: z.string().min(1),
  updated_at: z.string().min(1),
});

export const sessionIndexEntryWireSchema = sessionIndexEntrySchema.transform((value) => ({
  id: value.id,
  threadName: value.thread_name,
  updatedAt: value.updated_at,
}));

export const sessionListQuerySchema: z.ZodType<SessionListQuery> = z.object({
  dirty: optionalBooleanLikeSchema,
  frozen: optionalBooleanLikeSchema,
  status: z.preprocess(
    (value) => (value === "" ? undefined : value),
    sessionStatusEstimateSchema.optional(),
  ),
  project: optionalTrimmedStringSchema,
  provider: optionalTrimmedStringSchema,
  workspace: optionalTrimmedStringSchema,
  search: optionalTrimmedStringSchema,
  sort: z.preprocess(
    (value) => (value === "" ? undefined : value),
    sessionSortFieldSchema.optional(),
  ),
  order: z.preprocess((value) => (value === "" ? undefined : value), sortOrderSchema.optional()),
  limit: optionalPositiveIntegerSchema,
});

export const sessionDetailQuerySchema: z.ZodType<SessionDetailQuery> = z.object({
  includeTranscript: optionalBooleanLikeSchema,
});

export const sessionTranscriptQuerySchema: z.ZodType<SessionTranscriptQuery> = z.object({
  page: optionalPositiveIntegerSchema,
  pageSize: optionalPositiveIntegerSchema,
  includeHidden: optionalBooleanLikeSchema,
  role: z.preprocess(
    (value) => (value === "" ? undefined : value),
    transcriptRoleSchema.optional(),
  ),
  query: optionalTrimmedStringSchema,
});

export const renameRequestSchema: z.ZodType<RenameRequest> = z.object({
  name: z.string().trim().min(1),
});

export const batchApplyRequestSchema: z.ZodType<BatchApplyRequest> = z.object({
  filter: z
    .object({
      dirty: z.boolean().optional(),
    })
    .optional(),
  previewOnly: z.boolean().optional(),
});

export const providerTestRequestSchema: z.ZodType<ProviderTestRequest> = z.object({
  userConfig: looseConfigDocumentSchema.optional(),
});

export const promptPreviewRequestSchema: z.ZodType<PromptPreviewRequest> = z.object({
  threadId: optionalTrimmedStringSchema,
  userConfig: looseConfigDocumentSchema.optional(),
});

export const aiRequestLogQuerySchema: z.ZodType<AiRequestLogQuery> = z.object({
  limit: optionalPositiveIntegerSchema,
  page: optionalPositiveIntegerSchema,
  pageSize: optionalPositiveIntegerSchema,
  search: optionalTrimmedStringSchema,
  project: optionalTrimmedStringSchema,
  status: z.preprocess(
    (value) => (value === "" ? undefined : value),
    aiRequestStatusSchema.optional(),
  ),
  transport: z.preprocess(
    (value) => (value === "" ? undefined : value),
    aiRequestTransportSchema.optional(),
  ),
});

export const configUpdateRequestSchema: z.ZodType<ConfigUpdateRequest> = z
  .union([
    z
      .object({
        userConfig: looseConfigDocumentSchema.optional(),
      })
      .strict(),
    looseConfigDocumentSchema.transform((userConfig) => ({ userConfig })),
  ])
  .transform((value) => ({
    userConfig: value.userConfig ?? {},
  }));

export const renameReplayRequestSchema: z.ZodType<RenameReplayRequest> = z.object({
  since: z.string().trim().min(1),
  basis: replayBasisSchema.default("session-updated-at"),
});

export const daemonStartRequestSchema: z.ZodType<DaemonStartRequest> = z.object({
  intervalSeconds: optionalPositiveIntegerSchema,
});
