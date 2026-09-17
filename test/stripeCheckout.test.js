import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStripeCheckoutSessionPayload } from '../controllers/paymentController.js';

test('buildStripeCheckoutSessionPayload creates Stripe-ready checkout data', () => {
  const orderDraft = {
    currency: 'GBP',
    items: [
      { name: 'Boho Braid', qty: 1, price: 50 },
      { name: 'Crown Bundle', qty: 2, price: 25 },
    ],
    guestInfo: {
      firstName: 'Jane',
      email: 'jane@example.com',
      shippingAddress: {
        street: '1 Main Street',
        city: 'London',
        postalCode: 'SW1A 1AA',
        country: 'United Kingdom',
      },
    },
  };

  const payload = buildStripeCheckoutSessionPayload(orderDraft, 'http://localhost:5173');

  assert.equal(payload.line_items.length, 1);
  assert.equal(payload.line_items[0].price_data.currency, 'gbp');
  assert.equal(payload.line_items[0].price_data.unit_amount, 10000);
  assert.match(payload.success_url, /http:\/\/localhost:5173/);
  assert.match(payload.cancel_url, /http:\/\/localhost:5173\/checkout/);
  assert.equal(payload.customer_email, 'jane@example.com');
});
