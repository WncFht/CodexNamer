import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@codex-session-manager/core": path.resolve("packages/core/src/index.ts"),
      "@codex-session-manager/shared": path.resolve("packages/shared/src/index.ts")
    }
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"]
  }
});
