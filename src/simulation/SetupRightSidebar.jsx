import { useRef, useEffect } from "react";
import { colors, typography, radius, animation, space, shadows } from "../theme.js";
import { Button, Input, Badge, CollapsibleSection } from "../components/ui.jsx";
import { ACTOR_COLORS } from "../terrainColors.js";
import { TYPE_ICONS } from "../mapRenderer/overlays/UnitOverlay.js";
import { cellToDisplayString } from "../mapRenderer/overlays/UnitOverlay.js";
import SetupCellEditor from "./SetupCellEditor.jsx";
import {
  getBranchesForScale, getEchelonsForScale, ECHELON_LABELS,
  POSTURES, SCALE_TIERS, isSystemActive, MOVEMENT_TYPES,
} from "./schemas.js";

// ═══════════════════════════════════════════════════════════════
// SETUP RIGHT SIDEBAR — Unit Palette, Placed Units, Properties
// ═══════════════════════════════════════════════════════════════

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

export default function SetupRightSidebar({ state, dispatch, terrainData, onUpdateCell, open, onToggle }) {
  const {
    actors, units, scale,
    interactionMode, placementPayload, selectedUnitId,
  } = state;

  const scaleTier = SCALE_TIERS[scale]?.tier || 3;
  const branches = getBranchesForScale(scale);
  const echelons = getEchelonsForScale(scale);

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
          {/* Terrain edit mode: show cell editor */}
          {interactionMode === "edit_terrain" ? (
            <SetupCellEditor
              selectedCell={state.selectedCell}
              terrainData={terrainData}
              onUpdateCell={onUpdateCell}
            />
          ) : (<>
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
                    {branches.map(branch => {
                      const isActive = interactionMode === "place_unit" &&
                        placementPayload?.actorId === actor.id &&
                        placementPayload?.unitType === branch;
                      return (
                        <button
                          key={branch}
                          onClick={() => handlePaletteClick(actor.id, branch)}
                          title={`Place ${formatType(branch)} for ${actor.name}`}
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
                          {formatType(branch)}
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
                          {formatType(unit.type)}{unit.echelon ? ` · ${ECHELON_LABELS[unit.echelon] || formatType(unit.echelon)}` : ""} · {positionDisplay(unit.position)}
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

              {/* Branch + Echelon side by side */}
              <div style={{ display: "flex", gap: space[1], marginBottom: space[2] }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: 2 }}>Branch</div>
                  <select
                    value={selectedUnit.type}
                    onChange={e => dispatch({ type: "UPDATE_UNIT", idx: selectedUnitIdx, field: "type", value: e.target.value })}
                    style={{ width: "100%", padding: "6px 8px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.sm, color: colors.text.primary, fontSize: typography.body.sm, fontFamily: typography.fontFamily }}
                  >
                    {branches.map(t => <option key={t} value={t}>{formatType(t)}</option>)}
                    {/* Show current value if not in scale-filtered list (backward compat) */}
                    {!branches.includes(selectedUnit.type) && (
                      <option value={selectedUnit.type}>{formatType(selectedUnit.type)}</option>
                    )}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: 2 }}>Echelon</div>
                  <select
                    value={selectedUnit.echelon || ""}
                    onChange={e => dispatch({ type: "UPDATE_UNIT", idx: selectedUnitIdx, field: "echelon", value: e.target.value })}
                    style={{ width: "100%", padding: "6px 8px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.sm, color: colors.text.primary, fontSize: typography.body.sm, fontFamily: typography.fontFamily }}
                  >
                    {echelons.map(e => <option key={e} value={e}>{ECHELON_LABELS[e] || formatType(e)}</option>)}
                    {selectedUnit.echelon && !echelons.includes(selectedUnit.echelon) && (
                      <option value={selectedUnit.echelon}>{ECHELON_LABELS[selectedUnit.echelon] || formatType(selectedUnit.echelon)}</option>
                    )}
                  </select>
                </div>
              </div>

              {/* Posture */}
              <div style={{ marginBottom: space[2] }}>
                <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: 2 }}>Posture</div>
                <select
                  value={selectedUnit.posture || "ready"}
                  onChange={e => dispatch({ type: "UPDATE_UNIT", idx: selectedUnitIdx, field: "posture", value: e.target.value })}
                  style={{ width: "100%", padding: "6px 8px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.sm, color: colors.text.primary, fontSize: typography.body.sm, fontFamily: typography.fontFamily }}
                >
                  {POSTURES.map(p => <option key={p} value={p}>{formatType(p)}</option>)}
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

              {/* Morale — Tiers 1-3 */}
              {isSystemActive("morale", scaleTier) && selectedUnit.morale !== undefined && (
                <div style={{ marginBottom: space[2] }}>
                  <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: 2, display: "flex", justifyContent: "space-between" }}>
                    <span>Morale</span>
                    <span style={{ color: selectedUnit.morale > 50 ? colors.accent.green : selectedUnit.morale > 25 ? colors.accent.amber : colors.accent.red, fontFamily: typography.monoFamily, fontWeight: typography.weight.semibold }}>{selectedUnit.morale}%</span>
                  </div>
                  <input type="range" min="0" max="100" step="5" value={selectedUnit.morale}
                    onChange={e => dispatch({ type: "UPDATE_UNIT", idx: selectedUnitIdx, field: "morale", value: parseInt(e.target.value) })}
                    style={{ width: "100%", accentColor: selectedUnit.morale > 50 ? colors.accent.green : selectedUnit.morale > 25 ? colors.accent.amber : colors.accent.red }} />
                </div>
              )}

              {/* Ammo — Tiers 1-3 */}
              {isSystemActive("ammo_tracking", scaleTier) && selectedUnit.ammo !== undefined && (
                <div style={{ marginBottom: space[2] }}>
                  <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: 2, display: "flex", justifyContent: "space-between" }}>
                    <span>Ammo</span>
                    <span style={{ color: selectedUnit.ammo > 50 ? colors.accent.green : selectedUnit.ammo > 25 ? colors.accent.amber : colors.accent.red, fontFamily: typography.monoFamily, fontWeight: typography.weight.semibold }}>{selectedUnit.ammo}%</span>
                  </div>
                  <input type="range" min="0" max="100" step="5" value={selectedUnit.ammo}
                    onChange={e => dispatch({ type: "UPDATE_UNIT", idx: selectedUnitIdx, field: "ammo", value: parseInt(e.target.value) })}
                    style={{ width: "100%", accentColor: selectedUnit.ammo > 50 ? colors.accent.green : selectedUnit.ammo > 25 ? colors.accent.amber : colors.accent.red }} />
                </div>
              )}

              {/* Fuel — Tiers 2-4 */}
              {isSystemActive("fuel_tracking", scaleTier) && selectedUnit.fuel !== undefined && (
                <div style={{ marginBottom: space[2] }}>
                  <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: 2, display: "flex", justifyContent: "space-between" }}>
                    <span>Fuel</span>
                    <span style={{ color: selectedUnit.fuel > 50 ? colors.accent.green : selectedUnit.fuel > 25 ? colors.accent.amber : colors.accent.red, fontFamily: typography.monoFamily, fontWeight: typography.weight.semibold }}>{selectedUnit.fuel}%</span>
                  </div>
                  <input type="range" min="0" max="100" step="5" value={selectedUnit.fuel}
                    onChange={e => dispatch({ type: "UPDATE_UNIT", idx: selectedUnitIdx, field: "fuel", value: parseInt(e.target.value) })}
                    style={{ width: "100%", accentColor: selectedUnit.fuel > 50 ? colors.accent.green : selectedUnit.fuel > 25 ? colors.accent.amber : colors.accent.red }} />
                </div>
              )}

              {/* Fatigue — Tiers 1-2 */}
              {isSystemActive("fatigue", scaleTier) && selectedUnit.fatigue !== undefined && (
                <div style={{ marginBottom: space[2] }}>
                  <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: 2, display: "flex", justifyContent: "space-between" }}>
                    <span>Fatigue</span>
                    <span style={{ color: selectedUnit.fatigue < 30 ? colors.accent.green : selectedUnit.fatigue < 60 ? colors.accent.amber : colors.accent.red, fontFamily: typography.monoFamily, fontWeight: typography.weight.semibold }}>{selectedUnit.fatigue}%</span>
                  </div>
                  <input type="range" min="0" max="100" step="5" value={selectedUnit.fatigue}
                    onChange={e => dispatch({ type: "UPDATE_UNIT", idx: selectedUnitIdx, field: "fatigue", value: parseInt(e.target.value) })}
                    style={{ width: "100%", accentColor: selectedUnit.fatigue < 30 ? colors.accent.green : selectedUnit.fatigue < 60 ? colors.accent.amber : colors.accent.red }} />
                </div>
              )}

              {/* Entrenchment — Tiers 1-3 */}
              {isSystemActive("entrenchment", scaleTier) && selectedUnit.entrenchment !== undefined && (
                <div style={{ marginBottom: space[2] }}>
                  <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: 2, display: "flex", justifyContent: "space-between" }}>
                    <span>Entrenchment</span>
                    <span style={{ color: colors.accent.cyan, fontFamily: typography.monoFamily, fontWeight: typography.weight.semibold }}>{selectedUnit.entrenchment}%</span>
                  </div>
                  <input type="range" min="0" max="100" step="10" value={selectedUnit.entrenchment}
                    onChange={e => dispatch({ type: "UPDATE_UNIT", idx: selectedUnitIdx, field: "entrenchment", value: parseInt(e.target.value) })}
                    style={{ width: "100%", accentColor: colors.accent.cyan }} />
                </div>
              )}

              {/* Movement Type + Parent HQ side by side */}
              <div style={{ display: "flex", gap: space[1], marginBottom: space[2] }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: 2 }}>Movement</div>
                  <select
                    value={selectedUnit.movementType || "foot"}
                    onChange={e => dispatch({ type: "UPDATE_UNIT", idx: selectedUnitIdx, field: "movementType", value: e.target.value })}
                    style={{ width: "100%", padding: "6px 8px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.sm, color: colors.text.primary, fontSize: typography.body.sm, fontFamily: typography.fontFamily }}
                  >
                    {MOVEMENT_TYPES.map(mt => <option key={mt} value={mt}>{formatType(mt)}</option>)}
                  </select>
                </div>
                {scaleTier >= 3 && (
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: 2 }}>Parent HQ</div>
                    <select
                      value={selectedUnit.parentHQ || ""}
                      onChange={e => dispatch({ type: "UPDATE_UNIT", idx: selectedUnitIdx, field: "parentHQ", value: e.target.value })}
                      style={{ width: "100%", padding: "6px 8px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.sm, color: colors.text.primary, fontSize: typography.body.sm, fontFamily: typography.fontFamily }}
                    >
                      <option value="">None</option>
                      {units.filter(u => u.type === "headquarters" && u.id !== selectedUnit.id).map(hq => (
                        <option key={hq.id} value={hq.id}>{hq.name || hq.id}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Task Organization — Grand Tactical (Tier 3) only */}
              {scaleTier === 3 && (
                <div style={{ marginBottom: space[2] }}>
                  <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: 2 }}>Task Organization</div>
                  <textarea
                    value={selectedUnit.taskOrg || ""}
                    onChange={e => dispatch({ type: "UPDATE_UNIT", idx: selectedUnitIdx, field: "taskOrg", value: e.target.value })}
                    placeholder="e.g., 1x armor co, 2x mech inf co, 1x eng plt"
                    style={{ width: "100%", padding: "6px 8px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.sm, color: colors.text.primary, fontSize: typography.body.xs, fontFamily: typography.fontFamily, outline: "none", minHeight: 36, resize: "vertical", boxSizing: "border-box" }}
                  />
                </div>
              )}

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
          </>)}
        </div>
      </div>
    </div>
  );
}
