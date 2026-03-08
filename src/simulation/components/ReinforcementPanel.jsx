import { useState, useEffect } from "react";
import { colors, typography, radius, space } from "../../theme.js";
import { Button, Badge, Card, SectionHeader, Select } from "../../components/ui.jsx";
import { SCALE_TIERS, SCALE_ECHELONS, BRANCH_SCALE_RELEVANCE, MOVEMENT_TYPES, DIPLOMATIC_STATUSES, getUnitFieldsForScale, getBranchesForScale, getEchelonsForScale, ECHELON_LABELS } from "../schemas.js";
import { ACTOR_COLORS } from "../../terrainColors.js";
import { getTemplatesForScale, ERA_DEFINITIONS } from "../eraTemplates.js";

// ═══════════════════════════════════════════════════════════════
// REINFORCEMENT PANEL — Add units/actors mid-scenario
// Collapsible inline section for the PLANNING phase sidebar
// ═══════════════════════════════════════════════════════════════

// Pretty-print branch names: "special_forces" → "Special Forces"
function branchLabel(branch) {
  return branch.split("_").map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
}

const DEFAULT_DIPLOMACY = "neutral";

export default function ReinforcementPanel({
  gameState,       // full game state
  onAddUnit,       // (unit) => void — add immediately to gs.units
  onScheduleUnit,  // (entry) => void — add to reinforcementQueue
  onAddActor,      // (actor, diplomacyPairs) => void — add new actor
  onRemoveQueued,  // (reinfId) => void — remove from queue
  placingPosition, // "col,row" or null — set by map click during placement
  onStartPlacing,  // () => void — enter map-click mode for position selection
  onCancelPlacing, // () => void — exit placement mode
  terrainData,     // terrain grid data (optional, for placement validation)
}) {
  const [expanded, setExpanded] = useState(false);
  const [showAddUnit, setShowAddUnit] = useState(false);
  const [showAddActor, setShowAddActor] = useState(false);

  // Unit draft state
  const [unitActor, setUnitActor] = useState(gameState.scenario.actors[0]?.id || "");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [unitEchelon, setUnitEchelon] = useState("");
  const [unitName, setUnitName] = useState("");
  const [unitTiming, setUnitTiming] = useState("immediate"); // "immediate" | "scheduled"
  const [arrivalTurn, setArrivalTurn] = useState(gameState.game.turn + 1);
  // L20: Keep arrivalTurn current as turns advance
  useEffect(() => {
    setArrivalTurn(prev => Math.max(prev, gameState.game.turn + 1));
  }, [gameState.game.turn]);
  // Per-actor era override — defaults to what was set during setup
  const [eraOverrides, setEraOverrides] = useState({});

  // Actor draft state
  const [actorName, setActorName] = useState("");
  const [actorObjectives, setActorObjectives] = useState("");
  const [actorConstraints, setActorConstraints] = useState("");
  // Diplomacy toward each existing actor, keyed by actor id
  const [actorDiplomacy, setActorDiplomacy] = useState(() => {
    const d = {};
    gameState.scenario.actors.forEach(a => { d[a.id] = DEFAULT_DIPLOMACY; });
    return d;
  });

  const scaleKey = gameState.game.scale;
  const scaleTier = SCALE_TIERS[scaleKey]?.tier || 3;
  const echelons = getEchelonsForScale(scaleKey);
  const queue = gameState.reinforcementQueue || [];

  // Resolve era for the currently selected actor
  const setupEra = gameState.scenario.eraSelections?.[unitActor] || "default";
  const activeEra = eraOverrides[unitActor] || setupEra;
  const templates = getTemplatesForScale(activeEra, scaleKey);

  // Find the selected template object
  const selectedTemplate = templates.find(t => t.templateId === selectedTemplateId) || null;

  const resetUnitDraft = () => {
    setSelectedTemplateId("");
    setUnitEchelon("");
    setUnitName("");
    setUnitTiming("immediate");
    setArrivalTurn(gameState.game.turn + 1);
    setShowAddUnit(false);
    onCancelPlacing?.();
  };

  const resetActorDraft = () => {
    setActorName("");
    setActorObjectives("");
    setActorConstraints("");
    const d = {};
    gameState.scenario.actors.forEach(a => { d[a.id] = DEFAULT_DIPLOMACY; });
    setActorDiplomacy(d);
    setShowAddActor(false);
  };

  // M10: Water terrain types that ground units cannot be placed on
  const WATER_TERRAIN = new Set(["deep_water", "shallow_water", "coastal_water", "river"]);

  const handleConfirmUnit = () => {
    if (!unitName.trim() || !selectedTemplate || !unitEchelon || !placingPosition) return;

    // M10: Validate placement terrain — reject water for non-naval units
    if (terrainData?.cells) {
      const cell = terrainData.cells[placingPosition];
      const movType = selectedTemplate.defaults?.movementType || "foot";
      if (cell && WATER_TERRAIN.has(cell.terrain) && movType !== "naval" && movType !== "amphibious") {
        alert(`Cannot place ground unit on ${cell.terrain.replace(/_/g, " ")}. Choose a land hex.`);
        return;
      }
    }

    // M10: Warn about stacking — other units already at this hex
    const existingAtHex = gameState.units.filter(u => u.position === placingPosition && u.status !== "destroyed" && u.status !== "eliminated");
    if (existingAtHex.length > 0) {
      const names = existingAtHex.map(u => u.name).join(", ");
      if (!confirm(`${names} already at this hex. Place here anyway?`)) return;
    }

    const scaleFields = getUnitFieldsForScale(scaleTier);
    const tpl = selectedTemplate;
    const unit = {
      id: `reinf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      actor: unitActor,
      name: unitName.trim(),
      type: tpl.baseType,
      templateId: tpl.templateId,
      echelon: unitEchelon,
      position: placingPosition,
      posture: "ready",
      status: "ready",
      strength: 100,
      supply: 100,
      detected: false,
      movementType: tpl.defaults.movementType || "foot",
      specialCapabilities: tpl.defaults.specialCapabilities || [],
      ...(tpl.defaults.weaponRangeKm ? { weaponRangeKm: tpl.defaults.weaponRangeKm } : {}),
      ...scaleFields,
    };

    if (unitTiming === "immediate") {
      onAddUnit(unit);
    } else {
      onScheduleUnit({
        id: `reinf_q_${Date.now()}`,
        unit,
        arrivalTurn: Math.max(gameState.game.turn + 1, arrivalTurn),
        addedOnTurn: gameState.game.turn,
        addedBy: unitActor,
        newActor: null,
      });
    }

    resetUnitDraft();
  };

  const handleConfirmActor = () => {
    if (!actorName.trim()) return;

    const newActorId = `actor_${Date.now()}`;
    const actor = {
      id: newActorId,
      name: actorName.trim(),
      controller: "player",
      objectives: actorObjectives.split("\n").map(s => s.trim()).filter(Boolean),
      constraints: actorConstraints.split("\n").map(s => s.trim()).filter(Boolean),
    };

    // Build diplomacy pairs: { existingActorId: status }
    const diplomacyPairs = {};
    for (const [existingId, status] of Object.entries(actorDiplomacy)) {
      diplomacyPairs[existingId] = status;
    }

    onAddActor(actor, diplomacyPairs);

    // Auto-select the new actor for subsequent unit placement
    setUnitActor(newActorId);
    resetActorDraft();
  };

  const canConfirmUnit = unitName.trim() && selectedTemplate && unitEchelon && placingPosition;

  return (
    <Card style={{ marginBottom: space[3] }}>
      {/* Header — click to expand/collapse */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between",
          userSelect: "none",
        }}
      >
        <div style={{ fontSize: typography.body.xs, color: colors.text.muted, letterSpacing: 1, textTransform: "uppercase", fontWeight: typography.weight.semibold }}>
          Reinforcements
          {queue.length > 0 && (
            <Badge color={colors.accent.cyan} style={{ fontSize: 9, marginLeft: space[1], padding: "1px 4px" }}>
              {queue.length} queued
            </Badge>
          )}
        </div>
        <span style={{ color: colors.text.muted, fontSize: 12 }}>{expanded ? "\u25B2" : "\u25BC"}</span>
      </div>

      {!expanded && null}

      {expanded && (
        <div style={{ marginTop: space[3] }}>
          {/* Pending reinforcement queue */}
          {queue.length > 0 && (
            <div style={{ marginBottom: space[3] }}>
              <div style={{ fontSize: typography.body.xs, color: colors.text.secondary, marginBottom: space[1] }}>Scheduled Arrivals</div>
              {queue.map(r => {
                const actorObj = gameState.scenario.actors.find(a => a.id === r.unit.actor);
                const actorIdx = gameState.scenario.actors.indexOf(actorObj);
                return (
                  <div key={r.id} style={{
                    display: "flex", alignItems: "center", gap: space[1], padding: `${space[1]}px`,
                    background: colors.bg.surface, borderRadius: radius.sm, marginBottom: 2,
                    borderLeft: `3px solid ${ACTOR_COLORS[actorIdx >= 0 ? actorIdx % ACTOR_COLORS.length : 0]}`,
                  }}>
                    <span style={{ fontSize: typography.body.xs, flex: 1 }}>
                      {r.unit.name} ({branchLabel(r.unit.type)})
                    </span>
                    <Badge color={colors.accent.amber} style={{ fontSize: 9, padding: "1px 4px" }}>T{r.arrivalTurn}</Badge>
                    <button
                      onClick={() => onRemoveQueued(r.id)}
                      style={{
                        background: "none", border: "none", color: colors.text.muted,
                        cursor: "pointer", fontSize: 14, padding: "0 2px", lineHeight: 1,
                      }}
                    >&times;</button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: "flex", gap: space[1], marginBottom: space[2] }}>
            <Button variant="secondary" size="sm" onClick={() => { setShowAddUnit(!showAddUnit); setShowAddActor(false); }}>
              {showAddUnit ? "Cancel" : "+ Unit"}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => { setShowAddActor(!showAddActor); setShowAddUnit(false); }}>
              {showAddActor ? "Cancel" : "+ Actor"}
            </Button>
          </div>

          {/* ── Add Unit Form ── */}
          {showAddUnit && (
            <div style={{
              padding: space[2], background: colors.bg.surface, borderRadius: radius.md,
              border: `1px solid ${colors.border.subtle}`, marginBottom: space[2],
            }}>
              <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[2], textTransform: "uppercase", letterSpacing: 1 }}>
                New Reinforcement Unit
              </div>

              {/* Actor */}
              <label style={labelStyle}>Actor</label>
              <select
                value={unitActor}
                onChange={e => { setUnitActor(e.target.value); setSelectedTemplateId(""); }}
                style={selectStyle}
              >
                {gameState.scenario.actors.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>

              {/* Era */}
              <label style={labelStyle}>Era</label>
              <select
                value={activeEra}
                onChange={e => {
                  setEraOverrides(prev => ({ ...prev, [unitActor]: e.target.value }));
                  setSelectedTemplateId("");
                }}
                style={selectStyle}
              >
                {ERA_DEFINITIONS.map(era => (
                  <option key={era.id} value={era.id}>{era.shortLabel}</option>
                ))}
              </select>

              {/* Unit Name */}
              <label style={labelStyle}>Unit Name</label>
              <input
                value={unitName} onChange={e => setUnitName(e.target.value)}
                placeholder="e.g. Charlie Company"
                style={inputStyle}
              />

              {/* Type (era-specific templates) */}
              <label style={labelStyle}>Type</label>
              <select
                value={selectedTemplateId}
                onChange={e => {
                  setSelectedTemplateId(e.target.value);
                  // Auto-fill unit name from template if name is empty
                  const tpl = templates.find(t => t.templateId === e.target.value);
                  if (tpl && !unitName.trim()) setUnitName(tpl.name);
                }}
                style={selectStyle}
              >
                <option value="">Select...</option>
                {templates.map(t => (
                  <option key={t.templateId} value={t.templateId}>{t.name}</option>
                ))}
              </select>

              {/* Template info hint */}
              {selectedTemplate && (
                <div style={{
                  fontSize: 10, color: colors.text.muted, marginBottom: space[2],
                  padding: "3px 6px", background: colors.bg.base, borderRadius: radius.sm,
                  lineHeight: 1.4,
                }}>
                  {selectedTemplate.description}
                </div>
              )}

              {/* Echelon */}
              <label style={labelStyle}>Echelon</label>
              <select value={unitEchelon} onChange={e => setUnitEchelon(e.target.value)} style={selectStyle}>
                <option value="">Select...</option>
                {echelons.map(e => <option key={e} value={e}>{ECHELON_LABELS[e] || e}</option>)}
              </select>

              {/* Position — map click */}
              <label style={labelStyle}>Position</label>
              {placingPosition ? (
                <div style={{ display: "flex", alignItems: "center", gap: space[1], marginBottom: space[2] }}>
                  <Badge color={colors.accent.green} style={{ fontFamily: typography.monoFamily }}>{placingPosition}</Badge>
                  <Button variant="ghost" size="sm" onClick={onStartPlacing}>Change</Button>
                </div>
              ) : (
                <Button variant="secondary" size="sm" onClick={onStartPlacing} style={{ marginBottom: space[2] }}>
                  Click Map to Place
                </Button>
              )}

              {/* Timing */}
              <label style={labelStyle}>Timing</label>
              <div style={{ display: "flex", gap: space[1], marginBottom: space[2] }}>
                <Button
                  variant={unitTiming === "immediate" ? "primary" : "secondary"} size="sm"
                  onClick={() => setUnitTiming("immediate")}
                >Now</Button>
                <Button
                  variant={unitTiming === "scheduled" ? "primary" : "secondary"} size="sm"
                  onClick={() => setUnitTiming("scheduled")}
                >Scheduled</Button>
              </div>

              {unitTiming === "scheduled" && (
                <div style={{ display: "flex", alignItems: "center", gap: space[1], marginBottom: space[2] }}>
                  <span style={{ fontSize: typography.body.xs, color: colors.text.secondary }}>Arrives turn:</span>
                  <input
                    type="number"
                    value={arrivalTurn}
                    min={gameState.game.turn + 1}
                    onChange={e => setArrivalTurn(parseInt(e.target.value) || gameState.game.turn + 1)}
                    style={{ ...inputStyle, width: 60, marginBottom: 0 }}
                  />
                </div>
              )}

              {/* Confirm */}
              <Button
                onClick={handleConfirmUnit}
                disabled={!canConfirmUnit}
                size="sm"
                style={{ width: "100%" }}
              >
                {unitTiming === "immediate" ? "Add Unit Now" : `Schedule for Turn ${arrivalTurn}`}
              </Button>
            </div>
          )}

          {/* ── Add Actor Form ── */}
          {showAddActor && (
            <div style={{
              padding: space[2], background: colors.bg.surface, borderRadius: radius.md,
              border: `1px solid ${colors.border.subtle}`, marginBottom: space[2],
            }}>
              <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[2], textTransform: "uppercase", letterSpacing: 1 }}>
                New Actor / Faction
              </div>

              {/* Preview color — based on next index */}
              <div style={{ display: "flex", alignItems: "center", gap: space[1], marginBottom: space[2] }}>
                <div style={{
                  width: 14, height: 14, borderRadius: "50%",
                  background: ACTOR_COLORS[gameState.scenario.actors.length % ACTOR_COLORS.length],
                }} />
                <span style={{ fontSize: typography.body.xs, color: colors.text.muted }}>
                  Color (auto-assigned by position)
                </span>
              </div>

              {/* Name */}
              <label style={labelStyle}>Faction Name</label>
              <input
                value={actorName} onChange={e => setActorName(e.target.value)}
                placeholder="e.g. UN Peacekeepers"
                style={inputStyle}
              />

              {/* Objectives */}
              <label style={labelStyle}>Objectives (one per line)</label>
              <textarea
                value={actorObjectives} onChange={e => setActorObjectives(e.target.value)}
                placeholder={"Establish buffer zone\nProtect civilian infrastructure"}
                rows={3}
                style={{ ...inputStyle, resize: "vertical", fontFamily: typography.fontFamily }}
              />

              {/* Constraints */}
              <label style={labelStyle}>Constraints (one per line)</label>
              <textarea
                value={actorConstraints} onChange={e => setActorConstraints(e.target.value)}
                placeholder={"Rules of engagement: proportional force only\nNo offensive operations without HQ approval"}
                rows={3}
                style={{ ...inputStyle, resize: "vertical", fontFamily: typography.fontFamily }}
              />

              {/* Diplomacy toward each existing actor */}
              <label style={labelStyle}>Diplomatic Status</label>
              {gameState.scenario.actors.map((a, ai) => (
                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: space[1], marginBottom: 4 }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: ACTOR_COLORS[ai % ACTOR_COLORS.length],
                  }} />
                  <span style={{ fontSize: typography.body.xs, flex: 1 }}>{a.name}</span>
                  <select
                    value={actorDiplomacy[a.id] || DEFAULT_DIPLOMACY}
                    onChange={e => setActorDiplomacy(prev => ({ ...prev, [a.id]: e.target.value }))}
                    style={{ ...selectStyle, width: 100, marginBottom: 0 }}
                  >
                    {DIPLOMATIC_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              ))}

              {/* Confirm */}
              <Button
                onClick={handleConfirmActor}
                disabled={!actorName.trim()}
                size="sm"
                style={{ width: "100%", marginTop: space[2] }}
              >
                Add Actor
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ── Inline styles ──

const labelStyle = {
  display: "block",
  fontSize: 10,
  color: colors.text.muted,
  marginBottom: 2,
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

const inputStyle = {
  width: "100%",
  padding: "4px 6px",
  background: colors.bg.input,
  border: `1px solid ${colors.border.subtle}`,
  borderRadius: radius.sm,
  color: colors.text.primary,
  fontSize: typography.body.sm,
  fontFamily: typography.fontFamily,
  marginBottom: space[2],
  boxSizing: "border-box",
};

const selectStyle = {
  width: "100%",
  padding: "4px 6px",
  background: colors.bg.input,
  border: `1px solid ${colors.border.subtle}`,
  borderRadius: radius.sm,
  color: colors.text.primary,
  fontSize: typography.body.sm,
  fontFamily: typography.fontFamily,
  marginBottom: space[2],
  boxSizing: "border-box",
};
