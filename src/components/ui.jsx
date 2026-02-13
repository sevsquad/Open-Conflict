import { useState, useCallback } from "react";
import { colors, typography, radius, shadows, animation, space } from "../theme.js";

// ════════════════════════════════════════════════════════════════
// OPEN CONFLICT — Shared UI Primitives
// ════════════════════════════════════════════════════════════════

// ── Button ──────────────────────────────────────────────────────

const BTN_VARIANTS = {
  primary: {
    background: colors.accent.amber,
    color: "#000",
    border: "none",
    hoverBg: "#FBBF24",
    hoverShadow: shadows.glow(colors.accent.amber),
  },
  secondary: {
    background: "transparent",
    color: colors.text.secondary,
    border: `1px solid ${colors.border.subtle}`,
    hoverBg: colors.bg.surface,
    hoverShadow: "none",
  },
  danger: {
    background: colors.glow.red,
    color: colors.accent.red,
    border: `1px solid ${colors.accent.red}40`,
    hoverBg: `${colors.accent.red}30`,
    hoverShadow: "none",
  },
  success: {
    background: colors.glow.green,
    color: colors.accent.green,
    border: `1px solid ${colors.accent.green}40`,
    hoverBg: `${colors.accent.green}30`,
    hoverShadow: "none",
  },
  ghost: {
    background: "transparent",
    color: colors.text.muted,
    border: "none",
    hoverBg: colors.bg.surface,
    hoverShadow: "none",
  },
};

