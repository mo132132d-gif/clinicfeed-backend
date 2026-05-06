const { query } = require('../db/query');
const { withTransaction } = require('../db/transaction');
const { createHttpError } = require('../utils/httpError');

const REQUEST_FIELDS = [
  'supplier_id',
  'requested_by',
  'assigned_to',
  'amount',
  'currency',
  'payment_reason',
  'description',
  'priority',
  'status',
  'due_date',
  'manager_notes',
  'rejection_reason',
  'paid_amount',
  'paid_at'
];

function compactPayload(data = {}) {
  return REQUEST_FIELDS.reduce((payload, field) => {
    if (Object.prototype.hasOwnProperty.call(data, field) && data[field] !== undefined) {
      payload[field] = data[field];
    }
    return payload;
  }, {});
}

function normalizeAmount(value, fieldName = 'amount') {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw createHttpError(400, `${fieldName} must be a valid positive number`);
  }
  return amount;
}

function preparePayload(data = {}, isCreate = false) {
  const payload = compactPayload(data);

  if (Object.prototype.hasOwnProperty.call(payload, 'amount')) {
    payload.amount = normalizeAmount(payload.amount, 'amount');
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'paid_amount') && payload.paid_amount !== null && payload.paid_amount !== '') {
    payload.paid_amount = normalizeAmount(payload.paid_amount, 'paid_amount');
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'currency')) {
    payload.currency = String(payload.currency || 'SAR').trim() || 'SAR';
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'payment_reason')) {
    payload.payment_reason = String(payload.payment_reason || '').trim();
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'priority')) {
    payload.priority = String(payload.priority || 'عادي').trim() || 'عادي';
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'status')) {
    payload.status = String(payload.status || 'جديد').trim() || 'جديد';
  }

  if (isCreate && !payload.amount) {
    throw createHttpError(400, 'amount is required');
  }

  if (isCreate && !payload.payment_reason) {
    throw createHttpError(400, 'payment_reason is required');
  }

  return payload;
}

function buildInsert(payload) {
  const columns = Object.keys(payload);
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  const values = columns.map((column) => payload[column]);
  return { columns: columns.join(', '), placeholders: placeholders.join(', '), values };
}

function buildUpdate(payload) {
  const columns = Object.keys(payload);
  const assignments = columns.map((column, index) => `${column} = $${index + 2}`);
  const values = columns.map((column) => payload[column]);
  return { assignments, values };
}

async function list(params = {}) {
  const conditions = [];
  const values = [];
  let index = 1;

  if (params.search) {
    values.push(`%${String(params.search).trim()}%`);
    conditions.push(`(
      spr.request_number ILIKE $${index}
      OR s.name_ar ILIKE $${index}
      OR s.name_en ILIKE $${index}
      OR spr.payment_reason ILIKE $${index}
      OR spr.description ILIKE $${index}
    )`);
    index += 1;
  }

  if (params.status && params.status !== 'all') {
    values.push(params.status);
    conditions.push(`spr.status = $${index}`);
    index += 1;
  }

  if (params.supplier_id) {
    values.push(params.supplier_id);
    conditions.push(`spr.supplier_id = $${index}`);
    index += 1;
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await query(
    `
      SELECT
        spr.*,
        s.name_ar AS supplier_name_ar,
        s.name_en AS supplier_name_en,
        s.phone AS supplier_phone,
        s.email AS supplier_email,
        s.city AS supplier_city,
        s.category AS supplier_category
      FROM supplier_payment_requests spr
      LEFT JOIN suppliers s ON s.id = spr.supplier_id
      ${whereSql}
      ORDER BY spr.created_at DESC
      LIMIT 500
    `,
    values
  );

  return result.rows;
}

async function getById(id) {
  const result = await query(
    `
      SELECT
        spr.*,
        s.name_ar AS supplier_name_ar,
        s.name_en AS supplier_name_en,
        s.phone AS supplier_phone,
        s.email AS supplier_email,
        s.city AS supplier_city,
        s.category AS supplier_category
      FROM supplier_payment_requests spr
      LEFT JOIN suppliers s ON s.id = spr.supplier_id
      WHERE spr.id = $1
    `,
    [id]
  );

  if (!result.rows[0]) {
    throw createHttpError(404, 'Supplier payment request not found');
  }

  return result.rows[0];
}

async function create(data, user) {
  const payload = preparePayload(data, true);

  if (user?.id && !payload.requested_by) {
    payload.requested_by = user.id;
  }

  const insert = buildInsert(payload);
  const result = await query(
    `
      INSERT INTO supplier_payment_requests (${insert.columns})
      VALUES (${insert.placeholders})
      RETURNING *
    `,
    insert.values
  );

  return getById(result.rows[0].id);
}

async function update(id, data) {
  const payload = preparePayload(data, false);

  if (Object.keys(payload).length === 0) {
    throw createHttpError(400, 'No valid fields were provided');
  }

  const updateSql = buildUpdate(payload);
  const result = await query(
    `
      UPDATE supplier_payment_requests
      SET ${updateSql.assignments.join(', ')}, updated_at = now()
      WHERE id = $1
      RETURNING *
    `,
    [id, ...updateSql.values]
  );

  if (!result.rows[0]) {
    throw createHttpError(404, 'Supplier payment request not found');
  }

  return getById(id);
}

async function remove(id) {
  const result = await query(
    'DELETE FROM supplier_payment_requests WHERE id = $1 RETURNING id',
    [id]
  );

  if (!result.rows[0]) {
    throw createHttpError(404, 'Supplier payment request not found');
  }

  return { id };
}

async function listDocuments(paymentRequestId) {
  const result = await query(
    `
      SELECT *
      FROM supplier_payment_request_documents
      WHERE payment_request_id = $1
      ORDER BY created_at DESC
    `,
    [paymentRequestId]
  );

  return result.rows;
}

async function addDocument(paymentRequestId, document, user) {
  await getById(paymentRequestId);

  const result = await query(
    `
      INSERT INTO supplier_payment_request_documents (
        payment_request_id,
        document_type,
        file_url,
        file_name,
        file_mime_type,
        file_size,
        file_path,
        uploaded_by
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
    `,
    [
      paymentRequestId,
      document.document_type,
      document.file_url,
      document.file_name,
      document.file_mime_type,
      document.file_size,
      document.file_path,
      user?.id || null
    ]
  );

  return result.rows[0];
}

module.exports = {
  list,
  getById,
  create,
  update,
  remove,
  listDocuments,
  addDocument
};
