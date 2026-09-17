import {
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Code2,
  FlaskConical,
  LayoutGrid,
  Menu,
  Radio,
  Search,
  Server,
  Settings,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useStudio } from "./hooks/useStudio";
import type { Page } from "./lib/types";
import { ErrorBanner, Logo, StatusDot } from "./components/shared";
import { StudioPage } from "./components/StudioPage";
import { NetworkLab } from "./components/NetworkLab";
import {
  ArchitecturePage,
  OperationsPage,
  SettingsPage,
  StreamsPage,
} from "./components/OtherPages";
import { Viewer } from "./components/Viewer";
const navigation = [
  { id: "studio", label: "Studio", icon: SlidersHorizontal },
  { id: "streams", label: "Live streams", icon: Radio },
  { id: "lab", label: "Network lab", icon: FlaskConical },
  { id: "operations", label: "Operations", icon: LayoutGrid },
] as const;
const titles: Record<Page, string> = {
  studio: "Studio",
  streams: "Live streams",
  lab: "Network lab",
  operations: "Operations",
  architecture: "Architecture",
  settings: "Settings",
};
function Dashboard() {
  const initial = location.hash.slice(1) as Page;
  const [page, setPage] = useState<Page>(
      Object.keys(titles).includes(initial) ? initial : "studio",
    ),
    [menu, setMenu] = useState(false),
    [command, setCommand] = useState(false),
    [query, setQuery] = useState(""),
    [healthy, setHealthy] = useState(false);
  const s = useStudio();
  const navigate = (p: Page) => {
    setPage(p);
    location.hash = p;
    setMenu(false);
    setCommand(false);
    window.scrollTo(0, 0);
  };
  useEffect(() => {
    const onHash = () => {
      const p = location.hash.slice(1) as Page;
      if (Object.keys(titles).includes(p)) setPage(p);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    const check = () =>
      fetch("/healthz", { signal: abort.signal })
        .then((r) => setHealthy(r.ok))
        .catch(() => {
          if (!abort.signal.aborted) setHealthy(false);
        });
    void check();
    const t = setInterval(check, 5000);
    return () => {
      abort.abort();
      clearInterval(t);
    };
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommand((v) => !v);
      }
      if (e.key === "Escape") {
        setCommand(false);
        setMenu(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  return (
    <div className="app-shell">
      {menu && (
        <div className="sidebar-overlay" onClick={() => setMenu(false)} />
      )}
      <aside className={`sidebar ${menu ? "open" : ""}`}>
        <a
          href="#studio"
          className="brand-link"
          onClick={() => navigate("studio")}
        >
          <Logo />
        </a>
        <button
          className="workspace-switch"
          onClick={() => navigate("settings")}
        >
          <span className="workspace-avatar">
            S<span />
          </span>
          <span>
            <strong>Personal workspace</strong>
            <small>Local environment</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <div className="nav-section-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navigation.map((item) => (
            <button
              className={`nav-item ${page === item.id ? "active" : ""}`}
              key={item.id}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
              {item.id === "studio" && s.live && <StatusDot active />}
              {item.id === "lab" && <span className="nav-new">LAB</span>}
            </button>
          ))}
        </nav>
        <div className="nav-section-label resources-label">RESOURCES</div>
        <nav aria-label="Resources">
          <button
            className={`nav-item ${page === "architecture" ? "active" : ""}`}
            onClick={() => navigate("architecture")}
          >
            <BookOpen size={18} />
            <span>Architecture</span>
            <ArrowUpRight size={13} />
          </button>
          <a
            className="nav-item"
            href="/metrics"
            target="_blank"
            rel="noreferrer"
          >
            <Code2 size={18} />
            <span>Metrics endpoint</span>
            <ArrowUpRight size={13} />
          </a>
        </nav>
        <div className="sidebar-bottom">
          <div className="local-server">
            <span className="server-status-icon">
              <Server size={17} />
            </span>
            <div>
              <strong>Local server</strong>
              <span>
                <StatusDot active={healthy} />
                {healthy ? "All systems ready" : "Server unavailable"}
              </span>
            </div>
            <span className="server-line" />
          </div>
          <button
            className={`nav-item ${page === "settings" ? "active" : ""}`}
            onClick={() => navigate("settings")}
          >
            <Settings size={18} />
            <span>Settings</span>
          </button>
          <div className="profile">
            <span className="profile-avatar">SF</span>
            <div>
              <strong>StreamForge developer</strong>
              <span>Build something live.</span>
            </div>
            <span className="version">v0.1</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMenu(true)}
            >
              <Menu size={19} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{titles[page]}</strong>
          </div>
          <div className="topbar-right">
            <button
              className="search-trigger"
              onClick={() => {
                setQuery("");
                setCommand(true);
              }}
            >
              <Search size={14} />
              <span>Jump to…</span>
              <kbd>⌘ K</kbd>
            </button>
            <div className="topbar-divider" />
            <span className="environment">
              <StatusDot active={healthy} />
              Development
            </span>
            <span className="header-avatar">S</span>
          </div>
        </header>
        <main className="main-content">
          <ErrorBanner text={s.error} onClose={() => s.setError("")} />
          {page === "studio" ? (
            <StudioPage s={s} navigate={navigate} />
          ) : page === "lab" ? (
            <NetworkLab s={s} goStudio={() => navigate("studio")} />
          ) : page === "streams" ? (
            <StreamsPage goStudio={() => navigate("studio")} />
          ) : page === "operations" ? (
            <OperationsPage />
          ) : page === "architecture" ? (
            <ArchitecturePage />
          ) : (
            <SettingsPage />
          )}
          <footer className="app-footer">
            <span>
              <span className="footer-logo">ϟ</span>Engineered for the moment.
            </span>
            <span>
              WebRTC <i /> H.264 / Opus <i /> Go + C++{" "}
              <span className="footer-divider">|</span> StreamForge v0.1
            </span>
          </footer>
        </main>
      </div>
      {command && (
        <div className="modal-backdrop" onClick={() => setCommand(false)}>
          <div
            className="command-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Navigate workspace"
            onKeyDown={(e) => {
              if (e.key !== "Tab") return;
              const nodes = Array.from(
                e.currentTarget.querySelectorAll<HTMLElement>(
                  "button:not(:disabled), input, a[href]",
                ),
              );
              const first = nodes[0],
                last = nodes[nodes.length - 1];
              if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last?.focus();
              } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first?.focus();
              }
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="command-input">
              <Search size={19} />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Where would you like to go?"
                aria-label="Search pages"
              />
              <button
                className="icon-button"
                aria-label="Close search"
                onClick={() => setCommand(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="command-results">
              {Object.entries(titles)
                .filter(([, label]) =>
                  label.toLowerCase().includes(query.toLowerCase()),
                )
                .map(([id, label]) => (
                  <button key={id} onClick={() => navigate(id as Page)}>
                    <span>{label}</span>
                    <ChevronRight size={16} />
                  </button>
                ))}
              {!Object.values(titles).some((label) =>
                label.toLowerCase().includes(query.toLowerCase()),
              ) && <p>No matching pages.</p>}
            </div>
            <div className="command-hint">
              Select a page to navigate <kbd>esc to close</kbd>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
export default function App() {
  const match = location.pathname.match(/^\/watch\/([a-zA-Z0-9_-]+)$/);
  return match ? <Viewer id={match[1]} /> : <Dashboard />;
}
