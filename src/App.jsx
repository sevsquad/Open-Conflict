import { useState, useCallback } from "react";
import Parser from "./Parser.jsx";
import Viewer from "./Viewer.jsx";

export default function App() {
  const [mode, setMode] = useState("menu"); // "menu" | "parser" | "viewer"
  const [viewerData, setViewerData] = useState(null);

  const handleViewMap = useCallback((data) => {
    setViewerData(data);
    setMode("viewer");
  }, []);

  const goMenu = useCallback(() => setMode("menu"), []);

  if (mode === "parser") return <Parser onBack={goMenu} onViewMap={handleViewMap} />;
  if (mode === "viewer") return <Viewer onBack={goMenu} initialData={viewerData} />;

  // ── MENU ──
  return (
    <div style={{ background: "#0F172A", minHeight: "100vh", color: "#E5E7EB", fontFamily: "Arial, sans-serif", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 1, marginBottom: 6 }}>OPEN CONFLICT</div>
        <div style={{ fontSize: 12, color: "#64748B", letterSpacing: 2 }}>v0.10 · WorldCover + OSM + SRTM</div>
      </div>

      <div style={{ display: "flex", gap: 20 }}>
        {/* Parser Card */}
        <div onClick={() => setMode("parser")}
          style={{ width: 280, padding: "28px 24px", borderRadius: 10, cursor: "pointer", background: "#111827", border: "1px solid #1E293B", transition: "all 0.2s" }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = "#22C55E"; e.currentTarget.style.background = "#0D1520"; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "#1E293B"; e.currentTarget.style.background = "#111827"; }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="3" y1="15" x2="21" y2="15" />
              <line x1="9" y1="3" x2="9" y2="21" />
              <line x1="15" y1="3" x2="15" y2="21" />
            </svg>
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Terrain Parser</div>
          <div style={{ fontSize: 11, color: "#9CA3AF", lineHeight: 1.5 }}>
            Generate terrain maps from satellite data. Select a location and scale, then parse WorldCover, OpenStreetMap, and SRTM elevation into a structured grid.
          </div>
          <div style={{ marginTop: 14, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["WorldCover", "OSM", "SRTM", "Wikidata"].map(t => (
              <span key={t} style={{ fontSize: 8, padding: "2px 6px", borderRadius: 3, background: "#22C55E15", color: "#22C55E", border: "1px solid #22C55E30" }}>{t}</span>
            ))}
          </div>
        </div>

        {/* Viewer Card */}
        <div onClick={() => setMode("viewer")}
          style={{ width: 280, padding: "28px 24px", borderRadius: 10, cursor: "pointer", background: "#111827", border: "1px solid #1E293B", transition: "all 0.2s" }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = "#3B82F6"; e.currentTarget.style.background = "#0D1520"; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "#1E293B"; e.currentTarget.style.background = "#111827"; }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
              <line x1="8" y1="2" x2="8" y2="18" />
              <line x1="16" y1="6" x2="16" y2="22" />
            </svg>
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Map Viewer</div>
          <div style={{ fontSize: 11, color: "#9CA3AF", lineHeight: 1.5 }}>
            Interactive terrain map viewer. Load JSON exports for visualization, cell inspection, feature filtering, and LLM-optimized exports with annotated images.
          </div>
          <div style={{ marginTop: 14, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["Zoom/Pan", "Filters", "Labels", "PNG", "LLM Export"].map(t => (
              <span key={t} style={{ fontSize: 8, padding: "2px 6px", borderRadius: 3, background: "#3B82F615", color: "#3B82F6", border: "1px solid #3B82F630" }}>{t}</span>
            ))}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 30, fontSize: 10, color: "#374151", textAlign: "center", lineHeight: 1.6 }}>
        Generate terrain in the Parser, then view interactively or export for LLM analysis.<br />
        Parser auto-saves maps to the saves folder. Viewer can load them directly.
      </div>
    </div>
  );
}
