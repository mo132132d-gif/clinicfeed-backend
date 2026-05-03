const readXlsxFile = require('read-excel-file/node');
const { query } = require('../db/query');
const { withTransaction } = require('../db/transaction');
const { logActivity } = require('./activityLog.service');
const { createHttpError } = require('../utils/httpError');

const MISSING_NOTE = 'معلومات ناقصة';

const headerAliases = {
  name: new Set(['suppliername', 'supplier_name', 'vendorname', 'arabicname', 'englishname', 'name', 'اسم المورد', 'اسمالمورد']),
  phone: new Set(['mobile', 'phone', 'primaryphone', 'رقمالجوال', 'الجوال']),
  email: new Set(['email', 'e-mail', 'emailaddress', 'البريدالالكتروني', 'الايميل', 'الإيميل'])
};

function extensionFromName(fileName) {
  const parts = String(fileName || '').split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

function normalizeArabic(value) {
  return String(value || '')
    .replace(/[إأآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
}

function normalizeHeader(value) {
  return normalizeArabic(value)
    .trim()
    .toLowerCase()
    .replace(/^\uFEFF/, '')
    .replace(/[\s_\-]+/g, '');
}

function normalizeSupplierName(value) {
  return normalizeArabic(value)
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function isMissingValue(value, { zeroIsMissing = false } = {}) {
  if (value === null || value === undefined) {
    return true;
  }

  const text = String(value).trim();
  if (!text) {
    return true;
  }

  const normalized = normalizeArabic(text).toLowerCase();
  return (
    normalized === '-' ||
    normalized === 'missing' ||
    normalized === 'null' ||
    normalized === 'n/a' ||
    normalized === 'na' ||
    normalized === 'غيرمتوفر' ||
    normalized === 'غير متوفر' ||
    (zeroIsMissing && /^0+$/.test(normalized))
  );
}

function valueToText(value) {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.trunc(value).toString() : '';
  }

  const text = String(value).trim();
  if (/^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i.test(text)) {
    const parsed = Number(text);
    return Number.isFinite(parsed) ? Math.trunc(parsed).toString() : text;
  }

  return text;
}

function cleanSupplierName(value) {
  if (isMissingValue(value, { zeroIsMissing: true })) {
    return null;
  }

  return valueToText(value).replace(/\s+/g, ' ').trim() || null;
}

function cleanPhone(value) {
  if (isMissingValue(value, { zeroIsMissing: true })) {
    return null;
  }

  const text = valueToText(value);
  const hasPlus = text.trim().startsWith('+');
  const digits = text.replace(/[^\d]/g, '');

  if (digits.length < 7 || /^0+$/.test(digits)) {
    return null;
  }

  return `${hasPlus ? '+' : ''}${digits}`;
}

function cleanEmail(value) {
  if (isMissingValue(value)) {
    return null;
  }

  const email = valueToText(value).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === ',' && !quoted) {
      row.push(value);
      value = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      row.push(value);
      if (row.some((cell) => String(cell).trim() !== '')) {
        rows.push(row);
      }
      row = [];
      value = '';
      continue;
    }

    value += char;
  }

  row.push(value);
  if (row.some((cell) => String(cell).trim() !== '')) {
    rows.push(row);
  }

  return rows;
}

async function fileToRows(file) {
  const extension = extensionFromName(file.originalName);
  if (extension === 'csv') {
    return parseCsv(file.buffer.toString('utf8').replace(/^\uFEFF/, ''));
  }

  if (extension === 'xlsx') {
    const workbookRows = await readXlsxFile(file.buffer);
    if (Array.isArray(workbookRows) && workbookRows[0] && !Array.isArray(workbookRows[0]) && Array.isArray(workbookRows[0].data)) {
      const sheet = workbookRows.find((candidate) => {
        const headers = candidate.data?.[0] || [];
        const map = headerMap(headers);
        return map.name.length > 0;
      });
      return sheet?.data || workbookRows[0].data;
    }
    return workbookRows;
  }

  throw createHttpError(400, 'Unsupported supplier import file. Save Excel files as .xlsx or UTF-8 .csv.');
}

function headerMap(headers) {
  const map = { name: [], phone: [], email: [] };

  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    for (const [field, aliases] of Object.entries(headerAliases)) {
      if (aliases.has(normalized)) {
        map[field].push(index);
      }
    }
  });

  return map;
}

function firstCleanValue(row, indexes, cleaner) {
  for (const index of indexes) {
    const value = cleaner(row[index]);
    if (value) return value;
  }
  return null;
}

async function parseSupplierImportFile(file) {
  const rows = await fileToRows(file);
  if (rows.length === 0) {
    return [];
  }

  const map = headerMap(rows[0]);
  if (map.name.length === 0) {
    throw createHttpError(400, 'Supplier name column was not found');
  }

  return rows.slice(1).map((row, index) => {
    const name = firstCleanValue(row, map.name, cleanSupplierName);
    const phone = firstCleanValue(row, map.phone, cleanPhone);
    const email = firstCleanValue(row, map.email, cleanEmail);
    const incomplete = !phone || !email;

    return {
      rowNumber: index + 2,
      raw: row,
      name,
      normalizedName: normalizeSupplierName(name || ''),
      phone,
      email,
      incomplete
    };
  });
}

