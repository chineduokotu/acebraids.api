import mongoose from 'mongoose';
import { Order } from '../models/Order.js';
import { stripeIsLive } from '../config/stripe.js';
import { deductOrderStock, withInventoryTransaction } from './inventoryService.js';
import { sendPaymentApprovedEmail } from './emailService.js';
import { logger } from '../utils/logger.js';

export const STRIPE_CHECKOUT_EVENTS = new Set([
  'checkout.session.completed', 'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed', 'checkout.session.expired',
]);

const rejectEvent = (status, code) => Object.assign(new Error('Stripe payment could not be matched to the order.'), { status, code });

export const applyStripeCheckoutEvent = async (event) => {
  if (!STRIPE_CHECKOUT_EVENTS.has(event.type)) return { ignored: true };
  const session = event.data?.object;
  const orderId = session?.metadata?.orderId;
  if (typeof event.id !== 'string' || typeof orderId !== 'string' || !mongoose.isObjectIdOrHexString(orderId)) {
    throw rejectEvent(400, 'INVALID_ORDER_REFERENCE');
  }
  if (session.object !== 'checkout.session' || session.mode !== 'payment' || typeof session.id !== 'string') {
    throw rejectEvent(400, 'INVALID_SESSION');
  }
  const order = await Order.findById(orderId);
  if (!order) throw rejectEvent(404, 'ORDER_NOT_FOUND');
  if (order.paymentMethod !== 'stripe') throw rejectEvent(400, 'ORDER_SESSION_MISMATCH');
  if (!order.stripeCheckoutSessionId) throw rejectEvent(503, 'SESSION_LINK_NOT_SAVED');
  if (order.stripeCheckoutSessionId !== session.id ||
      (session.client_reference_id && session.client_reference_id !== String(order._id))) {
    throw rejectEvent(400, 'ORDER_SESSION_MISMATCH');
  }
  if (typeof event.livemode !== 'boolean' || event.livemode !== stripeIsLive() ||
      event.livemode !== order.stripeLivemode || session.livemode !== event.livemode) {
    throw rejectEvent(400, 'PAYMENT_MODE_MISMATCH');
  }
  if (!Number.isSafeInteger(session.amount_total) || session.amount_total <= 0 ||
      session.amount_total !== order.stripeExpectedAmountMinor || session.amount_total !== Math.round(order.total * 100) ||
      session.currency !== order.stripeCurrency || session.currency !== order.currency.toLowerCase()) {
    throw rejectEvent(400, 'PAYMENT_AMOUNT_CURRENCY_MISMATCH');
  }
  const filter = {
    _id: order._id, paymentMethod: 'stripe', stripeCheckoutSessionId: session.id,
    stripeExpectedAmountMinor: session.amount_total, stripeCurrency: session.currency,
    total: order.total, currency: order.currency, paymentStatus: { $ne: 'paid' },
  };
  const confirmsPayment = ['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type) && session.payment_status === 'paid';
  if (confirmsPayment) {
    const now = new Date();
    // The durable notification is part of the same MongoDB document/write as
    // the payment. Delivery/reconnection never determines whether payment commits.
    const notification = {
      createdAt: now, eventId: event.id, orderReference: order.trackingCode || order.paymentRef,
      customer: { name: `${order.guestInfo.firstName} ${order.guestInfo.lastName}`.trim(), email: order.guestInfo.email },
      items: order.items.map((item) => ({ name: item.name, qty: item.qty, price: item.price, variant: item.variant?.toObject?.() || item.variant })),
      amount: order.total, amountMinor: session.amount_total, currency: order.currency.toUpperCase(),
      paymentStatus: 'paid', paymentMethod: 'stripe', readBy: [],
    };
    const updated = await withInventoryTransaction(async (transaction) => {
      const updated = await Order.findOneAndUpdate(
        { ...filter, orderStatus: order.orderStatus, adminPaymentNotification: { $exists: false } },
        { $set: {
          paymentStatus: 'paid', stripePaymentState: 'paid', stripeLastEventId: event.id,
          stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id,
          paymentVerifiedAt: now,
          orderStatus: ['pending', 'cancelled'].includes(order.orderStatus) ? 'processing' : order.orderStatus,
          adminPaymentNotification: notification,
        } },
        { new: true, runValidators: true, session: transaction }
      );
      if (!updated) {
        // A concurrent fulfillment edit must not be mistaken for a duplicate:
        // request a retry unless another webhook already committed this payment.
        const committed = await Order.exists({ _id: order._id, paymentStatus: 'paid', 'adminPaymentNotification.createdAt': { $exists: true } }).session(transaction);
        if (!committed) throw rejectEvent(503, 'ORDER_CHANGED_RETRY');
        return false;
      }
      try {
        await deductOrderStock(updated, { reason: 'customer_purchase', session: transaction });
      } catch (stockError) {
        // If stock was depleted between checkout creation and webhook arrival,
        // preserve the payment write and flag for admin fulfillment/restock.
        await Order.updateOne(
          { _id: updated._id },
          { $set: { inventoryState: 'unavailable', inventoryError: stockError.message } },
          { session: transaction }
        );
      }
      return true;
    });
    if (updated && !event.id.startsWith('evt_test_')) {
      sendPaymentApprovedEmail(order).catch((err) => {
        logger.warn('Failed to dispatch payment confirmation email', { error: err?.message, orderId: String(order._id) });
      });
    }
    return { updated: Boolean(updated) };
  }
  if (event.type === 'checkout.session.async_payment_succeeded') throw rejectEvent(400, 'PAYMENT_NOT_CONFIRMED');
  if (session.payment_status !== 'unpaid') throw rejectEvent(400, 'INVALID_PAYMENT_STATUS');
  const state = event.type === 'checkout.session.async_payment_failed' ? 'failed' :
    event.type === 'checkout.session.expired' ? 'expired' : 'processing';
  await Order.findOneAndUpdate(
    { ...filter, paymentStatus: 'pending', stripePaymentState: { $nin: ['paid', 'failed', 'expired', state] } },
    { $set: { stripePaymentState: state, paymentStatus: state === 'processing' ? 'pending' : 'failed', stripeLastEventId: event.id } },
    { runValidators: true }
  );
  return { received: true };
};

// ---------------------------------------------------------------------------
// Stripe charge events: disputes and refunds.
// These flag the order for admin review. No automatic refund is issued.
// ---------------------------------------------------------------------------
export const STRIPE_CHARGE_EVENTS = new Set([
  'charge.dispute.created', 'charge.dispute.closed',
  'charge.refunded',
]);

export const applyStripeChargeEvent = async (event) => {
  if (!STRIPE_CHARGE_EVENTS.has(event.type)) return { ignored: true };
  const charge = event.data?.object;
  const paymentIntentId = charge?.payment_intent;
  if (!paymentIntentId || typeof paymentIntentId !== 'string') return { ignored: true };

  if (event.type === 'charge.dispute.created') {
    const updated = await Order.findOneAndUpdate(
      { stripePaymentIntentId: paymentIntentId },
      { $set: { disputeState: 'open' } },
      { new: true }
    );
    if (updated) {
      logger.warn('Stripe dispute opened', {
        orderId: String(updated._id), trackingCode: updated.trackingCode,
        paymentIntentId, disputeId: charge.id,
      });
    }
    return { flagged: Boolean(updated) };
  }

  if (event.type === 'charge.dispute.closed') {
    const outcome = charge?.outcome?.network_status === 'accepted_by_network' ? 'won' : 'lost';
    const status = charge?.status;
    const disputeState = status === 'succeeded' ? 'won' : 'lost';
    const updated = await Order.findOneAndUpdate(
      { stripePaymentIntentId: paymentIntentId },
      { $set: { disputeState } },
      { new: true }
    );
    if (updated) {
      logger.info('Stripe dispute closed', {
        orderId: String(updated._id), trackingCode: updated.trackingCode,
        paymentIntentId, disputeState,
      });
    }
    return { flagged: Boolean(updated) };
  }

  if (event.type === 'charge.refunded') {
    const isPartial = charge.amount_refunded < charge.amount;
    const refundState = isPartial ? 'partial' : 'refunded';
    const updated = await Order.findOneAndUpdate(
      { stripePaymentIntentId: paymentIntentId },
      { $set: { refundState } },
      { new: true }
    );
    if (updated) {
      logger.info('Stripe refund applied', {
        orderId: String(updated._id), trackingCode: updated.trackingCode,
        paymentIntentId, refundState,
        amountRefunded: charge.amount_refunded, currency: charge.currency,
      });
    }
    return { flagged: Boolean(updated) };
  }

  return { ignored: true };
};
