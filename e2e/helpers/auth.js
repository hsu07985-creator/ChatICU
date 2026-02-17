const { expect } = require("@playwright/test");

async function loginAndWait(page, options) {
  const { username, password, timeoutMs = 20000, maxAttempts = 3 } = options;

  let lastStatusCode = 0;
  let lastBackendMessage = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await page.goto("/login");
    await page.locator("#username").fill(username);
    await page.locator("#password").fill(password);

    const loginResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/auth/login") &&
        response.request().method() === "POST",
      { timeout: timeoutMs },
    );

    await page.getByRole("button", { name: "Login" }).click();
    const loginResponse = await loginResponsePromise;
    lastStatusCode = loginResponse.status();
    lastBackendMessage = "";

    try {
      const payload = await loginResponse.json();
      lastBackendMessage = payload?.message || payload?.detail || "";
    } catch {
      // Ignore body parsing failures; status code is still the primary signal.
    }

    if (lastStatusCode >= 200 && lastStatusCode < 300) {
      break;
    }

    if (lastStatusCode === 429 && attempt < maxAttempts) {
      const retryAfterHeader = Number(loginResponse.headers()["retry-after"] || "0");
      const backoffMs = Math.max(Number.isFinite(retryAfterHeader) ? retryAfterHeader * 1000 : 0, 65000);
      console.warn(
        `[INTG][E2E][AUTH] login rate-limited status=429 attempt=${attempt}/${maxAttempts} wait_ms=${backoffMs}`,
      );
      await page.waitForTimeout(backoffMs);
      continue;
    }

    throw new Error(
      `[INTG][E2E][AUTH] login failed status=${lastStatusCode}${lastBackendMessage ? ` message=${lastBackendMessage}` : ""}`,
    );
  }

  if (lastStatusCode < 200 || lastStatusCode >= 300) {
    throw new Error(
      `[INTG][E2E][AUTH] login failed status=${lastStatusCode}${lastBackendMessage ? ` message=${lastBackendMessage}` : ""}`,
    );
  }

  await page.waitForFunction(
    () => Boolean(window.localStorage.getItem("chaticu_token")),
    undefined,
    { timeout: timeoutMs },
  );
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: timeoutMs });
}

module.exports = {
  loginAndWait,
};
