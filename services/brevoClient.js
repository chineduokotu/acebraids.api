/**
 * Brevo (Sendinblue) Transactional Email Client
 * Uses the Brevo HTTPS REST API (Port 443).
 * Operates over standard HTTPS — completely immune to cloud SMTP port blocking.
 */

export const isBrevoConfigured = (env = process.env) => {
  return Boolean(env.BREVO_API_KEY && env.BREVO_API_KEY.trim());
};

export const formatBrevoRecipients = (recipients) => {
  if (!recipients) return [];
  const list = Array.isArray(recipients) ? recipients : [recipients];
  const formatted = [];
  for (const item of list) {
    if (!item) continue;
    if (typeof item === 'string') {
      const email = item.trim();
      if (email) formatted.push({ email });
    } else if (typeof item === 'object') {
      const email = (item.address || item.email)?.trim();
      if (email) {
        formatted.push(item.name ? { email, name: item.name } : { email });
      }
    }
  }
  return formatted;
};

export const sendViaBrevoApi = async (mailOptions, meta = {}, env = process.env) => {
  const apiKey = env.BREVO_API_KEY?.trim();
  if (!apiKey) {
    throw Object.assign(new Error('BREVO_API_KEY is not configured'), { code: 'BREVO_NOT_CONFIGURED' });
  }

  const senderEmail = (
    env.BREVO_SENDER_EMAIL ||
    (typeof mailOptions.from === 'object' ? mailOptions.from?.address : mailOptions.from) ||
    env.GOOGLE_SMTP_USER ||
    env.EMAIL_HOST_USER ||
    'comagtech2@gmail.com'
  ).trim();

  const senderName = (
    env.BREVO_SENDER_NAME ||
    (typeof mailOptions.from === 'object' ? mailOptions.from?.name : null) ||
    'AceBeautyBraids'
  ).trim();

  const to = formatBrevoRecipients(mailOptions.to);
  if (!to.length) {
    throw Object.assign(new Error('No valid recipients for Brevo dispatch'), { code: 'EMAIL_RECIPIENT' });
  }

  const bcc = formatBrevoRecipients(mailOptions.bcc);

  let replyTo;
  if (mailOptions.replyTo) {
    const replyEmail = (typeof mailOptions.replyTo === 'object' ? mailOptions.replyTo.address : mailOptions.replyTo)?.trim();
    if (replyEmail) {
      replyTo = { email: replyEmail };
    }
  }

  const payload = {
    sender: { name: senderName, email: senderEmail },
    to,
    subject: mailOptions.subject || 'Notification from AceBeautyBraids',
    htmlContent: mailOptions.html || `<p>${mailOptions.text || ''}</p>`,
    textContent: mailOptions.text || undefined,
  };

  if (bcc.length) payload.bcc = bcc;
  if (replyTo) payload.replyTo = replyTo;
  if (mailOptions.headers && typeof mailOptions.headers === 'object') {
    payload.headers = { ...mailOptions.headers };
  }

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'api-key': apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message || `Brevo API rejected request with status ${response.status}`);
    error.code = body.code || `BREVO_HTTP_${response.status}`;
    error.status = response.status;
    throw error;
  }

  return {
    accepted: to.map((r) => r.email),
    messageId: body.messageId || `brevo-${Date.now()}`,
    provider: 'brevo',
  };
};
