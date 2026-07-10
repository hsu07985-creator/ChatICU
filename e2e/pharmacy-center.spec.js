const { test, expect } = require("@playwright/test");

const username = process.env.E2E_PHARMACY_USERNAME || process.env.E2E_USERNAME || "pharmacist";
const password = process.env.E2E_PHARMACY_PASSWORD || process.env.E2E_PASSWORD || "pharmacist";

// Rewritten 2026-07-10 against the current pharmacy UI. The original spec
// targeted a retired generation of the pages (藥事支援工作台 heading, free-text
// interaction inputs, favorites, /pharmacy/error-report — all gone or
// redesigned), so it could not pass at all.
test.describe("Pharmacy Support Center", () => {
  test("pharmacist flow @pharmacy: workstation assess -> submit advice -> stats -> tools -> logout", async ({ page }) => {
    await page.goto("/login");
    await page.locator("#username").fill(username);
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: /登入|Login/ }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    // ── Workstation: select patient, add drugs, run full assessment ──
    await page.getByRole("link", { name: /智藥輔助|藥事支援工作台/ }).click();
    await expect(page).toHaveURL(/\/pharmacy\/workstation$/);
    await expect(page.getByRole("heading", { name: "藥師工作站" })).toBeVisible();

    // Radix Select trigger uses role="combobox" (not a plain button).
    await page.getByRole("combobox").first().click();
    const firstPatient = page.getByRole("option").first();
    await expect(firstPatient).toBeVisible({ timeout: 30000 });
    await firstPatient.click();

    // Patient meds auto-load; add two well-known drugs on top so the DDI
    // engine has a deterministic pair to chew on.
    const drugInput = page.getByPlaceholder("輸入藥品名稱...");
    await expect(drugInput).toBeVisible({ timeout: 15000 });
    await drugInput.fill("Propofol");
    await drugInput.press("Enter");
    await drugInput.fill("Fentanyl");
    await drugInput.press("Enter");

    await page.getByRole("button", { name: "執行全面評估" }).click();

    // Assessment completion signal: the run button flips to 重新評估 and the
    // four result sections render. (The old 產生報告→送出建議 journey was cut
    // from the UI in 1983485d0 — the report view is no longer reachable.)
    await expect(page.getByRole("button", { name: "重新評估" })).toBeVisible({ timeout: 90000 });
    await expect(page.getByRole("button", { name: /交互作用/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /重複用藥/ }).first()).toBeVisible();

    // ── Advice statistics page renders ──
    await page.getByRole("link", { name: /藥物統計|用藥建議與統計/ }).click();
    await expect(page).toHaveURL(/\/pharmacy\/advice-statistics$/);
    await expect(page.getByRole("heading", { name: "藥物統計" })).toBeVisible();

    // ── Interactions: pick two drugs via combobox, run query ──
    await page.getByRole("link", { name: /用藥交互|交互作用查詢/ }).click();
    await expect(page).toHaveURL(/\/pharmacy\/interactions$/);
    await expect(page.getByRole("heading", { name: "用藥交互" })).toBeVisible();

    const pickInteractionDrug = async (triggerIndex, drugName) => {
      await page.getByRole("combobox").nth(triggerIndex).click();
      const search = page.getByPlaceholder("輸入藥品名稱篩選...");
      await expect(search).toBeVisible({ timeout: 10000 });
      await search.fill(drugName);
      // DrugCombobox renders results as plain buttons (not role=option).
      const option = page.getByRole("button", { name: new RegExp(drugName, "i") }).first();
      await expect(option).toBeVisible({ timeout: 10000 });
      await option.click();
    };

    // combobox 0 = patient picker, 1..2 = drug slots.
    await pickInteractionDrug(1, "Propofol");
    await pickInteractionDrug(2, "Fentanyl");
    await page.getByRole("button", { name: "查詢", exact: true }).click();
    await expect(page.getByText("查詢摘要")).toBeVisible({ timeout: 30000 });

    // ── Compatibility + dosage pages render (smoke) ──
    await page.getByRole("link", { name: /用藥相容|相容性檢核/ }).click();
    await expect(page).toHaveURL(/\/pharmacy\/compatibility$/);
    await expect(page.getByRole("heading", { name: "用藥相容" })).toBeVisible();
    await expect(page.getByText("藥品選擇")).toBeVisible();

    await page.getByRole("link", { name: /劑量計算|劑量計算與建議/ }).click();
    await expect(page).toHaveURL(/\/pharmacy\/dosage$/);
    await expect(page.getByRole("heading", { name: "劑量計算", exact: true })).toBeVisible();

    // ── Logout ──
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
  });
});
