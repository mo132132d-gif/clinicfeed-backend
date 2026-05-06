const fs = require('node:fs/promises');
const path = require('node:path');
const { query } = require('../db/query');
const { withTransaction } = require('../db/transaction');
const { createHttpError } = require('../utils/httpError');
const { sanitizeFileName } = require('../middleware/multipartUpload');

const STATUSES = new Set([
  'New',
  'Under Review',
  'Waiting Invoice',
  'Waiting Approval',
  'Approved',
  'Paid',
  'Rejected',
  'Cancelled'
]);

const PRIORITIES = new Set(['Low', 'Normal', 'High', 'Urgent']);
const DOCUMENT_TYPES = new Set(['Supplier Invoice', 'Quotation', 'Payment Receipt', 'Bank Transfer', 'Other']);
const MUTABLE_FIELDS = [
  'request_number',
  'supplier_id',
  'amount',
  'status',
  'priority',
  'due_date',
  'payment_method',
  'invoice_number',
  'reference_number',
  'assigned_to',
  'notes'
];

function compactPayload(data, fields) {
  return fields.reduce((payload, field) => {
    if (Object.prototype.hasOwnProperty.call(data, field) && data[field] !== undefined) {
      payload[field] = data[field];
    }

    return payload;
  }, {});
}

function normalizeAmount(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') {
    throw createHttpError(400, 'amount is required and must be greater than 0');
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw createHttpError(400, 'amount is required and must be greater than 0');
  }

  return parsed;
}

function normalizeNullableText(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function normalizeSupplierIds(data) {
  const value = data.supplier_ids ?? data.supplierIds;
  const ids = [];

  if (Array.isArray(value)) {
    ids.push(...value);
  }

  if (data.supplier_id) {
    ids.unshift(data.supplier_id);
  }

  return [...new Set(ids.filter(Boolean).map((id) => String(id)))];
}

function preparePayload(data) {
  const payload = compactPayload(data, MUTABLE_FIELDS);

  for (const field of ['request_number', 'supplier_id', 'due_date', 'payment_method', 'invoice_number', 'reference_number', 'assigned_to', 'notes']) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      payload[field] = normalizeNullableText(payload[field]);
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'amount')) {
    payload.amount = normalizeAmount(payload.amount);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'status') && !STATUSES.has(payload.status)) {
    throw createHttpError(400, 'Invalid supplier payment request status');
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'priority')) {
    payload.priority = payload.priority || 'Normal';
    if (!PRIORITIES.has(payload.priority)) {
      throw createHttpError(400, 'Invalid supplier payment request priority');
    }
  }

  return payload;
}

function buildInsert(payload) {
  const keys = Object.keys(payload).filter((key) => payload[key] !== undefined);
  return {
    columns: keys.map((key) => `"${key}"`).join(', '),
    placeholders: keys.map((_, index) => `$${index + 1}`).join(', '),
    values: keys.map((key) => payload[key])
  };
}

function buildUpdate(payload) {
  const keys = Object.keys(payload).filter((key) => payload[key] !== undefined);
  return {
    assignments: keys.map((key, index) => `"${key}" = $${index + 2}`),
    values: keys.map((key) => payload[key])
  };
}

function addFilter(conditions, values, sql, value) {
  values.push(value);
  conditions.push(sql.replace('?', `$${values.length}`));
}

function buildFilters(params = {}) {
  const conditions = ['spr.deleted_at IS NULL'];
  const values = [];

  if (params.status && String(params.status).toLowerCase() !== 'all') {
    addFilter(conditions, values, 'spr.status = ?', params.status);
  }

  if (params.supplier_id) {
    values.push(params.supplier_id, params.supplier_id);
    const firstIndex = values.length - 1;
    const secondIndex = values.length;
    conditions.push(`(
      spr.supplier_id = $${firstIndex}::uuid
      OR EXISTS (
        SELECT 1
        FROM supplier_payment_request_suppliers sprs_filter
        WHERE sprs_filter.payment_request_id = spr.id
          AND sprs_filter.supplier_id = $${secondIndex}::uuid
      )
    )`);
  }

  if (params.assigned_to) {
    addFilter(conditions, values, 'spr.assigned_to ILIKE ?', `%${params.assigned_to}%`);
  }

  if (params.date_from) {
    addFilter(conditions, values, 'spr.created_at >= ?::timestamptz', params.date_from);
  }

  if (params.date_to) {
    addFilter(conditions, values, "spr.created_at < (?::date + INTERVAL '1 day')", params.date_to);
  }

  const search = params.q || params.search;
  if (search) {
    values.push(`%${search}%`);
    const index = values.length;
    conditions.push(`(
      spr.request_number ILIKE $${index}
      OR spr.reference_number ILIKE $${index}
      OR spr.invoice_number ILIKE $${index}
      OR spr.notes ILIKE $${index}
      OR EXISTS (
        SELECT 1
        FROM supplier_payment_request_suppliers sprs_search
        JOIN suppliers s_search ON s_search.id = sprs_search.supplier_id
        WHERE sprs_search.payment_request_id = spr.id
          AND (
            s_search.name_ar ILIKE $${index}
            OR s_search.name_en ILIKE $${index}
            OR s_search.city ILIKE $${index}
            OR s_search.category ILIKE $${index}
          )
      )
      OR EXISTS (
        SELECT 1
        FROM suppliers s_primary
        WHERE s_primary.id = spr.supplier_id
          AND (
            s_primary.name_ar ILIKE $${index}
            OR s_primary.name_en ILIKE $${index}
            OR s_primary.city ILIKE $${index}
            OR s_primary.category ILIKE $${index}
          )
      )
    )`);
  }

  return {
    whereSql: `WHERE ${conditions.join(' AND ')}`,
    values
  };
}

