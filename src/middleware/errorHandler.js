function databaseErrorMessage(err) {
  if (err.code === '22P02') return { statusCode: 400, message: 'Invalid UUID or field format' };
  if (err.code === '22007') return { statusCode: 400, message: 'Invalid date format' };
  if (err.code === '23503') return { statusCode: 400, message: 'Referenced record does not exist' };
  if (err.code === '23505') return { statusCode: 409, message: 'Duplicate record violates a unique constraint' };
  if (err.code === '23514') return { statusCode: 400, message: 'Invalid value violates a database constraint' };
  return null;
}

function errorHandler(err, req, res, next) {
  console.error("ERROR_HANDLER:", {
    message: err.message,
    stack: err.stack,
    code: err.code,
    detail: err.detail,
    hint: err.hint,
    table: err.table,
    constraint: err.constraint,
    path: req.path,
    method: req.method,
  });

  const databaseError = databaseErrorMessage(err);
  const statusCode = err.statusCode || err.status || databaseError?.statusCode || 500;

  res.status(statusCode).json({
    error: {
      message: statusCode === 500 ? "Internal server error" : databaseError?.message || err.message,
    },
  });
}

module.exports = { errorHandler };
