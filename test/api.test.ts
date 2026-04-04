import { afterEach, describe, expect, it } from "vitest";

import { buildApiServer } from "../packages/api/src/app.ts";

import { createManagerForTest, createTempWorkspace, writeRolloutFixture } from "./helpers.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length > 0) {
    const action = cleanup.pop();
    if (action) {
      await action();
    }
  }
});

describe("local api", () => {
  it("serves health and sessions endpoints", async () => {
    const workspace = await createTempWorkspace();
    const manager = await createManagerForTest({
      codexHome: workspace.codexHome,
      stateDir: workspace.stateDir
    });
    cleanup.push(async () => manager.close());

    await writeRolloutFixture({
      codexHome: workspace.codexHome,
      threadId: "019d-api-1",
      userMessage: "实现 local api",
      lastAgentMessage: "已经补上 health 和 sessions 路由"
    });
    await manager.scan();

    const app = await buildApiServer({ manager, operator: "api-test" });
    cleanup.push(async () => {
      await app.close();
    });

    const health = await app.inject({
      method: "GET",
      url: "/api/v1/health"
    });
    expect(health.statusCode).toBe(200);
    expect(health.json().ok).toBe(true);

    const sessions = await app.inject({
      method: "GET",
      url: "/api/v1/sessions"
    });
    expect(sessions.statusCode).toBe(200);
    const payload = sessions.json();
    expect(payload.total).toBeGreaterThanOrEqual(1);
    expect(payload.items[0]?.threadId).toBe("019d-api-1");
  });

  it("supports session actions and config/provider endpoints", async () => {
    const workspace = await createTempWorkspace();
    const manager = await createManagerForTest({
      codexHome: workspace.codexHome,
      stateDir: workspace.stateDir
    });
    cleanup.push(async () => manager.close());

    await writeRolloutFixture({
      codexHome: workspace.codexHome,
      threadId: "019d-api-2",
      userMessage: "实现 provider test",
      lastAgentMessage: "已经补上 provider diagnostics"
    });
    await manager.scan();

    const app = await buildApiServer({ manager, operator: "api-test" });
    cleanup.push(async () => {
      await app.close();
    });

    const suggest = await app.inject({
      method: "POST",
      url: "/api/v1/sessions/019d-api-2/suggest"
    });
    expect(suggest.statusCode).toBe(200);
    expect(suggest.json().threadId).toBe("019d-api-2");

    const freeze = await app.inject({
      method: "POST",
      url: "/api/v1/sessions/019d-api-2/freeze"
    });
    expect(freeze.statusCode).toBe(200);
    expect(freeze.json().frozen).toBe(true);

    const providerTest = await app.inject({
      method: "POST",
      url: "/api/v1/providers/test"
    });
    expect(providerTest.statusCode).toBe(200);
    expect(providerTest.json().diagnostics.configuredBackend).toBe("none");

    const config = await app.inject({
      method: "GET",
      url: "/api/v1/config"
    });
    expect(config.statusCode).toBe(200);
    expect(config.json().general.codexHome).toBe(workspace.codexHome);

    const doctor = await app.inject({
      method: "GET",
      url: "/api/v1/doctor"
    });
    expect(doctor.statusCode).toBe(200);
    expect(doctor.json().provider).toBeDefined();
  });

  it("supports session filters and auto-rename preview endpoint", async () => {
    const workspace = await createTempWorkspace();
    const manager = await createManagerForTest({
      codexHome: workspace.codexHome,
      stateDir: workspace.stateDir
    });
    cleanup.push(async () => manager.close());

    await writeRolloutFixture({
      codexHome: workspace.codexHome,
      threadId: "019d-api-filter-1",
      userMessage: "实现 web 页面",
      lastAgentMessage: "已经补上 sessions 页面"
    });
    await writeRolloutFixture({
      codexHome: workspace.codexHome,
      threadId: "019d-api-filter-2",
      userMessage: "实现 tui 页面",
      lastAgentMessage: "已经补上 tui 页面"
    });
    await manager.scan();
    await manager.freeze("019d-api-filter-2");

    const app = await buildApiServer({ manager, operator: "api-test" });
    cleanup.push(async () => {
      await app.close();
    });

    const filtered = await app.inject({
      method: "GET",
      url: "/api/v1/sessions?search=web&frozen=false"
    });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().items).toHaveLength(1);
    expect(filtered.json().items[0].threadId).toBe("019d-api-filter-1");

    const preview = await app.inject({
      method: "GET",
      url: "/api/v1/auto-rename/preview"
    });
    expect(preview.statusCode).toBe(200);
    expect(Array.isArray(preview.json().items)).toBe(true);
  });
});
