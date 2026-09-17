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

export const getCheckoutOrigin = (requestOrigin) => {
  const origins = (process.env.CLIENT_URL || 'http://localhost:5173').split(',').map((value) => {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid checkout origin.');
    return url.origin;
  });
  if (requestOrigin && !origins.includes(requestOrigin)) {
    throw Object.assign(new Error('This origin is not allowed to start checkout.'), { status: 403 });
  }
  return requestOrigin || origins[0];
};
