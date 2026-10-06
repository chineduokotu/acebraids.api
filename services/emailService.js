import mongoose from 'mongoose';
import { getEmailTransport } from '../config/email.js';
import { isBrevoConfigured, sendViaBrevoApi } from './brevoClient.js';
import { renderOrderEmail, renderAdminNewOrderEmail } from './orderEmailTemplates.js';
import { Order } from '../models/Order.js';

const NON_RETRYABLE_CODES = new Set([
  'EMAIL_RECIPIENT',
  'TEMPLATE_RENDER_FAILED',
]);

const isFallbackEligible = (error) => {
  if (!error) return false;
  if (NON_RETRYABLE_CODES.has(error.code)) return false;
  if (typeof error.message === 'string' && /invalid recipient|syntax error/i.test(error.message)) {
    return false;
  }
  return true;
};

export const sendEmailWithFallback = async (mailOptions, meta = {}) => {
  const { event = 'unknown', orderId = '' } = meta;
  let googleError = null;

  // 1. Primary Provider: Google SMTP
  try {
    const transport = getEmailTransport();
    const result = await transport.sendMail(mailOptions);
    if (!result.accepted?.length) {
      throw Object.assign(new Error('SMTP did not accept the recipient'), { code: 'EMAIL_REJECTED' });
    }
    console.info('[EMAIL SERVICE] Primary provider (Google SMTP) accepted', {
      event,
      orderId,
      provider: 'google',
      messageId: result.messageId,
    });
    return { success: true, provider: 'google', messageId: result.messageId };
  } catch (err) {
    googleError = err;
    console.warn('[EMAIL SERVICE] Primary provider (Google SMTP) failed', {
      event,
      orderId,
      code: err.code || 'EMAIL_FAILED',
    });
  }

  // 2. Permanent error validation
  if (!isFallbackEligible(googleError)) {
    return { success: false, provider: 'none', code: googleError?.code || 'EMAIL_FAILED' };
  }

  // 3. Fallback configuration check
  if (!isBrevoConfigured()) {
    return { success: false, provider: 'google', code: googleError?.code || 'EMAIL_FAILED' };
  }

  // 4. Fallback Provider: Brevo REST API
  try {
    console.info('[EMAIL SERVICE] Triggering fallback delivery via Brevo...', {
      event,
      orderId,
      primaryFailure: googleError.code || 'SMTP_FAILED',
    });
    const brevoResult = await sendViaBrevoApi(mailOptions, meta);
    console.info('[EMAIL SERVICE] Fallback provider (Brevo) delivered successfully', {
      event,
      orderId,
      provider: 'brevo',
      messageId: brevoResult.messageId,
    });
    return { success: true, provider: 'brevo', messageId: brevoResult.messageId };
  } catch (brevoErr) {
    console.warn('[EMAIL SERVICE] Both primary and fallback providers failed', {
      event,
      orderId,
      primaryCode: googleError.code || 'EMAIL_FAILED',
      fallbackCode: brevoErr.code || 'BREVO_FAILED',
    });
    return { success: false, provider: 'none', code: brevoErr.code || 'EMAIL_FAILED' };
  }
};

const resolveClientUrl = () => {
  const envUrl = process.env.CLIENT_URL;
  if (!envUrl) return 'https://acebraids.vercel.app';
  const urls = envUrl.split(',').map((s) => s.trim()).filter(Boolean);
  const httpsUrl = urls.find((u) => u.startsWith('https://'));
  return httpsUrl || urls[0] || 'https://acebraids.vercel.app';
};

// Customer order updates (confirmation, pending transfer, approved payment, shipment) use SMTP with Brevo fallback.
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
          const sender = (process.env.BREVO_SENDER_EMAIL || process.env.GOOGLE_SMTP_USER || process.env.EMAIL_HOST_USER || 'comagtech2@gmail.com').trim();
          const adminRecipients = getAdminNotificationRecipients();
          const bccList = [];
          if (event === 'payment-approved') {
            for (const admin of adminRecipients) {
              if (admin && admin.toLowerCase() !== recipient.trim().toLowerCase()) {
                bccList.push(admin);
              }
            }
          }

          const clientUrl = resolveClientUrl();
          const message = renderOrderEmail(event, snapshot, clientUrl, sender);
          const mailOptions = {
            from: { name: 'AceBeautyBraids', address: sender },
            replyTo: sender,
            to: { address: recipient.trim() },
            headers: {
              'X-Entity-Ref-ID': `${orderId}-${event}`,
            },
            ...message,
          };
          if (bccList.length) {
            mailOptions.bcc = bccList;
          }

          const delivery = await sendEmailWithFallback(mailOptions, { event, orderId });
          if (!delivery.success) {
            throw Object.assign(new Error('All email delivery attempts failed'), { code: delivery.code || 'EMAIL_FAILED' });
          }
          console.info('[EMAIL SERVICE] Notification delivered', { event, orderId, provider: delivery.provider, notifiedAdmin: bccList.length > 0 });
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

