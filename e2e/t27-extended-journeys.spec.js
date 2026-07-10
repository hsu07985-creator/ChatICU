const { test, expect } = require("@playwright/test");
const { loginAndWait } = require("./helpers/auth");

const username = process.env.E2E_USERNAME || "nurse";
// Local dev seed defaults to username/password pairs (e.g. admin/admin).
// CI overrides via env vars (see .github/workflows/ci.yml).
const password = process.env.E2E_PASSWORD || "nurse";
const extUsername = process.env.E2E_EXT_USERNAME || "doctor";
const extPassword = process.env.E2E_EXT_PASSWORD || "doctor";

async function openFirstPatient(page) {
  const firstRow = page.locator("tbody tr").first();
  await firstRow.click();
  try {
    await page.waitForURL(/\/patient\/[^/]+$/, { timeout: 5000 });
  } catch {
    // Table may re-render (query refetch) right as we click — retry once.
    await firstRow.click();
    await page.waitForURL(/\/patient\/[^/]+$/, { timeout: 10000 });
  }
}

test.describe("T27 Extended Journeys", () => {
  test("@t27-extended login -> team chat -> logout", async ({ page }) => {
    console.log("[INTG][E2E] Starting extended journey: team chat logout");
    await loginAndWait(page, { username, password });
    await page.getByRole("link", { name: /團隊訊息|Team Messages/ }).click();
    await expect(page).toHaveURL(/\/chat$/);
    await expect(page.getByRole("heading", { name: /團隊訊息|Team Messages/ })).toBeVisible();

    const toggle = page.getByRole("button", {
      name: /展開側邊欄|收起側邊欄|Expand sidebar|Collapse sidebar|Toggle Sidebar/,
    });
    if (await toggle.isVisible().catch(() => false)) {
      await toggle.click();
    }

    await page.getByRole("button", { name: "登出" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("@t27-extended login -> patients -> detail tab switch", async ({ page }) => {
    await loginAndWait(page, {
      username: extUsername,
      password: extPassword,
    });

    // Direct navigation avoids sidebar visibility/collapse variance in CI/local runs.
    await page.goto("/patients");
    await expect(page).toHaveURL(/\/patients$/);

    await expect
      .poll(async () => page.locator("tbody tr").count(), {
        timeout: 30000,
      })
      .toBeGreaterThan(0);

    // Rows are clickable — the standalone 檢視 button was retired (2026-07).
    await openFirstPatient(page);

    await page.getByRole("tab", { name: "留言板" }).click();
    await expect(page.getByRole("tab", { name: "留言板" })).toHaveAttribute("data-state", "active");

    await page.getByRole("tab", { name: "檢驗數據" }).click();
    await expect(page.getByRole("tab", { name: "檢驗數據" })).toHaveAttribute("data-state", "active");
  });

  test("@t27-extended login -> patient lab -> open trend dialog without runtime crash", async ({ page }) => {
    const runtimeErrors = [];
    page.on("pageerror", (error) => {
      runtimeErrors.push(String(error?.message || error));
    });

    await loginAndWait(page, {
      username: extUsername,
      password: extPassword,
    });

    await page.goto("/patients");
    await expect(page).toHaveURL(/\/patients$/);

    await expect
      .poll(async () => page.locator("tbody tr").count(), {
        timeout: 30000,
      })
      .toBeGreaterThan(0);

    // Rows are clickable — the standalone 檢視 button was retired (2026-07).
    await openFirstPatient(page);

    await page.getByRole("tab", { name: "檢驗數據" }).click();
    await expect(page.getByRole("tab", { name: "檢驗數據" })).toHaveAttribute("data-state", "active");

    // The trend icon was retired — lab/vital value cards are clickable
    // themselves (LabItem renders cursor-pointer when a trend exists).
    const labPanel = page.getByRole("tabpanel", { name: "檢驗數據" });
    const trendCard = labPanel.locator("div.cursor-pointer").first();
    await expect(trendCard).toBeVisible({ timeout: 15000 });
    await trendCard.click();

    await expect(page.getByText("歷史趨勢分析")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("發生錯誤")).toHaveCount(0);

    const objectRenderCrash = runtimeErrors.find((msg) =>
      msg.includes("Objects are not valid as a React child"),
    );
    expect(objectRenderCrash, "should not hit object-render runtime crash").toBeUndefined();
  });

  test("@t27-extended patient chat stream renders sse chunks", async ({ page }) => {
    await loginAndWait(page, {
      username: extUsername,
      password: extPassword,
    });

    await page.route("**/api/v1/ai/readiness", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            overall_ready: true,
            checked_at: new Date().toISOString(),
            llm: { ready: true, provider: "openai", model: "gpt-4o", reason: null },
            evidence: { reachable: true, ready: true, reason: null, last_error: null },
            rag: {
              ready: true,
              is_indexed: true,
              total_chunks: 10,
              total_documents: 2,
              engine: "hybrid_rag",
              clinical_rules_loaded: true,
            },
            feature_gates: {
              chat: true,
              clinical_summary: true,
              patient_explanation: true,
              guideline_interpretation: true,
              decision_support: true,
              clinical_polish: true,
              dose_calculation: true,
              drug_interactions: true,
              clinical_query: true,
            },
            blocking_reasons: [],
            display_reasons: [],
          },
        }),
      });
    });

    await page.route("**/ai/chat/stream", async (route) => {
      // Cookie-based auth sends credentialed requests; browsers reject
      // Access-Control-Allow-Origin "*" for those — echo the Origin instead.
      const corsOrigin = route.request().headers()["origin"] || "http://127.0.0.1:14173";
      if (route.request().method() === "OPTIONS") {
        await route.fulfill({
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": corsOrigin,
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Request-ID, X-Trace-ID, Accept",
          },
          body: "",
        });
        return;
      }

      const donePayload = {
        sessionId: "session_stream_test_001",
        message: {
          id: "msg_stream_test_001",
          role: "assistant",
          content: "這是 AO-04 串流測試回覆。",
          timestamp: new Date().toISOString(),
          citations: [],
          safetyWarnings: null,
          requiresExpertReview: false,
          degraded: false,
          degradedReason: null,
          upstreamStatus: "success",
          dataFreshness: {
            mode: "json",
            generated_at: new Date().toISOString(),
            as_of: "2025-01-10T08:30:00Z",
            sections: {
              lab_data: {
                status: "stale",
                timestamp: "2025-01-10T08:30:00Z",
                age_hours: 1000,
                threshold_hours: 24,
              },
              vital_signs: {
                status: "missing",
                timestamp: null,
                age_hours: null,
                threshold_hours: 6,
              },
              ventilator_settings: {
                status: "missing",
                timestamp: null,
                age_hours: null,
                threshold_hours: 6,
              },
              medications: {
                status: "present",
                active_count: 2,
              },
            },
            missing_fields: ["vital_signs", "ventilator_settings"],
            hints: [
              "目前為 JSON 離線模式，資料可能非即時。",
              "資料快照時間：2025-01-10T08:30:00Z",
              "資料缺值：vital_signs、ventilator_settings。",
            ],
          },
          evidenceGate: {
            passed: true,
            reason_code: null,
            display_reason: null,
            citation_count: 2,
            confidence: 0.91,
            thresholds: { min_citations: 1, min_confidence: 0.55 },
          },
        },
      };
      const body = [
        "event: start",
        `data: ${JSON.stringify({ sessionId: donePayload.sessionId, messageId: donePayload.message.id })}`,
        "",
        "event: delta",
        `data: ${JSON.stringify({ chunk: "這是 AO-04 " })}`,
        "",
        "event: delta",
        `data: ${JSON.stringify({ chunk: "串流測試回覆。" })}`,
        "",
        "event: done",
        `data: ${JSON.stringify(donePayload)}`,
        "",
      ].join("\n");

      await route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Access-Control-Allow-Origin": corsOrigin,
          "Access-Control-Allow-Credentials": "true",
        },
        body,
      });
    });

    await page.goto("/patients");
    await expect(page).toHaveURL(/\/patients$/);

    await expect
      .poll(async () => page.locator("tbody tr").count(), {
        timeout: 30000,
      })
      .toBeGreaterThan(0);

    // Rows are clickable — the standalone 檢視 button was retired (2026-07).
    await openFirstPatient(page);

    // Default tab is the AI companion; its input textarea has an empty
    // placeholder when ready (previous placeholder copy was retired).
    const chatPanel = page.getByRole("tabpanel", { name: /AI 臨床夥伴|對話助手/ });
    const input = chatPanel.locator("textarea").first();
    await expect(input).toBeVisible({ timeout: 15000 });
    await input.fill("請提供今天的鎮靜建議");
    await input.press("Enter");

    await expect(chatPanel.getByText("這是 AO-04 串流測試回覆。")).toBeVisible({ timeout: 15000 });
    // Freshness hints hide behind the data-quality toggle now — expand it.
    await chatPanel.getByRole("button", { name: "資料品質警告" }).first().click();
    await expect(chatPanel.getByText(/資料品質/).first()).toBeVisible({ timeout: 15000 });
  });

  test("@t27-extended team chat order oldest -> newest after reload", async ({ page }) => {
    await loginAndWait(page, {
      username: extUsername,
      password: extPassword,
    });

    await page.goto("/chat");
    await expect(page).toHaveURL(/\/chat$/);
    await expect(page.getByRole("heading", { name: /團隊訊息|Team Messages/ })).toBeVisible();

    const marker = `E2E_TEAM_ORDER_${Date.now()}`;
    const firstMessage = `${marker}_A`;
    const secondMessage = `${marker}_B`;
    // Composer placeholder is empty in the current UI — target the textarea.
    const input = page.locator("textarea").first();
    await expect(input).toBeVisible({ timeout: 15000 });

    await input.fill(firstMessage);
    await input.press("Enter");
    await expect(page.getByText(firstMessage)).toBeVisible({ timeout: 15000 });

    await input.fill(secondMessage);
    await input.press("Enter");
    await expect(page.getByText(secondMessage)).toBeVisible({ timeout: 15000 });

    // Reload to verify ordering from backend list API (not only local append state).
    await page.reload();
    await expect(page).toHaveURL(/\/chat$/);
    await expect(page.getByRole("heading", { name: /團隊訊息|Team Messages/ })).toBeVisible();
    // The heading renders before the message list finishes loading — anchor
    // on our own marker so the order snapshot below sees real data.
    await expect(page.getByText(secondMessage).first()).toBeVisible({ timeout: 15000 });

    const order = await page.getByTestId("team-chat-message").evaluateAll(
      (nodes, [first, second]) => {
        const texts = nodes.map((node) => node.textContent || "");
        return {
          firstIndex: texts.findIndex((text) => text.includes(first)),
          secondIndex: texts.findIndex((text) => text.includes(second)),
        };
      },
      [firstMessage, secondMessage],
    );

    expect(order.firstIndex).toBeGreaterThanOrEqual(0);
    expect(order.secondIndex).toBeGreaterThanOrEqual(0);
    expect(order.firstIndex).toBeLessThan(order.secondIndex);
  });
});