async function loadExistingSupplierIndex() {
  const result = await query(
    `
      SELECT
        s.*,
        COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.is_primary DESC, c.created_at ASC) FILTER (WHERE c.id IS NOT NULL), '[]'::jsonb) AS contacts
      FROM suppliers s
      LEFT JOIN contacts c ON c.supplier_id = s.id
      GROUP BY s.id
    `,
    []
  );

  const byName = new Map();
  for (const supplier of result.rows) {
    const names = new Set([
      normalizeSupplierName(supplier.name_ar),
      normalizeSupplierName(supplier.name_en)
    ]);
    for (const name of names) {
      if (!name) continue;
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(supplier);
    }
  }

  return { byName };
}

function addSupplierToIndex(index, supplier, contacts = []) {
  const indexedSupplier = { ...supplier, contacts };
  const names = new Set([
    normalizeSupplierName(indexedSupplier.name_ar),
    normalizeSupplierName(indexedSupplier.name_en)
  ]);

  for (const name of names) {
    if (!name) continue;
    if (!index.byName.has(name)) index.byName.set(name, []);
    const rows = index.byName.get(name);
    const existingIndex = rows.findIndex((row) => row.id === indexedSupplier.id);
    if (existingIndex === -1) rows.push(indexedSupplier);
    else rows[existingIndex] = indexedSupplier;
  }

  return indexedSupplier;
}

