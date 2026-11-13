import { useEffect, useRef, useState, type ReactNode } from "react";
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

type Section =
  | "dashboard"
  | "customers"
  | "analytics"
  | "segmentation"
  | "comparisons"
  | "import"
  | "settings"
  | "audit";

type Theme = "light" | "dark";

interface AppLayoutProps {
  children: ReactNode;
  sections?: Partial<Record<Section, ReactNode>>;
  onLogout?: () => Promise<void>;
  visibleSections?: Section[];
}

const navigation = [
  { id: "dashboard", label: "Panoramica", icon: LayoutDashboard },
  { id: "customers", label: "Gestione clienti", icon: Users },
  { id: "import", label: "Importazione dati", icon: Upload },
  { id: "analytics", label: "Analisi e report", icon: BarChart3 },
  { id: "segmentation", label: "Segmentazione", icon: PieChart },
  { id: "comparisons", label: "Confronti", icon: GitCompareArrows },
  { id: "settings", label: "Impostazioni", icon: Settings },
  { id: "audit", label: "Registro attività", icon: ClipboardList },
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
  const pageTitle =
    visibleNavigation.find((item) => item.id === activeSection)?.label ??
    "Panoramica";

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
    <div className={`app-shell theme-${theme}`}>
      <a className="skip-link" href="#main-content">Vai al contenuto principale</a>
      <aside
        ref={sidebarRef}
        id="primary-navigation"
        className={`sidebar ${collapsed ? "collapsed" : ""}`}
        aria-label="Navigazione principale"
      >
        <div className="sidebar-brand">
          <div className="brand-icon">
            <BarChart3 size={22} />
          </div>

          {!collapsed && (
            <div className="brand-text">
              <strong>Percorso Cliente</strong>
              <span>ANALISI DEI CLIENTI</span>
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

        <div className="sidebar-section-label">
          {!collapsed && "AREA DI LAVORO"}
        </div>

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
                aria-current={active ? "page" : undefined}
              >
                <Icon size={19} aria-hidden="true" />
                {!collapsed && <span>{item.label}</span>}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          {!collapsed && <span>Workspace analitico · Percorso Cliente</span>}
        </div>
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
              <span className="header-eyebrow">CUSTOMER INTELLIGENCE</span>
              <h1>{pageTitle}</h1>
              <p>Decisioni più chiare attraverso i dati del percorso cliente</p>
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
  );
}
