// ════════════════════════════════════════════════════════════════
// OPEN CONFLICT — Design Tokens
// Single source of truth for all visual constants
// ════════════════════════════════════════════════════════════════

// Color palette
export const colors = {
  bg: {
    base: "#0B1120",
    raised: "#111827",
    surface: "#1A2332",
    input: "#0D1520",
    overlay: "rgba(11, 17, 32, 0.92)",
  },
  border: {
    subtle: "#1E293B",
    default: "#2D3B4E",
    focus: "#475569",
  },
  text: {
    primary: "#F1F5F9",
    secondary: "#94A3B8",
    muted: "#64748B",
    disabled: "#475569",
  },
  accent: {
    amber: "#F59E0B",
    green: "#22C55E",
    blue: "#3B82F6",
    red: "#EF4444",
    purple: "#A855F7",
    cyan: "#06B6D4",
  },
  glow: {
    amber: "rgba(245, 158, 11, 0.15)",
    green: "rgba(34, 197, 94, 0.15)",
    blue: "rgba(59, 130, 246, 0.15)",
    red: "rgba(239, 68, 68, 0.15)",
  },
};

// Typography
export const typography = {
  fontFamily: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  monoFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
  heading: { xs: 11, sm: 13, md: 16, lg: 22, xl: 28, xxl: 36 },
  body: { xs: 9, sm: 11, md: 13, lg: 14 },
  weight: { normal: 400, medium: 500, semibold: 600, bold: 700, heavy: 800 },
  letterSpacing: { tight: -0.5, normal: 0, wide: 0.5, wider: 1, widest: 2 },
};

// Spacing scale (4px base)
export const space = {
  0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64,
};

// Border radius
export const radius = {
  sm: 4, md: 6, lg: 8, xl: 12, full: 9999,
};

// Shadows
export const shadows = {
  sm: "0 1px 2px rgba(0,0,0,0.3)",
  md: "0 4px 12px rgba(0,0,0,0.25)",
  lg: "0 8px 24px rgba(0,0,0,0.3)",
  glow: (color) => `0 0 20px ${color}25, 0 0 40px ${color}10`,
};

// Animation constants
export const animation = {
  fast: "0.15s",
  normal: "0.25s",
  slow: "0.4s",
  easeOut: "cubic-bezier(0.16, 1, 0.3, 1)",
  spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
};
