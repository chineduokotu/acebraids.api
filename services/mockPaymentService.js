import { v4 as uuidv4 } from 'uuid';

/**
 * MOCK PAYMENT SERVICE
 * -------------------------------------------------------------
 * Simulates a payment gateway (e.g., Stripe, PayPal, Klarna).
 * This service is isolated so that switching to a real provider in the future
 * only requires swapping this service file and the frontend Payment Element.
 * -------------------------------------------------------------
 */

export const processMockPayment = async ({ amount, currency = 'GBP', cardDetails }) => {
  // Simulate network latency like a real gateway (1.2 seconds)
  await new Promise((resolve) => setTimeout(resolve, 1200));

  const alwaysSucceed = process.env.MOCK_PAYMENT_ALWAYS_SUCCEED === 'true';

  // Basic mock card number checks
  const cleanCardNumber = (cardDetails?.cardNumber || '').replace(/\s+/g, '');
  
  // Specific test triggers for testing failure flows
  if (cleanCardNumber.endsWith('0000')) {
    return {
      success: false,
      error: 'Card declined: Insufficient funds (Mock Test Card)',
      code: 'insufficient_funds',
    };
  }

  if (cleanCardNumber.endsWith('9999')) {
    return {
      success: false,
      error: 'Card declined: Security code or expiry verification failed (Mock Test Card)',
      code: 'card_verification_failed',
    };
  }

  // If not forced to always succeed, 95% success rate, 5% random decline
  if (!alwaysSucceed && Math.random() < 0.05) {
    return {
      success: false,
      error: 'Your card was declined by the issuer (Mock simulation). Please try another payment method.',
      code: 'card_declined',
    };
  }

  // Successful payment simulation
  const paymentRef = `MOCK-${uuidv4().toUpperCase().substring(0, 16)}`;

  return {
    success: true,
    paymentRef,
    amount,
    currency,
    paidAt: new Date().toISOString(),
    cardBrand: getCardBrand(cleanCardNumber),
    last4: cleanCardNumber ? cleanCardNumber.slice(-4) : '4242',
  };
};

function getCardBrand(number) {
  if (number.startsWith('4')) return 'Visa';
  if (number.startsWith('5')) return 'Mastercard';
  if (number.startsWith('3')) return 'Amex';
  return 'Credit Card';
}