function findExistingSupplier(index, row) {
  const candidates = index.byName.get(row.normalizedName) || [];
  if (candidates.length === 0) {
    return null;
  }

  if (row.email) {
    const byEmail = candidates.find((supplier) =>
      supplier.contacts.some((contact) => cleanEmail(contact.email) === row.email)
    );
    if (byEmail) return byEmail;
  }

  if (row.phone) {
    const byPhone = candidates.find((supplier) =>
      supplier.contacts.some((contact) => cleanPhone(contact.phone) === row.phone || cleanPhone(contact.whatsapp) === row.phone)
    );
    if (byPhone) return byPhone;
  }

  if (!row.email && !row.phone && candidates.length === 1) {
    return candidates[0];
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  return null;
}

function nextNotes(existingNotes, incomplete) {
  if (!incomplete) {
    return existingNotes || null;
  }

  if (!existingNotes) {
    return MISSING_NOTE;
  }

  return existingNotes.includes(MISSING_NOTE) ? existingNotes : `${existingNotes}\n${MISSING_NOTE}`;
}

function statusFromContact(existingStatus, phone, email) {
  if (existingStatus && !['Active', 'Pending'].includes(existingStatus)) {
    return existingStatus;
  }

  return phone && email ? 'Active' : 'Pending';
}

function contactForUpdate(contacts, row) {
  return (
    contacts.find((contact) => row.email && cleanEmail(contact.email) === row.email) ||
    contacts.find((contact) => row.phone && (cleanPhone(contact.phone) === row.phone || cleanPhone(contact.whatsapp) === row.phone)) ||
    contacts.find((contact) => contact.is_primary) ||
    contacts[0] ||
    null
  );
}

async function upsertContact(client, supplierId, row, knownContacts = null) {
  if (!row.phone && !row.email) {
    return null;
  }

  const existingContacts = knownContacts || [];
  const existing = contactForUpdate(existingContacts, row);

  await client.query('UPDATE contacts SET is_primary = false WHERE supplier_id = $1', [supplierId]);

  if (!existing) {
    const created = await client.query(
      `
        INSERT INTO contacts (supplier_id, name, phone, whatsapp, email, is_primary)
        VALUES ($1, $2, $3, $3, $4, true)
        RETURNING *
      `,
      [supplierId, row.name, row.phone, row.email]
    );
    return { type: 'created', contact: created.rows[0] };
  }

  const updated = await client.query(
    `
      UPDATE contacts
      SET
        name = COALESCE(NULLIF(name, ''), $2),
        phone = COALESCE(phone, $3),
        whatsapp = COALESCE(whatsapp, $3),
        email = COALESCE(email, $4),
        is_primary = true
      WHERE id = $1
      RETURNING *
    `,
    [existing.id, row.name, row.phone, row.email]
  );

  return { type: 'updated', contact: updated.rows[0] };
}

function createReport(totalRows = 0) {
  return {
    totalRows,
    imported: 0,
    updated: 0,
    contactsCreated: 0,
    contactsUpdated: 0,
    skipped: 0,
    incomplete: 0,
    duplicates: 0,
    failed: 0,
    failedRows: []
  };
}

async function importSupplierRows(rows, { actor, dryRun = false } = {}) {
  const report = createReport(rows.length);
  const seenKeys = new Set();
  const existingIndex = await loadExistingSupplierIndex();

  for (const row of rows) {
    try {
      if (!row.name) {
        report.skipped += 1;
        report.failed += 1;
        report.failedRows.push({ rowNumber: row.rowNumber, reason: 'Supplier name is missing' });
        continue;
      }

      if (row.incomplete) {
        report.incomplete += 1;
      }

      const dedupeKey = row.email
        ? `${row.normalizedName}|email:${row.email}`
        : row.phone
          ? `${row.normalizedName}|phone:${row.phone}`
          : `${row.normalizedName}|name`;

      if (seenKeys.has(dedupeKey)) {
        report.duplicates += 1;
      }
      seenKeys.add(dedupeKey);

      const existing = findExistingSupplier(existingIndex, row);
      if (existing) {
        report.duplicates += 1;
      }

      if (dryRun) {
        if (existing) {
          report.updated += 1;
        } else {
          report.imported += 1;
        }

        if (row.phone || row.email) {
          const hasContact = Boolean(contactForUpdate(existing?.contacts || [], row));
          if (hasContact) report.contactsUpdated += 1;
          else report.contactsCreated += 1;
        }
        continue;
      }

      await withTransaction(async (client) => {
        const computedStatus = statusFromContact(existing?.status, row.phone, row.email);
        const notes = nextNotes(existing?.notes, row.incomplete);
        let supplier;

        if (existing) {
          const result = await client.query(
            `
              UPDATE suppliers
              SET
                name_ar = COALESCE(NULLIF(name_ar, ''), $2),
                name_en = COALESCE(NULLIF(name_en, ''), $2),
                status = $3,
                notes = $4
              WHERE id = $1
              RETURNING *
            `,
            [existing.id, row.name, computedStatus, notes]
          );
          supplier = result.rows[0];
          report.updated += 1;
        } else {
          const result = await client.query(
            `
              INSERT INTO suppliers (name_ar, name_en, status, notes)
              VALUES ($1, $1, $2, $3)
              RETURNING *
            `,
            [row.name, computedStatus, notes]
          );
          supplier = result.rows[0];
          report.imported += 1;
        }

        const previousContacts = existing?.contacts || [];
        const contactResult = await upsertContact(client, supplier.id, row, previousContacts);
        if (contactResult?.type === 'created') report.contactsCreated += 1;
        if (contactResult?.type === 'updated') report.contactsUpdated += 1;

        const nextContacts = contactResult
          ? [
              contactResult.contact,
              ...previousContacts
                .filter((contact) => contact.id !== contactResult.contact.id)
                .map((contact) => ({ ...contact, is_primary: false }))
            ]
          : previousContacts;
        addSupplierToIndex(existingIndex, supplier, nextContacts);

        await logActivity({
          client,
          userId: actor?.id || null,
          action: existing ? 'supplier_import_updated' : 'supplier_import_created',
          entityType: 'Supplier',
          entityId: supplier.id,
          oldValue: existing || null,
          newValue: supplier
        });
      });
    } catch (error) {
      report.failed += 1;
      report.failedRows.push({ rowNumber: row.rowNumber, reason: error.message || 'Row import failed' });
    }
  }

  return report;
}

async function importSupplierFile(file, options = {}) {
  const rows = await parseSupplierImportFile(file);
  return importSupplierRows(rows, options);
}

async function previewCleanupCandidates({ names = [], since, until } = {}) {
  if (names.length === 0 && !since && !until) {
    throw new Error('Provide --file and/or --since for cleanup preview. Refusing broad cleanup scan.');
  }

  const values = [];
  const conditions = ["(s.notes ILIKE '%معلومات ناقصة%' OR s.status = 'Pending')"];

  if (names.length > 0) {
    values.push(names.map(normalizeSupplierName));
    conditions.push(`
      (
        regexp_replace(lower(trim(s.name_ar)), '\\s+', ' ', 'g') = ANY($${values.length})
        OR regexp_replace(lower(trim(s.name_en)), '\\s+', ' ', 'g') = ANY($${values.length})
      )
    `);
  }

  if (since) {
    values.push(since);
    conditions.push(`s.created_at >= $${values.length}`);
  }

  if (until) {
    values.push(until);
    conditions.push(`s.created_at <= $${values.length}`);
  }

  const result = await query(
    `
      SELECT
        s.id,
        s.name_ar,
        s.status,
        s.notes,
        s.created_at,
        COUNT(DISTINCT c.id)::int AS contacts_count,
        COUNT(DISTINCT contracts.id)::int AS contracts_count,
        COUNT(DISTINCT documents.id)::int AS documents_count
      FROM suppliers s
      LEFT JOIN contacts c ON c.supplier_id = s.id
      LEFT JOIN contracts ON contracts.supplier_id = s.id
      LEFT JOIN documents ON documents.supplier_id = s.id
      WHERE ${conditions.join(' AND ')}
      GROUP BY s.id
      ORDER BY s.created_at DESC
    `,
    values
  );

  const candidates = result.rows.filter((row) => row.contracts_count === 0 && row.documents_count === 0);
  const excludedLinked = result.rows.filter((row) => row.contracts_count > 0 || row.documents_count > 0);

  return { candidates, excludedLinked };
}

module.exports = {
  MISSING_NOTE,
  cleanEmail,
  cleanPhone,
  cleanSupplierName,
  importSupplierFile,
  importSupplierRows,
  parseSupplierImportFile,
  previewCleanupCandidates
};
