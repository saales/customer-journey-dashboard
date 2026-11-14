#!/usr/bin/env node
/**
 * Smoke test HTTP per staging. Solo dati sintetici; nessun segreto nell'evidenza.
 * Richiede HTTPS e credenziali di due tenant distinti.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const base = (process.env.STAGING_URL || "").replace(/\/$/, "");
const credentialsPath = arg("--credentials");
if (!base || !credentialsPath) { console.error("Impostare STAGING_URL e --credentials <file>."); process.exit(1); }
const baseUrl = new URL(base);
if (baseUrl.protocol !== "https:") { console.error("STAGING_URL deve usare HTTPS."); process.exit(1); }
const origin = new URL(process.env.STAGING_ORIGIN || base).origin;
if (origin !== baseUrl.origin) { console.error("STAGING_ORIGIN deve coincidere con l'origine STAGING_URL."); process.exit(1); }
const cfg = JSON.parse(readFileSync(resolve(credentialsPath), "utf8"));
if (!cfg.otherTenant || !cfg.otherTenant.organizationSlug || !cfg.otherTenant.admin?.email || !cfg.otherTenant.admin?.password) {
  console.error("credentials.json deve includere otherTenant con slug, admin.email e admin.password.");
  process.exit(1);
}
if (cfg.organizationSlug === cfg.otherTenant.organizationSlug) { console.error("I due tenant devono avere slug distinti."); process.exit(1); }
const roles = ["admin", "editor", "analyst", "viewer"];
for (const role of roles) if (!cfg.users?.[role]?.email || !cfg.users?.[role]?.password) {
  console.error("Credenziali mancanti per il ruolo " + role + "."); process.exit(1);
}
const results = [];
const record = (id, ok, detail) => {
  results.push({ id, ok, detail });
  console.log((ok ? "OK  " : "FAIL ") + id + (ok ? "" : " — " + detail));
};
async function call(method, path, options = {}) {
  const headers = {};
  if (options.token) headers.Cookie = "__Host-percorso_session=" + options.token;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && options.withOrigin !== false) headers.Origin = origin;
  const response = await fetch(base + path, {
    method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body), redirect: "manual"
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: response.status, headers: response.headers, text, json };
}
async function login(slug, user) {
  const response = await call("POST", "/api/auth/login", {
    body: { email: user.email, password: user.password, organizationSlug: slug }
  });
  const cookie = response.headers.getSetCookie().find((v) => /__Host-percorso_session=/.test(v));
  return { response, cookie, token: cookie ? cookie.split(";")[0].split("=").slice(1).join("=") : null };
}
const expect = async (id, promise, status) => {
  const r = await promise;
  record(id, r.status === status, "atteso " + status + ", ricevuto " + r.status);
  return r;
};
function syntheticRows() {
  let seed = 42;
  const rand = () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const channels = ["Organico", "Social", "Email", "Advertising", "Referral"];
  const stages = ["lead", "qualified", "opportunity", "customer"];
  const rows = [];
  const day = (n) => new Date(Date.UTC(2026, 0, 1) + n * 86400000).toISOString().slice(0, 10);
  for (let i = 1; i <= 300; i++) {
    const externalId = "synthetic-" + String(i).padStart(4, "0");
    const channel = channels[Math.floor(rand() * channels.length)];
    let offset = Math.floor(rand() * 150);
    const createdAt = day(offset);
    rows.push({ externalId, channel, createdAt, stage: "visit", occurredAt: createdAt });
    for (const stage of stages) {
      if (rand() > 0.55) break;
      offset += 1 + Math.floor(rand() * 7);
      rows.push({ externalId, channel, createdAt, stage, occurredAt: day(offset) });
    }
  }
  return rows;
}
const tokens = {};
try {
  const health = await call("GET", "/api/health");
  record("health database connesso", health.status === 200 && health.json?.database === "connected", "stato " + health.status);
  record("header sicurezza", health.headers.get("x-content-type-options") === "nosniff" &&
    health.headers.get("cache-control") === "no-store" && health.headers.get("x-frame-options") === "DENY" &&
    !!health.headers.get("strict-transport-security"), "header attesi assenti");
  for (const role of roles) {
    const result = await login(cfg.organizationSlug, cfg.users[role]);
    const flags = result.cookie && /HttpOnly/.test(result.cookie) && /SameSite=Strict/.test(result.cookie) &&
      /Secure/.test(result.cookie) && result.cookie.startsWith("__Host-");
    record("login " + role + " con cookie sicuro", result.response.status === 200 && !!flags, "stato " + result.response.status);
    tokens[role] = result.token;
  }
  const bad = await login(cfg.organizationSlug, { email: cfg.users.admin.email, password: "password errata non valida" });
  record("password errata rifiutata", bad.response.status === 401 && !bad.cookie, "stato " + bad.response.status);
  if (args.includes("--seed")) {
    const seed = await call("POST", "/api/import", {
      token: tokens.admin, body: { fileName: "staging-synthetic.json", rows: syntheticRows() }
    });
    record("seed sintetico", seed.status === 201 || seed.status === 409, "stato " + seed.status);
  }
  const matrix = [
    ["GET", "/api/customers", undefined, {admin:200,editor:200,analyst:200,viewer:200}],
    ["GET", "/api/summary", undefined, {admin:200,editor:200,analyst:200,viewer:200}],
    ["POST", "/api/customers", {channel:"canale-inesistente"}, {admin:400,editor:400,analyst:403,viewer:403}],
    ["POST", "/api/import", {fileName:"x.csv",rows:"non-un-array"}, {admin:400,editor:400,analyst:403,viewer:403}],
    ["GET", "/api/export/organization.json", undefined, {admin:200,editor:200,analyst:200,viewer:403}],
    ["GET", "/api/audit", undefined, {admin:200,editor:403,analyst:403,viewer:403}],
    ["GET", "/api/members", undefined, {admin:200,editor:403,analyst:403,viewer:403}],
    ["GET", "/api/invitations", undefined, {admin:200,editor:403,analyst:403,viewer:403}]
  ];
  for (const [method, path, body, expected] of matrix) {
    for (const role of roles) await expect(role + " " + method + " " + path, call(method, path, {token:tokens[role],body}), expected[role]);
  }
  await expect("accesso anonimo negato", call("GET", "/api/customers"), 401);
  await expect("CSRF Origin assente negato", call("POST", "/api/customers", {token:tokens.admin,body:{},withOrigin:false}), 403);
  const exp = await call("GET", "/api/export/organization.json", {token:tokens.admin});
  const customers = await call("GET", "/api/customers?limit=1", {token:tokens.admin});
  record("export JSON coerente", exp.json?.schemaVersion === 1 &&
    exp.json?.customers?.length === customers.json?.pagination?.total, "conteggio/schema non coerente");
  record("export senza segreti", !/password|token_hash|scrypt\$/i.test(exp.text), "campo sensibile nell'export");
  const other = await login(cfg.otherTenant.organizationSlug, cfg.otherTenant.admin);
  record("login admin secondo tenant", other.response.status === 200 && !!other.token, "stato " + other.response.status);
  const mine = await call("GET", "/api/customers?limit=100", {token:tokens.admin});
  const theirs = await call("GET", "/api/customers?limit=100", {token:other.token});
  const mineIds = new Set((mine.json?.data || []).map((c) => c.id));
  const overlap = (theirs.json?.data || []).filter((c) => mineIds.has(c.id));
  record("isolamento liste clienti", overlap.length === 0, overlap.length + " ID condivisi");
  const victim = Array.from(mineIds)[0];
  if (victim) {
    await expect("tenant B non elimina cliente A", call("DELETE", "/api/customers/" + victim, {token:other.token}), 404);
    await expect("tenant B non modifica cliente A", call("PUT", "/api/customers/" + victim, {
      token:other.token, body:{externalId:"blocked-cross-tenant",channel:"Email",createdAt:"2026-01-01"}
    }), 404);
    const still = await call("GET", "/api/customers?limit=100", {token:tokens.admin});
    record("cliente tenant A ancora presente", (still.json?.data || []).some((c) => c.id === victim), "cliente non più presente");
  } else record("cliente campione per test cross-tenant", false, "tenant A non contiene clienti");
  await call("POST", "/api/auth/logout", {token:other.token});
  for (const role of roles) {
    const out = await call("POST", "/api/auth/logout", {token:tokens[role]});
    const after = await call("GET", "/api/account", {token:tokens[role]});
    record("logout " + role + " revoca sessione", out.status === 204 && after.status === 401,
      "logout " + out.status + ", successivo " + after.status);
  }
} catch (error) {
  console.error("Errore smoke:", error instanceof Error ? error.message : "sconosciuto");
  process.exit(1);
}
const failed = results.filter((r) => !r.ok);
const dir = arg("--evidence-dir") || "./evidence";
mkdirSync(dir, {recursive:true});
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const output = resolve(dir, "smoke-" + stamp + ".json");
writeFileSync(output, JSON.stringify({
  generatedAt:new Date().toISOString(), target:baseUrl.host, seeded:args.includes("--seed"),
  total:results.length, failed:failed.length, results
}, null, 2), {mode:0o600});
console.log("\n" + (results.length-failed.length) + "/" + results.length + " controlli superati. Evidenza: " + output);
process.exit(failed.length ? 2 : 0);
