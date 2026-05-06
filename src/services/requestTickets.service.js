const ExcelJS = require('exceljs');
const { query } = require('../db/query');
const { withTransaction } = require('../db/transaction');
const { createHttpError } = require('../utils/httpError');
const { isClosedStatus, normalizeTicketStatus } = require('../utils/ticketStatus');

const TICKET_FIELDS = [
  'ticket_number',
  'customer_name',
  'phone',
  'email',
  'country',
  'region',
  'request_description',
  'assigned_to',
  'status',
  'priority',
  'source',
  'internal_notes',
  'cancellation_reason',
  'order_amount',
  'vat_amount',
  'qr_code'
];

const CREATE_FIELDS = TICKET_FIELDS;
const UPDATE_FIELDS = TICKET_FIELDS.filter((field) => field !== 'ticket_number');

function statusBucketSql(alias = 'rt') {
  return `
    CASE
      WHEN lower(${alias}.status) IN ('completed', 'executed', 'done', 'success', 'fulfilled')
        OR ${alias}.status IN ('منفذ', 'مكتمل', 'تم التنفيذ')
        THEN 'completed'
      WHEN lower(${alias}.status) IN ('cancelled', 'canceled', 'rejected', 'failed')
        OR ${alias}.status IN ('ملغي', 'ملغى', 'مرفوض')
        THEN 'cancelled'
      ELSE 'pending'
    END
  `;
}

function parseOptionalAmount(value, field) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw createHttpError(400, `${field} must be a valid number`);
  }

  return parsed;
}

function amountValue(value) {
  if (value === null || value === undefined || value === '') {
    return 0;
  }

  return Number(value);
}

function normalizeSupplierIds(value) {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw createHttpError(400, 'supplier_ids must be an array');
  }

  return [...new Set(value.filter(Boolean).map((id) => String(id)))];
}

function filteredPayload(data, fields) {
  return fields.reduce((payload, field) => {
    if (Object.prototype.hasOwnProperty.call(data, field) && data[field] !== undefined) {
      payload[field] = data[field];
    }

    return payload;
  }, {});
}

function preparePayload(data, fields) {
  const payload = filteredPayload(data, fields);

  if (Object.prototype.hasOwnProperty.call(payload, 'status')) {
    payload.status = String(payload.status).trim();
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'order_amount')) {
    payload.order_amount = parseOptionalAmount(payload.order_amount, 'order_amount');
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'vat_amount')) {
    payload.vat_amount = parseOptionalAmount(payload.vat_amount, 'vat_amount');
  }

  return payload;
}

function buildInsert(payload) {
  const keys = Object.keys(payload).filter((key) => payload[key] !== undefined);
  const columns = keys.map((key) => `"${key}"`).join(', ');
  const placeholders = keys.map((_, index) => `$${index + 1}`).join(', ');
  const values = keys.map((key) => payload[key]);

  return { columns, placeholders, values };
}

function buildUpdate(payload) {
  const keys = Object.keys(payload).filter((key) => payload[key] !== undefined);
  const assignments = keys.map((key, index) => `"${key}" = $${index + 2}`);
  const values = keys.map((key) => payload[key]);

  return { assignments, values };
}

function buildFilters(queryParams = {}, startIndex = 1) {
  const conditions = [];
  const values = [];
  let index = startIndex;

  const statusView = queryParams.status || queryParams.view;
  if (statusView && !['all', 'kanban', 'table'].includes(String(statusView).toLowerCase())) {
    const normalized = normalizeTicketStatus(statusView) || String(statusView).trim().toLowerCase();
    values.push(normalized);
    conditions.push(`${statusBucketSql('rt')} = $${index}`);
    index += 1;
  }

  if (queryParams.assigned_to) {
    values.push(queryParams.assigned_to);
    conditions.push('rt.assigned_to = $' + index);
    index += 1;
  }

  if (queryParams.date_from) {
    values.push(queryParams.date_from);
    conditions.push('rt.created_at >= $' + index + '::timestamptz');
    index += 1;
  }

  if (queryParams.date_to) {
    values.push(queryParams.date_to);
    conditions.push("rt.created_at < ($" + index + "::date + INTERVAL '1 day')");
    index += 1;
  }

  if (queryParams.search) {
    values.push(`%${queryParams.search}%`);
    conditions.push(`(
      rt.ticket_number ILIKE $${index}
      OR rt.customer_name ILIKE $${index}
      OR rt.phone ILIKE $${index}
      OR rt.email ILIKE $${index}
      OR rt.country ILIKE $${index}
      OR rt.region ILIKE $${index}
      OR rt.request_description ILIKE $${index}
      OR rt.assigned_to ILIKE $${index}
    )`);
    index += 1;
  }

  return {
    whereSql: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    values
  };
}

