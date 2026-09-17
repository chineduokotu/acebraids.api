import { User } from '../models/User.js';
import bcrypt from 'bcryptjs';
import { createToken, generateToken, setTokenCookie } from '../utils/generateToken.js';
import { getAuthCookieOptions } from '../config/auth.js';
import { isValidCurrentPassword, validateNewPassword } from '../utils/passwordPolicy.js';

const validCredentials = (email, password) =>
  typeof email === 'string' && email.trim().length > 0 && email.length <= 254 && isValidCurrentPassword(password);

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
export const register = async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    if (typeof name !== 'string' || !name.trim() || !validCredentials(email, password)) {
      return res.status(400).json({ message: 'Enter a name, email, and password.' });
    }
    const policyError = validateNewPassword(password);
    if (policyError) return res.status(400).json({ message: policyError });

    const userExists = await User.findOne({ email: email.toLowerCase().trim() });
    if (userExists) {
      return res.status(400).json({ message: 'User already exists with this email address' });
    }

    const user = await User.create({
      name,
      email: email.toLowerCase().trim(),
      password,
      phone: phone || '',
      role: 'customer',
    });

    const token = generateToken(res, user._id, user.role, user.authVersion ?? 0);

    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      token,
    });
  } catch (error) {
    res.status(400).json({ message: 'Unable to register. Please check your details and try again.' });
  }
};

// @desc    Authenticate user & get token
// @route   POST /api/auth/login
// @access  Public
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!validCredentials(email, password)) {
      return res.status(400).json({ message: 'Enter your email and password.' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');
    if (user && (await user.matchPassword(password))) {
      const token = generateToken(res, user._id, user.role, user.authVersion ?? 0);
      res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        token,
      });
    } else {
      res.status(401).json({ message: 'Invalid email or password' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Unable to sign in. Please try again later.' });
  }
};

// @desc    Admin login
// @route   POST /api/auth/admin/login
// @access  Public
export const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!validCredentials(email, password)) {
      return res.status(400).json({ message: 'Enter your email and password.' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');
    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({ message: 'Invalid admin email or password' });
    }

    if (user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied: Admin role required' });
    }

    const token = generateToken(res, user._id, user.role, user.authVersion ?? 0);

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      token,
    });
  } catch (error) {
    res.status(500).json({ message: 'Unable to sign in. Please try again later.' });
  }
};

// @route POST /api/auth/admin/change-password
// @access Private/Admin
export const changePassword = async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body || {};
  if (!isValidCurrentPassword(currentPassword) || typeof newPassword !== 'string' || typeof confirmPassword !== 'string') {
    return res.status(400).json({ message: 'Enter your current password, new password, and confirmation.' });
  }
  const policyError = validateNewPassword(newPassword);
  if (policyError) return res.status(400).json({ message: policyError });
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ message: 'New password and confirmation do not match.' });
  }

  try {
    const user = await User.findById(req.user._id).select('+password');
    if (!user || (user.authVersion ?? 0) !== req.authVersion) {
      return res.status(401).json({ message: 'Your session has expired. Please sign in again.' });
    }
    if (user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied: Admin privileges required' });
    }
    if (!(await user.matchPassword(currentPassword))) {
      return res.status(400).json({ message: 'Your current password is incorrect.' });
    }
    if (await user.matchPassword(newPassword)) {
      return res.status(400).json({ message: 'Choose a new password different from your current password.' });
    }

    const authVersion = (user.authVersion ?? 0) + 1;
    // Sign first so bad server configuration cannot change the password without
    // being able to issue the replacement session.
    const token = createToken(user._id, user.role, authVersion);
    const passwordHash = await bcrypt.hash(newPassword, 10);
    const versionFilter = req.authVersion === 0
      ? { $or: [{ authVersion: 0 }, { authVersion: { $exists: false } }] }
      : { authVersion: req.authVersion };
    const result = await User.updateOne(
      { _id: user._id, role: 'admin', password: user.password, ...versionFilter },
      { $set: { password: passwordHash }, $inc: { authVersion: 1 } }
    );
    if (result.modifiedCount !== 1) {
      return res.status(409).json({ message: 'Your account changed during this request. Please sign in again.' });
    }
    setTokenCookie(res, token);
    res.json({ message: 'Password changed successfully. Other sessions have been signed out.', token });
  } catch {
    // Never echo database errors, request bodies, passwords, or hashes.
    res.status(500).json({ message: 'Unable to change your password. Please try again later.' });
  }
};

// @desc    Get current user profile
// @route   GET /api/auth/me
// @access  Private
export const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password -authVersion').populate('wishlist');
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Logout user & clear cookie
// @route   POST /api/auth/logout
// @access  Public
export const logout = async (req, res) => {
  res.clearCookie('jwt', getAuthCookieOptions());
  res.json({ message: 'Logged out successfully' });
};

// @desc    Toggle wishlist item
// @route   POST /api/auth/wishlist/:productId
// @access  Private
export const toggleWishlist = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const productId = req.params.productId;

    const index = user.wishlist.indexOf(productId);
    if (index > -1) {
      user.wishlist.splice(index, 1);
    } else {
      user.wishlist.push(productId);
    }

    await user.save();
    const updatedUser = await User.findById(req.user._id).populate('wishlist');
    res.json(updatedUser.wishlist);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
