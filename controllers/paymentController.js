import { Order } from '../models/Order.js';
import { sendOrderConfirmationEmail, sendPaymentPendingEmail } from '../services/emailService.js';
import { getCheckoutOrigin, getStripe, stripeIsLive } from '../config/stripe.js';
import { priceStripeOrder } from '../services/stripeOrderPricing.js';
import { applyStripeCheckoutEvent, STRIPE_CHECKOUT_EVENTS, applyStripeChargeEvent, STRIPE_CHARGE_EVENTS } from '../services/stripeWebhook.js';
import { logger } from '../utils/logger.js';

const generateTrackingCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = 'ABB-UK-';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

const getBankTransferDetails = () => ({
  bankName: process.env.BANK_NAME || 'AceBeautyBraids Business Bank',
  accountName: process.env.BANK_ACCOUNT_NAME || 'AceBeautyBraids',
  accountNumber: process.env.BANK_ACCOUNT_NUMBER || '00000000',
  sortCode: process.env.BANK_SORT_CODE || '00-00-00',
  iban: process.env.BANK_IBAN || '',
  bic: process.env.BANK_BIC || '',
  currency: 'GBP',
});

const getVerificationWindowMinutes = () => {
  const configured = Number(process.env.BANK_TRANSFER_WINDOW_MINUTES);
  return Number.isFinite(configured) && configured > 0 ? configured : 30;
};