export const sendOrderConfirmationEmail = async (order) => {
  if (!order) return false;

  // Stripe orders are confirmed upon payment completion via sendPaymentApprovedEmail.
  // Do not send an unconfirmed order email while the customer is only initiating checkout.
  if (order.paymentMethod === 'stripe' && order.paymentStatus !== 'paid') {
    return false;
  }

  const orderId = String(order._id || '');
  if (orderId && mongoose.connection?.readyState === 1) {
    const lock = await Order.findOneAndUpdate(
      { _id: orderId, customerConfirmationEmailSentAt: { $exists: false } },
      { $set: { customerConfirmationEmailSentAt: new Date() } }
    ).catch(() => null);

    if (!lock && !order.isNew) {
      return false;
    }
  }

  return dispatchOrderEmail('order-confirmation', order);
};

export const sendOrderStatusUpdateEmail = async (order) => {
  if (order.orderStatus !== 'shipped') return false;
  return dispatchOrderEmail('shipped', order);
};

export const sendPaymentPendingEmail = async (order) => {
  if (!order) return false;

  const orderId = String(order._id || '');
  if (orderId && mongoose.connection?.readyState === 1) {
    const lock = await Order.findOneAndUpdate(
      { _id: orderId, customerPendingEmailSentAt: { $exists: false } },
      { $set: { customerPendingEmailSentAt: new Date() } }
    ).catch(() => null);

    if (!lock && !order.isNew) {
      return false;
    }
  }

  return dispatchOrderEmail('bank-transfer-pending', order);
};

export const sendPaymentApprovedEmail = async (order) => {
  if (!order) return false;

  const orderId = String(order._id || '');
  if (orderId && mongoose.connection?.readyState === 1) {
    const lock = await Order.findOneAndUpdate(
      { _id: orderId, customerPaymentApprovedEmailSentAt: { $exists: false } },
      { $set: { customerPaymentApprovedEmailSentAt: new Date() } }
    ).catch(() => null);

    if (!lock && !order.isNew) {
      return false;
    }
  }

  return dispatchOrderEmail('payment-approved', order);
};

export const sendPaymentRejectedEmail = async (order) => {
  if (!order) return false;

  const orderId = String(order._id || '');
  if (orderId && mongoose.connection?.readyState === 1) {
    const lock = await Order.findOneAndUpdate(
      { _id: orderId, customerPaymentRejectedEmailSentAt: { $exists: false } },
      { $set: { customerPaymentRejectedEmailSentAt: new Date() } }
    ).catch(() => null);

    if (!lock && !order.isNew) {
      return false;
    }
  }

  return dispatchOrderEmail('payment-rejected', order);
};

export const getAdminNotificationRecipients = () => {
  // If ADMIN_ORDER_EMAIL is configured, prioritize it for order notifications.
  // Otherwise fall back to ADMIN_NOTIFICATION_EMAIL. Supports comma-separated emails.
  const raw = (process.env.ADMIN_ORDER_EMAIL || process.env.ADMIN_NOTIFICATION_EMAIL || '').trim();

  const emails = raw
    .split(',')
    .map((s) => s.trim())
    .filter((email) => /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(email));

  const unique = [...new Set(emails)];
  if (unique.length > 0) return unique;

  const fallback = 'comag923@gmail.com';
  return [fallback];
};

export const sendAdminNewOrderEmail = async (order) => {
  const orderId = String(order?._id || '');
  try {
    const adminRecipients = getAdminNotificationRecipients();
    if (!adminRecipients.length) {
      console.warn('[EMAIL SERVICE] Admin order notification skipped: no valid admin email configured');
      return false;
    }

    const sender = (process.env.BREVO_SENDER_EMAIL || process.env.GOOGLE_SMTP_USER || process.env.EMAIL_HOST_USER || adminRecipients[0]).trim();

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
      to: adminRecipients.length === 1 ? { address: adminRecipients[0] } : adminRecipients.map((addr) => ({ address: addr })),
      headers: {
        'X-Priority': '1',
        'Priority': 'urgent',
        'Importance': 'high',
        'Auto-Submitted': 'auto-generated',
        'X-Entity-Ref-ID': `${orderId}-admin-order`,
      },
      ...message,
    };

    const delivery = await sendEmailWithFallback(mailOptions, { event: 'admin-new-order', orderId });
    if (!delivery.success) {
      return false;
    }
    console.info('[EMAIL SERVICE] Admin new order email delivered', {
      orderId,
      provider: delivery.provider,
      messageId: delivery.messageId,
      recipients: adminRecipients,
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

    const sent = await sendAdminNewOrderEmail(order);
    if (!sent) {
      // Release lock on dispatch failure so retries can succeed
      await Order.updateOne(
        { _id: orderId, adminOrderNotificationSentAt: { $exists: true } },
        { $unset: { adminOrderNotificationSentAt: 1 } }
      ).catch(() => null);
      return false;
    }
    return true;
  } catch (error) {
    console.warn('[EMAIL SERVICE] Could not process admin order notification', {
      orderId: String(orderId),
      error: error.message,
    });
    return false;
  }
};
