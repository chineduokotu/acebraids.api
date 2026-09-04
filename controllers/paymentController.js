import { Order } from '../models/Order.js';
import { sendOrderConfirmationEmail, sendPaymentPendingEmail } from '../services/emailService.js';

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

    const { subtotal, shippingFee, total } = calculateOrderTotals(orderDraft);
    const currency = orderDraft.currency || 'GBP';
    const trackingCode = generateTrackingCode();
    const paymentRef = createPaymentReference();

    const order = new Order({
      user: req.user?._id || undefined,
      guestInfo: orderDraft.guestInfo,
      items: orderDraft.items,
      subtotal,
      shippingFee,
      total,
      currency,
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
    res.status(500).json({ message: error.message });
  }
};

export const confirmBankTransfer = async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId);

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
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