const createPaymentReference = () => (
  `ABB-${Date.now().toString().slice(-6)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
);

const calculateOrderTotals = (orderDraft) => {
  const subtotal = orderDraft.items.reduce((acc, item) => acc + (Number(item.price) * Number(item.qty)), 0);
  const shippingFee = orderDraft.shippingFee !== undefined ? Number(orderDraft.shippingFee) : (subtotal >= 80 ? 0 : 5.99);
  const total = Number((subtotal + shippingFee).toFixed(2));
  return { subtotal, shippingFee, total };
};

const validateOrderDraft = (orderDraft) => {
  if (!orderDraft || !orderDraft.items || orderDraft.items.length === 0) {
    return 'Cart items are required to process checkout';
  }

  if (!orderDraft.guestInfo?.firstName || !orderDraft.guestInfo?.email || !orderDraft.guestInfo?.shippingAddress?.street) {
    return 'Valid shipping contact and address are required';
  }

  return null;
};

export const buildStripeCheckoutSessionPayload = (orderDraft, clientBaseUrl = process.env.CLIENT_URL || 'http://localhost:5173') => {
  const validationError = validateOrderDraft(orderDraft);

  if (validationError) {
    throw new Error(validationError);
  }

  const { total } = calculateOrderTotals(orderDraft);
  const currency = String(orderDraft.currency || 'GBP').toLowerCase();
  const normalizedBaseUrl = String(clientBaseUrl || 'http://localhost:5173').replace(/\/$/, '');
  const description = orderDraft.items.map(item => `${item.name}${item.qty > 1 ? ` x${item.qty}` : ''}`).join(', ');

  return {
    // Card-only remains the default. Dynamic methods must be deliberately
    // enabled; delayed methods are handled by the webhook state machine.
    ...(process.env.STRIPE_DYNAMIC_PAYMENT_METHODS === 'true' ? {} : { payment_method_types: ['card'] }),
    mode: 'payment',
    customer_email: orderDraft.guestInfo?.email || undefined,
    line_items: [{
      price_data: {
        currency,
        unit_amount: Math.round(total * 100),
        product_data: {
          name: 'AceBeautyBraids order',
          description: description.slice(0, 200),
        },
      },
      quantity: 1,
    }],
    success_url: `${normalizedBaseUrl}/order-confirmation?checkout=success`,
    cancel_url: `${normalizedBaseUrl}/checkout?payment=cancelled`,
    metadata: {
      customerEmail: orderDraft.guestInfo?.email || '',
      customerName: `${orderDraft.guestInfo?.firstName || ''} ${orderDraft.guestInfo?.lastName || ''}`.trim(),
    },
  };
};

export const getBankDetails = async (req, res) => {
  res.json({
    bankDetails: getBankTransferDetails(),
    verificationWindowMinutes: getVerificationWindowMinutes(),
  });
};

export const createBankTransferOrder = async (req, res) => {
  try {
    const { orderDraft } = req.body;
    const validationError = validateOrderDraft(orderDraft);

    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    // Both checkout methods validate current inventory and persist the exact
    // catalogue variant, prices and quantities used by later fulfillment.
    const pricedOrder = await priceStripeOrder(orderDraft);
    const trackingCode = generateTrackingCode();
    const paymentRef = createPaymentReference();

    const order = new Order({
      user: req.user?._id || undefined,
      ...pricedOrder,
      paymentStatus: 'pending',
      paymentMethod: 'bank_transfer',
      paymentRef,
      orderStatus: 'pending',
      trackingCode,
      carrier: orderDraft.guestInfo.shippingAddress.country === 'Germany' ? 'DHL Express Germany' : 'Royal Mail 24 Tracked',
      notes: orderDraft.notes || '',
      customerPaymentNote: orderDraft.customerPaymentNote || '',
    });

    const savedOrder = await order.save();
    sendOrderConfirmationEmail(savedOrder).catch(console.error);

    res.status(201).json({
      success: true,
      order: savedOrder,
      bankDetails: getBankTransferDetails(),
      verificationWindowMinutes: getVerificationWindowMinutes(),
    });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message });
  }
};

export const createStripeCheckoutSession = async (req, res) => {
  try {
    const stripe = getStripe();
    if (!process.env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_')) {
      return res.status(503).json({ message: 'Stripe checkout is temporarily unavailable.' });
    }

    const { orderDraft } = req.body;
    const pricedOrder = await priceStripeOrder(orderDraft);
    const clientBaseUrl = getCheckoutOrigin(req.get('Origin'));
    const trackingCode = generateTrackingCode();
    const paymentRef = createPaymentReference();

    const order = new Order({
      ...pricedOrder,
      user: req.user?._id || undefined,
      paymentStatus: 'pending',
      paymentMethod: 'stripe',
      stripeCurrency: pricedOrder.currency.toLowerCase(),
      stripeLivemode: stripeIsLive(),
      stripePaymentState: 'pending',
      paymentRef,
      orderStatus: 'pending',
      trackingCode,
      carrier: orderDraft.guestInfo.shippingAddress.country === 'Germany' ? 'DHL Express Germany' : 'Royal Mail 24 Tracked',
      notes: typeof orderDraft.notes === 'string' ? orderDraft.notes.slice(0, 2000) : '',
    });

    const savedOrder = await order.save();
    const sessionPayload = buildStripeCheckoutSessionPayload(pricedOrder, clientBaseUrl);
    sessionPayload.client_reference_id = String(savedOrder._id);
    sessionPayload.success_url = `${clientBaseUrl}/order-confirmation/${savedOrder._id}?checkout=success`;
    sessionPayload.cancel_url = `${clientBaseUrl}/checkout?payment=cancelled`;
    sessionPayload.metadata = {
      ...sessionPayload.metadata,
      orderId: String(savedOrder._id),
    };

    const session = await stripe.checkout.sessions.create({
      ...sessionPayload,
      billing_address_collection: 'required',
      shipping_address_collection: {
        allowed_countries: ['GB', 'DE'],
      },
      invoice_creation: {
        enabled: false,
      },
      mode: 'payment',
      allow_promotion_codes: false,
    }, { idempotencyKey: `checkout-order-${savedOrder._id}` });

    // Persist the provider linkage before releasing the hosted checkout URL.
    savedOrder.stripeCheckoutSessionId = session.id;
    await savedOrder.save();

    sendOrderConfirmationEmail(savedOrder).catch(console.error);

    res.status(201).json({
      success: true,
      order: savedOrder,
      sessionId: session.id,
      checkoutUrl: session.url,
    });
  } catch (error) {
    res.status(error.status || 503).json({ message: error.status ? error.message : 'Unable to start Stripe checkout. Please try again.' });
  }
};

export const handleStripeWebhook = async (req, res) => {
  let event;
  let stripe;
  try {
    stripe = getStripe();
  } catch {
    return res.status(503).json({ message: 'Stripe webhook is not configured.' });
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret?.startsWith('whsec_')) return res.status(503).json({ message: 'Stripe webhook is not configured.' });
  const signature = req.get('stripe-signature');
  if (!signature || !Buffer.isBuffer(req.body)) return res.status(400).json({ message: 'Invalid Stripe signature or payload.' });
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, secret);
  } catch {
    // SDK errors can contain request/signature details. Never echo or log them.
    return res.status(400).json({ message: 'Invalid Stripe signature or payload.' });
  }
  try {
    if (STRIPE_CHECKOUT_EVENTS.has(event.type)) {
      await applyStripeCheckoutEvent(event);
    } else if (STRIPE_CHARGE_EVENTS.has(event.type)) {
      await applyStripeChargeEvent(event);
    }
    return res.json({ received: true });
  } catch (error) {
    logger.warn('Stripe webhook processing incomplete', {
      eventId: typeof event.id === 'string' ? event.id : undefined,
      code: error.code && typeof error.code === 'string' && error.status ? error.code : 'PERSISTENCE_FAILURE',
    });
    return res.status(error.status || 500).json({ message: 'Stripe event could not be processed.' });
  }
};

export const confirmBankTransfer = async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId);

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (order.paymentMethod !== 'bank_transfer') {
      return res.status(400).json({ message: 'Only bank transfers can be reported for manual verification.' });
    }

    if (!['pending', 'awaiting_verification'].includes(order.paymentStatus)) {
      return res.status(400).json({ message: `Payment is already ${order.paymentStatus}` });
    }

    const windowMinutes = getVerificationWindowMinutes();
    order.paymentStatus = 'awaiting_verification';
    order.orderStatus = 'pending';
    order.paymentSubmittedAt = order.paymentSubmittedAt || new Date();
    order.paymentVerificationDeadline = new Date(Date.now() + windowMinutes * 60 * 1000);

    if (req.body?.customerPaymentNote !== undefined) {
      order.customerPaymentNote = req.body.customerPaymentNote;
    }

    const updatedOrder = await order.save();
    sendPaymentPendingEmail(updatedOrder).catch(console.error);

    res.json({
      success: true,
      order: updatedOrder,
      verificationWindowMinutes: windowMinutes,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
