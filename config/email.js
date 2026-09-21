import nodemailer from 'nodemailer';

let transporter;

export const getSmtpOptions = (env = process.env) => {
  const user = env.EMAIL_HOST_USER?.trim();
  // Google displays App Passwords in groups separated by spaces.
  const pass = env.EMAIL_HOST_PASSWORD?.replace(/\s/g, '');
  if (!user || !pass) {
    throw Object.assign(new Error('SMTP credentials are missing'), { code: 'EMAIL_CONFIG' });
  }

  const port = Number(env.EMAIL_PORT?.trim() || 587);
  if (![587, 465].includes(port)) {
    throw Object.assign(new Error('EMAIL_PORT must be 587 or 465'), { code: 'EMAIL_CONFIG' });
  }

  return {
    host: env.EMAIL_HOST?.trim() || 'smtp.gmail.com',
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: { user, pass },
    tls: { rejectUnauthorized: true },
    dnsTimeout: 10000,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
};

export const resetEmailTransport = () => {
  transporter = null;
};

// Lazy initialization ensures dotenv has loaded before credentials are read.
export const getEmailTransport = () => {
  if (!transporter) transporter = nodemailer.createTransport(getSmtpOptions());
  return transporter;
};
