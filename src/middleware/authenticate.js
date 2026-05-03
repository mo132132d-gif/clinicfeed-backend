const { query } = require('../db/query');
const { createHttpError } = require('../utils/httpError');
const { verifyAccessToken } = require('../utils/jwt');

async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw createHttpError(401, 'Missing bearer token');
    }

    const token = header.slice('Bearer '.length);
    const payload = verifyAccessToken(token);

    const result = await query(
      `
        SELECT id, name, email, role, is_active
        FROM users
        WHERE id = $1
      `,
      [payload.sub]
    );

    const user = result.rows[0];
    if (!user || !user.is_active) {
      throw createHttpError(401, 'Invalid or inactive user');
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      next(createHttpError(401, 'Invalid or expired token'));
      return;
    }

    next(error);
  }
}

module.exports = { authenticate };
