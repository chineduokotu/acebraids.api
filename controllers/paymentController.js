import { processMockPayment } from '../services/mockPaymentService.js';
import { Order } from '../models/Order.js';
import { Product } from '../models/Product.js';
import { sendOrderConfirmationEmail } from '../services/emailService.js';

// Generate clean tracking code: ABB-UK-XXXXX
const generateTrackingCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = 'ABB-UK-';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// @desc    Process Mock Checkout & Create Order
// @route   POST /api/payments/mock-checkout
// @access  Public
export const mockCheckout = async (req, res) => {
  try {
    const { orderDraft, cardDetails } = req.body;

    if (!orderDraft || !orderDraft.items || orderDraft.items.length === 0) {
      return res.status(400).json({ message: 'Cart items are required to process checkout' });
    }

    if (!orderDraft.guestInfo?.firstName || !orderDraft.guestInfo?.email || !orderDraft.guestInfo?.shippingAddress?.street) {
      return res.status(400).json({ message: 'Valid shipping contact and address are required' });
    }

    const subtotal = orderDraft.items.reduce((acc, item) => acc + (Number(item.price) * Number(item.qty)), 0);
    // Free shipping over £80 in UK, £5.99 otherwise
    const shippingFee = orderDraft.shippingFee !== undefined ? Number(orderDraft.shippingFee) : (subtotal >= 80 ? 0 : 5.99);
    const total = Number((subtotal + shippingFee).toFixed(2));
    const currency = orderDraft.currency || 'GBP';

    // 1. Process simulated payment
    const paymentResult = await processMockPayment({
      amount: total,
      currency,
      cardDetails,
    });

    if (!paymentResult.success) {
      return res.status(402).json({
        message: paymentResult.error || 'Payment failed (mock simulation)',
        code: paymentResult.code || 'card_declined',
      });
    }

    // 2. On payment success, persist Order in database
    const trackingCode = generateTrackingCode();

    const order = new Order({
      user: req.user?._id || undefined,
      guestInfo: orderDraft.guestInfo,
      items: orderDraft.items,
      subtotal,
      shippingFee,
      total,
      currency,
      paymentStatus: 'mock_paid',
      paymentMethod: 'mock_card',
      paymentRef: paymentResult.paymentRef,
      orderStatus: 'processing',
      trackingCode,
      carrier: orderDraft.guestInfo.shippingAddress.country === 'Germany' ? 'DHL Express Germany' : 'Royal Mail 24 Tracked',
      notes: orderDraft.notes || '',
    });

    const savedOrder = await order.save();

    // 3. Decrement stock for purchased variants
    for (const item of orderDraft.items) {
      if (item.product) {
        try {
          const prod = await Product.findById(item.product);
          if (prod && prod.variants && prod.variants.length > 0) {
            const vIndex = prod.variants.findIndex(v => 
              (!item.variant?.color || v.color === item.variant.color) &&
              (!item.variant?.length || v.length === item.variant.length)
            );
            if (vIndex !== -1 && prod.variants[vIndex].stock > 0) {
              prod.variants[vIndex].stock = Math.max(0, prod.variants[vIndex].stock - item.qty);
              await prod.save();
            }
          }
        } catch (stockErr) {
          console.warn('Stock update skipped:', stockErr.message);
        }
      }
    }

    // 4. Send asynchronous mock email confirmation
    sendOrderConfirmationEmail(savedOrder).catch(console.error);

    res.status(201).json({
      success: true,
      message: 'Payment completed successfully (Mock Gateway)',
      order: savedOrder,
      paymentResult,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
