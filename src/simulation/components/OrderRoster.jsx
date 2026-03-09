import { colors, typography, radius, animation, space } from "../../theme.js";
import { Button, Badge, SectionHeader } from "../../components/ui.jsx";
import { positionToLabel } from "../prompts.js";
import { isAirUnit } from "../orderTypes.js";

// ═══════════════════════════════════════════════════════════════
// ORDER ROSTER — Sidebar showing all units grouped by actor
// with order status. Replaces the old textarea planning section.
// Each unit row is clickable to open the UnitOrderCard.
// ═══════════════════════════════════════════════════════════════

// Build a short summary of a unit's orders like "MOVE E4 + ATTACK D5"
function orderSummary(orders) {
  if (!orders) return "HOLD";
  const parts = [];
  if (orders.movementOrder) {
    const target = orders.movementOrder.target ? ` ${positionToLabel(orders.movementOrder.target)}` : "";
    const wpCount = orders.movementOrder.waypoints?.length || 0;
    const wpTag = wpCount > 0 ? ` (${wpCount}wp)` : "";
    parts.push(orders.movementOrder.id + target + wpTag);
  }
  if (orders.actionOrder) {
    const target = orders.actionOrder.target ? ` ${positionToLabel(orders.actionOrder.target)}` : "";
    const subtype = orders.actionOrder.subtype ? ` (${orders.actionOrder.subtype})` : "";
    const alt = orders.actionOrder.altitude ? ` @${orders.actionOrder.altitude}` : "";
    parts.push(orders.actionOrder.id + target + subtype + alt);
  }
  return parts.length > 0 ? parts.join(" + ") : "HOLD";
}

function hasExplicitOrders(orders) {
  if (!orders) return false;
  return !!(orders.movementOrder || orders.actionOrder);
}

