export const validateRequest = (requiredFields = []) => {
  return (req, res, next) => {
    const missing = [];
    for (const field of requiredFields) {
      if (!req.body[field]) {
        missing.push(field);
      }
    }

    if (missing.length > 0) {
      return res.status(400).json({
        message: `Missing required fields: ${missing.join(', ')}`
      });
    }
    next();
  };
};
