import { Order } from '../models/Order.js';
import { Product } from '../models/Product.js';
import {
  sendOrderStatusUpdateEmail,
  sendPaymentApprovedEmail,
  sendPaymentRejectedEmail,
} from '../services/emailService.js';

const decrementApprovedOrderStock = async (order) => {
  for (const item of order.items || []) {
    if (!item.product) continue;

    try {
      const prod = await Product.findById(item.product);
      if (!prod?.variants?.length) continue;

      const vIndex = prod.variants.findIndex(v =>
        (!item.variant?.color || v.color === item.variant.color) &&
        (!item.variant?.length || v.length === item.variant.length)
      );

      if (vIndex !== -1 && prod.variants[vIndex].stock > 0) {
        prod.variants[vIndex].stock = Math.max(0, prod.variants[vIndex].stock - item.qty);
        await prod.save();
      }
    } catch (stockErr) {
      console.warn('Stock update skipped:', stockErr.message);
    }
  }
};

// @desc    Get order by ID
// @route   GET /api/orders/:id
// @access  Public
export const getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    res.json(order);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Track order by tracking code or order ID
// @route   GET /api/orders/track/:code
// @access  Public
export const getOrderByTrackingCode = async (req, res) => {
  try {
    const code = req.params.code.trim();

    let order = await Order.findOne({ trackingCode: { $regex: new RegExp(`^${code}$`, 'i') } });

    // Fallback: search by ID if 24 hex chars
    if (!order && code.match(/^[0-9a-fA-F]{24}$/)) {
      order = await Order.findById(code);
    }

    if (!order) {
      return res.status(404).json({ message: 'No order found with this tracking number or ID' });
    }

    res.json(order);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get public payment status for polling
// @route   GET /api/orders/:id/payment-status
// @access  Public
export const getOrderPaymentStatus = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).select(
      'trackingCode paymentStatus orderStatus paymentMethod paymentRef paymentSubmittedAt paymentVerificationDeadline paymentVerifiedAt paymentRejectedAt paymentRejectionReason total currency guestInfo.email createdAt'
    );

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    res.json({
      _id: order._id,
      trackingCode: order.trackingCode,
      paymentStatus: order.paymentStatus,
      orderStatus: order.orderStatus,
      paymentMethod: order.paymentMethod,
      paymentRef: order.paymentRef,
      paymentSubmittedAt: order.paymentSubmittedAt,
      paymentVerificationDeadline: order.paymentVerificationDeadline,
      paymentVerifiedAt: order.paymentVerifiedAt,
      paymentRejectedAt: order.paymentRejectedAt,
      paymentRejectionReason: order.paymentRejectionReason,
      total: order.total,
      currency: order.currency,
      email: order.guestInfo?.email,
      createdAt: order.createdAt,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get all orders for admin
// @route   GET /api/orders
// @access  Private/Admin
export const getAdminOrders = async (req, res) => {
  try {
    const { status, paymentStatus, limit = 50, page = 1, search } = req.query;

    const query = {};
    if (status && status !== 'all') {
      const fulfillmentStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
      const paymentStatuses = ['awaiting_verification', 'paid', 'rejected', 'failed'];
      if (fulfillmentStatuses.includes(status)) {
        query.orderStatus = status;
      } else if (paymentStatuses.includes(status)) {
        query.paymentStatus = status;
      }
    }

    if (paymentStatus && paymentStatus !== 'all') {
      query.paymentStatus = paymentStatus;
    }

    if (search) {
      query.$or = [
        { trackingCode: { $regex: search, $options: 'i' } },
        { 'guestInfo.email': { $regex: search, $options: 'i' } },
        { 'guestInfo.firstName': { $regex: search, $options: 'i' } },
        { 'guestInfo.lastName': { $regex: search, $options: 'i' } },
        { paymentRef: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [orders, total, totalRevenueAgg] = await Promise.all([
      Order.find(query).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      Order.countDocuments(query),
      Order.aggregate([
        { $match: { paymentStatus: { $in: ['paid', 'mock_paid'] } } },
        { $group: { _id: null, totalRevenue: { $sum: '$total' } } }
      ])
    ]);

    const totalRevenue = totalRevenueAgg[0]?.totalRevenue || 0;

    res.json({
      orders,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      total,
      totalRevenue,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get orders awaiting bank transfer verification
// @route   GET /api/orders/admin/pending-transfers
// @access  Private/Admin
export const getPendingTransfers = async (req, res) => {
  try {
    const orders = await Order.find({ paymentStatus: 'awaiting_verification' }).sort({
      paymentSubmittedAt: 1,
      createdAt: 1,
    });

    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Approve a bank transfer as paid
// @route   PUT /api/orders/:id/payment/approve
// @access  Private/Admin
export const approvePayment = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (order.paymentStatus === 'paid') {
      return res.json(order);
    }

    if (order.paymentStatus !== 'awaiting_verification') {
      return res.status(400).json({ message: 'Only awaiting verification payments can be approved' });
    }

    order.paymentStatus = 'paid';
    order.orderStatus = 'processing';
    order.paymentVerifiedAt = new Date();
    order.paymentDecisionBy = req.user?._id;

    const updatedOrder = await order.save();
    await decrementApprovedOrderStock(updatedOrder);
    sendPaymentApprovedEmail(updatedOrder).catch(console.error);

    res.json(updatedOrder);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Reject a bank transfer
// @route   PUT /api/orders/:id/payment/reject
// @access  Private/Admin
export const rejectPayment = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (order.paymentStatus !== 'awaiting_verification') {
      return res.status(400).json({ message: 'Only awaiting verification payments can be rejected' });
    }

    order.paymentStatus = 'rejected';
    order.orderStatus = 'cancelled';
    order.paymentRejectedAt = new Date();
    order.paymentDecisionBy = req.user?._id;
    order.paymentRejectionReason = req.body?.reason || 'Payment could not be verified. Please contact support.';

    const updatedOrder = await order.save();
    sendPaymentRejectedEmail(updatedOrder).catch(console.error);

    res.json(updatedOrder);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update order status
// @route   PUT /api/orders/:id/status
// @access  Private/Admin
export const updateOrderStatus = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const { orderStatus, carrier, trackingCode, notes } = req.body;

    if (orderStatus) order.orderStatus = orderStatus;
    if (carrier) order.carrier = carrier;
    if (trackingCode) order.trackingCode = trackingCode;
    if (notes !== undefined) order.notes = notes;

    const updatedOrder = await order.save();

    // Trigger update email
    sendOrderStatusUpdateEmail(updatedOrder).catch(console.error);

    res.json(updatedOrder);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};
