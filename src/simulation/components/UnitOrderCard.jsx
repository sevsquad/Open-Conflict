import { useState, useCallback, useEffect } from "react";
import { colors, typography, radius, shadows, animation, space } from "../../theme.js";
import { Button, Badge } from "../../components/ui.jsx";
import {
  ORDER_TYPES, ORDER_SLOT, getValidOrders, resolveOrderConflict, isCompatible,
  MOVEMENT_BUDGETS, TERRAIN_COSTS, WEAPON_RANGE_KM, canEmbark,
  isAirUnit, isHelicopter,
} from "../orderTypes.js";
import { OBSERVER_VISUAL_KM, DEFAULT_OBSERVER_VISUAL_KM } from "../detectionRanges.js";
import { parseUnitPosition } from "../../mapRenderer/overlays/UnitOverlay.js";
import { hexDistance } from "../../mapRenderer/HexMath.js";
import { positionToLabel } from "../prompts.js";
import { checkBingoStatus } from "../airLogistics.js";

// Air orders that support altitude selection
const ALTITUDE_ORDERS = new Set(["CAS", "INTERDICTION", "SEAD", "AIR_RECON"]);
// All air-specific action orders (for detecting "is this an air order card")
const AIR_ACTION_ORDERS = new Set([
  "CAS", "AIR_SUPERIORITY", "INTERDICTION", "SEAD", "STRATEGIC_STRIKE",
  "AIRLIFT", "AIR_RECON", "CAP", "ESCORT",
]);
const ALTITUDE_OPTIONS = ["LOW", "MEDIUM", "HIGH"];

// ═══════════════════════════════════════════════════════════════
// UNIT ORDER CARD — Modal for assigning per-unit orders
// Shows unit stats, valid order buttons, and commander intent.
// Buttons that need a target hex trigger targeting mode on the map.
// ═══════════════════════════════════════════════════════════════

