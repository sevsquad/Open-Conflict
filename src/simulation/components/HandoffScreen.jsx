// ═══════════════════════════════════════════════════════════════
// HANDOFF SCREEN — Full-screen interstitial shown between actor
// turns in hotseat mode. Prevents the next player from seeing
// the previous player's orders or adjudication.
// ═══════════════════════════════════════════════════════════════

import { colors, typography, space, radius } from "../../theme.js";
import { Button } from "../../components/ui.jsx";

/**
 * @param {Object} props
 * @param {string} props.actorName - name of the actor who goes next
 * @param {string} props.actorColor - actor's faction color (optional)
 * @param {string} props.phaseName - what the actor is about to do ("submit orders" | "review adjudication" | etc.)
 * @param {number} props.turnNumber - current turn
 * @param {function} props.onReady - called when the player clicks Ready
 */
export default function HandoffScreen({ actorName, actorColor, phaseName, turnNumber, onReady }) {
  return (
    <div style={{
      position: "fixed",
      inset: 0,
      zIndex: 9999,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      background: colors.bg.base,
      color: colors.text.primary,
      fontFamily: typography.fontFamily,
    }}>
      {/* Minimal info — just enough to know whose turn it is */}
      <div style={{
        textAlign: "center",
        maxWidth: 400,
      }}>
        <div style={{
          fontSize: typography.body.xs,
          color: colors.text.muted,
          textTransform: "uppercase",
          letterSpacing: 2,
          marginBottom: space[2],
        }}>
          Turn {turnNumber}
        </div>

        <div style={{
          fontSize: typography.heading.xl,
          fontWeight: typography.weight.bold,
          color: actorColor || colors.text.primary,
          marginBottom: space[3],
        }}>
          {actorName}
        </div>

        <div style={{
          fontSize: typography.body.md,
          color: colors.text.secondary,
          marginBottom: space[8],
        }}>
          {phaseName}
        </div>

        <Button
          variant="primary"
          onClick={onReady}
          style={{
            padding: `${space[3]}px ${space[8]}px`,
            fontSize: typography.body.lg,
            borderRadius: radius.lg,
          }}
        >
          Ready
        </Button>

        <div style={{
          marginTop: space[6],
          fontSize: typography.body.xs,
          color: colors.text.muted,
        }}>
          Pass the device to this player before pressing Ready
        </div>
      </div>
    </div>
  );
}