async function generateTicketNumber(client) {
  const result = await client.query(`
    SELECT COALESCE(MAX(substring(ticket_number from '^(?:REQ|RT)-([0-9]+)$')::int), 0) + 1 AS next_number
    FROM request_tickets
    WHERE ticket_number ~ '^(REQ|RT)-[0-9]+$'
  `);

  return `REQ-${String(result.rows[0].next_number).padStart(6, '0')}`;
}

async function setSupplierLinks(ticketId, supplierIds, client) {
  await client.query('DELETE FROM request_ticket_suppliers WHERE ticket_id = $1', [ticketId]);

  if (!supplierIds || supplierIds.length === 0) {
    return;
  }

  const values = [];
  const rows = supplierIds.map((supplierId, index) => {
    values.push(ticketId, supplierId);
    const offset = index * 2;
    return `($${offset + 1}, $${offset + 2})`;
  });

  await client.query(
    `
      INSERT INTO request_ticket_suppliers (ticket_id, supplier_id)
      VALUES ${rows.join(', ')}
      ON CONFLICT (ticket_id, supplier_id) DO NOTHING
    `,
    values
  );
}

async function suppliersForTicketIds(ticketIds) {
  if (ticketIds.length === 0) {
    return new Map();
  }

  const result = await query(
    `
      SELECT
        rts.ticket_id,
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
      FROM request_ticket_suppliers rts
      JOIN suppliers s ON s.id = rts.supplier_id
      LEFT JOIN contacts c ON c.supplier_id = s.id
      WHERE rts.ticket_id = ANY($1::uuid[])
      GROUP BY rts.ticket_id, s.id
      ORDER BY s.name_ar ASC NULLS LAST, s.name_en ASC NULLS LAST
    `,
    [ticketIds]
  );

  const byTicket = new Map();
  for (const supplier of result.rows) {
    if (!byTicket.has(supplier.ticket_id)) {
      byTicket.set(supplier.ticket_id, []);
    }

    byTicket.get(supplier.ticket_id).push({
      id: supplier.id,
      name_ar: supplier.name_ar,
      name_en: supplier.name_en,
      cr_number: supplier.cr_number,
      vat_number: supplier.vat_number,
      city: supplier.city,
      category: supplier.category,
      status: supplier.status,
      phones: supplier.phones || [],
      emails: supplier.emails || []
    });
  }

  return byTicket;
}

async function attachSuppliers(tickets) {
  const supplierMap = await suppliersForTicketIds(tickets.map((ticket) => ticket.id));
  return tickets.map((ticket) => ({
    ...ticket,
    normalized_status: normalizeTicketStatus(ticket.status) || 'pending',
    suppliers: supplierMap.get(ticket.id) || []
  }));
}

async function list(queryParams = {}) {
  const filters = buildFilters(queryParams);
  const result = await query(
    `
      SELECT rt.*
      FROM request_tickets rt
      ${filters.whereSql}
      ORDER BY rt.created_at DESC, rt.ticket_number DESC NULLS LAST
    `,
    filters.values
  );

  return attachSuppliers(result.rows);
}

async function getById(id) {
  const result = await query('SELECT * FROM request_tickets WHERE id = $1', [id]);
  const ticket = result.rows[0];

  if (!ticket) {
    throw createHttpError(404, 'Request ticket not found');
  }

  const [withSuppliers] = await attachSuppliers([ticket]);
  return withSuppliers;
}

async function create(data) {
  const supplierIds = normalizeSupplierIds(data.supplier_ids);
  const payload = preparePayload(data, CREATE_FIELDS);

  if (!payload.customer_name || !payload.request_description) {
    throw createHttpError(400, 'customer_name and request_description are required');
  }

  if (!payload.ticket_number) {
    payload.ticket_number = null;
  }

  if (payload.order_amount !== undefined || payload.vat_amount !== undefined) {
    payload.total_amount = amountValue(payload.order_amount) + amountValue(payload.vat_amount);
  }

  const row = await withTransaction(async (client) => {
    if (!payload.ticket_number) {
      payload.ticket_number = await generateTicketNumber(client);
    }

    const insert = buildInsert(payload);
    const result = await client.query(
      `
        INSERT INTO request_tickets (${insert.columns})
        VALUES (${insert.placeholders})
        RETURNING *
      `,
      insert.values
    );

    await setSupplierLinks(result.rows[0].id, supplierIds, client);
    return result.rows[0];
  });

  return getById(row.id);
}