export default function UnitOrderCard({
  unit,
  terrainData,
  allUnits,
  actors,
  existingOrders,       // { movementOrder, actionOrder, intent } or null
  targetingMode,        // currently active targeting mode or null
  onStartTargeting,     // (orderType) => void — ask map to enter targeting mode
  onCancelTargeting,    // () => void
  onConfirm,            // ({ movementOrder, actionOrder, intent }) => void
  onOrderPreview,       // ({ movementOrder, actionOrder }) => void — persist order pair to parent on every click
  onClose,
  onEmbark,             // (unitId, transportId) => void — embark into transport
  scaleTier,            // current scale tier (3-6), used for air unit field visibility
  waypointCount = 0,    // number of waypoints accumulated so far during MOVE targeting
  onClearWaypoints,     // () => void — clear accumulated waypoints
}) {
  // Local state for the order being built
  const [movementOrder, setMovementOrder] = useState(existingOrders?.movementOrder || null);
  const [actionOrder, setActionOrder] = useState(existingOrders?.actionOrder || null);
  const [intent, setIntent] = useState(existingOrders?.intent || "");
  const [flashedButton, setFlashedButton] = useState(null);  // ID of button that was just replaced

  // Fire mission subtype (HE/SMOKE)
  const [fireMissionType, setFireMissionType] = useState(
    existingOrders?.actionOrder?.subtype || "HE"
  );
  // Engineer subtype
  const [engineerType, setEngineerType] = useState(
    existingOrders?.actionOrder?.subtype || "BRIDGE"
  );

  // Air-specific state
  const [altitude, setAltitude] = useState(
    existingOrders?.actionOrder?.altitude || "MEDIUM"
  );
  // Escort target — which friendly air unit to escort
  const [escortTarget, setEscortTarget] = useState(
    existingOrders?.actionOrder?.targetUnit || null
  );

  const isAir = isAirUnit(unit);
  const tier = scaleTier || 3;

  // Bingo fuel: persistent aircraft at bingo must RTB (only MOVE allowed, no action orders)
  const bingoStatus = (isAir && unit.fuel !== undefined) ? checkBingoStatus(unit) : null;
  const atBingo = unit.forcedRTB || (bingoStatus?.atBingo ?? false);

  // When the map delivers a target hex (parent calls this effect by updating existingOrders)
  // Actually handled via the targeting callback in SimGame — when map clicks, parent updates us
  useEffect(() => {
    // Sync if parent changes existingOrders (e.g., after target selected)
    // Intent is NOT synced here — it's local-only state edited in the textarea.
    // Syncing it would overwrite the user's in-progress edits on every target selection.
    if (existingOrders) {
      setMovementOrder(existingOrders.movementOrder || null);
      setActionOrder(existingOrders.actionOrder || null);
      if (existingOrders.actionOrder?.altitude) setAltitude(existingOrders.actionOrder.altitude);
      if (existingOrders.actionOrder?.targetUnit != null) setEscortTarget(existingOrders.actionOrder.targetUnit);
    }
  }, [existingOrders]);

  // Get valid orders for this unit type
  const validOrders = getValidOrders(unit.type);
  const movementOrders = validOrders.filter(
    o => ORDER_TYPES[o.orderId]?.slot === ORDER_SLOT.MOVEMENT
      && (o.orderId !== "DISEMBARK" || unit.embarkedIn) // DISEMBARK only for embarked units
  );
  const actionOrders = validOrders.filter(
    o => ORDER_TYPES[o.orderId]?.slot === ORDER_SLOT.ACTION
  );

  // Handle clicking an order button
  const handleOrderClick = useCallback((orderId) => {
    const orderDef = ORDER_TYPES[orderId];
    if (!orderDef) return;

    // H1: Re-clicking an already-selected order that requires a target → re-enter targeting
    // instead of toggling it off. Allows the user to change a destination in one click.
    // ESCORT uses in-card dropdown, not hex targeting — re-click just toggles off.
    const alreadySelected = (movementOrder?.id === orderId) || (actionOrder?.id === orderId);
    if (alreadySelected && orderDef.requiresTarget && orderId !== "ESCORT") {
      onStartTargeting?.(orderId);
      return;
    }

    // Resolve conflicts with existing orders
    const result = resolveOrderConflict(
      movementOrder?.id || null,
      actionOrder?.id || null,
      orderId
    );

    // Flash the replaced button briefly
    if (result.replaced) {
      setFlashedButton(result.replaced);
      setTimeout(() => setFlashedButton(null), 600);
    }

    // Build new order objects
    const newMovement = result.movementOrder
      ? { id: result.movementOrder, target: movementOrder?.id === result.movementOrder ? movementOrder?.target : null }
      : null;
    const newAction = result.actionOrder
      ? { id: result.actionOrder, target: actionOrder?.id === result.actionOrder ? actionOrder?.target : null, subtype: actionOrder?.id === result.actionOrder ? actionOrder?.subtype : null }
      : null;

    setMovementOrder(newMovement);
    setActionOrder(newAction);

    // Persist both orders to parent immediately so applyTarget sees the full pair
    onOrderPreview?.({ movementOrder: newMovement, actionOrder: newAction });

    // If this order requires a target, enter targeting mode
    // ESCORT uses an in-card dropdown instead of hex-click targeting
    const usesInCardSelector = orderId === "ESCORT";
    if (orderDef.requiresTarget && !usesInCardSelector && result.movementOrder === orderId && newMovement && !newMovement.target) {
      onStartTargeting?.(orderId);
    } else if (orderDef.requiresTarget && !usesInCardSelector && result.actionOrder === orderId && newAction && !newAction.target) {
      onStartTargeting?.(orderId);
    }
  }, [movementOrder, actionOrder, onStartTargeting, onOrderPreview]);

  // Called by parent when map targeting completes
  // This is handled by setting existingOrders from parent

  const handleConfirm = useCallback(() => {
    // M1: Strip orders that require a target but don't have one
    // ESCORT uses in-card dropdown (escortTarget) instead of hex target
    const finalMovement = (movementOrder && ORDER_TYPES[movementOrder.id]?.requiresTarget && !movementOrder.target)
      ? null : movementOrder;
    const escortHasTarget = actionOrder?.id === "ESCORT" && escortTarget;
    // Bingo fuel enforcement: strip action orders, force RTB only
    const finalAction = atBingo ? null
      : (actionOrder && ORDER_TYPES[actionOrder.id]?.requiresTarget && !actionOrder.target && !escortHasTarget)
        ? null : actionOrder;

    onConfirm({
      movementOrder: finalMovement,
      actionOrder: finalAction ? {
        ...finalAction,
        subtype: finalAction.id === "FIRE_MISSION" ? fireMissionType
          : finalAction.id === "ENGINEER" ? engineerType
          : null,
        // Air-specific fields
        altitude: (isAir && ALTITUDE_ORDERS.has(finalAction.id)) ? altitude : null,
        targetUnit: finalAction.id === "ESCORT" ? escortTarget : null,
      } : null,
      intent,
    });
  }, [movementOrder, actionOrder, intent, fireMissionType, engineerType, altitude, escortTarget, isAir, onConfirm]);

  // Esc key to close
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") {
        if (targetingMode) {
          onCancelTargeting?.();
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [targetingMode, onCancelTargeting, onClose]);

  // Unit position info
  const pos = parseUnitPosition(unit.position);
  const cellKey = pos ? `${pos.c},${pos.r}` : null;
  const cellData = cellKey && terrainData ? terrainData.cells[cellKey] : null;

  // Find nearby enemies (within 3 hexes)
  const nearbyEnemies = (allUnits || []).filter(u => {
    if (u.actor === unit.actor) return false;
    if (!u.position || !pos) return false;
    if (u.status === "destroyed" || u.status === "eliminated") return false;
    const ePos = parseUnitPosition(u.position);
    if (!ePos) return false;
    return hexDistance(pos.c, pos.r, ePos.c, ePos.r) <= 3;
  }).map(u => {
    const ePos = parseUnitPosition(u.position);
    const dist = hexDistance(pos.c, pos.r, ePos.c, ePos.r);
    return { ...u, distance: dist };
  }).sort((a, b) => a.distance - b.distance);

  // Transport state
  const isEmbarked = !!unit.embarkedIn;
  const embarkedTransport = isEmbarked
    ? (allUnits || []).find(u => u.id === unit.embarkedIn) : null;

  // Transport units: show cargo list
  const hasCargo = (unit.cargo?.length || 0) > 0;
  const cargoUnits = hasCargo
    ? unit.cargo.map(id => (allUnits || []).find(u => u.id === id)).filter(Boolean) : [];
  const transportCapacity = unit.transportCapacity || 0;

  // Non-embarked units: find available transports on same hex
  const availableTransports = (!isEmbarked && pos && onEmbark)
    ? (allUnits || []).filter(t => {
        if (t.id === unit.id) return false;
        if (t.actor !== unit.actor) return false;
        if (t.status === "destroyed" || t.status === "eliminated") return false;
        const tPos = parseUnitPosition(t.position);
        if (!tPos || tPos.c !== pos.c || tPos.r !== pos.r) return false;
        return canEmbark(unit, t).allowed;
      })
    : [];

  // Render an order button
  const renderOrderButton = (orderId, capability) => {
    const orderDef = ORDER_TYPES[orderId];
    const isMovement = orderDef.slot === ORDER_SLOT.MOVEMENT;
    const currentOrder = isMovement ? movementOrder : actionOrder;
    const isSelected = currentOrder?.id === orderId;
    const isFlashed = flashedButton === orderId;
    const targetLabel = currentOrder?.target ? positionToLabel(currentOrder.target) : null;

    return (
      <button
        key={orderId}
        onClick={() => handleOrderClick(orderId)}
        style={{
          padding: `${space[1]}px ${space[2] + 2}px`,
          fontSize: typography.body.sm,
          fontFamily: typography.fontFamily,
          fontWeight: isSelected ? typography.weight.semibold : typography.weight.medium,
          cursor: "pointer",
          border: isSelected
            ? `1px solid ${colors.accent.amber}`
            : `1px solid ${colors.border.subtle}`,
          borderRadius: radius.sm,
          background: isSelected
            ? `${colors.accent.amber}25`
            : isFlashed
              ? `${colors.accent.red}20`
              : colors.bg.input,
          color: isSelected
            ? colors.accent.amber
            : capability === "reduced"
              ? colors.text.muted
              : colors.text.secondary,
          transition: `all ${animation.fast}`,
          animation: isFlashed ? "flash 0.6s ease-out" : "none",
          whiteSpace: "nowrap",
        }}
      >
        {orderDef.label}{isSelected && targetLabel ? ` \u2192 ${targetLabel}` : ""}
        {capability === "reduced" && !isSelected && (
          <span style={{ fontSize: 8, marginLeft: 3, opacity: 0.6 }}>*</span>
        )}
      </button>
    );
  };

  // When targeting is active, dim the card
  const isTargeting = !!targetingMode;

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.5)",
      pointerEvents: isTargeting ? "none" : "auto",
    }}
    onClick={(e) => { if (e.target === e.currentTarget && !isTargeting) onClose(); }}
    >
      {/* L7: Targeting mode instruction overlay */}
      {isTargeting && (
        <div style={{
          position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
          background: colors.bg.raised, border: `1px solid ${colors.accent.amber}`,
          padding: `${space[3]}px ${space[4]}px`, borderRadius: radius.lg,
          textAlign: "center", pointerEvents: "auto", zIndex: 1001,
          boxShadow: shadows.lg,
        }}>
          <div style={{ fontSize: typography.body.md, color: colors.accent.amber, marginBottom: space[2], fontWeight: typography.weight.semibold }}>
            {targetingMode?.orderType === "MOVE" || targetingMode?.orderType === "WITHDRAW"
              ? "Click destination · Shift+click to add waypoints"
              : "Click a hex on the map"}
          </div>
          {waypointCount > 0 && (
            <div style={{ fontSize: typography.body.xs, color: colors.text.secondary, marginBottom: space[2] }}>
              {waypointCount} waypoint{waypointCount !== 1 ? "s" : ""} set
            </div>
          )}
          <Button variant="secondary" size="sm" onClick={onCancelTargeting}>Cancel</Button>
        </div>
      )}
      <div style={{
        background: colors.bg.raised,
        border: `1px solid ${colors.border.default}`,
        borderRadius: radius.xl,
        padding: space[4],
        width: 480,
        maxWidth: "90vw",
        maxHeight: "85vh",
        overflowY: "auto",
        boxShadow: shadows.lg,
        opacity: isTargeting ? 0.4 : 1,
        transition: `opacity ${animation.fast}`,
        pointerEvents: isTargeting ? "none" : "auto",
      }}>

        {/* Unit Header */}
        <div style={{ display: "flex", alignItems: "center", gap: space[2], marginBottom: space[3] }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: typography.heading.md, fontWeight: typography.weight.bold, color: colors.text.primary }}>
              {unit.name}
            </div>
            <div style={{ fontSize: typography.body.sm, color: colors.text.secondary }}>
              {isEmbarked && embarkedTransport
                ? `Embarked in ${embarkedTransport.name}`
                : <>
                    {positionToLabel(unit.position)} &middot; {cellData ? (cellData.terrain || "unknown") : "—"}
                    {cellData?.elevation !== undefined ? `, ${cellData.elevation}m` : ""}
                    {cellData?.features?.length > 0 ? ` (${cellData.features.join(", ")})` : ""}
                  </>
              }
            </div>
          </div>
          <Badge color={colors.accent.cyan}>{unit.type}</Badge>
          {unit.echelon && <Badge color={colors.text.muted}>{unit.echelon}</Badge>}
        </div>

        {/* Stats Grid — air units show readiness/fuel/munitions/sorties, ground units show standard stats */}
        {isAir ? (
          <AirStatsGrid unit={unit} tier={tier} />
        ) : (
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: `${space[1]}px ${space[2]}px`,
            padding: space[2], background: colors.bg.input, borderRadius: radius.md,
            marginBottom: space[3], fontSize: typography.body.xs,
          }}>
            <StatCell label="Strength" value={`${unit.strength}%`} color={unit.strength > 50 ? colors.accent.green : unit.strength > 25 ? colors.accent.amber : colors.accent.red} />
            <StatCell label="Supply" value={`${unit.supply ?? "—"}%`} color={(unit.supply ?? 100) > 50 ? colors.accent.green : (unit.supply ?? 100) > 25 ? colors.accent.amber : colors.accent.red} />
            <StatCell label="Ammo" value={`${unit.ammo ?? "—"}%`} color={(unit.ammo ?? 100) > 50 ? colors.accent.green : colors.accent.amber} />
            <StatCell label="Morale" value={`${unit.morale ?? "—"}%`} color={(unit.morale ?? 100) > 50 ? colors.accent.green : colors.accent.amber} />
            <StatCell label="Status" value={unit.status || "ready"} color={unit.status === "ready" ? colors.accent.green : colors.text.muted} />
            <StatCell label="Posture" value={unit.posture || "ready"} color={unit.posture === "attacking" ? colors.accent.red : unit.posture === "defending" ? colors.accent.blue : colors.text.secondary} />
          </div>
        )}

        {/* Capabilities */}
        {(() => {
          const moveBudget = MOVEMENT_BUDGETS[unit.movementType || "foot"] ?? 3;
          const rangeKm = unit.weaponRangeKm || WEAPON_RANGE_KM[unit.type] || WEAPON_RANGE_KM.infantry;
          const rangeStr = (rangeKm.effective === 0 && rangeKm.max === 0)
            ? "—" : `${rangeKm.effective}/${rangeKm.max}`;
          const visionKm = OBSERVER_VISUAL_KM[unit.type] ?? DEFAULT_OBSERVER_VISUAL_KM;
          const terrainCost = cellData?.terrain ? (TERRAIN_COSTS[cellData.terrain] ?? 1.0) : null;
          return (
            <>
              <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[1], letterSpacing: 0.5, textTransform: "uppercase" }}>
                Capabilities
              </div>
              <div style={{
                display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: `${space[1]}px ${space[2]}px`,
                padding: space[2], background: colors.bg.input, borderRadius: radius.md,
                marginBottom: terrainCost != null ? 0 : space[3], fontSize: typography.body.xs,
              }}>
                <StatCell label="Move" value={`${moveBudget} hex`} color={colors.accent.cyan} />
                <StatCell label="Range (km)" value={rangeStr} color={rangeStr === "—" ? colors.text.muted : colors.accent.amber} />
                <StatCell label="Vision (km)" value={`${visionKm}`} color={colors.accent.blue} />
              </div>
              {terrainCost != null && (
                <div style={{
                  fontSize: typography.body.xs, color: colors.text.muted,
                  padding: `2px ${space[2]}px`, marginBottom: space[3],
                  fontStyle: "italic",
                }}>
                  Current terrain: {cellData.terrain} ({terrainCost}× move cost)
                </div>
              )}
            </>
          );
        })()}

        {/* Nearby Enemies */}
        {nearbyEnemies.length > 0 && (
          <div style={{ marginBottom: space[3] }}>
            <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[1], letterSpacing: 0.5, textTransform: "uppercase" }}>
              Nearby Enemies
            </div>
            {nearbyEnemies.map(e => (
              <div key={e.id} style={{ fontSize: typography.body.sm, color: colors.accent.red, marginBottom: 2 }}>
                {e.name} @ {positionToLabel(e.position)} ({e.distance} hex, {(e.distance * (terrainData?.cellSizeKm || 1)).toFixed(0)}km)
                {e.strength !== undefined && <span style={{ color: colors.text.muted }}> &middot; {e.strength}% str</span>}
              </div>
            ))}
          </div>
        )}

        {/* Board Transport button — for non-embarked units on same hex as a transport */}
        {availableTransports.length > 0 && (
          <div style={{ marginBottom: space[3] }}>
            {availableTransports.map(t => (
              <Button
                key={t.id}
                variant="secondary"
                size="sm"
                onClick={() => onEmbark?.(unit.id, t.id)}
                style={{ marginRight: space[1], marginBottom: space[1] }}
              >
                Board {t.name} ({(t.cargo?.length || 0)}/{t.transportCapacity || 0})
              </Button>
            ))}
          </div>
        )}

        {/* Cargo inventory — for transport units with loaded units */}
        {transportCapacity > 0 && (
          <div style={{ marginBottom: space[3] }}>
            <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[1], letterSpacing: 0.5, textTransform: "uppercase" }}>
              Cargo ({cargoUnits.length}/{transportCapacity})
            </div>
            <div style={{
              padding: space[2], background: colors.bg.input, borderRadius: radius.md,
              fontSize: typography.body.sm, color: hasCargo ? colors.text.secondary : colors.text.muted,
            }}>
              {hasCargo
                ? cargoUnits.map(cu => (
                    <div key={cu.id} style={{ marginBottom: 2, display: "flex", alignItems: "center", gap: space[1] }}>
                      <span style={{ color: colors.text.primary }}>{cu.name}</span>
                      <Badge color={colors.accent.cyan} style={{ fontSize: 9 }}>{cu.type}</Badge>
                    </div>
                  ))
                : "Empty"
              }
            </div>
          </div>
        )}

        {/* Order Buttons */}
        <div style={{ marginBottom: space[3] }}>
          {isEmbarked ? (
            <>
              {/* Embarked units: DISEMBARK-only movement */}
              <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[1], letterSpacing: 0.5, textTransform: "uppercase" }}>
                Movement
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: space[1] + 2, marginBottom: space[2] }}>
                {renderOrderButton("DISEMBARK", "full")}
              </div>

              {/* Action buttons — disabled until DISEMBARK is selected */}
              <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[1], letterSpacing: 0.5, textTransform: "uppercase" }}>
                Action {!movementOrder?.id && <span style={{ fontSize: 9, fontStyle: "italic" }}>(select Disembark first)</span>}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: space[1] + 2, opacity: movementOrder?.id === "DISEMBARK" ? 1 : 0.4, pointerEvents: movementOrder?.id === "DISEMBARK" ? "auto" : "none" }}>
                {actionOrders.map(o => renderOrderButton(o.orderId, o.capability))}
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[1], letterSpacing: 0.5, textTransform: "uppercase" }}>
                Movement
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: space[1] + 2, marginBottom: space[2] }}>
                {movementOrders.map(o => renderOrderButton(o.orderId, o.capability))}
              </div>

              <div style={{ fontSize: typography.body.xs, color: atBingo ? colors.accent.red : colors.text.muted, marginBottom: space[1], letterSpacing: 0.5, textTransform: "uppercase" }}>
                Action {atBingo && <span style={{ fontSize: 9, fontStyle: "italic" }}>(BINGO — must RTB)</span>}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: space[1] + 2, opacity: atBingo ? 0.35 : 1, pointerEvents: atBingo ? "none" : "auto" }}>
                {actionOrders.map(o => renderOrderButton(o.orderId, o.capability))}
              </div>
            </>
          )}
        </div>

        {/* Fire Mission subtype selector */}
        {actionOrder?.id === "FIRE_MISSION" && (
          <div style={{ display: "flex", gap: space[2], marginBottom: space[2], alignItems: "center" }}>
            <span style={{ fontSize: typography.body.xs, color: colors.text.muted }}>Type:</span>
            {["HE", "SMOKE"].map(t => (
              <button key={t} onClick={() => setFireMissionType(t)} style={{
                padding: `2px ${space[2]}px`, fontSize: typography.body.sm, fontFamily: typography.fontFamily,
                border: `1px solid ${fireMissionType === t ? colors.accent.amber : colors.border.subtle}`,
                borderRadius: radius.sm, cursor: "pointer",
                background: fireMissionType === t ? `${colors.accent.amber}20` : colors.bg.input,
                color: fireMissionType === t ? colors.accent.amber : colors.text.secondary,
              }}>
                {t}
              </button>
            ))}
          </div>
        )}

        {/* Engineer subtype selector */}
        {actionOrder?.id === "ENGINEER" && (
          <div style={{ display: "flex", gap: space[1] + 2, marginBottom: space[2], alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: typography.body.xs, color: colors.text.muted }}>Task:</span>
            {ORDER_TYPES.ENGINEER.subtypes.map(t => (
              <button key={t} onClick={() => setEngineerType(t)} style={{
                padding: `2px ${space[2]}px`, fontSize: typography.body.xs, fontFamily: typography.fontFamily,
                border: `1px solid ${engineerType === t ? colors.accent.amber : colors.border.subtle}`,
                borderRadius: radius.sm, cursor: "pointer",
                background: engineerType === t ? `${colors.accent.amber}20` : colors.bg.input,
                color: engineerType === t ? colors.accent.amber : colors.text.secondary,
              }}>
                {t}
              </button>
            ))}
          </div>
        )}

        {/* Altitude selector — shown for air orders that support altitude */}
        {isAir && actionOrder?.id && ALTITUDE_ORDERS.has(actionOrder.id) && (
          <div style={{ display: "flex", gap: space[2], marginBottom: space[2], alignItems: "center" }}>
            <span style={{ fontSize: typography.body.xs, color: colors.text.muted }}>Altitude:</span>
            {ALTITUDE_OPTIONS.map(alt => {
              // Helicopters locked out of HIGH altitude
              const helo = isHelicopter(unit);
              const disabled = helo && alt === "HIGH";
              return (
                <button key={alt} onClick={() => !disabled && setAltitude(alt)} style={{
                  padding: `2px ${space[2]}px`, fontSize: typography.body.sm, fontFamily: typography.fontFamily,
                  border: `1px solid ${altitude === alt ? colors.accent.cyan : colors.border.subtle}`,
                  borderRadius: radius.sm,
                  cursor: disabled ? "not-allowed" : "pointer",
                  background: altitude === alt ? `${colors.accent.cyan}20` : colors.bg.input,
                  color: disabled ? colors.text.disabled : altitude === alt ? colors.accent.cyan : colors.text.secondary,
                  opacity: disabled ? 0.5 : 1,
                }}>
                  {alt}
                </button>
              );
            })}
          </div>
        )}

        {/* Escort target selector — pick which friendly air unit to escort */}
        {isAir && actionOrder?.id === "ESCORT" && (() => {
          const friendlyAir = (allUnits || []).filter(u =>
            u.id !== unit.id && u.actor === unit.actor && isAirUnit(u)
            && u.status !== "destroyed" && u.status !== "eliminated"
          );
          return (
            <div style={{ marginBottom: space[2] }}>
              <span style={{ fontSize: typography.body.xs, color: colors.text.muted, display: "block", marginBottom: space[1] }}>
                Escort target:
              </span>
              {friendlyAir.length === 0 ? (
                <span style={{ fontSize: typography.body.xs, color: colors.accent.amber }}>No other friendly air units available</span>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: space[1] }}>
                  {friendlyAir.map(u => (
                    <button key={u.id} onClick={() => setEscortTarget(u.id)} style={{
                      padding: `2px ${space[2]}px`, fontSize: typography.body.xs, fontFamily: typography.fontFamily,
                      border: `1px solid ${escortTarget === u.id ? colors.accent.cyan : colors.border.subtle}`,
                      borderRadius: radius.sm, cursor: "pointer",
                      background: escortTarget === u.id ? `${colors.accent.cyan}20` : colors.bg.input,
                      color: escortTarget === u.id ? colors.accent.cyan : colors.text.secondary,
                    }}>
                      {u.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {/* Waypoint route display — shown when movement order has waypoints */}
        {movementOrder?.waypoints?.length > 0 && (
          <div style={{
            display: "flex", alignItems: "center", gap: space[2],
            padding: `${space[1]}px ${space[2]}px`, marginBottom: space[2],
            background: `${colors.accent.cyan}10`, border: `1px solid ${colors.accent.cyan}30`,
            borderRadius: radius.md, fontSize: typography.body.xs,
          }}>
            <span style={{ color: colors.accent.cyan, fontWeight: typography.weight.semibold }}>
              Route:
            </span>
            <span style={{ color: colors.text.secondary, flex: 1 }}>
              {positionToLabel(unit.position)}
              {movementOrder.waypoints.map((wp, i) => (
                <span key={i}> → {positionToLabel(wp)}</span>
              ))}
              {movementOrder.target && <span> → {positionToLabel(movementOrder.target)}</span>}
            </span>
            <button
              onClick={() => {
                setMovementOrder(prev => prev ? { ...prev, waypoints: undefined } : prev);
                if (onClearWaypoints) onClearWaypoints();
                onOrderPreview?.({ movementOrder: movementOrder ? { ...movementOrder, waypoints: undefined } : null, actionOrder });
              }}
              style={{
                padding: `1px ${space[1]}px`, fontSize: 10, fontFamily: typography.fontFamily,
                border: `1px solid ${colors.border.subtle}`, borderRadius: radius.sm,
                background: colors.bg.input, color: colors.text.muted, cursor: "pointer",
              }}
            >
              Clear route
            </button>
          </div>
        )}

        {/* Commander Intent textarea */}
        <div style={{ marginBottom: space[3] }}>
          <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[1], letterSpacing: 0.5, textTransform: "uppercase" }}>
            Commander Intent / Additional Orders
          </div>
          <textarea
            value={intent}
            onChange={e => setIntent(e.target.value)}
            placeholder="Conditional orders, coordination notes, approach details, risk tolerance..."
            style={{
              width: "100%", padding: space[2], background: colors.bg.input,
              border: `1px solid ${colors.border.subtle}`, borderRadius: radius.md,
              color: colors.text.primary, fontSize: typography.body.sm,
              minHeight: 70, fontFamily: typography.fontFamily, resize: "vertical",
              boxSizing: "border-box", outline: "none",
            }}
          />
        </div>

        {/* Confirm / Cancel */}
        <div style={{ display: "flex", gap: space[2], justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={onClose} size="sm">Cancel</Button>
          <Button onClick={handleConfirm} size="sm">Confirm Order</Button>
        </div>
      </div>
    </div>
  );
}

// Small stat cell for the grid
function StatCell({ label, value, color }) {
  return (
    <div>
      <div style={{ color: colors.text.muted, fontSize: 9, letterSpacing: 0.5, textTransform: "uppercase" }}>{label}</div>
      <div style={{ color: color || colors.text.primary, fontFamily: typography.monoFamily, fontWeight: typography.weight.semibold }}>{value}</div>
    </div>
  );
}

// Air unit stats grid — shows readiness, fuel, munitions, sorties, base, strength
// Fields shown depend on scale tier (see schemas.js getUnitFieldsForScale)
function AirStatsGrid({ unit, tier }) {
  const readiness = unit.readiness ?? 100;
  const fuel = unit.fuel;       // undefined for transient aircraft (tier 4+)
  const munitions = unit.munitions;
  const sorties = unit.sorties;
  const baseHex = unit.baseHex;
  const speed = unit.airProfile?.speed || "medium";

  // Bingo status for persistent aircraft with fuel tracking
  const bingo = fuel !== undefined ? checkBingoStatus(unit) : null;

  const readinessColor = readiness > 60 ? colors.accent.green
    : readiness > 30 ? colors.accent.amber : colors.accent.red;
  const fuelColor = bingo?.atBingo ? colors.accent.red
    : bingo?.warning ? colors.accent.amber : colors.accent.green;

  return (
    <div style={{ marginBottom: space[3] }}>
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: `${space[1]}px ${space[2]}px`,
        padding: space[2], background: colors.bg.input, borderRadius: radius.md,
        fontSize: typography.body.xs,
      }}>
        <StatCell label="Strength" value={`${unit.strength}%`}
          color={unit.strength > 50 ? colors.accent.green : unit.strength > 25 ? colors.accent.amber : colors.accent.red} />
        <StatCell label="Readiness" value={`${readiness}%`} color={readinessColor} />
        <StatCell label="Speed" value={speed} color={colors.accent.cyan} />

        {/* Fuel — only for persistent aircraft (tier 3 helicopters) */}
        {fuel !== undefined ? (
          <StatCell label="Fuel" value={`${fuel}%`} color={fuelColor} />
        ) : (
          <StatCell label="Status" value={unit.status || "ready"} color={unit.status === "ready" ? colors.accent.green : colors.text.muted} />
        )}

        {/* Munitions — tiers 3-4 */}
        {munitions !== undefined ? (
          <StatCell label="Munitions" value={`${munitions}%`}
            color={munitions > 50 ? colors.accent.green : munitions > 20 ? colors.accent.amber : colors.accent.red} />
        ) : (
          <StatCell label="Morale" value={`${unit.morale ?? "—"}%`}
            color={(unit.morale ?? 100) > 50 ? colors.accent.green : colors.accent.amber} />
        )}

        {/* Sorties — tier 4+ */}
        {sorties !== undefined ? (
          <StatCell label="Sorties" value={`${sorties}`}
            color={sorties > 0 ? colors.accent.cyan : colors.accent.red} />
        ) : (
          <StatCell label="Supply" value={`${unit.supply ?? "—"}%`}
            color={(unit.supply ?? 100) > 50 ? colors.accent.green : colors.accent.amber} />
        )}
      </div>

      {/* Base hex label */}
      {baseHex && (
        <div style={{
          fontSize: typography.body.xs, color: colors.text.muted,
          padding: `2px ${space[2]}px`, fontStyle: "italic",
        }}>
          Based at {positionToLabel(baseHex)}
        </div>
      )}

      {/* Bingo fuel warning */}
      {bingo?.atBingo && (
        <div style={{
          fontSize: typography.body.xs, color: colors.accent.red,
          padding: `${space[1]}px ${space[2]}px`, marginTop: space[1],
          background: `${colors.accent.red}10`, border: `1px solid ${colors.accent.red}30`,
          borderRadius: radius.sm, fontWeight: typography.weight.semibold,
        }}>
          BINGO FUEL — Must RTB next turn
        </div>
      )}
      {bingo?.warning && !bingo.atBingo && (
        <div style={{
          fontSize: typography.body.xs, color: colors.accent.amber,
          padding: `${space[1]}px ${space[2]}px`, marginTop: space[1],
          background: `${colors.accent.amber}10`, border: `1px solid ${colors.accent.amber}30`,
          borderRadius: radius.sm,
        }}>
          Low fuel — 1 turn of operations remaining
        </div>
      )}
    </div>
  );
}
