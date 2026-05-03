const { pool } = require('../db/pool');

function runner(client) {
  return client || pool;
}

function quoteIdentifier(identifier) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }

  return `"${identifier}"`;
}

function tableName(config) {
  return quoteIdentifier(config.table);
}

function pickAllowed(data, fields) {
  return fields.reduce((payload, field) => {
    if (Object.prototype.hasOwnProperty.call(data, field) && data[field] !== undefined) {
      payload[field] = data[field];
    }

    return payload;
  }, {});
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

function sortClause(config, queryParams) {
  const defaultSort = config.defaultSort || { field: 'created_at', direction: 'DESC' };
  const requestedSort = queryParams.sort_by;
  const requestedOrder = String(queryParams.order || '').toUpperCase();
  const field = config.sortable.includes(requestedSort) ? requestedSort : defaultSort.field;
  const direction = ['ASC', 'DESC'].includes(requestedOrder) ? requestedOrder : defaultSort.direction;

  return `${quoteIdentifier(field)} ${direction}`;
}

function buildWhere(config, queryParams) {
  const conditions = [];
  const values = [];

  for (const field of config.filters) {
    if (queryParams[field] === undefined || queryParams[field] === '') {
      continue;
    }

    values.push(queryParams[field]);
    conditions.push(`${quoteIdentifier(field)} = $${values.length}`);
  }

  if (queryParams.q && config.searchable.length > 0) {
    const searchConditions = [];
    for (const field of config.searchable) {
      values.push(`%${queryParams.q}%`);
      searchConditions.push(`${quoteIdentifier(field)} ILIKE $${values.length}`);
    }

    conditions.push(`(${searchConditions.join(' OR ')})`);
  }

  return {
    whereSql: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    values
  };
}

async function list(config, queryParams = {}, client) {
  const db = runner(client);
  const limit = parseLimit(queryParams.limit);
  const offset = parseOffset(queryParams.offset);
  const { whereSql, values } = buildWhere(config, queryParams);
  const orderSql = sortClause(config, queryParams);

  const countResult = await db.query(
    `SELECT COUNT(*)::int AS total FROM ${tableName(config)} ${whereSql}`,
    values
  );

  const rowsResult = await db.query(
    `
      SELECT *
      FROM ${tableName(config)}
      ${whereSql}
      ORDER BY ${orderSql}
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

async function findById(config, id, client) {
  const db = runner(client);
  const result = await db.query(
    `SELECT * FROM ${tableName(config)} WHERE id = $1`,
    [id]
  );

  return result.rows[0] || null;
}

async function create(config, data, client) {
  const db = runner(client);
  const payload = pickAllowed(data, config.fields);
  const keys = Object.keys(payload);
  const columns = keys.map(quoteIdentifier).join(', ');
  const placeholders = keys.map((_, index) => `$${index + 1}`).join(', ');
  const values = keys.map((key) => payload[key]);

  const result = await db.query(
    `
      INSERT INTO ${tableName(config)} (${columns})
      VALUES (${placeholders})
      RETURNING *
    `,
    values
  );

  return result.rows[0];
}

async function update(config, id, data, client) {
  const db = runner(client);
  const payload = pickAllowed(data, config.fields);
  const keys = Object.keys(payload);
  const assignments = keys.map((key, index) => `${quoteIdentifier(key)} = $${index + 2}`);
  const values = keys.map((key) => payload[key]);

  const result = await db.query(
    `
      UPDATE ${tableName(config)}
      SET ${assignments.join(', ')}
      WHERE id = $1
      RETURNING *
    `,
    [id, ...values]
  );

  return result.rows[0] || null;
}

async function remove(config, id, client) {
  const db = runner(client);
  const result = await db.query(
    `
      DELETE FROM ${tableName(config)}
      WHERE id = $1
      RETURNING *
    `,
    [id]
  );

  return result.rows[0] || null;
}

module.exports = {
  list,
  findById,
  create,
  update,
  remove
};
