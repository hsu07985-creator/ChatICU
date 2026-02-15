const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const username = process.env.E2E_USERNAME || "nurse";
const password = process.env.E2E_PASSWORD || "nurse";
const chatPrompt = process.env.E2E_CHAT_PROMPT || "請提供目前病患重點摘要";

test.describe("T27 Critical Journey", () => {
  test("critical flow @critical: login -> patients -> detail -> ai chat -> logout", async ({ page }) => {
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

    await page.getByRole("tab", { name: "對話助手" }).click();
    const chatInputBox = page.getByPlaceholder("例如：這位病患的鎮靜深度是否適當？");
    const aiResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/ai/chat") &&
        response.request().method() === "POST" &&
        response.status() === 200,
    );

    await chatInputBox.fill(chatPrompt);
    await chatInputBox.press("Enter");

    const aiResponse = await aiResponsePromise;
    const aiResponseBody = await aiResponse.json();
    const assistantContent = String(aiResponseBody?.data?.message?.content || "");

    await expect(page.getByText(chatPrompt)).toBeVisible();
    expect(assistantContent.length).toBeGreaterThan(0);

    const assistantSnippet = assistantContent.replace(/\s+/g, " ").trim().slice(0, 20);
    if (assistantSnippet) {
      await expect(page.getByText(assistantSnippet, { exact: false })).toBeVisible({ timeout: 60000 });
    }

    await page.getByRole("button", { name: "登出" }).click();
    await expect(page).toHaveURL(/\/login$/);

    fs.mkdirSync(path.resolve("output/playwright"), { recursive: true });
    await page.screenshot({
      path: path.resolve("output/playwright/critical-journey-final.png"),
      fullPage: true,
    });
  });
});
