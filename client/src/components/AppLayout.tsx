import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavigationContext, type Section } from "../navigation";
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  GitCompareArrows,
  LayoutDashboard,
  Menu,
  Moon,
  Settings,
  Sun,
  Users,
  Upload,
  PieChart,
  ClipboardList,
} from "lucide-react";

type Theme = "light" | "dark";

interface AppLayoutProps {
  children: ReactNode;
  sections?: Partial<Record<Section, ReactNode>>;
  onLogout?: () => Promise<void>;
  visibleSections?: Section[];
}

const navigation = [
  { id: "dashboard", label: "Panoramica", description: "Come i clienti avanzano dalla prima visita all'acquisto", icon: LayoutDashboard },
  { id: "customers", label: "Gestione clienti", description: "Cerca, aggiungi e correggi i clienti e le fasi del loro percorso", icon: Users },
  { id: "import", label: "Importazione dati", description: "Carica un file CSV o Excel e controlla i dati prima di salvarli", icon: Upload },
  { id: "analytics", label: "Analisi e report", description: "Conversione per fase, andamento nel tempo e confronto tra canali", icon: BarChart3 },
  { id: "segmentation", label: "Segmentazione", description: "Quali gruppi di clienti convertono meglio", icon: PieChart },
  { id: "comparisons", label: "Confronti", description: "Il periodo selezionato rispetto a quello precedente", icon: GitCompareArrows },
  { id: "settings", label: "Impostazioni", description: "Account, fasi del percorso, organizzazione e membri", icon: Settings },
  { id: "audit", label: "Registro attività", description: "Chi ha fatto cosa e quando", icon: ClipboardList },
] as const;

function readTheme(): Theme {
  try {
    return window.localStorage.getItem("customer-journey-theme") === "dark"
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

export function AppLayout({ children, sections, onLogout, visibleSections }: AppLayoutProps) {
  const [collapsed, setCollapsed] = useState(
    () => typeof window !== "undefined" && window.innerWidth <= 760,
  );
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [activeSection, setActiveSection] = useState<Section>("dashboard");
  const sidebarRef = useRef<HTMLElement>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const previousCollapsed = useRef(collapsed);

  useEffect(() => {
    try {
      window.localStorage.setItem("customer-journey-theme", theme);
    } catch {
      // La preferenza resta valida nella sessione anche se lo storage non è disponibile.
    }
  }, [theme]);

  useEffect(() => {
    if (typeof window === "undefined" || window.innerWidth > 760) return;

    if (previousCollapsed.current !== collapsed) {
      if (collapsed) {
        mobileMenuButtonRef.current?.focus();
      } else {
        sidebarRef.current?.querySelector<HTMLButtonElement>(".nav-item")?.focus();
      }
      previousCollapsed.current = collapsed;
    }
  }, [collapsed]);

  useEffect(() => {
    if (collapsed || typeof window === "undefined" || window.innerWidth > 760) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setCollapsed(true);
        return;
      }

      if (event.key !== "Tab") return;
      const items = sidebarRef.current?.querySelectorAll<HTMLButtonElement>(
        ".nav-item:not(:disabled)",
      );
      if (!items?.length) return;

      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [collapsed]);

  const visibleNavigation = visibleSections
    ? navigation.filter((item) => visibleSections.includes(item.id))
    : navigation;
  const currentItem = visibleNavigation.find((item) => item.id === activeSection);
  const pageTitle = currentItem?.label ?? "Panoramica";
  const pageDescription = currentItem?.description ?? "";

  const sectionContent = sections?.[activeSection] ?? (
    activeSection === "dashboard" ? (
      children
    ) : (
      <div className="card">
        <h2>Sezione in preparazione</h2>
        <p className="subtitle">
          Questa sezione verrà completata nel prossimo passaggio.
        </p>
      </div>
    )
  );

  function navigateTo(section: Section) {
    setActiveSection(section);
    if (typeof window !== "undefined" && window.innerWidth <= 760) {
      setCollapsed(true);
    }
  }

  return (
    <NavigationContext.Provider value={navigateTo}>
    <div className={`app-shell theme-${theme}`}>
      <a className="skip-link" href="#main-content">Vai al contenuto principale</a>
      <aside
        ref={sidebarRef}
        id="primary-navigation"
        className={`sidebar ${collapsed ? "collapsed" : ""}`}
        aria-label="Navigazione principale"
      >
        <div className="sidebar-brand">
          <div className="brand-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="24" height="24">
              <rect x="2.5" y="3" width="4.5" height="18" rx="1.5" fill="currentColor" />
              <rect x="9.75" y="7" width="4.5" height="10" rx="1.5" fill="currentColor" opacity=".8" />
              <rect x="17" y="10" width="4.5" height="4" rx="1.5" fill="currentColor" opacity=".6" />
            </svg>
          </div>

          {!collapsed && (
            <div className="brand-text">
              <strong>Percorso Cliente</strong>
              <span>Analisi dei clienti</span>
            </div>
          )}
        </div>

        <button
          className="sidebar-toggle"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? "Espandi menu" : "Comprimi menu"}
          aria-expanded={!collapsed}
          aria-controls="primary-navigation"
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>

        <nav className="sidebar-nav" aria-label="Sezioni applicazione">
          {visibleNavigation.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;

            return (
              <button
                key={item.id}
                className={`nav-item ${active ? "active" : ""}`}
                onClick={() => navigateTo(item.id)}
                title={collapsed ? item.label : undefined}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={19} aria-hidden="true" />
                {!collapsed && <span>{item.label}</span>}
              </button>
            );
          })}
        </nav>

      </aside>

      {!collapsed && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Chiudi menu di navigazione"
          onClick={() => setCollapsed(true)}
        />
      )}

      <div className="app-main">
        <header className="app-header">
          <div className="header-title">
            <button
              ref={mobileMenuButtonRef}
              className="mobile-menu-button"
              aria-label={collapsed ? "Apri menu" : "Chiudi menu"}
              aria-expanded={!collapsed}
              aria-controls="primary-navigation"
              onClick={() => setCollapsed(!collapsed)}
            >
              <Menu size={20} />
            </button>

            <div className="header-copy">
              <h1>{pageTitle}</h1>
              <p>{pageDescription}</p>
            </div>
          </div>

          <div className="header-actions">
            <button
              className="theme-toggle"
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
              aria-label={theme === "light" ? "Attiva tema scuro" : "Attiva tema chiaro"}
            >
              {theme === "light" ? <Moon size={19} /> : <Sun size={19} />}
              <span>{theme === "light" ? "Tema scuro" : "Tema chiaro"}</span>
            </button>
            {onLogout && (
              <button className="logout-toggle" type="button" onClick={() => void onLogout()}>
                Esci
              </button>
            )}
          </div>
        </header>

        <main id="main-content" className="app-content" tabIndex={-1}>{sectionContent}</main>
      </div>
    </div>
    </NavigationContext.Provider>
  );
}