export default function OrderRoster({
  units,
  actors,
  unitOrders,          // { actorId: { unitId: { movementOrder, actionOrder, intent } } }
  actorIntents,        // { actorId: "intent text" }
  onUnitClick,         // (unit) => void — open UnitOrderCard
  onActorIntentChange, // (actorId, text) => void
  onSubmit,            // () => void
  submitting,          // boolean
  disabled,            // boolean
  turnNumber,
  activeActorId,       // optional: when set, only show this actor's units (FOW/privacy mode)
  submitLabel,         // optional: custom label for submit button (default: "Submit All Orders")
}) {
  // Filter to active actor if specified (hotseat privacy)
  const visibleActors = activeActorId
    ? actors.filter(a => a.id === activeActorId)
    : actors;
  const visibleUnits = activeActorId
    ? units.filter(u => u.actor === activeActorId)
    : units;

  // Count units with explicit orders vs HOLD
  const totalUnits = visibleUnits.length;
  const orderedUnits = visibleUnits.filter(u => {
    const actorOrders = unitOrders[u.actor];
    return actorOrders && hasExplicitOrders(actorOrders[u.id]);
  }).length;
  const holdCount = totalUnits - orderedUnits;

  return (
    <div style={{ marginBottom: space[4] }}>
      <SectionHeader>Turn {turnNumber} — Unit Orders</SectionHeader>

      {visibleActors.map(actor => {
        const actorUnits = visibleUnits.filter(u => u.actor === actor.id);
        if (actorUnits.length === 0) return null;

        return (
          <div key={actor.id} style={{ marginBottom: space[3] }}>
            {/* Actor header + intent */}
            <div style={{ marginBottom: space[2] }}>
              <div style={{
                fontSize: typography.body.sm, fontWeight: typography.weight.bold,
                color: colors.text.primary, marginBottom: space[1],
              }}>
                {actor.name}
                <span style={{ fontWeight: typography.weight.normal, color: colors.text.muted, marginLeft: space[2], fontSize: typography.body.xs }}>
                  {actor.objectives?.join("; ") || ""}
                </span>
              </div>
              <textarea
                value={actorIntents[actor.id] || ""}
                onChange={e => onActorIntentChange(actor.id, e.target.value)}
                placeholder={`${actor.name} commander's intent for this turn...`}
                disabled={disabled}
                style={{
                  width: "100%", padding: `${space[1] + 2}px ${space[2]}px`,
                  background: colors.bg.input, border: `1px solid ${colors.border.subtle}`,
                  borderRadius: radius.sm, color: colors.text.primary,
                  fontSize: typography.body.sm, minHeight: 36, fontFamily: typography.fontFamily,
                  resize: "vertical", boxSizing: "border-box", outline: "none",
                }}
              />
            </div>

            {/* Unit rows */}
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {actorUnits.map(unit => {
                const orders = unitOrders[actor.id]?.[unit.id];
                const hasOrders = hasExplicitOrders(orders);
                const hasIntent = !!(orders?.intent);
                const summary = orderSummary(orders);
                const isDestroyed = unit.status === "destroyed" || unit.status === "eliminated";

                return (
                  <div
                    key={unit.id}
                    onClick={() => !isDestroyed && !disabled && onUnitClick(unit)}
                    style={{
                      display: "flex", alignItems: "center", gap: space[2],
                      padding: `${space[1]}px ${space[2]}px`,
                      background: colors.bg.input, borderRadius: radius.sm,
                      cursor: isDestroyed || disabled ? "default" : "pointer",
                      border: `1px solid ${hasOrders ? colors.accent.amber + "30" : colors.border.subtle}`,
                      opacity: isDestroyed ? 0.4 : 1,
                      transition: `all ${animation.fast}`,
                    }}
                    onMouseEnter={e => {
                      if (!isDestroyed && !disabled) e.currentTarget.style.background = colors.bg.surface;
                    }}
                    onMouseLeave={e => { e.currentTarget.style.background = colors.bg.input; }}
                  >
                    {/* Order status indicator */}
                    <span style={{
                      fontSize: 11, width: 14, textAlign: "center",
                      color: hasOrders ? colors.accent.green : colors.text.muted,
                    }}>
                      {hasOrders ? "\u2713" : "\u00B7"}
                    </span>
                    {/* Intent indicator — small icon when unit has intent text */}
                    {hasIntent && (
                      <span title="Has commander's intent" style={{
                        fontSize: 9, color: colors.accent.blue || colors.text.secondary,
                        marginLeft: -4,
                      }}>
                        \u270E
                      </span>
                    )}

                    {/* Unit name + type */}
                    <div style={{ flex: "0 0 auto", minWidth: 120, overflow: "hidden" }}>
                      <span style={{
                        fontSize: typography.body.sm, fontWeight: typography.weight.semibold,
                        color: colors.text.primary, whiteSpace: "nowrap",
                      }}>
                        {unit.name}
                      </span>
                      <span style={{ fontSize: typography.body.xs, color: colors.text.muted, marginLeft: space[1] }}>
                        ({unit.type})
                      </span>
                    </div>

                    {/* Position */}
                    <span style={{
                      fontSize: typography.body.xs, color: colors.text.secondary,
                      fontFamily: typography.monoFamily, minWidth: 28,
                    }}>
                      {positionToLabel(unit.position)}
                    </span>

                    {/* Strength bar */}
                    <div style={{ width: 40, height: 6, background: colors.bg.base, borderRadius: 3, overflow: "hidden", flexShrink: 0 }}>
                      <div style={{
                        width: `${unit.strength}%`, height: "100%", borderRadius: 3,
                        background: unit.strength > 50 ? colors.accent.green : unit.strength > 25 ? colors.accent.amber : colors.accent.red,
                      }} />
                    </div>

                    {/* Air unit indicators: readiness + sorties */}
                    {isAirUnit(unit) && unit.readiness !== undefined && (
                      <span style={{
                        fontSize: 9, fontFamily: typography.monoFamily,
                        color: unit.readiness > 60 ? colors.accent.green : unit.readiness > 30 ? colors.accent.amber : colors.accent.red,
                        flexShrink: 0,
                      }} title={`Readiness ${unit.readiness}%`}>
                        R{unit.readiness}
                      </span>
                    )}
                    {isAirUnit(unit) && unit.sorties !== undefined && (
                      <span style={{
                        fontSize: 9, fontFamily: typography.monoFamily,
                        color: unit.sorties > 0 ? colors.accent.cyan : colors.accent.red,
                        flexShrink: 0,
                      }} title={`${unit.sorties} sorties available`}>
                        S{unit.sorties}
                      </span>
                    )}

                    {/* Order summary */}
                    <span style={{
                      flex: 1, fontSize: typography.body.xs,
                      color: hasOrders ? colors.accent.amber : colors.text.muted,
                      fontFamily: typography.monoFamily, textAlign: "right",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {summary}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Hold warning */}
      {holdCount > 0 && (
        <div style={{
          fontSize: typography.body.xs, color: colors.accent.amber, marginBottom: space[2],
          padding: `${space[1]}px ${space[2]}px`, background: `${colors.accent.amber}08`,
          border: `1px solid ${colors.accent.amber}20`, borderRadius: radius.sm,
        }}>
          {holdCount} unit{holdCount !== 1 ? "s" : ""} with no orders (HOLD)
        </div>
      )}

      {/* Submit button */}
      <Button onClick={onSubmit} disabled={submitting || disabled} style={{ width: "100%" }}>
        {submitting ? "Adjudicating..." : (submitLabel || "Submit All Orders")}
      </Button>
    </div>
  );
}
