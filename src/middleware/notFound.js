const { createHttpError } = require('../utils/httpError');

function notFound(req, res, next) {
  next(createHttpError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}

module.exports = { notFound };
