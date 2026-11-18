import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportButton } from "./ExportButton";

const props = { filename: "test_2026-01-01_2026-03-31.csv", title: "Prova", description: "d", headers: ["A", "B"], rows: [[1, 2]] };

describe("ExportButton (menu)", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("mostra un solo pulsante «Esporta»: i formati compaiono solo all'apertura", () => {
    render(<ExportButton {...props} />);
    const trigger = screen.getByRole("button", { name: "Esporta" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByRole("menuitem").map((el) => el.getAttribute("aria-label"))).toEqual(["Esporta CSV", "Esporta Excel", "Esporta PDF"]);
  });

  it("sposta il focus sul primo formato, naviga con le frecce e si chiude con Esc riportando il focus sul pulsante", () => {
    render(<ExportButton {...props} />);
    const trigger = screen.getByRole("button", { name: "Esporta" });
    fireEvent.click(trigger);
    const items = screen.getAllByRole("menuitem");
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(document, { key: "ArrowUp" });
    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("si chiude cliccando fuori", () => {
    render(<div><ExportButton {...props} /><p>fuori</p></div>);
    fireEvent.click(screen.getByRole("button", { name: "Esporta" }));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.mouseDown(screen.getByText("fuori"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("scegliere CSV avvia il download e chiude il menu", () => {
    const createObjectURL = vi.fn(() => "blob:x");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<ExportButton {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Esporta" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Esporta CSV" }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
