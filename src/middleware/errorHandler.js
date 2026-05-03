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

  const statusCode = err.statusCode || err.status || 500;

  res.status(statusCode).json({
    error: {
      message: statusCode === 500 ? "Internal server error" : err.message,
    },
  });
}

module.exports = { errorHandler };