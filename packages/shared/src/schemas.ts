import { z } from "zod";

export const sessionIndexEntrySchema = z.object({
  id: z.string().min(1),
  thread_name: z.string().min(1),
  updated_at: z.string().min(1)
});

export const sessionIndexEntryWireSchema = sessionIndexEntrySchema.transform((value) => ({
  id: value.id,
  threadName: value.thread_name,
  updatedAt: value.updated_at
}));

