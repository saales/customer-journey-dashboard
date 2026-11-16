import { describe, expect, it } from "vitest";
import { createOneTimeAuthLink } from "../src/one-time-auth-link.js";

describe("link con token monouso", () => {
  it("colloca l'invito nel frammento URL senza inserirlo nella richiesta HTTP", () => {
    const token = "invito+/=";
    const link = new URL(createOneTimeAuthLink("https://app.example.it", "token", token));

    expect(link.origin).toBe("https://app.example.it");
    expect(link.search).toBe("");
    expect(new URLSearchParams(link.hash.slice(1)).get("token")).toBe(token);
  });

  it("colloca il reset password nel frammento URL", () => {
    const link = new URL(createOneTimeAuthLink("https://app.example.it", "reset", "R".repeat(43)));

    expect(link.search).toBe("");
    expect(new URLSearchParams(link.hash.slice(1)).get("reset")).toBe("R".repeat(43));
  });
});
