const { query } = require('../db/query');
const { withTransaction } = require('../db/transaction');
const { createHttpError } = require('../utils/httpError');
const { hashPassword, verifyPassword } = require('../utils/password');
const { signAccessToken } = require('../utils/jwt');
const { logActivity } = require('./activityLog.service');

const publicUserFields = 'id, name, email, role, is_active, created_at, updated_at';

function sanitizeUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    is_active: user.is_active,
    created_at: user.created_at,
    updated_at: user.updated_at
  };
}

function parseLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 25;
  }

  return Math.min(parsed, 100);
}

function parseOffset(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

async function login({ email, password }) {
  const result = await query(
    `
      SELECT id, name, email, password_hash, role, is_active, created_at, updated_at
      FROM users
      WHERE lower(email) = lower($1)
    `,
    [email]
  );

  const user = result.rows[0];
  if (!user || !user.is_active) {
    throw createHttpError(401, 'Invalid email or password');
  }

  const passwordMatches = await verifyPassword(password, user.password_hash);
  if (!passwordMatches) {
    throw createHttpError(401, 'Invalid email or password');
  }

  const publicUser = sanitizeUser(user);
  return {
    token: signAccessToken(publicUser),
    user: publicUser
  };
}

async function listUsers(queryParams = {}) {
  const limit = parseLimit(queryParams.limit);
  const offset = parseOffset(queryParams.offset);
  const values = [];
  let whereSql = '';

  if (queryParams.q) {
    values.push(`%${queryParams.q}%`);
    whereSql = `WHERE name ILIKE $1 OR email ILIKE $1 OR role ILIKE $1`;
  }

  const countResult = await query(
    `SELECT COUNT(*)::int AS total FROM users ${whereSql}`,
    values
  );

  const rowsResult = await query(
    `
      SELECT ${publicUserFields}
      FROM users
      ${whereSql}
      ORDER BY created_at DESC
      LIMIT $${values.length + 1}
      OFFSET $${values.length + 2}
    `,
    [...values, limit, offset]
  );

  return {
    data: rowsResult.rows,
    meta: {
      total: countResult.rows[0].total,
      limit,
      offset
    }
  };
}

async function getUserById(id) {
  const result = await query(
    `SELECT ${publicUserFields} FROM users WHERE id = $1`,
    [id]
  );

  const user = result.rows[0];
  if (!user) {
    throw createHttpError(404, 'User not found');
  }

  return user;
}

async function createUser(data, actor) {
  const passwordHash = await hashPassword(data.password);
  const email = data.email.toLowerCase();

  return withTransaction(async (client) => {
    const result = await client.query(
      `
        INSERT INTO users (name, email, password_hash, role, is_active)
        VALUES ($1, $2, $3, $4, COALESCE($5, true))
        RETURNING ${publicUserFields}
      `,
      [data.name, email, passwordHash, data.role, data.is_active]
    );

    const user = result.rows[0];
    await logActivity({
      client,
      userId: actor.id,
      action: 'created',
      entityType: 'User',
      entityId: user.id,
      oldValue: null,
      newValue: user
    });

    return user;
  });
}

async function updateUser(id, data, actor) {
  if (actor.id === id && data.is_active === false) {
    throw createHttpError(400, 'You cannot deactivate your own account');
  }

  return withTransaction(async (client) => {
    const existingResult = await client.query(
      `SELECT ${publicUserFields} FROM users WHERE id = $1`,
      [id]
    );

    const existing = existingResult.rows[0];
    if (!existing) {
      throw createHttpError(404, 'User not found');
    }

    const fields = [];
    const values = [id];

    if (data.name !== undefined) {
      values.push(data.name);
      fields.push(`name = $${values.length}`);
    }

    if (data.email !== undefined) {
      values.push(data.email.toLowerCase());
      fields.push(`email = $${values.length}`);
    }

    if (data.password !== undefined) {
      values.push(await hashPassword(data.password));
      fields.push(`password_hash = $${values.length}`);
    }

    if (data.role !== undefined) {
      values.push(data.role);
      fields.push(`role = $${values.length}`);
    }

    if (data.is_active !== undefined) {
      values.push(data.is_active);
      fields.push(`is_active = $${values.length}`);
    }

    const result = await client.query(
      `
        UPDATE users
        SET ${fields.join(', ')}
        WHERE id = $1
        RETURNING ${publicUserFields}
      `,
      values
    );

    const user = result.rows[0];
    await logActivity({
      client,
      userId: actor.id,
      action: 'updated',
      entityType: 'User',
      entityId: user.id,
      oldValue: existing,
      newValue: user
    });

    return user;
  });
}

async function deleteUser(id, actor) {
  if (actor.id === id) {
    throw createHttpError(400, 'You cannot delete your own account');
  }

  return withTransaction(async (client) => {
    const existingResult = await client.query(
      `SELECT ${publicUserFields} FROM users WHERE id = $1`,
      [id]
    );

    const existing = existingResult.rows[0];
    if (!existing) {
      throw createHttpError(404, 'User not found');
    }

    const result = await client.query(
      `DELETE FROM users WHERE id = $1 RETURNING ${publicUserFields}`,
      [id]
    );

    await logActivity({
      client,
      userId: actor.id,
      action: 'deleted',
      entityType: 'User',
      entityId: id,
      oldValue: existing,
      newValue: null
    });

    return result.rows[0];
  });
}

module.exports = {
  login,
  listUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  sanitizeUser
};
