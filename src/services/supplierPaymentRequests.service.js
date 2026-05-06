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
const OPTIONAL_RELATION_ERROR_CODES = new Set(['42P01', '42703']);
const SUPPLIER_PAYMENT_REQUEST_COLUMNS = [
  'id',
  'request_number',
  'supplier_id',
  'amount',
  'payment_reason',
  'status',
  'priority',
  'due_date',
  'payment_method',
  'invoice_number',
  'reference_number',
  'assigned_to',
  'notes',
  'created_by',
  'created_at',
  'updated_at',
  'deleted_at'
];
const SUPPLIER_PAYMENT_REQUEST_COLUMN_TYPES = {
  id: 'uuid',
  supplier_id: 'uuid',
  amount: 'numeric',
  due_date: 'date',
  created_by: 'uuid',
  created_at: 'timestamptz',
  updated_at: 'timestamptz',
  deleted_at: 'timestamptz'
};
const SUPPLIER_RESPONSE_COLUMNS = ['name_ar', 'name_en', 'cr_number', 'vat_number', 'city', 'category', 'status'];
const SUPPLIER_SEARCH_COLUMNS = ['name_ar', 'name_en', 'city', 'category', 'cr_number', 'vat_number'];
const REQUEST_SEARCH_COLUMNS = ['request_number', 'reference_number', 'invoice_number', 'notes'];
const DEFAULT_PAYMENT_REASON = 'Supplier payment request';
const MUTABLE_FIELDS = [
  'request_number',
  'supplier_id',
  'amount',
  'payment_reason',
  'status',
  'priority',
  'due_date',
  'payment_method',
  'invoice_number',
  'reference_number',
  'assigned_to',
  'notes'
];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tableColumnsCache = new Map();