function limitOffset(params = {}, startIndex) {
  const limit = Math.min(Math.max(Number(params.limit || 100), 1), 500);
  const offset = Math.max(Number(params.offset || 0), 0);

  return {
    sql: ` LIMIT $${startIndex} OFFSET $${startIndex + 1}`,
    values: [limit, offset],
    limit,
    offset
  };
}

async function generateRequestNumber(client) {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const result = await client.query(
    `
      SELECT COALESCE(MAX(substring(request_number from 'SPR-[0-9]{8}-([0-9]{4})$')::int), 0) + 1 AS next_number
      FROM supplier_payment_requests
      WHERE request_number LIKE $1
    `,
    [`SPR-${datePart}-%`]
  );

  return `SPR-${datePart}-${String(result.rows[0].next_number).padStart(4, '0')}`;
}

async function addActivity(client, paymentRequestId, action, options = {}) {
  await client.query(
    `
      INSERT INTO supplier_payment_request_activity_logs
        (payment_request_id, action, old_value, new_value, description, created_by)
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [
      paymentRequestId,
      action,
      options.oldValue === undefined ? null : String(options.oldValue),
      options.newValue === undefined ? null : String(options.newValue),
      options.description || null,
      options.userId || null
    ]
  );
}

async function setSupplierLinks(client, paymentRequestId, supplierIds) {
  await client.query('DELETE FROM supplier_payment_request_suppliers WHERE payment_request_id = $1', [paymentRequestId]);

  if (!supplierIds || supplierIds.length === 0) {
    return;
  }

  const values = [];
  const rows = supplierIds.map((supplierId, index) => {
    values.push(paymentRequestId, supplierId);
    const offset = index * 2;
    return `($${offset + 1}, $${offset + 2})`;
  });

  await client.query(
    `
      INSERT INTO supplier_payment_request_suppliers (payment_request_id, supplier_id)
      VALUES ${rows.join(', ')}
      ON CONFLICT (payment_request_id, supplier_id) DO NOTHING
    `,
    values
  );
}

async function suppliersForRequestIds(ids) {
  if (ids.length === 0) return new Map();

  const result = await query(
    `
      SELECT
        sprs.payment_request_id,
        s.id,
        s.name_ar,
        s.name_en,
        s.cr_number,
        s.vat_number,
        s.city,
        s.category,
        s.status,
        array_remove(array_agg(DISTINCT c.phone), NULL) AS phones,
        array_remove(array_agg(DISTINCT c.email), NULL) AS emails
      FROM supplier_payment_request_suppliers sprs
      JOIN suppliers s ON s.id = sprs.supplier_id
      LEFT JOIN contacts c ON c.supplier_id = s.id
      WHERE sprs.payment_request_id = ANY($1::uuid[])
      GROUP BY sprs.payment_request_id, s.id
      ORDER BY s.name_ar ASC NULLS LAST, s.name_en ASC NULLS LAST
    `,
    [ids]
  );

  const map = new Map();
  for (const row of result.rows) {
    if (!map.has(row.payment_request_id)) {
      map.set(row.payment_request_id, []);
    }

    map.get(row.payment_request_id).push({
      id: row.id,
      name_ar: row.name_ar,
      name_en: row.name_en,
      cr_number: row.cr_number,
      vat_number: row.vat_number,
      city: row.city,
      category: row.category,
      status: row.status,
      phones: row.phones || [],
      emails: row.emails || []
    });
  }

  return map;
}

async function attachSuppliers(requests) {
  const map = await suppliersForRequestIds(requests.map((request) => request.id));
  return requests.map((request) => ({
    ...request,
    suppliers: map.get(request.id) || []
  }));
}

async function list(params = {}) {
  const filters = buildFilters(params);
  const paging = limitOffset(params, filters.values.length + 1);

  const [rowsResult, countResult, summaryResult] = await Promise.all([
    query(
      `
        SELECT spr.*
        FROM supplier_payment_requests spr
        ${filters.whereSql}
        ORDER BY spr.created_at DESC, spr.request_number DESC NULLS LAST
        ${paging.sql}
      `,
      [...filters.values, ...paging.values]
    ),
    query(
      `
        SELECT COUNT(*)::int AS total
        FROM supplier_payment_requests spr
        ${filters.whereSql}
      `,
      filters.values
    ),
    query(
      `
        SELECT
          COUNT(*)::int AS total_requests,
          (COUNT(*) FILTER (WHERE status IN ('New', 'Under Review', 'Waiting Invoice', 'Waiting Approval')))::int AS pending_requests,
          (COUNT(*) FILTER (WHERE status = 'Approved'))::int AS approved_requests,
          (COUNT(*) FILTER (WHERE status = 'Paid'))::int AS paid_requests,
          (COUNT(*) FILTER (WHERE status IN ('Rejected', 'Cancelled')))::int AS rejected_cancelled_requests,
          COALESCE(SUM(amount) FILTER (WHERE status <> 'Paid' AND status NOT IN ('Rejected', 'Cancelled')), 0)::float AS outstanding_amount,
          COALESCE(SUM(amount) FILTER (WHERE status <> 'Paid' AND status NOT IN ('Rejected', 'Cancelled')), 0)::float AS total_due_amount,
          COALESCE(SUM(amount) FILTER (WHERE status = 'Paid'), 0)::float AS paid_amount,
          COALESCE(SUM(amount) FILTER (WHERE status = 'Paid'), 0)::float AS total_paid_amount
        FROM supplier_payment_requests spr
        ${filters.whereSql}
      `,
      filters.values
    )
  ]);

  return {
    data: await attachSuppliers(rowsResult.rows),
    meta: {
      total: countResult.rows[0]?.total || 0,
      limit: paging.limit,
      offset: paging.offset
    },
    summary: summaryResult.rows[0] || {}
  };
}

async function getById(id) {
  const result = await query('SELECT * FROM supplier_payment_requests WHERE id = $1 AND deleted_at IS NULL', [id]);
  const paymentRequest = result.rows[0];

  if (!paymentRequest) {
    throw createHttpError(404, 'Supplier payment request not found');
  }

  const [withSuppliers, documents, activity_logs] = await Promise.all([
    attachSuppliers([paymentRequest]).then(([row]) => row),
    listDocuments(id),
    listActivityLogs(id)
  ]);

  return { ...withSuppliers, documents, activity_logs };
}

async function create(data, userId) {
  const supplierIds = normalizeSupplierIds(data);
  const payload = preparePayload(data);

  if (!Object.prototype.hasOwnProperty.call(payload, 'amount')) {
    throw createHttpError(400, 'amount is required and must be greater than 0');
  }

  payload.status = payload.status || 'New';
  payload.priority = payload.priority || 'Normal';
  payload.supplier_id = payload.supplier_id || supplierIds[0] || null;
  payload.created_by = userId || null;

  const row = await withTransaction(async (client) => {
    if (!payload.request_number) {
      payload.request_number = await generateRequestNumber(client);
    }

    const insert = buildInsert(payload);
    const result = await client.query(
      `
        INSERT INTO supplier_payment_requests (${insert.columns})
        VALUES (${insert.placeholders})
        RETURNING *
      `,
      insert.values
    );

    await setSupplierLinks(client, result.rows[0].id, supplierIds);
    await addActivity(client, result.rows[0].id, 'created', {
      newValue: result.rows[0].request_number,
      description: 'Supplier payment request created',
      userId
    });

    return result.rows[0];
  });

  return getById(row.id);
}

async function update(id, data, userId) {
  const existing = await getById(id);
  const supplierIdsProvided = Object.prototype.hasOwnProperty.call(data, 'supplier_ids') || Object.prototype.hasOwnProperty.call(data, 'supplierIds');
  const supplierIds = supplierIdsProvided ? normalizeSupplierIds(data) : undefined;
  const payload = preparePayload(data);

  if (supplierIds && !Object.prototype.hasOwnProperty.call(payload, 'supplier_id')) {
    payload.supplier_id = supplierIds[0] || null;
  }

  if (Object.keys(payload).length === 0 && supplierIds === undefined) {
    throw createHttpError(400, 'No valid fields were provided');
  }

  await withTransaction(async (client) => {
    if (Object.keys(payload).length > 0) {
      const updateSql = buildUpdate(payload);
      const result = await client.query(
        `
          UPDATE supplier_payment_requests
          SET ${updateSql.assignments.join(', ')}, updated_at = now()
          WHERE id = $1 AND deleted_at IS NULL
          RETURNING *
        `,
        [id, ...updateSql.values]
      );

      if (!result.rows[0]) {
        throw createHttpError(404, 'Supplier payment request not found');
      }

      await addActivity(client, id, 'updated', {
        description: 'Supplier payment request updated',
        userId
      });

      if (Object.prototype.hasOwnProperty.call(payload, 'status') && payload.status !== existing.status) {
        await addActivity(client, id, 'status changed', {
          oldValue: existing.status,
          newValue: payload.status,
          description: 'Status changed',
          userId
        });
      }

      if (Object.prototype.hasOwnProperty.call(payload, 'amount') && Number(payload.amount) !== Number(existing.amount || 0)) {
        await addActivity(client, id, 'amount changed', {
          oldValue: existing.amount,
          newValue: payload.amount,
          description: 'Amount changed',
          userId
        });
      }
    }

    if (supplierIds !== undefined) {
      await setSupplierLinks(client, id, supplierIds);
    }
  });

  return getById(id);
}

async function remove(id, userId) {
  const row = await withTransaction(async (client) => {
    const result = await client.query(
      `
        UPDATE supplier_payment_requests
        SET deleted_at = now(), updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING *
      `,
      [id]
    );

    if (!result.rows[0]) {
      throw createHttpError(404, 'Supplier payment request not found');
    }

    await addActivity(client, id, 'deleted', {
      oldValue: result.rows[0].request_number,
      description: 'Supplier payment request deleted',
      userId
    });

    return result.rows[0];
  });

  return row;
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

async function uploadDocument(paymentRequestId, file, data, userId) {
  await getById(paymentRequestId);

  const documentType = data.document_type || data.documentType || 'Other';
  if (!DOCUMENT_TYPES.has(documentType)) {
    throw createHttpError(400, 'Invalid document type');
  }

  const originalName = sanitizeFileName(file.originalName);
  const storedName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${originalName}`;
  const relativePath = path.posix.join('supplier-payment-requests', paymentRequestId, storedName);
  const absoluteDir = path.join(__dirname, '..', '..', 'uploads', 'supplier-payment-requests', paymentRequestId);
  const absolutePath = path.join(absoluteDir, storedName);

  await fs.mkdir(absoluteDir, { recursive: true });
  await fs.writeFile(absolutePath, file.buffer);

  const row = await withTransaction(async (client) => {
    const result = await client.query(
      `
        INSERT INTO supplier_payment_request_documents
          (payment_request_id, document_type, file_name, file_url, file_path, file_mime_type, file_size, uploaded_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `,
      [
        paymentRequestId,
        documentType,
        originalName,
        `/uploads/${relativePath}`,
        path.join('uploads', relativePath),
        file.mimeType,
        file.size,
        userId || null
      ]
    );

    await addActivity(client, paymentRequestId, 'document uploaded', {
      newValue: originalName,
      description: `Document uploaded: ${documentType}`,
      userId
    });

    return result.rows[0];
  });

  return row;
}

async function deleteDocument(paymentRequestId, documentId, userId) {
  const row = await withTransaction(async (client) => {
    const result = await client.query(
      `
        DELETE FROM supplier_payment_request_documents
        WHERE id = $1 AND payment_request_id = $2
        RETURNING *
      `,
      [documentId, paymentRequestId]
    );

    if (!result.rows[0]) {
      throw createHttpError(404, 'Document not found');
    }

    await addActivity(client, paymentRequestId, 'document deleted', {
      oldValue: result.rows[0].file_name,
      description: 'Document deleted',
      userId
    });

    return result.rows[0];
  });

  if (row.file_path) {
    const absolutePath = path.join(__dirname, '..', '..', row.file_path);
    try {
      await fs.unlink(absolutePath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  return row;
}

async function listActivityLogs(paymentRequestId) {
  const result = await query(
    `
      SELECT *
      FROM supplier_payment_request_activity_logs
      WHERE payment_request_id = $1
      ORDER BY created_at DESC
    `,
    [paymentRequestId]
  );

  return result.rows;
}

module.exports = {
  list,
  getById,
  create,
  update,
  remove,
  uploadDocument,
  listDocuments,
  deleteDocument,
  listActivityLogs
};
