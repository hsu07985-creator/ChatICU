const { test, expect } = require("@playwright/test");
const { loginAndWait } = require("./helpers/auth");

const username = process.env.E2E_USERNAME || "nurse";
// Local dev seed defaults to username/password pairs (e.g. admin/admin).
// CI overrides via env vars (see .github/workflows/ci.yml).
const password = process.env.E2E_PASSWORD || "nurse";
const extUsername = process.env.E2E_EXT_USERNAME || "doctor";
const extPassword = process.env.E2E_EXT_PASSWORD || "doctor";

test.describe("T27 Extended Journeys", () => {
  test("@t27-extended login -> team chat -> logout", async ({ page }) => {
    console.log("[INTG][E2E] Starting extended journey: team chat logout");
    await loginAndWait(page, { username, password });
    await page.getByRole("link", { name: "團隊聊天室" }).click();
    await expect(page).toHaveURL(/\/chat$/);
    await expect(page.getByRole("heading", { name: "團隊聊天室" })).toBeVisible();

    const toggle = page.getByRole("button", {
      name: /展開側邊欄|收起側邊欄|Toggle Sidebar/,
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
      .poll(async () => page.getByRole("button", { name: "檢視" }).count(), {
        timeout: 30000,
      })
      .toBeGreaterThan(0);

    await page.getByRole("button", { name: "檢視" }).first().click();
    await expect(page).toHaveURL(/\/patient\/[^/]+$/);

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
      .poll(async () => page.getByRole("button", { name: "檢視" }).count(), {
        timeout: 30000,
      })
      .toBeGreaterThan(0);

    await page.getByRole("button", { name: "檢視" }).first().click();
    await expect(page).toHaveURL(/\/patient\/[^/]+$/);

    await page.getByRole("tab", { name: "檢驗數據" }).click();
    await expect(page.getByRole("tab", { name: "檢驗數據" })).toHaveAttribute("data-state", "active");

    // Click a real trend icon within the active lab tab. Previous selector used a
    // broad div filter and could match a container without click handlers.
    const labPanel = page.getByRole("tabpanel", { name: "檢驗數據" });
    const trendIcon = labPanel.locator("svg.lucide-trending-up").first();
    await expect(trendIcon).toBeVisible({ timeout: 15000 });
    await trendIcon.click();

    await expect(page.getByText("歷史趨勢分析")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("發生錯誤")).toHaveCount(0);

    const objectRenderCrash = runtimeErrors.find((msg) =>
      msg.includes("Objects are not valid as a React child"),
    );
    expect(objectRenderCrash, "should not hit object-render runtime crash").toBeUndefined();
  });

  test("@t27-extended patient ai readiness gate disables chat input when not ready", async ({ page }) => {
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
            overall_ready: false,
            checked_at: new Date().toISOString(),
            llm: {
              ready: false,
              provider: "openai",
              model: "gpt-4o",
              reason: "LLM_API_KEY_MISSING",
            },
            evidence: {
              reachable: true,
              ready: true,
              reason: null,
              last_error: null,
            },
            rag: {
              ready: true,
              is_indexed: true,
              total_chunks: 10,
              total_documents: 2,
              engine: "hybrid_rag",
              clinical_rules_loaded: true,
            },
            feature_gates: {
              chat: false,
              clinical_summary: false,
              patient_explanation: false,
              guideline_interpretation: false,
              decision_support: false,
              clinical_polish: false,
              dose_calculation: true,
              drug_interactions: true,
              clinical_query: true,
            },
            blocking_reasons: ["LLM_API_KEY_MISSING"],
            display_reasons: ["LLM API key 未設定，AI 生成功能已停用。"],
          },
        }),
      });
    });

    await page.goto("/patients");
    await expect(page).toHaveURL(/\/patients$/);

    await expect
      .poll(async () => page.getByRole("button", { name: "檢視" }).count(), {
        timeout: 30000,
      })
      .toBeGreaterThan(0);

    await page.getByRole("button", { name: "檢視" }).first().click();
    await expect(page).toHaveURL(/\/patient\/[^/]+$/);

    const chatPanel = page.getByRole("tabpanel", { name: "對話助手" });
    await expect(chatPanel.getByText("AI 未就緒")).toBeVisible({ timeout: 15000 });
    await expect(chatPanel.getByText("LLM API key 未設定，AI 生成功能已停用。")).toBeVisible({
      timeout: 15000,
    });
    await expect(chatPanel.getByPlaceholder("AI 功能未就緒，請先修復 readiness 問題")).toBeDisabled();
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
      if (route.request().method() === "OPTIONS") {
        await route.fulfill({
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
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
          "Access-Control-Allow-Origin": "*",
        },
        body,
      });
    });

    await page.goto("/patients");
    await expect(page).toHaveURL(/\/patients$/);

    await expect
      .poll(async () => page.getByRole("button", { name: "檢視" }).count(), {
        timeout: 30000,
      })
      .toBeGreaterThan(0);

    await page.getByRole("button", { name: "檢視" }).first().click();
    await expect(page).toHaveURL(/\/patient\/[^/]+$/);

    const chatPanel = page.getByRole("tabpanel", { name: "對話助手" });
    const input = chatPanel.getByPlaceholder("例如：這位病患的鎮靜深度是否適當？");
    await input.fill("請提供今天的鎮靜建議");
    await input.press("Enter");

    await expect(chatPanel.getByText("這是 AO-04 串流測試回覆。")).toBeVisible({ timeout: 15000 });
    await expect(chatPanel.getByText("資料新鮮度/缺值提示")).toBeVisible({ timeout: 15000 });
    await expect(chatPanel.getByText("資料缺值：vital_signs、ventilator_settings。")).toBeVisible({
      timeout: 15000,
    });
  });

  test("@t27-extended team chat order oldest -> newest after reload", async ({ page }) => {
    await loginAndWait(page, {
      username: extUsername,
      password: extPassword,
    });

    await page.goto("/chat");
    await expect(page).toHaveURL(/\/chat$/);
    await expect(page.getByRole("heading", { name: "團隊聊天室" })).toBeVisible();

    const marker = `E2E_TEAM_ORDER_${Date.now()}`;
    const firstMessage = `${marker}_A`;
    const secondMessage = `${marker}_B`;
    const input = page.getByPlaceholder("例如：I-1 床病患血鉀偏低，已補充 KCl...");

    await input.fill(firstMessage);
    await input.press("Enter");
    await expect(page.getByText(firstMessage)).toBeVisible({ timeout: 15000 });

    await input.fill(secondMessage);
    await input.press("Enter");
    await expect(page.getByText(secondMessage)).toBeVisible({ timeout: 15000 });

    // Reload to verify ordering from backend list API (not only local append state).
    await page.reload();
    await expect(page).toHaveURL(/\/chat$/);
    await expect(page.getByRole("heading", { name: "團隊聊天室" })).toBeVisible();

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
