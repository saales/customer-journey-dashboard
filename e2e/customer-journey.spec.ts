import { test, expect, type Browser } from "@playwright/test";

const e2ePassword = (role: string) => ["E2E", role, "password", "2026!"].join("-");

const admin = {
  email: "admin@e2e.example",
  password: e2ePassword("admin"),
  organization: "e2e-workspace",
};


async function acceptInviteInFreshContext(browser: Browser, inviteUrl: string, fullName: string, password: string) {
  // Il destinatario reale non condivide cookie o sessioni con l'amministratore che crea l'invito.
  const context = await browser.newContext();
  const inviteePage = await context.newPage();
  await inviteePage.goto(inviteUrl);
  await expect(inviteePage.getByLabel("Nome e cognome")).toBeVisible();
  await inviteePage.getByLabel("Nome e cognome").fill(fullName);
  const passwordFields = inviteePage.locator('form.auth-form input[autocomplete="new-password"]');
  await expect(passwordFields).toHaveCount(2);
  await passwordFields.nth(0).fill(password);
  await passwordFields.nth(1).fill(password);
  const acceptance = inviteePage.waitForResponse((response) =>
    response.url().endsWith("/api/invitations/accept") && response.request().method() === "POST",
  );
  await inviteePage.getByRole("button", { name: "Accetta invito" }).click();
  const response = await acceptance;
  const body = await response.json();
  expect(response.status(), JSON.stringify(body)).toBe(200);
  expect(await inviteePage.evaluate(async () => (await fetch("/api/auth/session")).status)).toBe(200);
  await expect(inviteePage.getByRole("heading", { name: "Panoramica" })).toBeVisible();
  return { context, page: inviteePage };
}

test("percorso amministratore e limitazione dei permessi analista", async ({ page, browser }) => {
  await page.goto("/");
  await page.locator("form.auth-form").first().getByLabel("Email").fill(admin.email);
  await page.getByLabel("Password").fill(admin.password);
  await page.locator("form.auth-form").first().getByLabel("Codice organizzazione").fill(admin.organization);
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
  await expect(page.getByRole("heading", { name: "Il tuo account" })).toBeVisible();
  const profileName = page.getByLabel("Nome e cognome");
  await expect(profileName).toHaveValue("E2E Administrator");
  await profileName.fill("E2E Admin aggiornato");
  await page.getByRole("button", { name: "Salva profilo" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Profilo aggiornato." })).toBeVisible();
  await expect(profileName).toHaveValue("E2E Admin aggiornato");
  await expect(page.getByRole("heading", { name: "Organizzazione" })).toBeVisible();
  const organizationName = page.getByLabel("Nome organizzazione");
  await expect(organizationName).toHaveValue("E2E Workspace");
  await organizationName.fill("E2E Workspace aggiornato");
  await page.getByRole("button", { name: "Salva modifiche" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Nome organizzazione aggiornato." })).toBeVisible();
  await expect(organizationName).toHaveValue("E2E Workspace aggiornato");
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

  // Invito reale monouso: l'accettazione avviene in un browser isolato.
  await page.getByRole("button", { name: "Impostazioni" }).click();
  await page.locator(".card .card form.customer-form").getByLabel("Email").fill("analyst@e2e.example");
  await page.locator("form.customer-form select").selectOption("analyst");
  await page.getByRole("button", { name: "Crea invito (7 giorni)" }).click();
  const inviteInput = page.getByLabel("Collegamento da condividere");
  await expect(inviteInput).toHaveValue(/token=/);
  const analyst = await acceptInviteInFreshContext(browser, await inviteInput.inputValue(), "E2E Analyst", e2ePassword("analyst"));
  const analystPage = analyst.page;
  await expect(analystPage.getByRole("button", { name: "Importazione dati" })).toHaveCount(0);
  await analystPage.getByRole("button", { name: "Gestione clienti" }).click();
  await expect(analystPage.getByRole("button", { name: "Nuovo cliente" })).toHaveCount(0);
  const analystDownloadPromise = analystPage.waitForEvent("download");
  await analystPage.getByRole("button", { name: "Esporta tutti i clienti CSV" }).click();
  const analystDownload = await analystDownloadPromise;
  expect(analystDownload.suggestedFilename()).toBe("percorso-clienti.csv");
  const permissionStatuses = await analystPage.evaluate(async () => {
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
  await analyst.context.close();

  // Il viewer non può modificare, esportare o consultare l'audit.
  await page.getByRole("button", { name: "Impostazioni" }).click();
  await page.locator(".card .card form.customer-form").getByLabel("Email").fill("viewer@e2e.example");
  await page.locator("form.customer-form select").selectOption("viewer");
  await page.getByRole("button", { name: "Crea invito (7 giorni)" }).click();
  const viewerInviteInput = page.getByLabel("Collegamento da condividere");
  await expect(viewerInviteInput).toHaveValue(/token=/);
  const viewer = await acceptInviteInFreshContext(browser, await viewerInviteInput.inputValue(), "E2E Viewer", e2ePassword("viewer"));
  const viewerPage = viewer.page;
  await viewerPage.getByRole("button", { name: "Gestione clienti" }).click();
  await expect(viewerPage.getByRole("button", { name: "Nuovo cliente" })).toHaveCount(0);
  await expect(viewerPage.getByRole("button", { name: "Esporta tutti i clienti CSV" })).toHaveCount(0);
  const viewerPermissions = await viewerPage.evaluate(async () => {
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
  await viewer.context.close();

  // L'editor può lavorare sui dati ma non amministrare membri o audit.
  await page.getByRole("button", { name: "Impostazioni" }).click();
  await page.locator(".card .card form.customer-form").getByLabel("Email").fill("editor@e2e.example");
  await page.locator("form.customer-form select").selectOption("editor");
  await page.getByRole("button", { name: "Crea invito (7 giorni)" }).click();
  const editorInviteInput = page.getByLabel("Collegamento da condividere");
  await expect(editorInviteInput).toHaveValue(/token=/);
  const editor = await acceptInviteInFreshContext(browser, await editorInviteInput.inputValue(), "E2E Editor", e2ePassword("editor"));
  const editorPage = editor.page;
  await expect(editorPage.getByRole("button", { name: "Importazione dati" })).toBeVisible();
  await editorPage.getByRole("button", { name: "Gestione clienti" }).click();
  await expect(editorPage.getByRole("button", { name: "Nuovo cliente" })).toBeVisible();
  const editorPermissions = await editorPage.evaluate(async () => {

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
  await editor.context.close();

  // Isolamento API tra due organizzazioni reali: stesso utente, sessione nel tenant B.
  await page.getByRole("button", { name: "Esci" }).click();
  await page.locator("form.auth-form").first().getByLabel("Email").fill(admin.email);
  await page.getByLabel("Password").fill(admin.password);
  await page.locator("form.auth-form").first().getByLabel("Codice organizzazione").fill("e2e-second-workspace");
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
  }, { foreignCustomerId: tenantACustomerId, foreignStageId: tenantAFunnelStageId });
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
