import { getEmailTransport } from '../config/email.js';
import { renderOrderEmail, renderAdminNewOrderEmail } from './orderEmailTemplates.js';
import { Order } from '../models/Order.js';

// Payment approval and shipment use SMTP. Other hooks retain their existing behavior.
const dispatchOrderEmail = async (event, order) => {
  const orderId = String(order?._id || '');
  try {
    // Snapshot before yielding, so a later mutation cannot change the notification.
    const snapshot = typeof order.toObject === 'function' ? order.toObject() : structuredClone(order);
    return await new Promise(resolve => {
      setImmediate(async () => {
        try {
          const recipient = snapshot.guestInfo?.email || snapshot.user?.email;
          if (typeof recipient !== 'string' || !/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(recipient.trim())) {
            throw Object.assign(new Error('Missing or invalid recipient'), { code: 'EMAIL_RECIPIENT' });
          }
          const transport = getEmailTransport();
          const sender = process.env.EMAIL_HOST_USER.trim();
          const adminNotificationEmail = (process.env.ADMIN_NOTIFICATION_EMAIL || 'comag923@gmail.com').trim();
          const bccList = [];
          if (event === 'payment-approved' && adminNotificationEmail && adminNotificationEmail.toLowerCase() !== recipient.trim().toLowerCase()) {
            bccList.push(adminNotificationEmail);
          }

          const message = renderOrderEmail(event, snapshot, process.env.CLIENT_URL, sender);
          const mailOptions = {
            from: { name: 'AceBeautyBraids', address: sender },
            replyTo: sender,
            to: { address: recipient.trim() },
            ...message,
          };
          if (bccList.length) {
            mailOptions.bcc = bccList;
          }

          const result = await transport.sendMail(mailOptions);
          if (!result.accepted?.length) {
            throw Object.assign(new Error('SMTP did not accept the recipient'), { code: 'EMAIL_REJECTED' });
          }
          console.info('[EMAIL SERVICE] SMTP accepted', { event, orderId, messageId: result.messageId, notifiedAdmin: bccList.length > 0 });
          resolve(true);
        } catch (error) {
          // Never log SMTP messages, credentials, bodies, or customer addresses.
          console.warn('[EMAIL SERVICE] Notification failed', { event, orderId, code: error.code || 'EMAIL_FAILED' });
          resolve(false);
        }
      });
    });
  } catch (error) {
    console.warn('[EMAIL SERVICE] Notification could not be scheduled', { event, orderId, code: error.code || 'EMAIL_FAILED' });
    return false;
  }
};

const getRecipient = (order) => order.guestInfo?.email || order.user?.email || 'unknown customer';

export const sendOrderConfirmationEmail = async (order) => {
  console.log(`\n[EMAIL SERVICE] Order confirmation sent to: ${getRecipient(order)}`);
  console.log(`   Order tracking code: ${order.trackingCode}`);
  console.log(`   Total: GBP ${order.total.toFixed(2)} (${order.paymentRef})`);
  console.log(`   Payment status: ${order.paymentStatus}\n`);
  return true;
};

export const sendOrderStatusUpdateEmail = async (order) => {
  if (order.orderStatus !== 'shipped') return false;
  return dispatchOrderEmail('shipped', order);
};

export const sendPaymentPendingEmail = async (order) => {
  console.log(`\n[EMAIL SERVICE] Bank transfer pending notice sent to: ${getRecipient(order)}`);
  console.log(`   Order ${order.trackingCode} is awaiting payment verification.`);
  console.log(`   Verification deadline: ${order.paymentVerificationDeadline?.toISOString?.() || 'N/A'}\n`);
  return true;
};

export const sendPaymentApprovedEmail = async (order) => {
  return dispatchOrderEmail('payment-approved', order);
};

export const sendPaymentRejectedEmail = async (order) => {
  console.log(`\n[EMAIL SERVICE] Payment rejected notice sent to: ${getRecipient(order)}`);
  console.log(`   Order ${order.trackingCode} payment rejected. Reason: ${order.paymentRejectionReason}\n`);
  return true;
};

export const sendAdminNewOrderEmail = async (order) => {
  const orderId = String(order?._id || '');
  try {
    const adminEmail = (process.env.ADMIN_ORDER_EMAIL || process.env.ADMIN_NOTIFICATION_EMAIL || '').trim();
    if (!adminEmail || !/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(adminEmail)) {
      console.warn('[EMAIL SERVICE] Admin order notification skipped: no valid admin email configured');
      return false;
    }

    const transport = getEmailTransport();
    const sender = process.env.EMAIL_HOST_USER?.trim() || adminEmail;

    // Resolve client URL for admin order link
    const clientUrl = (
      process.env.ADMIN_BASE_URL ||
      (process.env.CLIENT_URL
        ? process.env.CLIENT_URL.split(',').map((s) => s.trim()).find((u) => u.startsWith('https://')) || process.env.CLIENT_URL.split(',')[0].trim()
        : 'https://acebraids.vercel.app')
    ).replace(/\/+$/, '');

    const snapshot = typeof order.toObject === 'function' ? order.toObject() : structuredClone(order);
    const message = renderAdminNewOrderEmail(snapshot, clientUrl, sender);

    const mailOptions = {
      from: { name: 'AceBeautyBraids', address: sender },
      replyTo: sender,
      to: { address: adminEmail },
      headers: {
        'X-Priority': '1',
        'Priority': 'urgent',
        'Importance': 'high',
        'Auto-Submitted': 'auto-generated',
        'X-Entity-Ref-ID': orderId,
      },
      ...message,
    };

    const result = await transport.sendMail(mailOptions);
    console.info('[EMAIL SERVICE] Admin new order email accepted', {
      orderId,
      messageId: result.messageId,
      recipient: adminEmail,
    });
    return true;
  } catch (error) {
    console.warn('[EMAIL SERVICE] Admin new order notification failed', {
      orderId,
      code: error.code || 'EMAIL_FAILED',
      message: error.message,
    });
    return false;
  }
};

export const notifyAdminNewOrder = async (orderId) => {
  if (!orderId) return false;
  try {
    // Atomic check-and-set: ensure ONLY ONE admin notification is ever dispatched for an order
    const order = await Order.findOneAndUpdate(
      { _id: orderId, adminOrderNotificationSentAt: { $exists: false } },
      { $set: { adminOrderNotificationSentAt: new Date() } },
      { new: true }
    );

    if (!order) {
      // Notification already recorded/sent for this order
      return false;
    }

    return await sendAdminNewOrderEmail(order);
  } catch (error) {
    console.warn('[EMAIL SERVICE] Could not process admin order notification', {
      orderId: String(orderId),
      error: error.message,
    });
    return false;
  }
};
