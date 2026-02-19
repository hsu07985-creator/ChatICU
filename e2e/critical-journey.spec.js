const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const username = process.env.E2E_USERNAME || "nurse";
const password = process.env.E2E_PASSWORD || "nurse";
const chatPrompt = process.env.E2E_CHAT_PROMPT || "請提供目前病患重點摘要";

test.describe("T27 Critical Journey", () => {
  test("critical flow @critical: login -> patients -> detail -> ai chat -> logout", async ({ page }) => {
    console.log("[INTG][E2E] Starting critical flow journey");
    await page.goto("/login");

    await page.locator("#username").fill(username);
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: "Login" }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "加護病房總覽" })).toBeVisible();

    await page.getByRole("link", { name: "病人清單" }).click();
    await expect(page).toHaveURL(/\/patients$/);
    await expect(page.getByRole("heading", { name: "病人清單" })).toBeVisible();

    await expect
      .poll(async () => await page.getByRole("button", { name: "檢視" }).count(), {
        timeout: 30000,
      })
      .toBeGreaterThan(0);

    await page.getByRole("button", { name: "檢視" }).first().click();
    await expect(page).toHaveURL(/\/patient\/[^/]+$/);

    await page.getByRole("tab", { name: /對話助手/ }).click();
    const chatInputBox = page.getByPlaceholder("例如：這位病患的鎮靜深度是否適當？");

    // AI chat requires OPENAI_API_KEY on the backend. When the key is not
    // configured (typical in CI without secrets), the backend returns an error.
    // We still verify the chat UI loads and the message is sent, but treat the
    // AI response as optional so the rest of the journey is not blocked.
    let aiChatSucceeded = false;
    let assistantContent = "";

    const aiResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/ai/chat") &&
        response.request().method() === "POST",
      { timeout: 30000 },
    );

    await chatInputBox.fill(chatPrompt);
    await chatInputBox.press("Enter");

    try {
      const aiResponse = await aiResponsePromise;
      if (aiResponse.status() === 200) {
        const aiResponseBody = await aiResponse.json();
        assistantContent = String(aiResponseBody?.data?.message?.content || "");
        if (assistantContent.length > 0) {
          aiChatSucceeded = true;
        }
      } else {
        console.log(`[INTG][E2E] AI chat returned status ${aiResponse.status()} (API key may be missing)`);
      }
    } catch (e) {
      console.log(`[INTG][E2E] AI chat response not received (skipping): ${e.message}`);
    }

    if (aiChatSucceeded) {
      expect(assistantContent.length).toBeGreaterThan(0);

      // P0/P2: Verify session history can be reloaded from backend after a page reload.
      // Backend session title defaults to the first user message (truncated to 50 chars).
      const sessionTitle = chatPrompt.slice(0, 50);
      const sessionButton = page.locator("button", { hasText: sessionTitle }).first();
      await expect(sessionButton).toBeVisible({ timeout: 30000 });

      await page.reload();
      await expect(page).toHaveURL(/\/patient\/[^/]+$/);

      await page.getByRole("tab", { name: /對話助手/ }).click();
      const sessionButtonAfterReload = page
        .locator("button", { hasText: sessionTitle })
        .first();
      await expect(sessionButtonAfterReload).toBeVisible({ timeout: 30000 });
      await sessionButtonAfterReload.click();

      // Ensure both user prompt and assistant content are present in the reloaded history.
      const chatLog = page
        .locator("div", { hasText: "按 Enter 發送" })
        .locator("..");
      await expect(chatLog.getByText(chatPrompt).first()).toBeVisible({ timeout: 30000 });
      const assistantSnippet = assistantContent.replace(/\s+/g, " ").trim().slice(0, 20);
      if (assistantSnippet) {
        await expect(page.getByText(assistantSnippet)).toBeVisible({ timeout: 30000 });
      }
    } else {
      console.log("[INTG][E2E] Skipping AI session history verification (AI unavailable)");
    }

    const logoutButton = page.getByRole("button", { name: "登出" });
    const logoutVisible = await logoutButton.isVisible().catch(() => false);
    if (!logoutVisible) {
      const sidebarToggle = page.getByRole("button", {
        name: /展開側邊欄|收起側邊欄|Toggle Sidebar/,
      });
      if (await sidebarToggle.isVisible().catch(() => false)) {
        await sidebarToggle.click();
      }
    }

    await expect(logoutButton).toBeVisible({ timeout: 15000 });
    await logoutButton.click();
    await expect(page).toHaveURL(/\/login$/);

    fs.mkdirSync(path.resolve("output/playwright"), { recursive: true });
    await page.screenshot({
      path: path.resolve("output/playwright/critical-journey-final.png"),
      fullPage: true,
    });
  });
});
