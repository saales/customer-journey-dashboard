import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppLayout } from "./AppLayout";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.innerWidth = 1024;
});

describe("AppLayout", () => {
  it("cambia sezione e conserva la preferenza del tema", () => {
    render(
      <AppLayout sections={{ analytics: <p>Report analitici</p> }}>
        <p>Panoramica contenuti</p>
      </AppLayout>,
    );

    expect(screen.getByRole("link", { name: "Vai al contenuto principale" }).getAttribute("href")).toBe("#main-content");
    expect(screen.getByRole("main").getAttribute("id")).toBe("main-content");

    fireEvent.click(screen.getByRole("button", { name: "Analisi e report" }));
    expect(screen.getByRole("heading", { name: "Analisi e report" })).toBeTruthy();
    expect(screen.getByText("Report analitici")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Attiva tema scuro" }));
    expect(window.localStorage.getItem("customer-journey-theme")).toBe("dark");
  });

  it("inizializza il menu chiuso su mobile e lo richiude dopo la navigazione", () => {
    window.innerWidth = 390;

    render(
      <AppLayout sections={{ customers: <p>Elenco clienti</p> }}>
        <p>Panoramica contenuti</p>
      </AppLayout>,
    );

    const menuButton = screen.getByRole("button", { name: "Apri menu" });
    expect(menuButton.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(menuButton);
    expect(screen.getByRole("button", { name: "Chiudi menu" }).getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Gestione clienti" }));
    expect(screen.getByText("Elenco clienti")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apri menu" }).getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Apri menu" }));
    fireEvent.click(screen.getByRole("button", { name: "Chiudi menu di navigazione" }));
    expect(screen.getByRole("button", { name: "Apri menu" }).getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Apri menu" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Apri menu" }).getAttribute("aria-expanded")).toBe("false");
  });
});