export function Button({ children, onClick, disabled, variant = "primary", size = "md", style: extraStyle, ...rest }) {
  const [hovered, setHovered] = useState(false);
  const v = BTN_VARIANTS[variant] || BTN_VARIANTS.primary;
  const sizes = {
    sm: { padding: "4px 10px", fontSize: typography.body.sm, borderRadius: radius.sm },
    md: { padding: "8px 16px", fontSize: typography.body.md, borderRadius: radius.md },
    lg: { padding: "10px 20px", fontSize: typography.body.lg, borderRadius: radius.lg },
  };
  const s = sizes[size] || sizes.md;

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={e => { e.currentTarget.style.outline = `2px solid ${colors.accent.blue}`; e.currentTarget.style.outlineOffset = "2px"; }}
      onBlur={e => { e.currentTarget.style.outline = "none"; }}
      style={{
        ...s,
        fontFamily: typography.fontFamily,
        fontWeight: typography.weight.semibold,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        background: hovered && !disabled ? v.hoverBg : v.background,
        color: v.color,
        border: v.border,
        boxShadow: hovered && !disabled ? v.hoverShadow : "none",
        transition: `all ${animation.normal} ${animation.easeOut}`,
        transform: hovered && !disabled ? "scale(1.02)" : "scale(1)",
        ...extraStyle,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

// ── Input ───────────────────────────────────────────────────────

export function Input({ label, value, onChange, placeholder, multiline, style: extraStyle, labelStyle, ...rest }) {
  const [focused, setFocused] = useState(false);
  const Tag = multiline ? "textarea" : "input";
  return (
    <div style={{ marginBottom: space[3] }}>
      {label && <div style={{ fontSize: typography.body.sm, color: colors.text.secondary, marginBottom: space[1], fontFamily: typography.fontFamily, ...labelStyle }}>{label}</div>}
      <Tag
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: "100%",
          padding: "8px 10px",
          background: colors.bg.input,
          border: `1px solid ${focused ? colors.border.focus : colors.border.subtle}`,
          borderRadius: radius.md,
          color: colors.text.primary,
          fontSize: typography.body.md,
          fontFamily: typography.fontFamily,
          resize: multiline ? "vertical" : undefined,
          minHeight: multiline ? 60 : undefined,
          boxSizing: "border-box",
          transition: `border-color ${animation.fast}`,
          outline: "none",
          ...extraStyle,
        }}
        {...rest}
      />
    </div>
  );
}

// ── Select ──────────────────────────────────────────────────────

export function Select({ label, value, onChange, options, placeholder, style: extraStyle, ...rest }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ marginBottom: space[3] }}>
      {label && <div style={{ fontSize: typography.body.sm, color: colors.text.secondary, marginBottom: space[1], fontFamily: typography.fontFamily }}>{label}</div>}
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: "100%",
          padding: "8px 10px",
          background: colors.bg.input,
          border: `1px solid ${focused ? colors.border.focus : colors.border.subtle}`,
          borderRadius: radius.md,
          color: colors.text.primary,
          fontSize: typography.body.md,
          fontFamily: typography.fontFamily,
          cursor: "pointer",
          transition: `border-color ${animation.fast}`,
          outline: "none",
          appearance: "none",
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748B' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 10px center",
          paddingRight: 30,
          ...extraStyle,
        }}
        {...rest}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map(opt => (
          <option key={typeof opt === "string" ? opt : opt.value} value={typeof opt === "string" ? opt : opt.value}>
            {typeof opt === "string" ? opt : opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ── Card ────────────────────────────────────────────────────────

export function Card({ children, accent, onClick, padding, style: extraStyle, ...rest }) {
  const [hovered, setHovered] = useState(false);
  const isClickable = !!onClick;
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered && isClickable ? colors.bg.surface : colors.bg.raised,
        border: `1px solid ${hovered && accent ? accent + "60" : colors.border.subtle}`,
        borderRadius: radius.xl,
        padding: padding !== undefined ? padding : space[4],
        cursor: isClickable ? "pointer" : "default",
        transition: `all ${animation.normal} ${animation.easeOut}`,
        transform: hovered && isClickable ? "translateY(-2px)" : "translateY(0)",
        boxShadow: hovered && isClickable ? shadows.md : "none",
        ...(accent && { borderTop: `3px solid ${accent}` }),
        ...extraStyle,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

// ── Panel ───────────────────────────────────────────────────────

export function Panel({ children, style: extraStyle, ...rest }) {
  return (
    <div
      style={{
        background: colors.bg.overlay,
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: `1px solid ${colors.border.subtle}`,
        borderRadius: radius.lg,
        padding: space[3],
        ...extraStyle,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

// ── Badge ───────────────────────────────────────────────────────

export function Badge({ children, color, style: extraStyle }) {
  const c = color || colors.accent.amber;
  return (
    <span style={{
      fontSize: typography.body.xs,
      padding: "2px 8px",
      borderRadius: radius.sm,
      background: `${c}15`,
      color: c,
      border: `1px solid ${c}30`,
      fontFamily: typography.fontFamily,
      fontWeight: typography.weight.medium,
      letterSpacing: typography.letterSpacing.wide,
      lineHeight: 1,
      display: "inline-flex",
      alignItems: "center",
      ...extraStyle,
    }}>
      {children}
    </span>
  );
}

// ── SectionHeader ───────────────────────────────────────────────

export function SectionHeader({ children, accent, style: extraStyle }) {
  return (
    <div style={{
      fontSize: typography.heading.sm,
      fontWeight: typography.weight.bold,
      color: accent || colors.text.primary,
      fontFamily: typography.fontFamily,
      marginBottom: space[3],
      display: "flex",
      alignItems: "center",
      gap: space[2],
      ...extraStyle,
    }}>
      {accent && <div style={{ width: 3, height: 14, borderRadius: 2, background: accent, flexShrink: 0 }} />}
      {children}
    </div>
  );
}

// ── ProgressBar ─────────────────────────────────────────────────

export function ProgressBar({ progress, status, startTime }) {
  if (!progress && !status) return null;
  const pct = progress ? Math.round((progress.current / Math.max(1, progress.total)) * 100) : 0;
  const elapsed = startTime ? ((Date.now() - startTime) / 1000).toFixed(0) : null;

  return (
    <div style={{ marginTop: space[3], padding: space[3], background: colors.bg.raised, borderRadius: radius.lg, border: `1px solid ${colors.border.subtle}` }}>
      {progress && (
        <div style={{ marginBottom: space[2] }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: space[1] }}>
            <span style={{ fontSize: typography.body.xs, color: colors.text.secondary, fontFamily: typography.fontFamily }}>
              {progress.phase} {progress.current}/{progress.total}
            </span>
            <span style={{ fontSize: typography.body.xs, color: colors.text.muted, fontFamily: typography.monoFamily }}>
              {pct}%{elapsed ? ` \u00B7 ${elapsed}s` : ""}
            </span>
          </div>
          <div style={{ height: 6, background: colors.bg.input, borderRadius: radius.full, overflow: "hidden" }}>
            <div style={{
              height: "100%",
              width: `${pct}%`,
              background: `linear-gradient(90deg, ${colors.accent.green}, ${colors.accent.cyan})`,
              borderRadius: radius.full,
              transition: `width ${animation.normal}`,
              backgroundSize: "200% 100%",
              animation: "shimmer 2s linear infinite",
            }} />
          </div>
        </div>
      )}
      {status && (
        <div style={{ fontSize: typography.body.xs, color: colors.text.muted, fontFamily: typography.fontFamily }}>
          {status}
        </div>
      )}
    </div>
  );
}
