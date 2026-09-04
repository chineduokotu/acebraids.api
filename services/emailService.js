/**
 * Email Service (Mock / Extensible)
 * Simulates transactional emails for order confirmations and status updates.
 */

const getRecipient = (order) => order.guestInfo?.email || order.user?.email || 'unknown customer';

export const sendOrderConfirmationEmail = async (order) => {
  console.log(`\n[EMAIL SERVICE] Order confirmation sent to: ${getRecipient(order)}`);
  console.log(`   Order tracking code: ${order.trackingCode}`);
  console.log(`   Total: GBP ${order.total.toFixed(2)} (${order.paymentRef})`);
  console.log(`   Payment status: ${order.paymentStatus}\n`);
  return true;
};

export const sendOrderStatusUpdateEmail = async (order) => {
  console.log(`\n[EMAIL SERVICE] Order status update: Order ${order.trackingCode} is now '${order.orderStatus}'`);
  return true;
};

export const sendPaymentPendingEmail = async (order) => {
  console.log(`\n[EMAIL SERVICE] Bank transfer pending notice sent to: ${getRecipient(order)}`);
  console.log(`   Order ${order.trackingCode} is awaiting payment verification.`);
  console.log(`   Verification deadline: ${order.paymentVerificationDeadline?.toISOString?.() || 'N/A'}\n`);
  return true;
};

export const sendPaymentApprovedEmail = async (order) => {
  console.log(`\n[EMAIL SERVICE] Payment approved notice sent to: ${getRecipient(order)}`);
  console.log(`   Order ${order.trackingCode} payment verified. Fulfillment status: ${order.orderStatus}\n`);
  return true;
};

export const sendPaymentRejectedEmail = async (order) => {
  console.log(`\n[EMAIL SERVICE] Payment rejected notice sent to: ${getRecipient(order)}`);
  console.log(`   Order ${order.trackingCode} payment rejected. Reason: ${order.paymentRejectionReason}\n`);
  return true;
};
