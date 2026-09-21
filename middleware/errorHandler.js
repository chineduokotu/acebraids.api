import { logger } from '../utils/logger.js';

export const notFound = (req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  res.status(404);
  next(error);
};

export const errorHandler = (err, req, res, next) => {
  const errorStatus = err.status || err.statusCode || (res.statusCode !== 200 ? res.statusCode : 500);

  if (/^\/api\/auth(?:\/|\?|$)/i.test(req.originalUrl)) {
    // Parser/validation errors may contain pieces of the submitted credentials.
    // Authentication errors must never echo those values or include a stack.
    const status = [400, 401, 403, 404, 413, 415].includes(errorStatus) ? errorStatus : 500;
    if (status >= 500) {
      logger.error('Auth endpoint error', { method: req.method, url: req.originalUrl, status, message: err.message });
    }
    res.set('Cache-Control', 'no-store');
    return res.status(status).json({
      message: status === 413 ? 'Authentication request is too large.' :
        status === 404 ? 'Authentication endpoint not found.' :
        status < 500 ? 'Invalid authentication request.' : 'Unable to complete the authentication request.',
    });
  }

  let statusCode = errorStatus;
  let message = err.message;

  if (err.name === 'CastError' && err.kind === 'ObjectId') {
    statusCode = 404;
    message = 'Resource not found with the specified ID';
  }

  if (err.code === 11000) {
    statusCode = 400;
    message = 'Duplicate field value entered';
  }

  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = Object.values(err.errors).map(val => val.message).join(', ');
  }

  // Log server errors (5xx) with full context; skip noisy 4xx.
  if (statusCode >= 500) {
    logger.error('Unhandled server error', {
      method: req.method,
      url: req.originalUrl,
      status: statusCode,
      message: err.message,
      stack: err.stack,
    });
  } else if (statusCode >= 400) {
    logger.warn('Client error', { method: req.method, url: req.originalUrl, status: statusCode, message });
  }

  res.status(statusCode).json({
    message,
    ...(process.env.NODE_ENV !== 'production' ? { stack: err.stack } : {}),
  });
};
