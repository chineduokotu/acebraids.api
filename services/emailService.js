/**
 * Email Service (Mock / Extensible)
 * Simulates transactional emails for order confirmations & status updates.
 */

export const sendOrderConfirmationEmail = async (order) => {
  console.log(`\n📧 [EMAIL SERVICE] Order Confirmation Email sent to: ${order.guestInfo?.email || order.user?.email}`);
  console.log(`   Order Tracking Code: ${order.trackingCode}`);
  console.log(`   Total Paid: £${order.total.toFixed(2)} (${order.paymentRef})\n`);
  return true;
};

export const sendOrderStatusUpdateEmail = async (order) => {
  console.log(`\n📧 [EMAIL SERVICE] Order Status Update Email: Order ${order.trackingCode} is now '${order.orderStatus}'`);
  return true;
};
