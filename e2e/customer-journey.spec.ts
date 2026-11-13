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

  // Conserva l'ID del cliente nel tenant A per provare successivamente gli accessi IDOR dal tenant B.
  const tenantACustomerId = await page.evaluate(async () => {
    const response = await fetch("/api/customers?limit=100");
    const body = await response.json() as { data: Array<{ id: string; createdAt: string }> };
    return body.data.find((customer) => customer.createdAt === "2025-03-10")?.id ?? null;
  });
  expect(tenantACustomerId).toBeTruthy();

  // Aggiunta di una fase funnel persistente.
  await page.getByRole("button", { name: "Impostazioni" }).click();
  await page.getByLabel("Aggiungi una fase").fill("Demo completata");
  await page.getByRole("button", { name: "Aggiungi fase" }).click();
  await expect(page.getByText("Demo completata", { exact: true })).toBeVisible();

  // Conserva l’ID della fase personalizzata del tenant A per il controllo IDOR.
  const tenantAFunnelStageId = await page.evaluate(async () => {
    const response = await fetch("/api/funnel-stages");
    const stages = await response.json() as Array<{ id: string; label: string }>;
    return stages.find((stage) => stage.label === "Demo completata")?.id ?? null;
  });
  expect(tenantAFunnelStageId).toMatch(/^custom_[a-f0-9]{32}$/);

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

  // Terzo percorso browser: l'editor può lavorare sui dati ma non amministrare membri o audit.
  await page.getByRole("button", { name: "Esci" }).click();
  await page.getByLabel("Email").fill(admin.email);
  await page.getByLabel("Password").fill(admin.password);
  await page.getByLabel("Codice organizzazione").fill(admin.organization);
  await page.getByRole("button", { name: "Accedi" }).click();
  await expect(page.getByRole("heading", { name: "Panoramica" })).toBeVisible();
  await page.getByRole("button", { name: "Impostazioni" }).click();
  await page.getByLabel("Email", { exact: true }).fill("editor@e2e.example");
  await page.locator("form.customer-form select").selectOption("editor");
  await page.getByRole("button", { name: "Crea invito (7 giorni)" }).click();
  const editorInviteInput = page.getByLabel("Collegamento da condividere");
  await expect(editorInviteInput).toHaveValue(/token=/);
  await page.goto(await editorInviteInput.inputValue());
  await page.getByLabel("Nome e cognome").fill("E2E Editor");
  await page.getByLabel("Password", { exact: true }).fill("E2E-editor-password-2026!");
  await page.getByLabel("Conferma password").fill("E2E-editor-password-2026!");
  const editorAcceptance = page.waitForResponse((response) =>
    response.url().endsWith("/api/invitations/accept") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Accetta invito" }).click();
  expect((await editorAcceptance).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Panoramica" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Importazione dati" })).toBeVisible();
  await page.getByRole("button", { name: "Gestione clienti" }).click();
  await expect(page.getByRole("button", { name: "Nuovo cliente" })).toBeVisible();
  const editorPermissions = await page.evaluate(async () => {
    const [customerWrite, funnelWrite, importData, exportCsv, audit, members] = await Promise.all([
      fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ externalId: "editor-e2e-customer", channel: "Organico", createdAt: "2025-07-01", events: [] }),
      }),
      fetch("/api/funnel-stages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "Editor E2E" }),
      }),
      fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: "editor-e2e.csv",
          rows: [{ externalId: "editor-e2e-001", channel: "Organico", createdAt: "2025-07-02",
            stage: "visit", occurredAt: "2025-07-02" }],
        }),
      }),
      fetch("/api/export/customers.csv"),
      fetch("/api/audit"),
      fetch("/api/members"),
    ]);
    return {
      customerWrite: customerWrite.status,
      funnelWrite: funnelWrite.status,
      importData: importData.status,
      exportCsv: exportCsv.status,
      audit: audit.status,
      members: members.status,
    };
  });
  expect(editorPermissions).toEqual({
    customerWrite: 201,
    funnelWrite: 201,
    importData: 201,
    exportCsv: 200,
    audit: 403,
    members: 403,
  });

  // Isolamento API tra due organizzazioni reali: stesso utente, sessione nel tenant B.
  await page.getByRole("button", { name: "Esci" }).click();
  await page.getByLabel("Email").fill(admin.email);
  await page.getByLabel("Password").fill(admin.password);
  await page.getByLabel("Codice organizzazione").fill("e2e-second-workspace");
  await page.getByRole("button", { name: "Accedi" }).click();
  await expect(page.getByRole("heading", { name: "Panoramica" })).toBeVisible();
  const crossTenantChecks = await page.evaluate(async ({ foreignCustomerId, foreignStageId }) => {
    const [customers, update, remove, exportResponse, audit, funnel, updateStage, members, invitations] = await Promise.all([
      fetch("/api/customers?limit=100"),
      fetch(`/api/customers/${encodeURIComponent(foreignCustomerId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "Social", createdAt: "2025-03-10", events: [] }),
      }),
      fetch(`/api/customers/${encodeURIComponent(foreignCustomerId)}`, { method: "DELETE" }),
      fetch("/api/export/customers.csv"),
      fetch("/api/audit"),
      fetch("/api/funnel-stages"),
      fetch(`/api/funnel-stages/${encodeURIComponent(foreignStageId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "Modifica cross-tenant non autorizzata" }),
      }),
      fetch("/api/members"),
      fetch("/api/invitations"),
    ]);
    return {
      customerStatus: customers.status,
      customers: (await customers.json()).data,
      updateStatus: update.status,
      deleteStatus: remove.status,
      exportStatus: exportResponse.status,
      exportCsv: await exportResponse.text(),
      auditStatus: audit.status,
      audit: (await audit.json()).data,
      funnelStatus: funnel.status,
      funnelStages: await funnel.json(),
      updateStageStatus: updateStage.status,
      membersStatus: members.status,
      members: await members.json(),
      invitationsStatus: invitations.status,
      invitations: await invitations.json(),
    };
  }, { tenantACustomerId, tenantAFunnelStageId });
  expect(crossTenantChecks.customerStatus).toBe(200);
  expect(crossTenantChecks.customers).toHaveLength(1);
  expect(crossTenantChecks.customers[0]).toMatchObject({ channel: "Advertising", createdAt: "2025-02-01" });
  expect(crossTenantChecks.customers[0].events).toEqual([
    { stage: "visit", occurredAt: "2025-02-01" },
  ]);
  expect(crossTenantChecks.updateStatus).toBe(404);
  expect(crossTenantChecks.deleteStatus).toBe(404);
  expect(crossTenantChecks.exportStatus).toBe(200);
  expect(crossTenantChecks.exportCsv).toContain("tenant-b-sentinel");
  expect(crossTenantChecks.exportCsv).not.toContain("e2e-crm-001");
  expect(crossTenantChecks.exportCsv).not.toContain("editor-e2e-001");
  expect(crossTenantChecks.funnelStatus).toBe(200);
  expect(crossTenantChecks.funnelStages.some((stage: { label: string }) => stage.label === "Demo completata")).toBe(false);
  expect(crossTenantChecks.updateStageStatus).toBe(404);
  expect(crossTenantChecks.membersStatus).toBe(200);
  expect(crossTenantChecks.members).toHaveLength(1);
  expect(crossTenantChecks.members[0]).toMatchObject({ email: "admin@e2e.example", role: "admin" });
  expect(crossTenantChecks.invitationsStatus).toBe(200);
  expect(crossTenantChecks.invitations).toHaveLength(0);
  expect(crossTenantChecks.auditStatus).toBe(200);
  expect(crossTenantChecks.audit.every((entry: { action: string }) =>
    !["membership.invited", "data.imported", "customer.created"].includes(entry.action),
  )).toBe(true);
});
