const { test, expect } = require("@playwright/test");

const username = process.env.E2E_USERNAME || "admin";
const password = process.env.E2E_PASSWORD || "CITestPassword123!";

test.describe("T27 Extended Journeys", () => {
  test("@t27-extended login -> team chat -> logout", async ({ page }) => {
    await page.goto("/login");
    await page.locator("#username").fill(username);
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: "Login" }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
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
    await page.goto("/login");
    await page.locator("#username").fill(username);
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: "Login" }).click();

    await page.getByRole("link", { name: "病人清單" }).click();
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
});
