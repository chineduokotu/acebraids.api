import { Order } from '../models/Order.js';
import { deductOrderStock, restoreOrderStock, withInventoryTransaction } from '../services/inventoryService.js';

const invalid = (message, status = 400) => Object.assign(new Error(message), { status });
import {
  sendOrderStatusUpdateEmail,
  sendPaymentApprovedEmail,
  sendPaymentRejectedEmail,
} from '../services/emailService.js';


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
        { $group: { _id: '$currency', totalRevenue: { $sum: '$total' } } }
      ])
    ]);

    const revenueByCurrency = Object.fromEntries(totalRevenueAgg.map((row) => [row._id || 'GBP', row.totalRevenue]));
    // Keep the old field for existing clients, but never mix currencies in it.
    const totalRevenue = revenueByCurrency.GBP || 0;

    res.json({
      orders,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      total,
      totalRevenue,
      revenueByCurrency,
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
    const orders = await Order.find({ paymentMethod: 'bank_transfer', paymentStatus: 'awaiting_verification' }).sort({
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
    const { order, changed } = await withInventoryTransaction(async (session) => {
      const order = await Order.findById(req.params.id).session(session);
      if (!order) throw invalid('Order not found', 404);
      if (order.paymentMethod !== 'bank_transfer') throw invalid('Stripe payments are confirmed automatically and cannot be manually approved.');
      if (order.paymentStatus === 'paid') return { order, changed: false };
      if (order.orderStatus === 'cancelled') throw invalid('Cancelled orders cannot be approved.', 409);
      if (order.paymentStatus !== 'awaiting_verification') throw invalid('Only awaiting verification payments can be approved');
      await deductOrderStock(order, { performedBy: req.user?._id, session });
      order.paymentStatus = 'paid';
      order.orderStatus = 'processing';
      order.paymentVerifiedAt = new Date();
      order.paymentDecisionBy = req.user?._id;
      await order.save({ session });
      return { order, changed: true };
    });
    if (changed) sendPaymentApprovedEmail(order).catch(console.error);
    res.json(order);
  } catch (error) {
    res.status(error.status || 400).json({ message: error.message });
  }
};

// @desc    Reject a bank transfer
// @route   PUT /api/orders/:id/payment/reject
// @access  Private/Admin
export const rejectPayment = async (req, res) => {
  try {
    const order = await withInventoryTransaction(async (session) => {
      const order = await Order.findById(req.params.id).session(session);
      if (!order) throw invalid('Order not found', 404);
      if (order.paymentMethod !== 'bank_transfer') throw invalid('Only bank transfers can be manually rejected.');
      if (order.paymentStatus !== 'awaiting_verification') throw invalid('Only awaiting verification payments can be rejected');
      order.paymentStatus = 'rejected';
      order.orderStatus = 'cancelled';
      order.paymentRejectedAt = new Date();
      order.paymentDecisionBy = req.user?._id;
      order.paymentRejectionReason = req.body?.reason || 'Payment could not be verified. Please contact support.';
      return order.save({ session });
    });
    sendPaymentRejectedEmail(order).catch(console.error);
    res.json(order);
  } catch (error) {
    res.status(error.status || 400).json({ message: error.message });
  }
};

// @desc    Update order status
// @route   PUT /api/orders/:id/status
// @access  Private/Admin
export const updateOrderStatus = async (req, res) => {
  try {
    const { order, previousOrderStatus } = await withInventoryTransaction(async (session) => {
      const order = await Order.findById(req.params.id).session(session);
      if (!order) throw invalid('Order not found', 404);
      const { orderStatus, carrier, trackingCode, notes } = req.body;
      const previousOrderStatus = order.orderStatus;
      if (orderStatus && !['pending', 'processing', 'shipped', 'delivered', 'cancelled'].includes(orderStatus)) throw invalid('Invalid order status.');
      if (previousOrderStatus === 'cancelled' && orderStatus && orderStatus !== 'cancelled') throw invalid('Cancelled orders cannot be reopened. Create a new order.', 409);
      if (orderStatus === 'cancelled') {
        await restoreOrderStock(order, { performedBy: req.user?._id, session });
      } else if (['processing', 'shipped', 'delivered'].includes(orderStatus) && order.inventoryState === 'unavailable') {
        // An admin can retry fulfillment after restocking a paid Stripe order.
        await deductOrderStock(order, { performedBy: req.user?._id, session });
      }
      if (orderStatus) order.orderStatus = orderStatus;
      if (carrier) order.carrier = carrier;
      if (trackingCode) order.trackingCode = trackingCode;
      if (notes !== undefined) order.notes = notes;
      await order.save({ session });
      return { order, previousOrderStatus };
    });
    if (previousOrderStatus !== 'shipped' && order.orderStatus === 'shipped') sendOrderStatusUpdateEmail(order).catch(console.error);
    res.json(order);
  } catch (error) {
    res.status(error.status || 400).json({ message: error.message });
  }
};
