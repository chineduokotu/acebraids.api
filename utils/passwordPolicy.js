// Count Unicode code points; bcrypt only uses the first 72 UTF-8 bytes.
export const validateNewPassword = (password) => {
  if (typeof password !== 'string' || !password.trim()) {
    return 'Enter a new password.';
  }
  if ([...password].length < 15) {
    return 'Use at least 15 characters for your new password.';
  }
  if (Buffer.byteLength(password, 'utf8') > 72) {
    return 'Use no more than 72 bytes for your new password (some characters use more than one byte).';
  }
  return null;
};

// Existing passwords remain usable while accounts adopt the new policy.
export const isValidCurrentPassword = (password) =>
  typeof password === 'string' && password.length > 0 && Buffer.byteLength(password, 'utf8') <= 1024;
