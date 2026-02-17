const { test, expect } = require("@playwright/test");

const username = process.env.E2E_PHARMACY_USERNAME || process.env.E2E_USERNAME || "pharmacist";
const password = process.env.E2E_PHARMACY_PASSWORD || process.env.E2E_PASSWORD || "pharmacist";

test.describe("Pharmacy Support Center", () => {
  test("pharmacist flow @pharmacy: workstation -> advice -> stats -> compatibility -> error report -> logout", async ({ page }) => {
    const runId = String(Date.now());

    await page.goto("/login");
    await page.locator("#username").fill(username);
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: "Login" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    // Workstation: select patient, add drugs, run assessment, submit advice record
    await page.getByRole("link", { name: "藥事支援工作台" }).click();
    await expect(page).toHaveURL(/\/pharmacy\/workstation$/);
    await expect(page.getByRole("heading", { name: "藥事支援工作台" })).toBeVisible();

    // Select first patient in list
    // Radix Select trigger uses role="combobox" (not a plain button).
    await page.getByRole("combobox").first().click();
    const firstPatient = page.getByRole("option").first();
    await expect(firstPatient).toBeVisible({ timeout: 30000 });
    const firstPatientLabel = (await firstPatient.textContent()) || "";
    await firstPatient.click();
    const m = firstPatientLabel.match(/^\s*([^-\n]+?)\s*-\s*([^(]+?)\s*\(/);
    const selectedBed = m ? m[1].trim() : null;
    const selectedName = m ? m[2].trim() : null;

    // Ensure we have at least 2 drugs so interactions/compatibility have something to do.
    const drugInput = page.getByPlaceholder("輸入藥品名稱...");
    await drugInput.fill("Propofol");
    await drugInput.press("Enter");
    await drugInput.fill("Fentanyl");
    await drugInput.press("Enter");

    await page.getByRole("button", { name: "執行全面評估" }).click();
    // Avoid strict-mode ambiguity with "未發現藥物交互作用" empty-state text.
    await expect(page.getByRole("heading", { name: "藥物交互作用" })).toBeVisible({ timeout: 90000 });

    await page.getByRole("button", { name: "產生報告" }).click();
    const reportTextarea = page.getByPlaceholder("點擊「產生報告」自動產生完整建議，或手動輸入...");
    const generated = await reportTextarea.inputValue();
    expect(generated).toContain("【用藥建議報告】");

    const marker = `E2E_ID=${runId}`;
    await reportTextarea.fill(`${generated}\n\n${marker}\n`);

    await page.getByRole("button", { name: "接受並送出" }).click();
    await expect(page.getByText("選擇用藥建議分類")).toBeVisible();

    await page.getByText("請選擇大類別...").click();
    await page.getByRole("option", { name: /建議處方/ }).click();

    await page.getByText("請選擇具體分類...").click();
    // Pick the first code for deterministic behavior.
    await page.getByRole("option").first().click();

    await page.getByRole("button", { name: "確認送出" }).click();
    await expect(page.getByText("選擇用藥建議分類")).toHaveCount(0, { timeout: 30000 });

    // Advice must auto-sync to the patient message board (medication-advice).
    if (selectedBed) {
      await page.getByRole("link", { name: "病人清單" }).click();
      await expect(page).toHaveURL(/\/patients$/);
      await page.getByPlaceholder("搜尋姓名或床號...").fill(selectedBed);
      const targetRow = page.getByRole("row", { name: new RegExp(selectedBed) }).nth(1);
      await expect(targetRow).toBeVisible({ timeout: 30000 });
      await targetRow.click();
      await expect(page).toHaveURL(/\/patient\//);

      await page.getByRole("tab", { name: "留言板" }).click();
      await expect(page.getByText(marker).first()).toBeVisible({ timeout: 30000 });
    }

    // Advice statistics should include the record we just created.
    await page.getByRole("link", { name: "用藥建議與統計" }).click();
    await expect(page).toHaveURL(/\/pharmacy\/advice-statistics$/);
    await expect(page.getByRole("heading", { name: "用藥建議與統計" })).toBeVisible();
    await expect(page.getByText(marker).first()).toBeVisible({ timeout: 30000 });

    // Interactions: verify the search flow works (Evidence engine or DB fallback).
    await page.getByRole("link", { name: "交互作用查詢" }).click();
    await expect(page).toHaveURL(/\/pharmacy\/interactions$/);
    await expect(page.getByRole("heading", { name: "交互作用查詢" })).toBeVisible();

    await page.getByPlaceholder("例：Propofol").fill("Propofol");
    await page.getByPlaceholder("例：Fentanyl").fill("Fentanyl");
    await page.getByRole("button", { name: "查詢" }).click();
    await expect(page.getByText("查詢結果")).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("Propofol + Fentanyl").first()).toBeVisible({ timeout: 30000 });

    // Dosage: verify deterministic error message when Evidence engine (func/) isn't running,
    // or a real result renders when it is.
    await page.getByRole("link", { name: "劑量計算與建議" }).click();
    await expect(page).toHaveURL(/\/pharmacy\/dosage$/);
    await expect(page.getByRole("heading", { name: "劑量計算與建議" })).toBeVisible();

    await page.getByPlaceholder("例：Norepinephrine").fill("Norepinephrine");
    await page.getByRole("button", { name: "計算劑量" }).click();
    await expect
      .poll(async () => {
        const resultVisible = await page
          .getByRole("heading", { name: "劑量建議" })
          .isVisible()
          .catch(() => false);
        if (resultVisible) return "result";

        const actionableError = await page
          .getByText(/劑量引擎不可用（請啟動 func\/ 服務）/)
          .isVisible()
          .catch(() => false);
        if (actionableError) return "error";

        // Fallback: any 503 toast message still counts as graceful degradation.
        const any503 = await page
          .getByText(/Evidence engine service unavailable|服務暫時不可用/)
          .isVisible()
          .catch(() => false);
        if (any503) return "error";

        return null;
      }, { timeout: 30000 })
      .not.toBeNull();

    // Compatibility: add a favorite pair and ensure it appears in "我的常用".
    await page.getByRole("link", { name: "相容性檢核" }).click();
    await expect(page).toHaveURL(/\/pharmacy\/compatibility$/);
    await expect(page.getByRole("heading", { name: "相容性檢核" })).toBeVisible();

    const favDrugA = `E2E_${runId}_A`;
    const favDrugB = `E2E_${runId}_B`;
    await page.getByPlaceholder("例：Propofol").fill(favDrugA);
    await page.getByPlaceholder("例：Fentanyl").fill(favDrugB);
    await page.getByRole("button", { name: "加入常用組合" }).click();
    await expect(page.getByRole("button", { name: new RegExp(`${favDrugA} \\+ ${favDrugB}`) })).toBeVisible();

    // Error report: submit one and ensure it shows up in the listing.
    await page.getByRole("link", { name: "用藥異常通報" }).click();
    await expect(page).toHaveURL(/\/pharmacy\/error-report$/);
    await expect(page.getByRole("heading", { name: "用藥錯誤回報" })).toBeVisible();

    await page.getByRole("button", { name: "新增回報" }).click();
    await page.getByText("選擇錯誤類型").click();
    await page.getByRole("option", { name: "劑量錯誤" }).click();

    const reportDrugName = `E2E_DRUG_${runId}`;
    await page.getByPlaceholder("例：Morphine").fill(reportDrugName);
    await page
      .getByPlaceholder("請詳細描述錯誤情況、發生原因與影響...")
      .fill(`E2E error report ${runId}`);
    await page.getByRole("button", { name: "送出回報" }).click();
    await expect(page.getByText(reportDrugName).first()).toBeVisible({ timeout: 30000 });

    // Logout
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
