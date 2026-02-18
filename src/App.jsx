import { useState, useCallback, useEffect } from "react";
import Parser from "./Parser.jsx";
import Viewer from "./Viewer.jsx";
import Simulation from "./simulation/Simulation.jsx";
import WorldScanner from "./WorldScanner.jsx";
import { colors, typography, radius, shadows, animation, space } from "./theme.js";
import { Badge } from "./components/ui.jsx";
import AppHeader from "./components/AppHeader.jsx";

export default function App() {
  const [mode, setMode] = useState("menu"); // "menu" | "parser" | "viewer" | "simulation" | "worldscan"
  const [viewerData, setViewerData] = useState(null);
  const [recentMaps, setRecentMaps] = useState([]);
  const [parserMounted, setParserMounted] = useState(false);

  const handleViewMap = useCallback((data) => {
    setViewerData(data);
    setMode("viewer");
  }, []);

  // Keep Parser mounted once opened so state survives Viewer round-trips
  useEffect(() => { if (mode === "parser") setParserMounted(true); }, [mode]);

  const goMenu = useCallback(() => { setMode("menu"); setParserMounted(false); }, []);
  const goParser = useCallback(() => setMode("parser"), []);

  // Fetch recent maps for launcher
  useEffect(() => {
    if (mode === "menu") {
      fetch("/api/saves").then(r => r.json()).then(files => {
        const sorted = files.sort((a, b) => (b.modified || "").localeCompare(a.modified || ""));
        setRecentMaps(sorted.slice(0, 3));
      }).catch(() => {});
    }
  }, [mode]);

  // Keyboard shortcuts on menu
  useEffect(() => {
    if (mode !== "menu") return;
    const handler = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "1" || e.key === "p") setMode("parser");
      if (e.key === "2" || e.key === "v") setMode("viewer");
      if (e.key === "3" || e.key === "s") setMode("simulation");
      if (e.key === "4" || e.key === "w") setMode("worldscan");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mode]);

  // Non-menu modes get persistent header
  if (mode !== "menu") {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: colors.bg.base }}>
        <AppHeader mode={mode} onBack={goMenu} />
        <div style={{ flex: 1, overflow: "hidden" }}>
          {parserMounted && (
            <div style={{ display: mode === "parser" ? "contents" : "none" }}>
              <Parser onBack={goMenu} onViewMap={handleViewMap} />
            </div>
          )}
          {mode === "viewer" && <Viewer onBack={goMenu} onParser={goParser} initialData={viewerData} />}
          {mode === "simulation" && <Simulation onBack={goMenu} />}
          {mode === "worldscan" && <WorldScanner onBack={goMenu} />}
        </div>
      </div>
    );
  }

  // ── MENU / LAUNCHER ──
  const cards = [
    {
      id: "parser", label: "Terrain Parser", accent: colors.accent.green, key: "1",
      desc: "Generate terrain maps from satellite data. Select a location and scale, then parse WorldCover, OpenStreetMap, and SRTM elevation into a structured grid.",
      tags: ["WorldCover", "OSM", "SRTM", "Wikidata"],
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="3" y1="15" x2="21" y2="15" />
          <line x1="9" y1="3" x2="9" y2="21" />
          <line x1="15" y1="3" x2="15" y2="21" />
        </svg>
      ),
    },
    {
      id: "viewer", label: "Map Viewer", accent: colors.accent.blue, key: "2",
      desc: "Interactive terrain map viewer. Load JSON exports for visualization, cell inspection, feature filtering, and LLM-optimized exports with annotated images.",
      tags: ["Zoom/Pan", "Filters", "Labels", "PNG", "LLM Export"],
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
          <line x1="8" y1="2" x2="8" y2="18" />
          <line x1="16" y1="6" x2="16" y2="22" />
        </svg>
      ),
    },
    {
      id: "simulation", label: "Simulation", accent: colors.accent.amber, key: "3",
      desc: "Run LLM-adjudicated conflict simulations on generated terrain maps. Matrix game format with structured adjudication, logging, and turn management.",
      tags: ["LLM Adjudication", "Turn Mgmt", "Logging", "Kill Switch"],
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="12" x2="15" y2="14" />
          <path d="M4.93 4.93l2.83 2.83" />
          <path d="M16.24 16.24l2.83 2.83" />
        </svg>
      ),
    },
    {
      id: "worldscan", label: "World Scanner", accent: colors.accent.cyan, key: "4",
      desc: "Pre-scan the entire planet at strategic (10km) or tactical (0.5km) resolution. Cached data enables instant map generation anywhere.",
      tags: ["Global", "10km", "0.5km", "Offline Cache"],
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      ),
    },
  ];

  return (
    <div style={{
      background: `radial-gradient(ellipse at 50% 30%, #0F1A2E 0%, ${colors.bg.base} 70%)`,
      minHeight: "100vh",
      color: colors.text.primary,
      fontFamily: typography.fontFamily,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      position: "relative",
      overflow: "auto",
    }}>
      {/* Subtle grid background */}
      <div style={{
        position: "absolute", inset: 0, opacity: 0.03, pointerEvents: "none",
        backgroundImage: `linear-gradient(${colors.text.muted} 1px, transparent 1px), linear-gradient(90deg, ${colors.text.muted} 1px, transparent 1px)`,
        backgroundSize: "60px 60px",
      }} />

      {/* Hero */}
      <div style={{ textAlign: "center", marginBottom: space[12], position: "relative", zIndex: 1, animation: "fadeIn 0.6s ease-out" }}>
        <div style={{
          fontSize: typography.heading.xxl,
          fontWeight: typography.weight.heavy,
          letterSpacing: typography.letterSpacing.widest + 1,
          background: `linear-gradient(135deg, ${colors.text.primary} 0%, ${colors.accent.amber} 100%)`,
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
          marginBottom: space[2],
        }}>
          OPEN CONFLICT
        </div>
        <div style={{
          width: 120, height: 1, margin: "0 auto",
          background: `linear-gradient(90deg, transparent, ${colors.accent.amber}60, transparent)`,
          marginBottom: space[3],
        }} />
        <div style={{ display: "flex", gap: space[2], justifyContent: "center", alignItems: "center" }}>
          <Badge color={colors.text.muted} style={{ fontSize: 10, letterSpacing: 1.5 }}>v0.10</Badge>
          <span style={{ fontSize: typography.body.xs, color: colors.text.muted, letterSpacing: 1.5 }}>
            WorldCover + OSM + SRTM
          </span>
        </div>
      </div>

      {/* Cards */}
      <div style={{ display: "flex", gap: space[5], position: "relative", zIndex: 1 }}>
        {cards.map((card, i) => (
          <MenuCard key={card.id} card={card} index={i} onClick={() => setMode(card.id)} />
        ))}
      </div>

      {/* Recent Maps */}
      {recentMaps.length > 0 && (
        <div style={{
          marginTop: space[10], position: "relative", zIndex: 1,
          animation: "fadeIn 0.8s ease-out 0.3s both",
        }}>
          <div style={{ fontSize: typography.body.xs, color: colors.text.muted, textAlign: "center", marginBottom: space[2], letterSpacing: 1, textTransform: "uppercase" }}>
            Recent Maps
          </div>
          <div style={{ display: "flex", gap: space[2] }}>
            {recentMaps.map(m => (
              <div key={m.name} onClick={() => { setViewerData(null); setMode("viewer"); }}
                style={{
                  padding: "6px 14px", borderRadius: radius.md,
                  background: colors.bg.raised, border: `1px solid ${colors.border.subtle}`,
                  cursor: "pointer", fontSize: typography.body.xs, color: colors.text.secondary,
                  transition: `all ${animation.normal} ${animation.easeOut}`,
                  maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = colors.accent.blue + "60"; e.currentTarget.style.color = colors.text.primary; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = colors.border.subtle; e.currentTarget.style.color = colors.text.secondary; }}
              >
                {(m.name || "").replace(/\.json$/, "").replace(/_/g, " ")}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer hint */}
      <div style={{
        marginTop: space[8], fontSize: typography.body.xs, color: colors.text.muted,
        textAlign: "center", lineHeight: 1.6, position: "relative", zIndex: 1,
        opacity: 0.6, animation: "fadeIn 1s ease-out 0.4s both",
      }}>
        Press <kbd style={{ padding: "1px 5px", borderRadius: 3, background: colors.bg.surface, border: `1px solid ${colors.border.subtle}`, fontSize: 9 }}>1</kbd>{" "}
        <kbd style={{ padding: "1px 5px", borderRadius: 3, background: colors.bg.surface, border: `1px solid ${colors.border.subtle}`, fontSize: 9 }}>2</kbd>{" "}
        <kbd style={{ padding: "1px 5px", borderRadius: 3, background: colors.bg.surface, border: `1px solid ${colors.border.subtle}`, fontSize: 9 }}>3</kbd> to navigate
      </div>
    </div>
  );
}

// ── Menu Card Component ─────────────────────────────────────────

function MenuCard({ card, index, onClick }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 320,
        padding: "28px 24px",
        borderRadius: radius.xl,
        cursor: "pointer",
        background: hovered
          ? `radial-gradient(ellipse at 50% 0%, ${card.accent}08 0%, ${colors.bg.raised} 70%)`
          : colors.bg.raised,
        border: `1px solid ${hovered ? card.accent + "50" : colors.border.subtle}`,
        borderTop: `3px solid ${hovered ? card.accent : card.accent + "40"}`,
        transition: `all ${animation.normal} ${animation.easeOut}`,
        transform: hovered ? "translateY(-4px)" : "translateY(0)",
        boxShadow: hovered ? `${shadows.lg}, ${shadows.glow(card.accent)}` : "none",
        animation: `slideUp 0.5s ${animation.easeOut} ${index * 0.1}s both`,
        position: "relative",
      }}
    >
      {/* Icon */}
      <div style={{
        width: 48, height: 48, borderRadius: radius.lg,
        background: `${card.accent}12`,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: card.accent, marginBottom: space[3],
        transition: `background ${animation.normal}`,
        ...(hovered && { background: `${card.accent}20` }),
      }}>
        {card.icon}
      </div>

      {/* Title */}
      <div style={{
        fontSize: typography.heading.md,
        fontWeight: typography.weight.bold,
        marginBottom: space[2],
        color: colors.text.primary,
      }}>
        {card.label}
      </div>

      {/* Description */}
      <div style={{
        fontSize: typography.body.sm + 1,
        color: colors.text.secondary,
        lineHeight: 1.6,
        marginBottom: space[4],
      }}>
        {card.desc}
      </div>

      {/* Tags */}
      <div style={{ display: "flex", gap: space[1] + 2, flexWrap: "wrap" }}>
        {card.tags.map(t => (
          <Badge key={t} color={card.accent}>{t}</Badge>
        ))}
      </div>

      {/* Keyboard shortcut */}
      <div style={{
        position: "absolute", top: 14, right: 14,
        fontSize: 10, color: colors.text.muted,
        padding: "2px 6px", borderRadius: radius.sm,
        background: colors.bg.surface,
        border: `1px solid ${colors.border.subtle}`,
        opacity: hovered ? 1 : 0.4,
        transition: `opacity ${animation.normal}`,
      }}>
        {card.key}
      </div>
    </div>
  );
}