async function update(id, data) {
  const supplierIds = normalizeSupplierIds(data.supplier_ids);
  const existing = await getById(id);
  const payload = preparePayload(data, UPDATE_FIELDS);

  if (Object.prototype.hasOwnProperty.call(payload, 'order_amount') || Object.prototype.hasOwnProperty.call(payload, 'vat_amount')) {
    const orderAmount = Object.prototype.hasOwnProperty.call(payload, 'order_amount')
      ? payload.order_amount
      : existing.order_amount;
    const vatAmount = Object.prototype.hasOwnProperty.call(payload, 'vat_amount')
      ? payload.vat_amount
      : existing.vat_amount;
    payload.total_amount = amountValue(orderAmount) + amountValue(vatAmount);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'status') && isClosedStatus(payload.status) && !existing.closed_at) {
    payload.closed_at = new Date();
  }

  if (Object.keys(payload).length === 0 && supplierIds === undefined) {
    throw createHttpError(400, 'No valid fields were provided');
  }

  await withTransaction(async (client) => {
    if (Object.keys(payload).length > 0) {
      const updateSql = buildUpdate(payload);
      const result = await client.query(
        `
          UPDATE request_tickets
          SET ${updateSql.assignments.join(', ')}, updated_at = now()
          WHERE id = $1
          RETURNING *
        `,
        [id, ...updateSql.values]
      );

      if (!result.rows[0]) {
        throw createHttpError(404, 'Request ticket not found');
      }
    }

    if (supplierIds !== undefined) {
      await setSupplierLinks(id, supplierIds, client);
    }
  });

  return getById(id);
}

async function remove(id) {
  const result = await query('DELETE FROM request_tickets WHERE id = $1 RETURNING *', [id]);

  if (!result.rows[0]) {
    throw createHttpError(404, 'Request ticket not found');
  }

  return result.rows[0];
}

async function summary(queryParams = {}) {
  const filters = buildFilters(queryParams);
  const result = await query(
    `
      WITH filtered AS (
        SELECT rt.*, ${statusBucketSql('rt')} AS normalized_status
        FROM request_tickets rt
        ${filters.whereSql}
      ),
      supplier_counts AS (
        SELECT ticket_id, COUNT(*)::int AS supplier_count
        FROM request_ticket_suppliers
        GROUP BY ticket_id
      )
      SELECT
        COUNT(*)::int AS total_requests,
        (COUNT(*) FILTER (WHERE normalized_status = 'completed'))::int AS completed_requests,
        (COUNT(*) FILTER (WHERE normalized_status = 'cancelled'))::int AS cancelled_requests,
        (COUNT(*) FILTER (WHERE normalized_status = 'pending'))::int AS pending_requests,
        COALESCE(SUM(order_amount), 0)::float AS order_amount_sum,
        COALESCE(SUM(vat_amount), 0)::float AS vat_amount_sum,
        COALESCE(SUM(total_amount), 0)::float AS total_amount_sum,
        COALESCE(AVG(total_amount), 0)::float AS average_order_value,
        COALESCE(MAX(total_amount), 0)::float AS max_order_value,
        (COUNT(*) FILTER (WHERE COALESCE(sc.supplier_count, 0) = 0))::int AS tickets_without_supplier,
        (COUNT(*) FILTER (WHERE COALESCE(sc.supplier_count, 0) > 0))::int AS tickets_with_suppliers
      FROM filtered f
      LEFT JOIN supplier_counts sc ON sc.ticket_id = f.id
    `,
    filters.values
  );

  return result.rows[0] || {
    total_requests: 0,
    completed_requests: 0,
    cancelled_requests: 0,
    pending_requests: 0,
    order_amount_sum: 0,
    vat_amount_sum: 0,
    total_amount_sum: 0,
    average_order_value: 0,
    max_order_value: 0,
    tickets_without_supplier: 0,
    tickets_with_suppliers: 0
  };
}

