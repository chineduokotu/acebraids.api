export const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.trim().length < 32) {
    throw new Error('Configure JWT_SECRET with at least 32 characters from a secure random source.');
  }
  return secret;
};

export const getAuthCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  path: '/',
});

