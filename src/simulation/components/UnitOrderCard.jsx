import { useState, useCallback, useEffect } from "react";
import { colors, typography, radius, shadows, animation, space } from "../../theme.js";
import { Button, Badge } from "../../components/ui.jsx";
import {
  ORDER_TYPES, ORDER_SLOT, getValidOrders, resolveOrderConflict, isCompatible,
  MOVEMENT_BUDGETS, TERRAIN_COSTS, WEAPON_RANGE_KM,
} from "../orderTypes.js";
import { OBSERVER_VISUAL_KM, DEFAULT_OBSERVER_VISUAL_KM } from "../detectionRanges.js";
import { parseUnitPosition } from "../../mapRenderer/overlays/UnitOverlay.js";
import { hexDistance } from "../../mapRenderer/HexMath.js";
import { positionToLabel } from "../prompts.js";

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
  onClose,
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

  // When the map delivers a target hex (parent calls this effect by updating existingOrders)
  // Actually handled via the targeting callback in SimGame — when map clicks, parent updates us
  useEffect(() => {
    // Sync if parent changes existingOrders (e.g., after target selected)
    // Intent is NOT synced here — it's local-only state edited in the textarea.
    // Syncing it would overwrite the user's in-progress edits on every target selection.
    if (existingOrders) {
      setMovementOrder(existingOrders.movementOrder || null);
      setActionOrder(existingOrders.actionOrder || null);
    }
  }, [existingOrders]);

  // Get valid orders for this unit type
  const validOrders = getValidOrders(unit.type);
  const movementOrders = validOrders.filter(
    o => ORDER_TYPES[o.orderId]?.slot === ORDER_SLOT.MOVEMENT
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
    const alreadySelected = (movementOrder?.id === orderId) || (actionOrder?.id === orderId);
    if (alreadySelected && orderDef.requiresTarget) {
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

    // If this order requires a target, enter targeting mode
    if (orderDef.requiresTarget && result.movementOrder === orderId && newMovement && !newMovement.target) {
      onStartTargeting?.(orderId);
    } else if (orderDef.requiresTarget && result.actionOrder === orderId && newAction && !newAction.target) {
      onStartTargeting?.(orderId);
    }
  }, [movementOrder, actionOrder, onStartTargeting]);

  // Called by parent when map targeting completes
  // This is handled by setting existingOrders from parent

  const handleConfirm = useCallback(() => {
    // M1: Strip orders that require a target but don't have one
    const finalMovement = (movementOrder && ORDER_TYPES[movementOrder.id]?.requiresTarget && !movementOrder.target)
      ? null : movementOrder;
    const finalAction = (actionOrder && ORDER_TYPES[actionOrder.id]?.requiresTarget && !actionOrder.target)
      ? null : actionOrder;

    onConfirm({
      movementOrder: finalMovement,
      actionOrder: finalAction ? {
        ...finalAction,
        subtype: finalAction.id === "FIRE_MISSION" ? fireMissionType
          : finalAction.id === "ENGINEER" ? engineerType
          : null,
      } : null,
      intent,
    });
  }, [movementOrder, actionOrder, intent, fireMissionType, engineerType, onConfirm]);

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
            Click a hex on the map
          </div>
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
              {positionToLabel(unit.position)} &middot; {cellData ? (cellData.terrain || "unknown") : "—"}
              {cellData?.elevation !== undefined ? `, ${cellData.elevation}m` : ""}
              {cellData?.features?.length > 0 ? ` (${cellData.features.join(", ")})` : ""}
            </div>
          </div>
          <Badge color={colors.accent.cyan}>{unit.type}</Badge>
          {unit.echelon && <Badge color={colors.text.muted}>{unit.echelon}</Badge>}
        </div>

        {/* Stats Grid */}
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

        {/* Order Buttons */}
        <div style={{ marginBottom: space[3] }}>
          <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[1], letterSpacing: 0.5, textTransform: "uppercase" }}>
            Movement
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: space[1] + 2, marginBottom: space[2] }}>
            {movementOrders.map(o => renderOrderButton(o.orderId, o.capability))}
          </div>

          <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[1], letterSpacing: 0.5, textTransform: "uppercase" }}>
            Action
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: space[1] + 2 }}>
            {actionOrders.map(o => renderOrderButton(o.orderId, o.capability))}
          </div>
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
