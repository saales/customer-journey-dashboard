import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AuthGate } from "./components/AuthGate";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthGate>{(logout, demoMode) => <App onLogout={logout} demoMode={demoMode} />}</AuthGate>
  </StrictMode>,
);
