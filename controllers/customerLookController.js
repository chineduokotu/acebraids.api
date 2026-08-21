import { CustomerLook } from '../models/CustomerLook.js';
import { Product } from '../models/Product.js';

// @desc    Get all active customer looks
// @route   GET /api/customer-looks
// @access  Public
export const getCustomerLooks = async (req, res) => {
  try {
    const looks = await CustomerLook.find({ isActive: true })
      .populate('linkedProduct', 'name slug price discountPrice images')
      .sort({ order: 1, createdAt: -1 });

    res.json(looks);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get all customer looks for admin
// @route   GET /api/customer-looks/admin
// @access  Private/Admin
export const getAdminCustomerLooks = async (req, res) => {
  try {
    const looks = await CustomerLook.find()
      .populate('linkedProduct', 'name slug price images')
      .sort({ order: 1, createdAt: -1 });

    res.json(looks);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create a new customer look
// @route   POST /api/customer-looks
// @access  Private/Admin
export const createCustomerLook = async (req, res) => {
  try {
    const { title, customerName, videoUrl, posterUrl, linkedProduct, order, isActive } = req.body;

    const look = new CustomerLook({
      title: title || 'Glamour Look',
      customerName: customerName || 'Ace Babe',
      videoUrl,
      posterUrl,
      linkedProduct,
      order: order !== undefined ? Number(order) : 0,
      isActive: isActive !== undefined ? Boolean(isActive) : true,
    });

    const createdLook = await look.save();
    const populated = await createdLook.populate('linkedProduct', 'name slug price discountPrice images');

    res.status(201).json(populated);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update a customer look
// @route   PUT /api/customer-looks/:id
// @access  Private/Admin
export const updateCustomerLook = async (req, res) => {
  try {
    const look = await CustomerLook.findById(req.params.id);
    if (!look) {
      return res.status(404).json({ message: 'Customer look not found' });
    }

    const { title, customerName, videoUrl, posterUrl, linkedProduct, order, isActive } = req.body;

    if (title !== undefined) look.title = title;
    if (customerName !== undefined) look.customerName = customerName;
    if (videoUrl !== undefined) look.videoUrl = videoUrl;
    if (posterUrl !== undefined) look.posterUrl = posterUrl;
    if (linkedProduct !== undefined) look.linkedProduct = linkedProduct;
    if (order !== undefined) look.order = Number(order);
    if (isActive !== undefined) look.isActive = Boolean(isActive);

    const updated = await look.save();
    const populated = await updated.populate('linkedProduct', 'name slug price discountPrice images');

    res.json(populated);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Delete a customer look
// @route   DELETE /api/customer-looks/:id
// @access  Private/Admin
export const deleteCustomerLook = async (req, res) => {
  try {
    const look = await CustomerLook.findById(req.params.id);
    if (!look) {
      return res.status(404).json({ message: 'Customer look not found' });
    }

    await look.deleteOne();
    res.json({ message: 'Customer look removed' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
