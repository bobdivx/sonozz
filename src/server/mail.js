/**
 * Envoi SMTP (Scaleway TEM ou compatible).
 */
import nodemailer from "nodemailer";

export function getMailConfig() {
  const meta = import.meta.env || {};
  const proc = typeof process !== "undefined" ? process.env || {} : {};
  const host = String(meta.SMTP_HOST || proc.SMTP_HOST || "").trim();
  const port = Number(meta.SMTP_PORT || proc.SMTP_PORT || 587);
  const user = String(meta.SMTP_USER || proc.SMTP_USER || "").trim();
  const pass = String(meta.SMTP_PASS || proc.SMTP_PASS || "");
  const from = String(meta.SMTP_FROM || proc.SMTP_FROM || "").trim();
  return { host, port, user, pass, from };
}

export function isMailConfigured() {
  const { host, user, pass, from } = getMailConfig();
  return Boolean(host && user && pass && from);
}

export function getAppUrl(request) {
  const meta = import.meta.env || {};
  const proc = typeof process !== "undefined" ? process.env || {} : {};
  const configured = String(meta.APP_URL || proc.APP_URL || "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  try {
    if (request?.url) {
      const u = new URL(request.url);
      return `${u.protocol}//${u.host}`;
    }
  } catch {
    /* ignore */
  }
  return "http://localhost:4321";
}

let transporter;

function getTransporter() {
  const cfg = getMailConfig();
  if (!cfg.host || !cfg.user || !cfg.pass) {
    throw new Error("SMTP non configuré (SMTP_HOST, SMTP_USER, SMTP_PASS)");
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port || 587,
      secure: cfg.port === 465 || cfg.port === 2465,
      auth: { user: cfg.user, pass: cfg.pass },
    });
  }
  return transporter;
}

export async function sendMail({ to, subject, text, html }) {
  if (!isMailConfigured()) {
    throw new Error("SMTP non configuré (SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM)");
  }
  const cfg = getMailConfig();
  const transport = getTransporter();
  const info = await transport.sendMail({
    from: cfg.from,
    to,
    subject,
    text,
    html: html || undefined,
  });
  return { messageId: info.messageId };
}

export async function sendInviteEmail({ to, inviteUrl, invitedBy }) {
  const subject = "Invitation — rejoindre le studio SONOZZ";
  const who = invitedBy ? ` (${invitedBy})` : "";
  const text = [
    `Tu es invité·e à rejoindre le studio SONOZZ${who}.`,
    "",
    "Clique sur ce lien pour définir ton mot de passe et accéder au studio :",
    inviteUrl,
    "",
    "Ce lien expire dans 7 jours.",
    "",
    "Si tu n’attendais pas cet email, ignore-le.",
  ].join("\n");

  const html = `
    <p>Tu es invité·e à rejoindre le studio <strong>SONOZZ</strong>${who ? ` par ${invitedBy}` : ""}.</p>
    <p><a href="${inviteUrl}">Définir mon mot de passe et rejoindre</a></p>
    <p style="color:#666;font-size:13px">Ce lien expire dans 7 jours. Si tu n’attendais pas cet email, ignore-le.</p>
  `;

  return sendMail({ to, subject, text, html });
}
