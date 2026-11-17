import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import { getRequestClientAddress } from "../src/request-client-address.js";

function request(headers: Record<string, string>, ip = "10.0.0.4") {
  return {
    get: (name: string) => headers[name.toLowerCase()],
    ip,
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as Request;
}

afterEach(() => vi.unstubAllEnvs());

describe("getRequestClientAddress", () => {
  it("uses Render's trusted CF-Connecting-IP value", () => {
    vi.stubEnv("RENDER", "true");
    expect(getRequestClientAddress(request({ "cf-connecting-ip": "198.51.100.24" }))).toBe("198.51.100.24");
  });

  it("ignores invalid forwarded addresses on Render", () => {
    vi.stubEnv("RENDER", "true");
    expect(getRequestClientAddress(request({ "cf-connecting-ip": "not-an-ip" }))).toBe("10.0.0.4");
  });

  it("does not trust CF-Connecting-IP outside Render", () => {
    vi.stubEnv("RENDER", "");
    expect(getRequestClientAddress(request({ "cf-connecting-ip": "198.51.100.24" }))).toBe("10.0.0.4");
  });
});