async function tableColumns(tableName) {
  if (tableColumnsCache.has(tableName)) {
    return tableColumnsCache.get(tableName);
  }

  const result = await query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = $1
    `,
    [tableName]
  );
  const columns = new Set(result.rows.map((row) => row.column_name));
  tableColumnsCache.set(tableName, columns);
  return columns;
}

function hasColumns(columns, requiredColumns) {
  return requiredColumns.every((column) => columns.has(column));
}

function selectColumn(alias, columns, column, type = 'text') {
  if (columns.has(column)) {
    return `${alias}."${column}"`;
  }

  return `NULL::${type}`;
}

function supplierSearchSql(alias, supplierColumns, index) {
  return SUPPLIER_SEARCH_COLUMNS
    .filter((column) => supplierColumns.has(column))
    .map((column) => `${alias}."${column}" ILIKE $${index}`);
}

function logServiceError(label, error, context = {}) {
  console.error(`Supplier payment requests service ${label} failed:`, {
    ...context,
    message: error.message,
    stack: error.stack,
    code: error.code,
    detail: error.detail,
    hint: error.hint,
    table: error.table,
    column: error.column,
    constraint: error.constraint
  });
}

function compactPayload(data, fields) {
  return fields.reduce((payload, field) => {
    if (Object.prototype.hasOwnProperty.call(data, field) && data[field] !== undefined) {
      payload[field] = data[field];
    }

    return payload;
  }, {});
}

function payloadForColumns(payload, columns) {
  return Object.entries(payload).reduce((filtered, [key, value]) => {
    if (columns.has(key)) {
      filtered[key] = value;
    }

    return filtered;
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

function normalizePaymentReason(value, fallback = DEFAULT_PAYMENT_REASON) {
  if (value === undefined || value === null) return fallback;
  const trimmed = String(value).trim();
  return trimmed || fallback;
}

function normalizeNullableUuid(value, fieldName) {
  const normalized = normalizeNullableText(value);
  if (normalized === undefined || normalized === null) {
    return normalized;
  }

  if (!UUID_PATTERN.test(normalized)) {
    throw createHttpError(400, `${fieldName} must be a valid UUID`);
  }

  return normalized;
}

function requireUuid(value, fieldName) {
  const normalized = normalizeNullableUuid(value, fieldName);
  if (!normalized) {
    throw createHttpError(400, `${fieldName} is required`);
  }

  return normalized;
}

function normalizeNullableDate(value, fieldName) {
  const normalized = normalizeNullableText(value);
  if (normalized === undefined || normalized === null) {
    return normalized;
  }

  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw createHttpError(400, `${fieldName} must be a valid date in YYYY-MM-DD format`);
  }

  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    parsed.getUTCFullYear() !== Number(year)
    || parsed.getUTCMonth() !== Number(month) - 1
    || parsed.getUTCDate() !== Number(day)
  ) {
    throw createHttpError(400, `${fieldName} must be a valid date in YYYY-MM-DD format`);
  }

  return normalized;
}

function normalizeSupplierIds(data) {
  const value = data.supplier_ids ?? data.supplierIds;
  const ids = [];

  function addId(id, fieldName) {
    const normalized = normalizeNullableUuid(id, fieldName);
    if (normalized) {
      ids.push(normalized);
    }
  }

  if (Array.isArray(value)) {
    for (const id of value) {
      addId(id, 'supplier_ids');
    }
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          for (const id of parsed) {
            addId(id, 'supplier_ids');
          }
        } else {
          addId(parsed, 'supplier_ids');
        }
      } catch {
        for (const id of trimmed.split(',')) {
          addId(id, 'supplier_ids');
        }
      }
    }
  } else if (value !== undefined && value !== null) {
    addId(value, 'supplier_ids');
  }

  if (Object.prototype.hasOwnProperty.call(data, 'supplier_id')) {
    const supplierId = normalizeNullableUuid(data.supplier_id, 'supplier_id');
    if (supplierId) {
      ids.unshift(supplierId);
    }
  }

  return [...new Set(ids)];
}

function preparePayload(data) {
  const payload = compactPayload(data, MUTABLE_FIELDS);

  for (const field of ['request_number', 'payment_method', 'invoice_number', 'reference_number', 'assigned_to', 'notes']) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      payload[field] = normalizeNullableText(payload[field]);
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'payment_reason')) {
    payload.payment_reason = normalizePaymentReason(payload.payment_reason);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'supplier_id')) {
    payload.supplier_id = normalizeNullableUuid(payload.supplier_id, 'supplier_id');
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'due_date')) {
    payload.due_date = normalizeNullableDate(payload.due_date, 'due_date');
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

function buildFilters(params = {}, schema = {}) {
  const requestColumns = schema.requestColumns || new Set();
  const conditions = [];
  const values = [];
  const supplierColumns = schema.supplierColumns || new Set();
  const linkColumns = schema.linkColumns || new Set();
  const hasSuppliersTable = supplierColumns.has('id');
  const hasSupplierLinks = hasColumns(linkColumns, ['payment_request_id', 'supplier_id']);

  if (requestColumns.has('deleted_at')) {
    conditions.push('spr.deleted_at IS NULL');
  }

  if (params.status && String(params.status).toLowerCase() !== 'all' && requestColumns.has('status')) {
    addFilter(conditions, values, 'spr.status = ?', params.status);
  }

  if (params.supplier_id && requestColumns.has('supplier_id')) {
    const supplierId = normalizeNullableUuid(params.supplier_id, 'supplier_id');
    values.push(supplierId);
    const index = values.length;
    const supplierConditions = ['spr.supplier_id = $' + index + '::uuid'];

    if (hasSupplierLinks) {
      supplierConditions.push(`EXISTS (
        SELECT 1
        FROM supplier_payment_request_suppliers sprs_filter
        WHERE sprs_filter.payment_request_id = spr.id
          AND sprs_filter.supplier_id = $${index}::uuid
      )`);
    }

    conditions.push(`(${supplierConditions.join(' OR ')})`);
  }

  if (params.assigned_to && requestColumns.has('assigned_to')) {
    addFilter(conditions, values, 'spr.assigned_to ILIKE ?', `%${params.assigned_to}%`);
  }

  if (params.date_from && requestColumns.has('created_at')) {
    addFilter(conditions, values, 'spr.created_at >= ?::timestamptz', params.date_from);
  }

  if (params.date_to && requestColumns.has('created_at')) {
    addFilter(conditions, values, "spr.created_at < (?::date + INTERVAL '1 day')", params.date_to);
  }

  const search = params.q || params.search;
  if (search) {
    values.push(`%${search}%`);
    const index = values.length;
    const searchConditions = REQUEST_SEARCH_COLUMNS
      .filter((column) => requestColumns.has(column))
      .map((column) => `spr."${column}" ILIKE $${index}`);
    const linkedSupplierSearch = supplierSearchSql('s_search', supplierColumns, index);
    const primarySupplierSearch = supplierSearchSql('s_primary', supplierColumns, index);

    if (hasSuppliersTable && hasSupplierLinks && linkedSupplierSearch.length > 0) {
      searchConditions.push(`EXISTS (
        SELECT 1
        FROM supplier_payment_request_suppliers sprs_search
        JOIN suppliers s_search ON s_search.id = sprs_search.supplier_id
        WHERE sprs_search.payment_request_id = spr.id
          AND (${linkedSupplierSearch.join(' OR ')})
      )`);
    }

    if (hasSuppliersTable && primarySupplierSearch.length > 0) {
      searchConditions.push(`EXISTS (
        SELECT 1
        FROM suppliers s_primary
        WHERE s_primary.id = spr.supplier_id
          AND (${primarySupplierSearch.join(' OR ')})
      )`);
    }

    if (searchConditions.length > 0) {
      conditions.push(`(${searchConditions.join(' OR ')})`);
    }
  }

  return {
    whereSql: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
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

function emptySummary() {
  return {
    total_requests: 0,
    pending_requests: 0,
    approved_requests: 0,
    paid_requests: 0,
    rejected_cancelled_requests: 0,
    total_due_amount: 0,
    total_paid_amount: 0
  };
}

function normalizeSummary(row = {}) {
  const summary = emptySummary();

  for (const key of Object.keys(summary)) {
    summary[key] = Number(row[key] || 0);
  }

  return summary;
}

function requestSelectSql(requestColumns) {
  return SUPPLIER_PAYMENT_REQUEST_COLUMNS
    .map((column) => {
      const expression = selectColumn('spr', requestColumns, column, SUPPLIER_PAYMENT_REQUEST_COLUMN_TYPES[column] || 'text');
      return `${expression} AS "${column}"`;
    })
    .join(', ');
}

function listOrderSql(requestColumns) {
  const orderParts = [];

  if (requestColumns.has('created_at')) {
    orderParts.push('spr.created_at DESC');
  }

  if (requestColumns.has('request_number')) {
    orderParts.push('spr.request_number DESC NULLS LAST');
  }

  if (requestColumns.has('id')) {
    orderParts.push('spr.id DESC');
  }

  return orderParts.length > 0 ? `ORDER BY ${orderParts.join(', ')}` : '';
}

function summarySelectSql(requestColumns) {
  const hasStatus = requestColumns.has('status');
  const hasAmount = requestColumns.has('amount');
  const pending = hasStatus
    ? "(COUNT(*) FILTER (WHERE spr.status IN ('New', 'Under Review', 'Waiting Invoice', 'Waiting Approval')))::int"
    : '0::int';
  const approved = hasStatus ? "(COUNT(*) FILTER (WHERE spr.status = 'Approved'))::int" : '0::int';
  const paid = hasStatus ? "(COUNT(*) FILTER (WHERE spr.status = 'Paid'))::int" : '0::int';
  const rejectedCancelled = hasStatus
    ? "(COUNT(*) FILTER (WHERE spr.status IN ('Rejected', 'Cancelled')))::int"
    : '0::int';
  const dueAmount = hasStatus && hasAmount
    ? "COALESCE(SUM(spr.amount) FILTER (WHERE spr.status <> 'Paid' AND spr.status NOT IN ('Rejected', 'Cancelled')), 0)::float"
    : '0::float';
  const paidAmount = hasStatus && hasAmount
    ? "COALESCE(SUM(spr.amount) FILTER (WHERE spr.status = 'Paid'), 0)::float"
    : '0::float';

  return `
    COUNT(*)::int AS total_requests,
    ${pending} AS pending_requests,
    ${approved} AS approved_requests,
    ${paid} AS paid_requests,
    ${rejectedCancelled} AS rejected_cancelled_requests,
    ${dueAmount} AS total_due_amount,
    ${paidAmount} AS total_paid_amount
  `;
}

async function supplierPaymentRequestSchema() {
  const [requestColumns, supplierColumns, linkColumns, contactColumns] = await Promise.all([
    tableColumns('supplier_payment_requests'),
    tableColumns('suppliers'),
    tableColumns('supplier_payment_request_suppliers'),
    tableColumns('contacts')
  ]);

  return {
    requestColumns,
    supplierColumns,
    linkColumns,
    contactColumns
  };
}

function isOptionalRelationError(error) {
  return OPTIONAL_RELATION_ERROR_CODES.has(error.code);
}

function logOptionalRelationError(label, error) {
  console.warn('Supplier payment request optional relation skipped:', {
    relation: label,
    message: error.message,
    code: error.code,
    detail: error.detail,
    hint: error.hint,
    table: error.table,
    column: error.column
  });
}

async function optionalRows(label, queryFn, fallbackQueryFn) {
  try {
    const result = await queryFn();
    return result.rows || [];
  } catch (error) {
    if (isOptionalRelationError(error)) {
      logOptionalRelationError(label, error);
      if (fallbackQueryFn && error.code === '42703') {
        try {
          const fallbackResult = await fallbackQueryFn();
          return fallbackResult.rows || [];
        } catch (fallbackError) {
          if (isOptionalRelationError(fallbackError)) {
            logOptionalRelationError(`${label} fallback`, fallbackError);
            return [];
          }

          throw fallbackError;
        }
      }

      return [];
    }

    throw error;
  }
}

async function generateRequestNumber(client) {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const pattern = `^SPR-${datePart}-([0-9]{4,})$`;

  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('supplier_payment_requests_request_number'))");
    const result = await client.query(
      `
        SELECT COALESCE(
          MAX(
            CASE
              WHEN request_number ~ $2 THEN substring(request_number from $2)::int
              ELSE 0
            END
          ),
          0
        ) + 1 AS next_number
        FROM supplier_payment_requests
        WHERE request_number LIKE $1
      `,
      [`SPR-${datePart}-%`, pattern]
    );

    return `SPR-${datePart}-${String(result.rows[0].next_number).padStart(4, '0')}`;
  } catch (error) {
    console.error('Supplier payment requests service request number generation failed:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      detail: error.detail,
      hint: error.hint
    });

    return `SPR-${datePart}-${Date.now()}`;
  }
}

async function existingUserId(client, userId) {
  const normalized = UUID_PATTERN.test(String(userId || '')) ? String(userId) : null;
  if (!normalized) {
    return null;
  }

  try {
    const result = await client.query('SELECT id FROM users WHERE id = $1 LIMIT 1', [normalized]);
    return result.rows[0]?.id || null;
  } catch (error) {
    if (isOptionalRelationError(error)) {
      logOptionalRelationError('users', error);
      return null;
    }

    throw error;
  }
}

async function addActivity(client, paymentRequestId, action, options = {}) {
  const columns = await tableColumns('supplier_payment_request_activity_logs');
  if (!hasColumns(columns, ['payment_request_id', 'action'])) {
    console.warn('Supplier payment request activity log skipped: table or required columns are missing');
    return;
  }

  const payload = {
    payment_request_id: paymentRequestId,
    action,
    old_value: options.oldValue === undefined ? null : String(options.oldValue),
    new_value: options.newValue === undefined ? null : String(options.newValue),
    description: options.description || null,
    created_by: UUID_PATTERN.test(String(options.userId || '')) ? options.userId : null
  };
  const insert = buildInsert(payloadForColumns(payload, columns));

  await client.query(
    `
      INSERT INTO supplier_payment_request_activity_logs (${insert.columns})
      VALUES (${insert.placeholders})
    `,
    insert.values
  );
}

async function setSupplierLinks(client, paymentRequestId, supplierIds) {
  const columns = await tableColumns('supplier_payment_request_suppliers');
  if (!hasColumns(columns, ['payment_request_id', 'supplier_id'])) {
    console.warn('Supplier payment request supplier links skipped: table or required columns are missing');
    return;
  }

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

async function suppliersForRequestIds(ids, requests = [], schema = {}) {
  if (ids.length === 0) return new Map();

  const supplierColumns = schema.supplierColumns || await tableColumns('suppliers');
  const contactColumns = schema.contactColumns || await tableColumns('contacts');
  const linkColumns = schema.linkColumns || await tableColumns('supplier_payment_request_suppliers');
  const linkRows = [];

  for (const request of requests) {
    if (request.id && request.supplier_id) {
      linkRows.push({
        request_id: request.id,
        supplier_id: request.supplier_id
      });
    }
  }

  if (hasColumns(linkColumns, ['payment_request_id', 'supplier_id'])) {
    linkRows.push(...await optionalRows('supplier_payment_request_suppliers', () => query(
      `
        SELECT
          sprs.payment_request_id AS request_id,
          sprs.supplier_id
        FROM supplier_payment_request_suppliers sprs
        WHERE sprs.payment_request_id = ANY($1::uuid[])
          AND sprs.supplier_id IS NOT NULL
      `,
      [ids]
    )));
  }

  if (linkRows.length === 0) {
    return new Map();
  }

  const supplierIds = [...new Set(linkRows.map((row) => row.supplier_id).filter(Boolean))];
  if (supplierIds.length === 0 || !supplierColumns.has('id')) {
    return new Map();
  }

  const supplierSelect = SUPPLIER_RESPONSE_COLUMNS
    .map((column) => `${selectColumn('s', supplierColumns, column)} AS ${column}`)
    .join(',\n        ');
  const supplierRows = await optionalRows('suppliers', () => query(
    `
      SELECT
        s.id,
        ${supplierSelect}
      FROM suppliers s
      WHERE s.id = ANY($1::uuid[])
    `,
    [supplierIds]
  ));

  const contacts = hasColumns(contactColumns, ['supplier_id'])
    ? await optionalRows('contacts', () => query(
      `
        SELECT
          supplier_id,
          ${selectColumn('contacts', contactColumns, 'phone')} AS phone,
          ${selectColumn('contacts', contactColumns, 'email')} AS email
        FROM contacts
        WHERE supplier_id = ANY($1::uuid[])
      `,
      [supplierIds]
    ))
    : [];

  const contactsBySupplier = new Map();
  for (const contact of contacts) {
    if (!contact.supplier_id) continue;
    if (!contactsBySupplier.has(contact.supplier_id)) {
      contactsBySupplier.set(contact.supplier_id, { phones: new Set(), emails: new Set() });
    }

    const entry = contactsBySupplier.get(contact.supplier_id);
    if (contact.phone) entry.phones.add(contact.phone);
    if (contact.email) entry.emails.add(contact.email);
  }

  const suppliersById = new Map(supplierRows.map((supplier) => {
    const contact = contactsBySupplier.get(supplier.id);
    return [supplier.id, {
      id: supplier.id,
      name_ar: supplier.name_ar || null,
      name_en: supplier.name_en || supplier.name || null,
      cr_number: supplier.cr_number || null,
      vat_number: supplier.vat_number || null,
      city: supplier.city || null,
      category: supplier.category || null,
      status: supplier.status || null,
      phones: contact ? [...contact.phones] : [],
      emails: contact ? [...contact.emails] : []
    }];
  }));

  const map = new Map();
  const seen = new Map();
  for (const row of linkRows) {
    const supplier = suppliersById.get(row.supplier_id);
    if (!row.request_id || !supplier) continue;

    if (!map.has(row.request_id)) {
      map.set(row.request_id, []);
      seen.set(row.request_id, new Set());
    }

    if (seen.get(row.request_id).has(supplier.id)) continue;

    map.get(row.request_id).push(supplier);
    seen.get(row.request_id).add(supplier.id);
  }

  for (const suppliers of map.values()) {
    suppliers.sort((a, b) => (a.name_ar || a.name_en || a.id).localeCompare(b.name_ar || b.name_en || b.id));
  }

  return map;
}

async function attachSuppliers(requests, schema = {}) {
  const map = await suppliersForRequestIds(requests.map((request) => request.id), requests, schema);
  return requests.map((request) => ({
    ...request,
    suppliers: map.get(request.id) || []
  }));
}

async function list(params = {}) {
  try {
    const schema = await supplierPaymentRequestSchema();
    const missingColumns = SUPPLIER_PAYMENT_REQUEST_COLUMNS.filter((column) => !schema.requestColumns.has(column));
    if (missingColumns.length > 0) {
      console.warn('supplier_payment_requests is missing migration columns; list will return nulls for absent fields:', missingColumns);
    }

    const filters = buildFilters(params, schema);
    const paging = limitOffset(params, filters.values.length + 1);
    const selectColumns = requestSelectSql(schema.requestColumns);
    const orderSql = listOrderSql(schema.requestColumns);
    const summarySql = summarySelectSql(schema.requestColumns);

    const [rowsResult, countResult, summaryResult] = await Promise.all([
      query(
        `
          SELECT ${selectColumns}
          FROM supplier_payment_requests spr
          ${filters.whereSql}
          ${orderSql}
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
            ${summarySql}
          FROM supplier_payment_requests spr
          ${filters.whereSql}
        `,
        filters.values
      )
    ]);

    return {
      data: await attachSuppliers(rowsResult.rows, schema),
      meta: {
        total: countResult.rows[0]?.total || 0,
        limit: paging.limit,
        offset: paging.offset
      },
      summary: normalizeSummary(summaryResult.rows[0])
    };
  } catch (error) {
    logServiceError('list', error, { params });
    throw error;
  }
}

async function getById(id) {
  const requestId = requireUuid(id, 'id');
  const schema = await supplierPaymentRequestSchema();
  const selectColumns = requestSelectSql(schema.requestColumns);
  const deletedFilter = schema.requestColumns.has('deleted_at') ? 'AND spr.deleted_at IS NULL' : '';
  const result = await query(
    `
      SELECT ${selectColumns}
      FROM supplier_payment_requests spr
      WHERE spr.id = $1
      ${deletedFilter}
    `,
    [requestId]
  );
  const paymentRequest = result.rows[0];

  if (!paymentRequest) {
    throw createHttpError(404, 'Supplier payment request not found');
  }

  const [withSuppliers, documents, activity_logs] = await Promise.all([
    attachSuppliers([paymentRequest], schema).then(([row]) => row),
    listDocuments(requestId),
    listActivityLogs(requestId)
  ]);

  return { ...withSuppliers, documents, activity_logs };
}

async function create(data = {}, userId) {
  try {
    const schema = await supplierPaymentRequestSchema();
    const supplierIds = normalizeSupplierIds(data);
    const payload = preparePayload(data);

    if (!Object.prototype.hasOwnProperty.call(payload, 'amount')) {
      throw createHttpError(400, 'amount is required and must be greater than 0');
    }

    if (supplierIds.length === 0) {
      throw createHttpError(400, 'supplier_id or supplier_ids is required');
    }

    payload.status = payload.status || 'New';
    payload.priority = payload.priority || 'Normal';
    payload.payment_reason = normalizePaymentReason(payload.payment_reason);
    if (schema.requestColumns.has('supplier_id')) {
      payload.supplier_id = supplierIds[0];
    }

    const row = await withTransaction(async (client) => {
      if (schema.requestColumns.has('created_by')) {
        const createdBy = await existingUserId(client, userId);
        if (createdBy) {
          payload.created_by = createdBy;
        }
      }

      if (schema.requestColumns.has('request_number') && !payload.request_number) {
        payload.request_number = await generateRequestNumber(client);
      }

      const insertPayload = payloadForColumns(payload, schema.requestColumns);
      const insert = buildInsert(insertPayload);
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
        userId: insertPayload.created_by
      });

      return result.rows[0];
    });

    return getById(row.id);
  } catch (error) {
    logServiceError('create', error, {
      supplier_id: data?.supplier_id,
      supplier_ids_type: Array.isArray(data?.supplier_ids) ? 'array' : typeof data?.supplier_ids,
      has_amount: Object.prototype.hasOwnProperty.call(data || {}, 'amount'),
      user_id_present: Boolean(userId)
    });
    throw error;
  }
}

async function update(id, data = {}, userId) {
  const requestId = requireUuid(id, 'id');
  const schema = await supplierPaymentRequestSchema();
  const existing = await getById(requestId);
  const supplierIdsProvided = Object.prototype.hasOwnProperty.call(data, 'supplier_ids') || Object.prototype.hasOwnProperty.call(data, 'supplierIds');
  const supplierIds = supplierIdsProvided ? normalizeSupplierIds(data) : undefined;
  const payload = preparePayload(data);

  if (supplierIds && schema.requestColumns.has('supplier_id') && !Object.prototype.hasOwnProperty.call(payload, 'supplier_id')) {
    payload.supplier_id = supplierIds[0] || null;
  }

  const updatePayload = payloadForColumns(payload, schema.requestColumns);

  if (Object.keys(updatePayload).length === 0 && supplierIds === undefined) {
    throw createHttpError(400, 'No valid fields were provided');
  }

  await withTransaction(async (client) => {
    if (Object.keys(updatePayload).length > 0) {
      const updateSql = buildUpdate(updatePayload);
      const deletedFilter = schema.requestColumns.has('deleted_at') ? 'AND deleted_at IS NULL' : '';
      const result = await client.query(
        `
          UPDATE supplier_payment_requests
          SET ${updateSql.assignments.join(', ')}, updated_at = now()
          WHERE id = $1 ${deletedFilter}
          RETURNING *
        `,
        [requestId, ...updateSql.values]
      );

      if (!result.rows[0]) {
        throw createHttpError(404, 'Supplier payment request not found');
      }

      await addActivity(client, requestId, 'updated', {
        description: 'Supplier payment request updated',
        userId
      });

      if (Object.prototype.hasOwnProperty.call(payload, 'status') && payload.status !== existing.status) {
        await addActivity(client, requestId, 'status changed', {
          oldValue: existing.status,
          newValue: payload.status,
          description: 'Status changed',
          userId
        });
      }

      if (Object.prototype.hasOwnProperty.call(payload, 'amount') && Number(payload.amount) !== Number(existing.amount || 0)) {
        await addActivity(client, requestId, 'amount changed', {
          oldValue: existing.amount,
          newValue: payload.amount,
          description: 'Amount changed',
          userId
        });
      }
    }

    if (supplierIds !== undefined) {
      await setSupplierLinks(client, requestId, supplierIds);
    }
  });

  return getById(requestId);
}

async function remove(id, userId) {
  const requestId = requireUuid(id, 'id');
  const schema = await supplierPaymentRequestSchema();
  const row = await withTransaction(async (client) => {
    const result = schema.requestColumns.has('deleted_at')
      ? await client.query(
        `
          UPDATE supplier_payment_requests
          SET deleted_at = now(), updated_at = now()
          WHERE id = $1 AND deleted_at IS NULL
          RETURNING *
        `,
        [requestId]
      )
      : await client.query(
        `
          DELETE FROM supplier_payment_requests
          WHERE id = $1
          RETURNING *
        `,
        [requestId]
      );

    if (!result.rows[0]) {
      throw createHttpError(404, 'Supplier payment request not found');
    }

    await addActivity(client, requestId, 'deleted', {
      oldValue: result.rows[0].request_number,
      description: 'Supplier payment request deleted',
      userId
    });

    return result.rows[0];
  });

  return row;
}

async function listDocuments(paymentRequestId) {
  const requestId = requireUuid(paymentRequestId, 'payment_request_id');
  return optionalRows('supplier_payment_request_documents', () => query(
    `
      SELECT *
      FROM supplier_payment_request_documents
      WHERE payment_request_id = $1
      ORDER BY created_at DESC
    `,
    [requestId]
  ), () => query(
    `
      SELECT *
      FROM supplier_payment_request_documents
      WHERE payment_request_id = $1
    `,
    [requestId]
  ));
}

async function uploadDocument(paymentRequestId, file, data, userId) {
  const requestId = requireUuid(paymentRequestId, 'payment_request_id');
  await getById(requestId);

  const documentType = data.document_type || data.documentType || 'Other';
  if (!DOCUMENT_TYPES.has(documentType)) {
    throw createHttpError(400, 'Invalid document type');
  }

  const originalName = sanitizeFileName(file.originalName);
  const storedName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${originalName}`;
  const relativePath = path.posix.join('supplier-payment-requests', requestId, storedName);
  const absoluteDir = path.join(__dirname, '..', '..', 'uploads', 'supplier-payment-requests', requestId);
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
        requestId,
        documentType,
        originalName,
        `/uploads/${relativePath}`,
        path.join('uploads', relativePath),
        file.mimeType,
        file.size,
        UUID_PATTERN.test(String(userId || '')) ? userId : null
      ]
    );

    await addActivity(client, requestId, 'document uploaded', {
      newValue: originalName,
      description: `Document uploaded: ${documentType}`,
      userId
    });

    return result.rows[0];
  });

  return row;
}

async function deleteDocument(paymentRequestId, documentId, userId) {
  const requestId = requireUuid(paymentRequestId, 'payment_request_id');
  const docId = requireUuid(documentId, 'document_id');
  const row = await withTransaction(async (client) => {
    const result = await client.query(
      `
        DELETE FROM supplier_payment_request_documents
        WHERE id = $1 AND payment_request_id = $2
        RETURNING *
      `,
      [docId, requestId]
    );

    if (!result.rows[0]) {
      throw createHttpError(404, 'Document not found');
    }

    await addActivity(client, requestId, 'document deleted', {
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
  const requestId = requireUuid(paymentRequestId, 'payment_request_id');
  return optionalRows('supplier_payment_request_activity_logs', () => query(
    `
      SELECT *
      FROM supplier_payment_request_activity_logs
      WHERE payment_request_id = $1
      ORDER BY created_at DESC
    `,
    [requestId]
  ), () => query(
    `
      SELECT *
      FROM supplier_payment_request_activity_logs
      WHERE payment_request_id = $1
    `,
    [requestId]
  ));
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
