import { useState } from "react";
import { colors, typography, radius, animation, space } from "../theme.js";

const MODE_META = {
  parser: { label: "Terrain Parser", accent: colors.accent.green },
  viewer: { label: "Map Viewer", accent: colors.accent.blue },
  simulation: { label: "Simulation", accent: colors.accent.amber },
  worldscan: { label: "World Scanner", accent: colors.accent.cyan },
};

export default function AppHeader({ mode, onBack, children }) {
  const [backHovered, setBackHovered] = useState(false);
  const meta = MODE_META[mode] || { label: mode, accent: colors.accent.amber };

  return (
    <div style={{
      height: 44,
      display: "flex",
      alignItems: "center",
      padding: `0 ${space[4]}px`,
      background: colors.bg.overlay,
      backdropFilter: "blur(16px)",
      WebkitBackdropFilter: "blur(16px)",
      borderBottom: `1px solid ${colors.border.subtle}`,
      fontFamily: typography.fontFamily,
      flexShrink: 0,
      zIndex: 100,
    }}>
      {/* Logo / Back */}
      <div
        onClick={onBack}
        onMouseEnter={() => setBackHovered(true)}
        onMouseLeave={() => setBackHovered(false)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: space[2],
          cursor: "pointer",
          padding: `${space[1]}px ${space[2]}px`,
          borderRadius: radius.md,
          transition: `background ${animation.fast}`,
          background: backHovered ? colors.bg.surface : "transparent",
          marginRight: space[4],
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={colors.text.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        <span style={{
          fontSize: typography.body.sm,
          fontWeight: typography.weight.bold,
          color: colors.text.secondary,
          letterSpacing: typography.letterSpacing.wider,
        }}>
          OC
        </span>
        <div style={{ width: 4, height: 4, borderRadius: 2, background: colors.accent.amber }} />
      </div>

      {/* Mode indicator */}
      <div style={{
        fontSize: typography.body.md,
        fontWeight: typography.weight.semibold,
        color: meta.accent,
        display: "flex",
        alignItems: "center",
        gap: space[2],
      }}>
        <div style={{
          width: 6, height: 6, borderRadius: 3,
          background: meta.accent,
          boxShadow: `0 0 8px ${meta.accent}60`,
        }} />
        {meta.label}
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Mode-specific actions slot */}
      {children && (
        <div style={{ display: "flex", alignItems: "center", gap: space[2] }}>
          {children}
        </div>
      )}
    </div>
  );
}
