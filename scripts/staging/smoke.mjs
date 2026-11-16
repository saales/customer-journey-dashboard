#!/usr/bin/env node
/**
 * Smoke test di collaudo su un'istanza in esecuzione (staging). Usa SOLO l'API HTTP pubblica.
 *
 *   STAGING_URL=https://staging.example.it  node scripts/staging/smoke.mjs --credentials ./credentials.json [--seed] [--evidence-dir ./evidence]
 *
 * credentials.json (file locale, escluso dal repository; mai password nella riga di comando):
 * {
 *   "organizationSlug": "staging-a",
 *   "users": { "admin": {"email":"..","password":".."}, "editor": {...}, "analyst": {...}, "viewer": {...} },
 *   "otherTenant": { "organizationSlug": "staging-b", "admin": {"email":"..","password":".."} }   // opzionale, abilita i controlli cross-tenant
 * }
 *
 * --seed importa un dataset SINTETICO deterministico (300 clienti) tramite la vera API di importazione.
 * Esito: 0 tutto ok, 2 almeno un controllo fallito, 1 errore di esecuzione. Nessun token/password in output.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const base = (process.env.STAGING_URL ?? "").replace(/\/$/, "");
const credentialsPath = arg("--credentials");
if (!base || !credentialsPath) { console.error("Impostare STAGING_URL e --credentials <file>."); process.exit(1); }
const origin = new URL(process.env.STAGING_ORIGIN ?? base).origin;
const https = origin.startsWith("https:");
const cfg = JSON.parse(readFileSync(credentialsPath, "utf8"));
const results = [];
const record = (id, ok, detail) => { results.push({ id, ok, detail }); console.log(`${ok ? "OK  " : "FAIL"} ${id}${ok ? "" : " — " + detail}`); };

async function call(method, path, { token, body, withOrigin = true } = {}) {
  const headers = {};
  if (token) headers.Cookie = `${https ? "__Host-" : ""}percorso_session=${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && withOrigin) headers.Origin = origin;
  const res = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: "manual" });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* non JSON */ }
  return { status: res.status, headers: res.headers, json, text };
}
async function login(slug, user) {
  const res = await call("POST", "/api/auth/login", { body: { email: user.email, password: user.password, organizationSlug: slug } });
  const cookie = res.headers.getSetCookie().find((c) => /percorso_session=/.test(c));
  return { res, cookie, token: cookie ? cookie.split(";")[0].split("=")[1] : null };
}
const expectStatus = async (id, promise, expected) => {
  const r = await promise; record(id, r.status === expected, `atteso ${expected}, ottenuto ${r.status}`); return r;
};

// ---- Dataset sintetico deterministico (nessun dato reale) ----
function syntheticRows() {
  let seed = 42;
  const rand = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const channels = ["Organico", "Social", "Email", "Advertising", "Referral"];
  const stages = ["lead", "qualified", "opportunity", "customer"];
  const rows = [];
  const day = (offset) => new Date(Date.UTC(2026, 0, 1) + offset * 86400000).toISOString().slice(0, 10);
  for (let i = 1; i <= 300; i += 1) {
    const externalId = `synthetic-${String(i).padStart(4, "0")}`;
    const channel = channels[Math.floor(rand() * channels.length)];
    let offset = Math.floor(rand() * 150);
    const created = day(offset);
    rows.push({ externalId, channel, createdAt: created, stage: "visit", occurredAt: created });
    for (const stage of stages) {
      if (rand() > 0.55) break;
      offset += 1 + Math.floor(rand() * 7);
      rows.push({ externalId, channel, createdAt: created, stage, occurredAt: day(offset) });
    }
  }
  return rows;
}

