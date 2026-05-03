const { env } = require('../config/env');
const { HttpError } = require('../utils/httpError');

function statusFromPostgresError(error) {
  if (error.code === '23505') {
    return 409;
  }

  if (error.code === '23503' || error.code === '23514' || error.code === '22P02') {
    return 400;
  }

  return 500;
}

function messageFromPostgresError(error) {
  if (error.code === '23505') {
    return 'Duplicate value violates a unique constraint';
  }

  if (error.code === '23503') {
    return 'Referenced record does not exist';
  }

  if (error.code === '23514') {
    return 'Value violates a database constraint';
  }

  if (error.code === '22P02') {
    return 'Invalid input syntax';
  }

  return 'Internal server error';
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    next(error);
    return;
  }

  const isHttpError = error instanceof HttpError;
  const isPostgresError = Boolean(error.code);
  const statusCode = isHttpError
    ? error.statusCode
    : isPostgresError
      ? statusFromPostgresError(error)
      : 500;

  const response = {
    error: {
      message: isHttpError
        ? error.message
        : isPostgresError
          ? messageFromPostgresError(error)
          : 'Internal server error'
    }
  };

  if (isHttpError && error.details) {
    response.error.details = error.details;
  }

  if (isPostgresError && !env.isProduction) {
    response.error.details = {
      code: error.code,
      detail: error.detail,
      constraint: error.constraint
    };
  }

  if (!env.isProduction && !isHttpError && !isPostgresError) {
    response.error.details = error.message;
  }

  res.status(statusCode).json(response);
}

module.exports = { errorHandler };
