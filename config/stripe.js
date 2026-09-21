import Stripe from 'stripe';

export const stripeIsLive = () => {
  const key = process.env.STRIPE_SECRET_KEY || '';
  if (/^(sk|rk)_test_/.test(key)) return false;
  if (/^(sk|rk)_live_/.test(key)) return true;
  throw new Error('Stripe API key is not configured.');
};

export const getStripe = () => {
  stripeIsLive();
  return new Stripe(process.env.STRIPE_SECRET_KEY);
};

const OFFICIAL_ORIGINS = [
  'https://acebraids.co.uk',
  'https://www.acebraids.co.uk',
  'https://acebeautybraids.com',
  'https://www.acebeautybraids.com',
  'https://acebraids.vercel.app',
  'https://acebraids.chineokotu.workers.dev',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:5000',
];

export const getCheckoutOrigin = (requestOrigin) => {
  const configuredOrigins = (process.env.CLIENT_URL || 'http://localhost:5173').split(',').map((value) => {
    try {
      const url = new URL(value.trim());
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
      return url.origin;
    } catch {
      return null;
    }
  }).filter(Boolean);

  const origins = Array.from(new Set([...configuredOrigins, ...OFFICIAL_ORIGINS]));

  if (requestOrigin) {
    let parsedOrigin = null;
    try {
      const url = new URL(requestOrigin);
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) {
        parsedOrigin = url.origin;
      }
    } catch {
      // Invalid URL
    }

    const isAllowed = parsedOrigin && (
      origins.includes(parsedOrigin) ||
      new URL(parsedOrigin).hostname.endsWith('.workers.dev') ||
      new URL(parsedOrigin).hostname.endsWith('.acebraids.co.uk')
    );

    if (!isAllowed) {
      throw Object.assign(new Error('This origin is not allowed to start checkout.'), { status: 403 });
    }
    return parsedOrigin;
  }

  return origins[0];
};

