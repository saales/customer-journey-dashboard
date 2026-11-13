import { test, expect } from "@playwright/test";

const admin = {
  email: "admin@e2e.example",
  password: "E2E-admin-password-2026!",
  organization: "e2e-workspace",
};

test("percorso amministratore e limitazione dei permessi analista", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill(admin.email);
  await page.getByLabel("Password").fill(admin.password);
  await page.getByLabel("Codice organizzazione").fill(admin.organization);
  await page.getByRole("button", { name: "Accedi" }).click();
  await expect(page.getByRole("heading", { name: "Panoramica" })).toBeVisible();

  // Creazione reale di un cliente tramite interfaccia e API PostgreSQL.
  await page.getByRole("button", { name: "Gestione clienti" }).click();
  await page.getByRole("button", { name: "Nuovo cliente" }).click();
  await page.getByLabel("Canale di acquisizione").selectOption("Email");
  await page.getByLabel("Data della prima visita").fill("2025-03-10");
  await page.getByRole("button", { name: "Salva dati cliente" }).click();
  const createdCustomerRow = page.getByRole("row").filter({ hasText: "2025-03-10" });
  await expect(createdCustomerRow).toContainText("Email");

  // Aggiunta di una fase funnel persistente.
  await page.getByRole("button", { name: "Impostazioni" }).click();
  await page.getByLabel("Aggiungi una fase").fill("Demo completata");
  await page.getByRole("button", { name: "Aggiungi fase" }).click();
  await expect(page.getByText("Demo completata", { exact: true })).toBeVisible();

  // Importazione di un cliente tramite il flusso CSV reale.
  await page.getByRole("button", { name: "Importazione dati" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "e2e-import.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "externalId,channel,createdAt,stage,occurredAt\ne2e-crm-001,Organico,2025-04-01,lead,2025-04-02\n",
    ),
  });
  await expect(page.getByRole("heading", { name: "Anteprima e correzione dati" })).toBeVisible();
  await page.getByRole("button", { name: "Importa dati" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Importazione completata: 1 clienti" })).toBeVisible();

  // Esportazione server-side e verifica del file generato.
  await page.getByRole("button", { name: "Gestione clienti" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Esporta tutti i clienti CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("percorso-clienti.csv");

  // Invito reale monouso e verifica dei permessi di un analista.
  await page.getByRole("button", { name: "Impostazioni" }).click();
  await page.getByLabel("Email", { exact: true }).fill("analyst@e2e.example");
  await page.getByLabel("Ruolo").selectOption("analyst");
  await page.getByRole("button", { name: "Crea invito (7 giorni)" }).click();
  const inviteInput = page.getByLabel("Collegamento da condividere");
  await expect(inviteInput).toHaveValue(/token=/);
  const inviteUrl = await inviteInput.inputValue();

  await page.goto(inviteUrl);
  await page.getByLabel("Nome e cognome").fill("E2E Analyst");
  await page.getByLabel("Password", { exact: true }).fill("E2E-analyst-password-2026!");
  await page.getByLabel("Conferma password").fill("E2E-analyst-password-2026!");
  await page.getByRole("button", { name: "Accetta invito" }).click();
  await expect(page.getByRole("heading", { name: "Panoramica" })).toBeVisible();

  await expect(page.getByRole("button", { name: "Importazione dati" })).toHaveCount(0);
  await page.getByRole("button", { name: "Gestione clienti" }).click();
  await expect(page.getByRole("button", { name: "Nuovo cliente" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Esporta tutti i clienti CSV" })).toBeVisible();

  // La protezione è server-side: nascondere un pulsante non è sufficiente.
  const forbiddenStatus = await page.evaluate(async () => {
    const response = await fetch("/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: "Organico", createdAt: "2025-05-01", events: [] }),
    });
    return response.status;
  });
  expect(forbiddenStatus).toBe(403);
});