const roles = ["admin", "editor", "analyst", "viewer"];
const tokens = {};
try {
  // 1) Salute e intestazioni di sicurezza
  const health = await call("GET", "/api/health");
  record("health: 200 e database connesso", health.status === 200 && health.json?.database === "connected", `stato ${health.status}`);
  const h = (n) => health.headers.get(n);
  record("intestazioni: nosniff, no-store, X-Frame-Options", h("x-content-type-options") === "nosniff" && h("cache-control") === "no-store" && h("x-frame-options") === "DENY", "intestazioni di sicurezza mancanti");
  if (https) record("intestazioni: HSTS presente su HTTPS", !!h("strict-transport-security"), "Strict-Transport-Security mancante");

  // 2) Login dei quattro ruoli e attributi del cookie
  for (const role of roles) {
    const { res, cookie, token } = await login(cfg.organizationSlug, cfg.users[role]);
    const flags = cookie && /HttpOnly/.test(cookie) && /SameSite=Strict/.test(cookie) && (!https || (/Secure/.test(cookie) && cookie.startsWith("__Host-")));
    record(`login ${role}: 200 e cookie HttpOnly/SameSite=Strict${https ? "/Secure/__Host-" : ""}`, res.status === 200 && !!flags, `stato ${res.status}`);
    tokens[role] = token;
  }
  const bad = await login(cfg.organizationSlug, { email: cfg.users.admin.email, password: "Password-sbagliata-123!" });
  record("login con password errata: 401 senza cookie", bad.res.status === 401 && !bad.cookie, `stato ${bad.res.status}`);

  // 3) Seed sintetico opzionale tramite la vera API
  if (args.includes("--seed")) {
    const r = await call("POST", "/api/import", { token: tokens.admin, body: { fileName: "sintetico-staging.csv", rows: syntheticRows() } });
    record("seed sintetico via /api/import: 201 (o 409 se già importato)", r.status === 201 || r.status === 409, `stato ${r.status}`);
  }

  // 4) Matrice di permessi sugli endpoint chiave
  const matrix = [
    ["GET", "/api/customers", undefined, { admin: 200, editor: 200, analyst: 200, viewer: 200 }],
    ["GET", "/api/summary", undefined, { admin: 200, editor: 200, analyst: 200, viewer: 200 }],
    ["POST", "/api/customers", { channel: "canale-inesistente" }, { admin: 400, editor: 400, analyst: 403, viewer: 403 }],
    ["POST", "/api/import", { fileName: "x.csv", rows: "non-un-array" }, { admin: 400, editor: 400, analyst: 403, viewer: 403 }],
    ["GET", "/api/export/organization.json", undefined, { admin: 200, editor: 200, analyst: 200, viewer: 403 }],
    ["GET", "/api/export/customers.csv", undefined, { admin: 200, editor: 200, analyst: 200, viewer: 403 }],
    ["GET", "/api/audit", undefined, { admin: 200, editor: 403, analyst: 403, viewer: 403 }],
    ["GET", "/api/members", undefined, { admin: 200, editor: 403, analyst: 403, viewer: 403 }],
    ["GET", "/api/invitations", undefined, { admin: 200, editor: 403, analyst: 403, viewer: 403 }],
  ];
  for (const [method, path, body, expected] of matrix) {
    for (const role of roles) await expectStatus(`${role} ${method} ${path} → ${expected[role]}`, call(method, path, { token: tokens[role], body }), expected[role]);
  }
  await expectStatus("senza sessione GET /api/customers → 401", call("GET", "/api/customers"), 401);
  await expectStatus("Origin estraneo su scrittura → 403", call("POST", "/api/customers", { token: tokens.admin, body: {}, withOrigin: false }), 403);

  // 5) Export JSON: struttura e coerenza con l'elenco clienti
  const exp = await call("GET", "/api/export/organization.json", { token: tokens.admin });
  const list = await call("GET", "/api/customers?limit=1", { token: tokens.admin });
  record("export JSON: schemaVersion 1 e numero clienti coerente con l'elenco", exp.json?.schemaVersion === 1 && exp.json?.customers?.length === list.json?.pagination?.total, "export incoerente con l'elenco clienti");
  record("export JSON: nessun campo sensibile", !/password|token_hash|scrypt\$/i.test(exp.text), "campo sensibile presente nell'export");

  // 6) Isolamento tra tenant (se fornite le credenziali del secondo tenant)
  if (cfg.otherTenant) {
    const other = await login(cfg.otherTenant.organizationSlug, cfg.otherTenant.admin);
    record("secondo tenant: login amministratore", other.res.status === 200, `stato ${other.res.status}`);
    const mine = await call("GET", "/api/customers?limit=100", { token: tokens.admin });
    const theirs = await call("GET", "/api/customers?limit=100", { token: other.token });
    const mineIds = new Set((mine.json?.data ?? []).map((c) => c.id));
    const overlap = (theirs.json?.data ?? []).filter((c) => mineIds.has(c.id));
    record("elenchi clienti dei due tenant senza ID in comune", overlap.length === 0, `${overlap.length} ID in comune`);
    const victim = [...mineIds][0];
    if (victim) {
      await expectStatus("tenant B non può eliminare un cliente del tenant A (404)", call("DELETE", `/api/customers/${victim}`, { token: other.token }), 404);
      await expectStatus("tenant B non può modificare un cliente del tenant A (404)", call("PUT", `/api/customers/${victim}`, { token: other.token, body: { externalId: "x", channel: "Email", createdAt: "2026-01-01" } }), 404);
      const still = await call("GET", "/api/customers?limit=100", { token: tokens.admin });
      record("il cliente del tenant A è ancora presente", (still.json?.data ?? []).some((c) => c.id === victim), "cliente scomparso");
    }
    await call("POST", "/api/auth/logout", { token: other.token });
  }

  // 7) Logout: la sessione viene revocata lato server
  for (const role of roles) {
    const out = await call("POST", "/api/auth/logout", { token: tokens[role] });
    const after = await call("GET", "/api/account", { token: tokens[role] });
    record(`logout ${role}: 204 e sessione revocata (401)`, out.status === 204 && after.status === 401, `logout ${out.status}, dopo ${after.status}`);
  }
} catch (error) {
  console.error("Errore di esecuzione:", error instanceof Error ? error.message : "sconosciuto");
  process.exit(1);
}

const failed = results.filter((r) => !r.ok);
const dir = arg("--evidence-dir") ?? "./evidence";
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const file = `${dir}/smoke-${stamp}.json`;
writeFileSync(file, JSON.stringify({ generatedAt: new Date().toISOString(), target: new URL(base).host, seeded: args.includes("--seed"), total: results.length, failed: failed.length, results }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} controlli superati. Evidenza: ${file}`);
process.exit(failed.length ? 2 : 0);
