export const notFound = (req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  res.status(404);
  next(error);
};

export const errorHandler = (err, req, res, next) => {
  if (/^\/api\/auth(?:\/|\?|$)/i.test(req.originalUrl)) {
    // Parser/validation errors may contain pieces of the submitted credentials.
    // Authentication errors must never echo those values or include a stack.
    const errorStatus = err.status || res.statusCode;
    const status = [400, 404, 413, 415].includes(errorStatus) ? errorStatus : 500;
    res.set('Cache-Control', 'no-store');
    return res.status(status).json({
      message: status === 413 ? 'Authentication request is too large.' :
        status === 404 ? 'Authentication endpoint not found.' :
        status < 500 ? 'Invalid authentication request.' : 'Unable to complete the authentication request.',
    });
  }
  let statusCode = res.statusCode === 200 ? 500 : res.statusCode;
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

  res.status(statusCode).json({
    message,
    stack: process.env.NODE_ENV === 'production' ? null : err.stack,
  });
};
