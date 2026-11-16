import { createContext, useContext } from "react";

export type Section =
  | "dashboard"
  | "customers"
  | "analytics"
  | "segmentation"
  | "comparisons"
  | "import"
  | "settings"
  | "audit";

/** Permette ai componenti figli di cambiare sezione (es. dal messaggio «nessun dato» a «Importazione dati»). */
export const NavigationContext = createContext<(section: Section) => void>(() => undefined);

export function useNavigate(): (section: Section) => void {
  return useContext(NavigationContext);
}
