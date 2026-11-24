const nodemailer = require('nodemailer');
const { readEmailConfig } = require('./emailConfig');

let transporter = null;
let signature = null;

/* Built from the install's SETTINGS, falling back to the environment - see
 * functions/emailConfig for which wins and why.
 *
 * Cached against a signature of the settings rather than just "is it built",
 * because an admin can now change the mail server from Configuration > Email
 * and would otherwise keep sending through the old one until the container was
 * restarted. The password is part of the signature: changing only the password
 * is the commonest edit there is. */
const signatureOf = (c) => [c.host, c.port, c.secure, c.user, c.pass].join('|');

async function getTransporter() {
  const cfg = await readEmailConfig();

  if (!cfg.host || !cfg.user || !cfg.pass) {
    throw new Error(
      'Email is not configured. Set it in Configuration > Email, or supply '
      + 'SMTP_HOST / SMTP_USER / SMTP_PASS in the backend environment.'
    );
  }

  const sig = signatureOf(cfg);
  if (!transporter || signature !== sig) {
    transporter = nodemailer.createTransport({
      host: cfg.host,
      port: Number(cfg.port) || 587,
      secure: Boolean(cfg.secure), // true for port 465, false for 587/STARTTLS
      auth: { user: cfg.user, pass: cfg.pass },
    });
    signature = sig;
  }
  return transporter;
}

/** Drop the cached transport - used after the settings are saved. */
function resetTransporter() {
  transporter = null;
  signature = null;
}

// `fromEmail` is the individual employee's own address; the actual SMTP
// authentication always happens as SMTP_USER (the shared relay account).
// Whether the mail server accepts a From address that differs from the
// authenticated account depends on how the domain admin has configured it.
async function sendMail({ fromName, fromEmail, to, cc, bcc, subject, html, attachments }) {
  const t = await getTransporter();
  return t.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to,
    cc: cc && cc.length ? cc : undefined,
    bcc: bcc && bcc.length ? bcc : undefined,
    subject,
    html,
    attachments,
  });
}

module.exports = { sendMail, getTransporter, resetTransporter };
