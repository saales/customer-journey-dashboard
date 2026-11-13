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
      "externalId,channel,createdAt,stage,occurredAt\ne2e-crm-001,Organico,2025-04-01,visit,2025-04-01\ne2e-crm-001,Organico,2025-04-01,lead,2025-04-02\n",
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
  const exportAudit = await page.evaluate(async () => {
    const response = await fetch("/api/audit?action=data.exported");
    return { status: response.status, body: await response.json() };
  });
  expect(exportAudit.status).toBe(200);
  expect(exportAudit.body.data).toEqual(expect.arrayContaining([
    expect.objectContaining({ action: "data.exported", resourceType: "customer_export" }),
  ]));

  // Invito reale monouso e verifica dei permessi di un analista.
  await page.getByRole("button", { name: "Impostazioni" }).click();
  await page.getByLabel("Email", { exact: true }).fill("analyst@e2e.example");
  await page.locator("form.customer-form select").selectOption("analyst");
  await page.getByRole("button", { name: "Crea invito (7 giorni)" }).click();
  const inviteInput = page.getByLabel("Collegamento da condividere");
  await expect(inviteInput).toHaveValue(/token=/);
  const inviteUrl = await inviteInput.inputValue();

  await page.goto(inviteUrl);
  await page.getByLabel("Nome e cognome").fill("E2E Analyst");
  await page.getByLabel("Password", { exact: true }).fill("E2E-analyst-password-2026!");
  await page.getByLabel("Conferma password").fill("E2E-analyst-password-2026!");
  const acceptanceResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/invitations/accept") &&
    response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Accetta invito" }).click();
  const acceptanceResponse = await acceptanceResponsePromise;
  const acceptanceBody = await acceptanceResponse.json();
  expect(acceptanceResponse.status(), JSON.stringify(acceptanceBody)).toBe(200);
  const sessionStatus = await page.evaluate(async () => (await fetch("/api/auth/session")).status);
  expect(sessionStatus).toBe(200);
  await expect(page.getByRole("heading", { name: "Panoramica" })).toBeVisible();

  await expect(page.getByRole("button", { name: "Importazione dati" })).toHaveCount(0);
  await page.getByRole("button", { name: "Gestione clienti" }).click();
  await expect(page.getByRole("button", { name: "Nuovo cliente" })).toHaveCount(0);
  // L'analista può esportare ma non accedere all'audit o scrivere dati.
  const analystDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Esporta tutti i clienti CSV" }).click();
  const analystDownload = await analystDownloadPromise;
  expect(analystDownload.suggestedFilename()).toBe("percorso-clienti.csv");

  const permissionStatuses = await page.evaluate(async () => {
    const [audit, customerWrite] = await Promise.all([
      fetch("/api/audit"),
      fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "Organico", createdAt: "2025-05-01", events: [] }),
      }),
    ]);
    return { audit: audit.status, customerWrite: customerWrite.status };
  });
  expect(permissionStatuses).toEqual({ audit: 403, customerWrite: 403 });

  // Logout revoca la sessione e riporta alla schermata di accesso.
  await page.getByRole("button", { name: "Esci" }).click();
  await expect(page.getByRole("heading", { name: "Accedi al tuo spazio di lavoro" })).toBeVisible();
  const revokedSessionStatus = await page.evaluate(async () => (await fetch("/api/auth/session")).status);
  expect(revokedSessionStatus).toBe(401);

  // Seconda verifica browser con un ruolo viewer, privo anche dell'export.
  await page.getByLabel("Email").fill(admin.email);
  await page.getByLabel("Password").fill(admin.password);
  await page.getByLabel("Codice organizzazione").fill(admin.organization);
  await page.getByRole("button", { name: "Accedi" }).click();
  await expect(page.getByRole("heading", { name: "Panoramica" })).toBeVisible();
  await page.getByRole("button", { name: "Impostazioni" }).click();
  await page.getByLabel("Email", { exact: true }).fill("viewer@e2e.example");
  await page.locator("form.customer-form select").selectOption("viewer");
  await page.getByRole("button", { name: "Crea invito (7 giorni)" }).click();
  const viewerInviteInput = page.getByLabel("Collegamento da condividere");
  await expect(viewerInviteInput).toHaveValue(/token=/);
  await page.goto(await viewerInviteInput.inputValue());
  await page.getByLabel("Nome e cognome").fill("E2E Viewer");
  await page.getByLabel("Password", { exact: true }).fill("E2E-viewer-password-2026!");
  await page.getByLabel("Conferma password").fill("E2E-viewer-password-2026!");
  const viewerAcceptance = page.waitForResponse((response) =>
    response.url().endsWith("/api/invitations/accept") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Accetta invito" }).click();
  expect((await viewerAcceptance).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Panoramica" })).toBeVisible();
  await page.getByRole("button", { name: "Gestione clienti" }).click();
  await expect(page.getByRole("button", { name: "Nuovo cliente" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Esporta tutti i clienti CSV" })).toHaveCount(0);
  const viewerPermissions = await page.evaluate(async () => {
    const [audit, customerWrite, exportCsv] = await Promise.all([
      fetch("/api/audit"),
      fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "Organico", createdAt: "2025-06-01", events: [] }),
      }),
      fetch("/api/export/customers.csv"),
    ]);
    return { audit: audit.status, customerWrite: customerWrite.status, exportCsv: exportCsv.status };
  });
  expect(viewerPermissions).toEqual({ audit: 403, customerWrite: 403, exportCsv: 403 });
});
