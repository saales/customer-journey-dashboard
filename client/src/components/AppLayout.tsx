
import { useState, type ReactNode } from "react";
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

export function AppLayout({ children, sections, onLogout, visibleSections }: AppLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [theme, setTheme] = useState<Theme>("light");
  const [activeSection, setActiveSection] =
    useState<Section>("dashboard");

  const visibleNavigation = visibleSections ? navigation.filter((item) => visibleSections.includes(item.id)) : navigation;
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

  return (
    <div className={`app-shell theme-${theme}`}>
      <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
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
        >
          {collapsed ? (
            <ChevronRight size={18} />
          ) : (
            <ChevronLeft size={18} />
          )}
        </button>

        <div className="sidebar-section-label">
          {!collapsed && "AREA DI LAVORO"}
        </div>

        <nav className="sidebar-nav">
          {visibleNavigation.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;

            return (
              <button
                key={item.id}
                className={`nav-item ${active ? "active" : ""}`}
                onClick={() => setActiveSection(item.id)}
                title={collapsed ? item.label : undefined}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={19} />
                {!collapsed && <span>{item.label}</span>}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          {!collapsed && <span>Analisi del percorso cliente</span>}
        </div>
      </aside>

      <div className="app-main">
        <header className="app-header">
          <div className="header-title">
            <button
              className="mobile-menu-button"
              aria-label="Menu"
              onClick={() => setCollapsed(!collapsed)}
            >
              <Menu size={20} />
            </button>

            <div>
              <h1>{pageTitle}</h1>
              <p>Benvenuto nell’area di analisi</p>
            </div>
          </div>

          <button
            className="theme-toggle"
            onClick={() =>
              setTheme(theme === "light" ? "dark" : "light")
            }
            aria-label={
              theme === "light"
                ? "Attiva tema scuro"
                : "Attiva tema chiaro"
            }
          >
            {theme === "light" ? (
              <Moon size={19} />
            ) : (
              <Sun size={19} />
            )}
            <span>
              {theme === "light" ? "Tema scuro" : "Tema chiaro"}
            </span>
          </button>
          {onLogout && (
            <button className="logout-toggle" type="button" onClick={() => void onLogout()}>
              Esci
            </button>
          )}
        </header>

        <main className="app-content">{sectionContent}</main>
      </div>
    </div>
  );
}
