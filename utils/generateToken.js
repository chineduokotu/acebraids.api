import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { getAuthCookieOptions, getJwtSecret } from '../config/auth.js';

export const createToken = (userId, role, authVersion = 0) =>
  jwt.sign(
    { id: userId, role, authVersion },
    getJwtSecret(),
    { expiresIn: '30d', algorithm: 'HS256', jwtid: randomUUID() }
  );

export const setTokenCookie = (res, token) => {
  res.cookie('jwt', token, {
    ...getAuthCookieOptions(),
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  });
  res.set('Cache-Control', 'no-store');
};

export const generateToken = (res, userId, role, authVersion = 0) => {
  const token = createToken(userId, role, authVersion);
  setTokenCookie(res, token);
  return token;
};
