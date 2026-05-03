const { createHttpError } = require('../utils/httpError');

function validate(schema, property = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[property]);

    if (!result.success) {
      next(createHttpError(400, 'Validation failed', result.error.flatten()));
      return;
    }

    req[property] = result.data;
    next();
  };
}

module.exports = { validate };
