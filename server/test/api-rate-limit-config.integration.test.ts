import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createPostgresApp } from "../src/postgres-app.js";
import { ORIGIN, createHttpTestEnvironment, integrationDatabaseUrl, type HttpTestEnvironment } from "./helpers/http-test-environment.js";

const dbUrl = integrationDatabaseUrl();
let env: HttpTestEnvironment;
let server: Server;
let base: string;

beforeAll(async () => {
  if (!dbUrl) return;
  env = await createHttpTestEnvironment();
  const app = createPostgresApp(env.runtimePool, { allowedOrigins: [ORIGIN], rateLimitSecret: "limite-configurabile-con-almeno-32-caratteri", production: false, apiRateLimit: 5 });
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);
afterAll(async () => { await new Promise<void>((r) => (server ? server.close(() => r()) : r())); await env?.close(); });

describe.skipIf(!dbUrl)("Limite API per IP configurabile", () => {
  it("con apiRateLimit=5 la sesta richiesta riceve 429 con Retry-After e nessun dato", async () => {
    const token = env.tenants.A.users.admin.token;
    const statuses: number[] = [];
    let last: Response | undefined;
    for (let i = 0; i < 6; i += 1) {
      last = await fetch(`${base}/api/funnel-stages`, { headers: { Cookie: `percorso_session=${token}` } });
      statuses.push(last.status);
      if (last.status !== 429) await last.arrayBuffer();
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    expect(last!.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(await last!.text()).not.toContain("visit");
  });
});
