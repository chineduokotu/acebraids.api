import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { getJwtSecret } from '../config/auth.js';

export const protect = async (req, res, next) => {
  const bearer = req.headers.authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const token = bearer || req.cookies?.jwt;

  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token provided' });
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] });
    req.user = await User.findById(decoded.id).select('-password');
    if (!req.user) {
      return res.status(401).json({ message: 'User not found' });
    }
    const tokenVersion = decoded.authVersion ?? 0;
    if (!Number.isSafeInteger(tokenVersion) || tokenVersion < 0 || tokenVersion !== (req.user.authVersion ?? 0)) {
      return res.status(401).json({ message: 'Your session has expired. Please sign in again.' });
    }
    req.authVersion = tokenVersion;
    req.authExpiresAt = typeof decoded.exp === 'number' ? decoded.exp * 1000 : null;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Not authorized, token invalid or expired' });
  }
};

export const adminOnly = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ message: 'Access denied: Admin privileges required' });
  }
};
