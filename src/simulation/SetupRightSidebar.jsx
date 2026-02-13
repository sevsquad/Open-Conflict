import { useRef, useEffect } from "react";
import { colors, typography, radius, animation, space, shadows } from "../theme.js";
import { Button, Input, Badge, CollapsibleSection } from "../components/ui.jsx";
import { ACTOR_COLORS } from "../terrainColors.js";
import { TYPE_ICONS } from "../mapRenderer/overlays/UnitOverlay.js";
import { cellToDisplayString } from "../mapRenderer/overlays/UnitOverlay.js";

// ═══════════════════════════════════════════════════════════════
// SETUP RIGHT SIDEBAR — Unit Palette, Placed Units, Properties
// ═══════════════════════════════════════════════════════════════

const UNIT_TYPES = [
  "infantry", "mechanized", "armor", "artillery", "air",
  "naval", "special_forces", "logistics", "headquarters", "recon", "other",
];

// Render a small NATO icon onto a canvas and return it as a data URL
function renderTypeIcon(type, color, size = 24) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const iconFn = TYPE_ICONS[type];
  if (iconFn) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.5;
    iconFn(ctx, size / 2, size / 2, size * 0.3);
  }
  return canvas.toDataURL();
}

// Format type name for display
function formatType(type) {
  return type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// Parse position string to {c, r} for display
function positionDisplay(pos) {
  if (!pos) return "—";
  const commaMatch = pos.match(/^(\d+),(\d+)$/);
  if (commaMatch) return cellToDisplayString(parseInt(commaMatch[1]), parseInt(commaMatch[2]));
  return pos;
}

export default function SetupRightSidebar({ state, dispatch, open, onToggle }) {
  const {
    actors, units,
    interactionMode, placementPayload, selectedUnitId,
  } = state;

  const selectedUnit = selectedUnitId ? units.find(u => u.id === selectedUnitId) : null;
  const selectedUnitIdx = selectedUnit ? units.indexOf(selectedUnit) : -1;

  const handlePaletteClick = (actorId, unitType) => {
    // If already placing this exact combo, cancel
    if (interactionMode === "place_unit" &&
        placementPayload?.actorId === actorId &&
        placementPayload?.unitType === unitType) {
      dispatch({ type: "EXIT_PLACEMENT_MODE" });
    } else {
      dispatch({ type: "ENTER_PLACEMENT_MODE", actorId, unitType });
    }
  };

  const handleUnitRowClick = (unitId) => {
    dispatch({ type: "SELECT_UNIT", unitId });
  };

  const handleDeleteUnit = (e, unitId) => {
    e.stopPropagation();
    dispatch({ type: "REMOVE_UNIT", unitId });
  };

  const handleDuplicateUnit = () => {
    if (selectedUnit) {
      dispatch({ type: "DUPLICATE_UNIT", unitId: selectedUnit.id });
    }
  };

  return (
    <div style={{
      display: "flex", flexShrink: 0,
      width: open ? 340 : 20,
      transition: `width ${animation.normal} ${animation.easeOut}`,
    }}>
      {/* Collapse toggle button */}
      <button
        onClick={onToggle}
        title={open ? "Collapse sidebar" : "Expand sidebar"}
        style={{
          width: 20, flexShrink: 0, background: colors.bg.surface,
          border: "none", borderLeft: `1px solid ${colors.border.subtle}`,
          color: colors.text.muted, cursor: "pointer", display: "flex",
          alignItems: "center", justifyContent: "center", fontSize: 10,
          padding: 0,
        }}
      >
        {open ? "\u25B6" : "\u25C0"}
      </button>

      {/* Content */}
      <div style={{
        width: open ? 320 : 0, overflow: "hidden",
        transition: `width ${animation.normal} ${animation.easeOut}`,
      }}>
        <div style={{
          width: 320, height: "100%", overflowY: "auto", overflowX: "hidden",
          padding: space[3], borderLeft: `1px solid ${colors.border.subtle}`,
          background: colors.bg.raised, boxSizing: "border-box",
        }}>
          {/* Unit Palette */}
          <CollapsibleSection title="Unit Palette" accent={colors.accent.amber}>
            {actors.map((actor, ai) => {
              const actorColor = ACTOR_COLORS[ai % ACTOR_COLORS.length];
              return (
                <div key={actor.id} style={{ marginBottom: space[3] }}>
                  <div style={{
                    fontSize: typography.body.xs, color: actorColor, fontWeight: typography.weight.semibold,
                    marginBottom: space[1], display: "flex", alignItems: "center", gap: space[1],
                  }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: actorColor }} />
                    {actor.name}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                    {UNIT_TYPES.map(type => {
                      const isActive = interactionMode === "place_unit" &&
                        placementPayload?.actorId === actor.id &&
                        placementPayload?.unitType === type;
                      return (
                        <button
                          key={type}
                          onClick={() => handlePaletteClick(actor.id, type)}
                          title={`Place ${formatType(type)} for ${actor.name}`}
                          style={{
                            padding: "3px 6px", fontSize: typography.body.xs,
                            background: isActive ? actorColor + "30" : colors.bg.input,
                            border: `1px solid ${isActive ? actorColor : colors.border.subtle}`,
                            borderRadius: radius.sm, color: isActive ? actorColor : colors.text.secondary,
                            cursor: "pointer", fontFamily: typography.fontFamily,
                            transition: `all ${animation.fast}`,
                            boxShadow: isActive ? shadows.glow(actorColor) : "none",
                          }}
                        >
                          {formatType(type)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {interactionMode === "place_unit" && (
              <Button variant="ghost" onClick={() => dispatch({ type: "EXIT_PLACEMENT_MODE" })} size="sm" style={{ width: "100%", marginTop: space[1] }}>
                Cancel Placement (Esc)
              </Button>
            )}
          </CollapsibleSection>

          {/* Placed Units */}
          <CollapsibleSection title={`Placed Units (${units.length})`} accent={colors.accent.blue}>
            {units.length === 0 ? (
              <div style={{ fontSize: typography.body.sm, color: colors.text.muted, textAlign: "center", padding: space[3] }}>
                No units placed. Select a type above and click on the map.
              </div>
            ) : (
              <div style={{ maxHeight: 300, overflowY: "auto" }}>
                {units.map(unit => {
                  const actorIdx = actors.findIndex(a => a.id === unit.actor);
                  const actorColor = ACTOR_COLORS[actorIdx % ACTOR_COLORS.length] || colors.text.muted;
                  const isSelected = unit.id === selectedUnitId;
                  return (
                    <div
                      key={unit.id}
                      onClick={() => handleUnitRowClick(unit.id)}
                      style={{
                        display: "flex", alignItems: "center", gap: space[1],
                        padding: `${space[1]}px ${space[2]}px`,
                        borderRadius: radius.sm, cursor: "pointer",
                        background: isSelected ? colors.bg.surface : "transparent",
                        border: isSelected ? `1px solid ${actorColor}40` : "1px solid transparent",
                        marginBottom: 2, transition: `all ${animation.fast}`,
                      }}
                    >
                      <div style={{ width: 6, height: 6, borderRadius: "50%", background: actorColor, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: typography.body.xs, color: colors.text.primary,
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        }}>
                          {unit.name || "(unnamed)"}
                        </div>
                        <div style={{ fontSize: 8, color: colors.text.muted }}>
                          {formatType(unit.type)} · {positionDisplay(unit.position)}
                        </div>
                      </div>
                      <div style={{ fontSize: 8, color: unit.strength > 50 ? colors.accent.green : unit.strength > 25 ? colors.accent.amber : colors.accent.red, fontFamily: typography.monoFamily }}>
                        {unit.strength}%
                      </div>
                      <button
                        onClick={(e) => handleDeleteUnit(e, unit.id)}
                        style={{ background: "none", border: "none", color: colors.text.muted, cursor: "pointer", fontSize: 10, padding: "0 2px", opacity: 0.5 }}
                        title="Remove unit"
                      >
                        &times;
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </CollapsibleSection>

          {/* Unit Properties (when selected) */}
          {selectedUnit && (
            <CollapsibleSection title="Unit Properties" accent={ACTOR_COLORS[actors.findIndex(a => a.id === selectedUnit.actor) % ACTOR_COLORS.length]}>
              <div style={{ marginBottom: space[2] }}>
                <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: 2 }}>Name</div>
                <input
                  value={selectedUnit.name}
                  onChange={e => dispatch({ type: "UPDATE_UNIT", idx: selectedUnitIdx, field: "name", value: e.target.value })}
                  placeholder="Unit name"
                  style={{ width: "100%", padding: "6px 8px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.sm, color: colors.text.primary, fontSize: typography.body.sm, fontFamily: typography.fontFamily, outline: "none", boxSizing: "border-box" }}
                />
              </div>

              <div style={{ marginBottom: space[2] }}>
                <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: 2 }}>Type</div>
                <select
                  value={selectedUnit.type}
                  onChange={e => dispatch({ type: "UPDATE_UNIT", idx: selectedUnitIdx, field: "type", value: e.target.value })}
                  style={{ width: "100%", padding: "6px 8px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.sm, color: colors.text.primary, fontSize: typography.body.sm, fontFamily: typography.fontFamily }}
                >
                  {UNIT_TYPES.map(t => <option key={t} value={t}>{formatType(t)}</option>)}
                </select>
              </div>

              <div style={{ marginBottom: space[2] }}>
                <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: 2 }}>
                  Position: <span style={{ color: colors.accent.amber }}>{positionDisplay(selectedUnit.position)}</span>
                </div>
              </div>

              <div style={{ marginBottom: space[2] }}>
                <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: 2, display: "flex", justifyContent: "space-between" }}>
                  <span>Strength</span>
                  <span style={{
                    color: selectedUnit.strength > 50 ? colors.accent.green : selectedUnit.strength > 25 ? colors.accent.amber : colors.accent.red,
                    fontFamily: typography.monoFamily, fontWeight: typography.weight.semibold,
                  }}>{selectedUnit.strength}%</span>
                </div>
                <input type="range" min="0" max="100" step="5" value={selectedUnit.strength}
                  onChange={e => dispatch({ type: "UPDATE_UNIT", idx: selectedUnitIdx, field: "strength", value: parseInt(e.target.value) })}
                  style={{ width: "100%", accentColor: selectedUnit.strength > 50 ? colors.accent.green : selectedUnit.strength > 25 ? colors.accent.amber : colors.accent.red }} />
              </div>

              <div style={{ marginBottom: space[2] }}>
                <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: 2, display: "flex", justifyContent: "space-between" }}>
                  <span>Supply</span>
                  <span style={{ color: colors.accent.cyan, fontFamily: typography.monoFamily, fontWeight: typography.weight.semibold }}>{selectedUnit.supply}%</span>
                </div>
                <input type="range" min="0" max="100" step="5" value={selectedUnit.supply}
                  onChange={e => dispatch({ type: "UPDATE_UNIT", idx: selectedUnitIdx, field: "supply", value: parseInt(e.target.value) })}
                  style={{ width: "100%", accentColor: colors.accent.cyan }} />
              </div>

              <div style={{ marginBottom: space[2] }}>
                <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: 2 }}>Notes</div>
                <textarea
                  value={selectedUnit.notes || ""}
                  onChange={e => dispatch({ type: "UPDATE_UNIT", idx: selectedUnitIdx, field: "notes", value: e.target.value })}
                  placeholder="Optional notes..."
                  style={{ width: "100%", padding: "6px 8px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.sm, color: colors.text.primary, fontSize: typography.body.xs, fontFamily: typography.fontFamily, outline: "none", minHeight: 40, resize: "vertical", boxSizing: "border-box" }}
                />
              </div>

              <div style={{ display: "flex", gap: space[2] }}>
                <Button variant="secondary" onClick={handleDuplicateUnit} size="sm" style={{ flex: 1 }}>Duplicate</Button>
                <Button variant="danger" onClick={() => dispatch({ type: "REMOVE_UNIT", unitId: selectedUnit.id })} size="sm" style={{ flex: 1 }}>Delete</Button>
              </div>
            </CollapsibleSection>
          )}
        </div>
      </div>
    </div>
  );
}
