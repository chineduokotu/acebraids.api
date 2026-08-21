import { Order } from '../models/Order.js';
import { sendOrderStatusUpdateEmail } from '../services/emailService.js';

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

// @desc    Get all orders for admin
// @route   GET /api/orders
// @access  Private/Admin
export const getAdminOrders = async (req, res) => {
  try {
    const { status, limit = 50, page = 1, search } = req.query;

    const query = {};
    if (status && status !== 'all') {
      query.orderStatus = status;
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
        { $match: { paymentStatus: 'mock_paid' } },
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
