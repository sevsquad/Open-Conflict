// ═══════════════════════════════════════════════════════════════
// EMAIL — Notification service for PBEM game events.
// Uses nodemailer for SMTP. Falls back to console.log if not configured.
//
// Environment variables:
//   SMTP_HOST     - SMTP server hostname (e.g., smtp.gmail.com)
//   SMTP_PORT     - SMTP port (default: 587)
//   SMTP_USER     - SMTP username/email
//   SMTP_PASS     - SMTP password or app password
//   EMAIL_FROM    - From address (default: SMTP_USER)
//   APP_URL       - Base URL for links in emails (default: http://localhost:5173)
//
// If SMTP_HOST is not set, emails are logged to console instead of sent.
// This lets the alpha run without email infrastructure.
// ═══════════════════════════════════════════════════════════════

let transporter = null;

/**
 * Initialize the email transporter. Call once at server startup.
 * If SMTP is not configured, returns false (console-only mode).
 */
export async function initEmail() {
  if (!process.env.SMTP_HOST) {
    console.log("[Email] SMTP not configured — notifications will be logged to console only");
    return false;
  }

  // Lazy-load nodemailer only when SMTP is configured
  try {
    const nodemailer = await import("nodemailer");
    transporter = nodemailer.default.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10) || 587,
      secure: (process.env.SMTP_PORT === "465"),
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    console.log(`[Email] SMTP configured: ${process.env.SMTP_HOST}`);
    return true;
  } catch (e) {
    console.warn("[Email] Failed to initialize SMTP:", e.message);
    return false;
  }
}

/**
 * Send an email. Falls back to console.log if SMTP is not configured.
 */
async function sendMail({ to, subject, text, html }) {
  const from = process.env.EMAIL_FROM || process.env.SMTP_USER || "noreply@open-conflict.local";

  if (!transporter) {
    // Console-only mode — log the email for debugging
    console.log(`[Email] TO: ${to} | SUBJECT: ${subject}`);
    console.log(`[Email] BODY: ${text}`);
    return { accepted: [to], messageId: "console-only" };
  }

  try {
    const result = await transporter.sendMail({ from, to, subject, text, html });
    return result;
  } catch (e) {
    console.error(`[Email] Failed to send to ${to}:`, e.message);
    return null;
  }
}

// ── Notification Templates ───────────────────────────────────

const APP_URL = () => process.env.APP_URL || "http://localhost:5173";

/**
 * Notify a player that it's their turn to submit orders.
 */
export async function notifyYourTurn({ email, actorName, gameName, turn, deadlineHours }) {
  if (!email) return;
  const deadline = deadlineHours ? `You have ${deadlineHours} hours to submit.` : "";

  await sendMail({
    to: email,
    subject: `[Open Conflict] Your turn — ${gameName} (Turn ${turn})`,
    text: [
      `Commander ${actorName},`,
      "",
      `It's your turn to issue orders in "${gameName}" (Turn ${turn}).`,
      deadline,
      "",
      `Submit your orders at: ${APP_URL()}`,
      "",
      "— Open Conflict",
    ].join("\n"),
  });
}

/**
 * Notify a player that all orders are in and adjudication is complete.
 */
export async function notifyTurnResults({ email, actorName, gameName, turn }) {
  if (!email) return;

  await sendMail({
    to: email,
    subject: `[Open Conflict] Turn ${turn} results — ${gameName}`,
    text: [
      `Commander ${actorName},`,
      "",
      `Turn ${turn} of "${gameName}" has been adjudicated.`,
      "Review the results and accept or challenge the assessment.",
      "",
      `View results at: ${APP_URL()}`,
      "",
      "— Open Conflict",
    ].join("\n"),
  });
}

/**
 * Notify a player they've been invited to a game.
 */
export async function notifyInvite({ email, actorName, gameName, inviteToken }) {
  if (!email) return;

  await sendMail({
    to: email,
    subject: `[Open Conflict] You've been invited to "${gameName}"`,
    text: [
      `Commander ${actorName},`,
      "",
      `You've been invited to play in "${gameName}".`,
      "",
      `Join the game with this invite token: ${inviteToken}`,
      "",
      `Or join directly at: ${APP_URL()}/join?token=${inviteToken}`,
      "",
      "— Open Conflict",
    ].join("\n"),
  });
}

/**
 * Notify the moderator that all orders are submitted (ready to process).
 */
export async function notifyAllOrdersIn({ email, gameName, turn }) {
  if (!email) return;

  await sendMail({
    to: email,
    subject: `[Open Conflict] All orders submitted — ${gameName} (Turn ${turn})`,
    text: [
      `All players have submitted orders for Turn ${turn} of "${gameName}".`,
      "",
      "The turn is ready for processing.",
      "",
      `Manage game at: ${APP_URL()}`,
      "",
      "— Open Conflict",
    ].join("\n"),
  });
}

/**
 * Notify a player that someone challenged the adjudication.
 */
export async function notifyChallengeRaised({ email, actorName, gameName, turn }) {
  if (!email) return;

  await sendMail({
    to: email,
    subject: `[Open Conflict] Challenge raised — ${gameName} (Turn ${turn})`,
    text: [
      `Commander ${actorName},`,
      "",
      `A challenge has been raised against the Turn ${turn} adjudication in "${gameName}".`,
      "You may submit a counter-rebuttal.",
      "",
      `View details at: ${APP_URL()}`,
      "",
      "— Open Conflict",
    ].join("\n"),
  });
}