async function dashboardSummary(queryParams = {}) {
  const data = await summary(queryParams);
  return {
    total_requests: data.total_requests,
    completed_requests: data.completed_requests,
    cancelled_requests: data.cancelled_requests,
    pending_requests: data.pending_requests,
    total_amount_sum: data.total_amount_sum
  };
}

function supplierText(ticket, field) {
  return ticket.suppliers
    .map((supplier) => {
      if (field === 'name') {
        return supplier.name_ar || supplier.name_en || supplier.id;
      }

      return (supplier[field] || []).join(', ');
    })
    .filter(Boolean)
    .join(' | ');
}

async function exportWorkbook(queryParams = {}) {
  const [tickets, totals] = await Promise.all([
    list(queryParams),
    summary(queryParams)
  ]);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ClinicFeed';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('طلبات العملاء', {
    views: [{ rightToLeft: true }]
  });

  worksheet.properties.defaultRowHeight = 22;
  worksheet.mergeCells('A1:D1');
  worksheet.getCell('A1').value = 'تقرير طلبات العملاء';
  worksheet.getCell('A1').font = { bold: true, size: 16 };
  worksheet.getCell('A1').alignment = { horizontal: 'center' };

  const summaryRows = [
    ['إجمالي الطلبات', totals.total_requests],
    ['الطلبات المكتملة', totals.completed_requests],
    ['الطلبات الملغاة', totals.cancelled_requests],
    ['الطلبات المعلقة', totals.pending_requests],
    ['إجمالي قيمة الطلبات', totals.order_amount_sum],
    ['إجمالي الضريبة', totals.vat_amount_sum],
    ['الإجمالي شامل الضريبة', totals.total_amount_sum],
    ['متوسط قيمة الطلب', totals.average_order_value],
    ['أعلى قيمة طلب', totals.max_order_value],
    ['طلبات بدون مورد', totals.tickets_without_supplier],
    ['طلبات مرتبطة بموردين', totals.tickets_with_suppliers]
  ];

  summaryRows.forEach((row, index) => {
    const rowNumber = index + 3;
    worksheet.getCell(`A${rowNumber}`).value = row[0];
    worksheet.getCell(`B${rowNumber}`).value = row[1];
    worksheet.getCell(`A${rowNumber}`).font = { bold: true };
  });

  const headerRowNumber = summaryRows.length + 5;
  const headers = [
    'رقم التذكرة',
    'اسم العميل',
    'الجوال',
    'البريد الإلكتروني',
    'الدولة',
    'المنطقة',
    'وصف الطلب',
    'المسؤول',
    'الحالة',
    'الأولوية',
    'المصدر',
    'ملاحظات داخلية',
    'سبب الإلغاء',
    'قيمة الطلب',
    'الضريبة',
    'الإجمالي',
    'الموردون',
    'هواتف الموردين',
    'بريد الموردين',
    'تاريخ الإنشاء',
    'تاريخ الإغلاق'
  ];

  worksheet.getRow(headerRowNumber).values = headers;
  worksheet.getRow(headerRowNumber).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  worksheet.getRow(headerRowNumber).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1F4E78' }
  };

  tickets.forEach((ticket, index) => {
    worksheet.getRow(headerRowNumber + index + 1).values = [
      ticket.ticket_number,
      ticket.customer_name,
      ticket.phone,
      ticket.email,
      ticket.country,
      ticket.region,
      ticket.request_description,
      ticket.assigned_to,
      ticket.normalized_status,
      ticket.priority,
      ticket.source,
      ticket.internal_notes,
      ticket.cancellation_reason,
      Number(ticket.order_amount || 0),
      Number(ticket.vat_amount || 0),
      Number(ticket.total_amount || 0),
      supplierText(ticket, 'name'),
      supplierText(ticket, 'phones'),
      supplierText(ticket, 'emails'),
      ticket.created_at,
      ticket.closed_at
    ];
  });

  worksheet.columns.forEach((column) => {
    column.width = 18;
    column.alignment = { vertical: 'top', wrapText: true };
  });
  worksheet.getColumn(7).width = 42;
  worksheet.getColumn(12).width = 32;
  worksheet.getColumn(17).width = 30;

  return workbook.xlsx.writeBuffer();
}

module.exports = {
  list,
  getById,
  create,
  update,
  remove,
  summary,
  dashboardSummary,
  exportWorkbook
};
