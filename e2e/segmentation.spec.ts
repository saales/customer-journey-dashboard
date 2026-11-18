import { test, expect } from "@playwright/test";

test("filtri e aggiornamento della Segmentazione funzionano nel browser", async ({ page }) => {
  await page.goto("/");
  await page.locator("form.auth-form").first().getByLabel("Email").fill("admin@e2e.example");
  await page.getByLabel("Password").fill("E2E-admin-password-2026!");
  await page.locator("form.auth-form").first().getByLabel("Codice organizzazione").fill("e2e-workspace");
  await page.getByRole("button", { name: "Accedi" }).click();
  await expect(page.getByRole("heading", { name: "Panoramica" })).toBeVisible();

  await page.getByRole("button", { name: "Segmentazione" }).click();
  await expect(page.getByRole("heading", { name: "Segmentazione dei clienti" })).toBeVisible();

  const channelFilter = page.getByRole("combobox", { name: "Canale di acquisizione" });
  const stageFilter = page.getByRole("combobox", { name: "Visualizzazione fasi" });
  const refresh = page.getByRole("button", { name: "Aggiorna segmentazione" });

  await expect(channelFilter).toBeEnabled();
  await expect(channelFilter).toHaveValue("");
  await expect(stageFilter).toBeEnabled();
  await expect(refresh).toBeEnabled();

  const channelOptions = await channelFilter.locator("option").evaluateAll((options) =>
    options.map((option) => (option as HTMLOptionElement).value).filter(Boolean),
  );
  expect(channelOptions.length).toBeGreaterThan(0);

  const channelResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/segments" && url.searchParams.get("channel") === channelOptions[0];
  });
  await channelFilter.selectOption(channelOptions[0]);
  expect((await channelResponse).status()).toBe(200);
  await expect(channelFilter).toHaveValue(channelOptions[0]);

  const refreshResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/segments" && url.searchParams.get("channel") === channelOptions[0];
  });
  await refresh.click();
  expect((await refreshResponse).status()).toBe(200);

  await stageFilter.selectOption("active");
  await expect(stageFilter).toHaveValue("active");
});
