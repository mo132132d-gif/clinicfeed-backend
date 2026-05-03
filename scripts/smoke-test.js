const Module = require('node:module');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://memory';
process.env.DATABASE_SSL = 'false';
process.env.JWT_SECRET = 'test-secret';
process.env.JWT_EXPIRES_IN = '1h';
process.env.BCRYPT_ROUNDS = '4';

const TEST_TODAY = '2026-04-30';

function addDays(date, days) {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function daysAgo(days) {
  return `${addDays(TEST_TODAY, -days)}T00:00:00.000Z`;
}

function uuidFromCounter(counter) {
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
}

function clone(value) {
  return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function toDate(value) {
  if (!value) {
    return null;
  }

  return new Date(String(value).includes('T') ? value : `${value}T00:00:00.000Z`);
}

function maxDate(values) {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((latest, value) => (toDate(value) > toDate(latest) ? value : latest));
}

const db = {
  users: [],
  suppliers: [],
  contacts: [],
  contracts: [],
  documents: [],
  activity_logs: []
};

let idCounter = 1;

function resetDb() {
  for (const table of Object.keys(db)) {
    db[table] = [];
  }

  idCounter = 1;
}

function now() {
  return `${TEST_TODAY}T12:00:00.000Z`;
}

function baseRow() {
  return {
    id: uuidFromCounter(idCounter++),
    created_at: now(),
    updated_at: now()
  };
}

function defaultsForTable(table) {
  if (table === 'suppliers') {
    return { status: 'Pending' };
  }

  if (table === 'contacts') {
    return { is_primary: false };
  }

  if (table === 'contracts') {
    return { status: 'Active' };
  }

  if (table === 'documents') {
    return { last_updated: now() };
  }

  if (table === 'users') {
    return { role: 'viewer', is_active: true };
  }

  return {};
}

function stripIdentifier(identifier) {
  return identifier.trim().replaceAll('"', '');
}

function insertRow(table, data) {
  const row = {
    ...baseRow(),
    ...defaultsForTable(table),
    ...data
  };

  db[table].push(row);
  return clone(row);
}

function updateRow(table, id, data) {
  const index = db[table].findIndex((row) => row.id === id);
  if (index === -1) {
    return null;
  }

  db[table][index] = {
    ...db[table][index],
    ...data,
    updated_at: now()
  };

  return clone(db[table][index]);
}

function deleteRow(table, id) {
  const index = db[table].findIndex((row) => row.id === id);
  if (index === -1) {
    return null;
  }

  const [removed] = db[table].splice(index, 1);
  return clone(removed);
}

function tableFromQuotedSql(sql, verb) {
  const match = sql.match(new RegExp(`${verb}\\s+"?([a-z_]+)"?`, 'i'));
  return match ? match[1] : null;
}

function runListQuery(sql, params) {
  const table = tableFromQuotedSql(sql, 'FROM');
  let rows = [...db[table]];
  const whereMatch = sql.match(/WHERE\s+(.+?)\s+ORDER BY/is);

  if (whereMatch) {
    const where = whereMatch[1];
    const equalityMatches = [...where.matchAll(/"([a-z_]+)"\s*=\s*\$(\d+)/gi)];
    for (const [, field, position] of equalityMatches) {
      rows = rows.filter((row) => String(row[field]) === String(params[Number(position) - 1]));
    }
  }

  const limit = Number(params[params.length - 2] || 25);
  const offset = Number(params[params.length - 1] || 0);
  return rows.slice(offset, offset + limit).map(clone);
}

function runCountQuery(sql, params) {
  return [{ total: runListQuery(`${sql} ORDER BY "created_at" DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, 100000, 0]).length }];
}

function supplierById(id) {
  return db.suppliers.find((supplier) => supplier.id === id);
}

function documentWithSupplier(document) {
  const supplier = supplierById(document.supplier_id);
  return {
    ...clone(document),
    supplier_name_ar: supplier && supplier.name_ar,
    supplier_name_en: supplier && supplier.name_en
  };
}

function expiredDocuments() {
  return db.documents
    .filter((document) => document.expiry_date && toDate(document.expiry_date) < toDate(TEST_TODAY))
    .sort((a, b) => toDate(a.expiry_date) - toDate(b.expiry_date))
    .map(documentWithSupplier);
}

function documentsExpiringSoon() {
  const today = toDate(TEST_TODAY);
  const in30Days = toDate(addDays(TEST_TODAY, 30));

  return db.documents
    .filter((document) => {
      const expiry = toDate(document.expiry_date);
      return expiry && expiry >= today && expiry <= in30Days;
    })
    .sort((a, b) => toDate(a.expiry_date) - toDate(b.expiry_date))
    .map(documentWithSupplier);
}

function missingContactInfo() {
  return db.suppliers
    .map((supplier) => {
      const contact = db.contacts.find((row) => row.supplier_id === supplier.id && row.is_primary === true);
      const missingFields = [];

      if (!contact) {
        missingFields.push('primary_contact');
      } else {
        if (!contact.phone) missingFields.push('phone');
        if (!contact.whatsapp) missingFields.push('whatsapp');
        if (!contact.email) missingFields.push('email');
      }

      if (missingFields.length === 0) {
        return null;
      }

      return {
        supplier_id: supplier.id,
        supplier_name_ar: supplier.name_ar,
        supplier_name_en: supplier.name_en,
        supplier_status: supplier.status,
        contact_id: contact ? contact.id : null,
        contact_name: contact ? contact.name : null,
        missing_fields: missingFields
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.supplier_name_en.localeCompare(b.supplier_name_en));
}

function outdatedPriceLists() {
  const cutoff = new Date(`${TEST_TODAY}T12:00:00.000Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 90);

  return db.suppliers
    .map((supplier) => {
      const priceLists = db.documents
        .filter((document) => document.supplier_id === supplier.id && document.type === 'Price List')
        .map((document) => document.last_updated);
      const lastUpdated = maxDate(priceLists);

      if (lastUpdated && toDate(lastUpdated) >= cutoff) {
        return null;
      }

      return {
        supplier_id: supplier.id,
        supplier_name_ar: supplier.name_ar,
        supplier_name_en: supplier.name_en,
        supplier_status: supplier.status,
        last_price_list_updated: lastUpdated,
        alert_type: lastUpdated ? 'outdated_price_list' : 'missing_price_list'
      };
    })
    .filter(Boolean);
}

class FakePool {
  async query(sql, params = []) {
    const compactSql = sql.replace(/\s+/g, ' ').trim();

    if (compactSql === 'BEGIN' || compactSql === 'COMMIT' || compactSql === 'ROLLBACK') {
      return { rows: [], rowCount: 0 };
    }

    if (/SELECT id, name, email, password_hash, role, is_active/.test(sql) && /FROM users/.test(sql)) {
      const email = String(params[0]).toLowerCase();
      const row = db.users.find((user) => user.email.toLowerCase() === email);
      return { rows: row ? [clone(row)] : [], rowCount: row ? 1 : 0 };
    }

    if (/SELECT id, name, email, role, is_active/.test(sql) && /FROM users/.test(sql) && /WHERE id = \$1/.test(sql)) {
      const row = db.users.find((user) => user.id === params[0]);
      return { rows: row ? [clone(row)] : [], rowCount: row ? 1 : 0 };
    }

    if (/INSERT INTO users/i.test(sql)) {
      const [name, email, passwordHash, role, isActive] = params;
      const row = insertRow('users', {
        name,
        email,
        password_hash: passwordHash,
        role,
        is_active: isActive ?? true
      });
      delete row.password_hash;
      return { rows: [row], rowCount: 1 };
    }

    if (/INSERT INTO activity_logs/i.test(sql)) {
      const [userId, action, entityType, entityId, oldValue, newValue] = params;
      insertRow('activity_logs', {
        user_id: userId,
        action,
        entity_type: entityType,
        entity_id: entityId,
        old_value: oldValue,
        new_value: newValue
      });
      return { rows: [], rowCount: 1 };
    }

    if (/FROM documents d\s+JOIN suppliers s/i.test(sql) && /d\.expiry_date < CURRENT_DATE/i.test(sql)) {
      return { rows: expiredDocuments(), rowCount: expiredDocuments().length };
    }

    if (/FROM documents d\s+JOIN suppliers s/i.test(sql) && /CURRENT_DATE \+ INTERVAL '30 days'/i.test(sql)) {
      return { rows: documentsExpiringSoon(), rowCount: documentsExpiringSoon().length };
    }

    if (/LEFT JOIN contacts c/i.test(sql)) {
      const rows = missingContactInfo();
      return { rows, rowCount: rows.length };
    }

    if (/LEFT JOIN documents d ON d\.supplier_id = s\.id AND d\.type = 'Price List'/i.test(sql)) {
      const rows = outdatedPriceLists();
      return { rows, rowCount: rows.length };
    }

    if (/SELECT COUNT\(\*\)::int AS total FROM/i.test(sql)) {
      const rows = runCountQuery(sql, params);
      return { rows, rowCount: 1 };
    }

    if (/SELECT \* FROM/i.test(sql) && /WHERE id = \$1/i.test(sql)) {
      const table = tableFromQuotedSql(sql, 'FROM');
      const row = db[table].find((item) => item.id === params[0]);
      return { rows: row ? [clone(row)] : [], rowCount: row ? 1 : 0 };
    }

    if (/SELECT \*/i.test(sql) && /FROM\s+"/i.test(sql)) {
      const rows = runListQuery(sql, params);
      return { rows, rowCount: rows.length };
    }

    if (/INSERT INTO/i.test(sql)) {
      const table = tableFromQuotedSql(sql, 'INTO');
      const columns = sql.match(/INSERT INTO\s+"?[a-z_]+"?\s*\(([^)]+)\)/i)[1]
        .split(',')
        .map(stripIdentifier);
      const data = {};
      columns.forEach((column, index) => {
        data[column] = params[index];
      });
      const row = insertRow(table, data);
      return { rows: [row], rowCount: 1 };
    }

    if (/UPDATE\s+"/i.test(sql)) {
      const table = tableFromQuotedSql(sql, 'UPDATE');
      const fields = [...sql.matchAll(/"([a-z_]+)"\s*=/gi)].map((match) => match[1]);
      const data = {};
      fields.forEach((field, index) => {
        data[field] = params[index + 1];
      });
      const row = updateRow(table, params[0], data);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    if (/DELETE FROM\s+"/i.test(sql)) {
      const table = tableFromQuotedSql(sql, 'FROM');
      const row = deleteRow(table, params[0]);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    throw new Error(`Unhandled SQL in smoke test: ${compactSql}`);
  }

  async connect() {
    return {
      query: this.query.bind(this),
      release() {}
    };
  }

  async end() {}

  on() {
    return this;
  }
}

const fakePool = new FakePool();
const originalLoad = Module._load;

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'pg') {
    return { Pool: class Pool { constructor() { return fakePool; } } };
  }

  if (request === 'dotenv') {
    return { config: () => ({ parsed: {} }) };
  }

  if (request === 'bcryptjs') {
    return {
      hash: async (password) => `hashed:${password}`,
      compare: async (password, passwordHash) => passwordHash === `hashed:${password}`
    };
  }

  if (request === 'jsonwebtoken') {
    return {
      sign: (payload) => `test-token:${Buffer.from(JSON.stringify(payload)).toString('base64url')}`,
      verify: (token) => JSON.parse(Buffer.from(token.replace('test-token:', ''), 'base64url').toString('utf8'))
    };
  }

  return originalLoad.call(this, request, parent, isMain);
};

const authService = require('../src/services/auth.service');
const crudService = require('../src/services/crud.service');
const alertsService = require('../src/services/alerts.service');
const { entityConfigs } = require('../src/config/entities');

const results = [];

async function test(name, fn) {
  try {
    await fn();
    results.push({ name, status: 'passed' });
  } catch (error) {
    results.push({ name, status: 'failed', error });
  }
}

async function runCrudLifecycle(entityName, payload, updatePayload) {
  const config = entityConfigs[entityName];
  const actor = db.users[0];

  const created = await crudService.create(config, payload, actor);
  assert.ok(created.id, `${entityName} create should return an id`);

  const fetched = await crudService.getById(config, created.id);
  assert.equal(fetched.id, created.id, `${entityName} get should return created row`);

  const updated = await crudService.update(config, created.id, updatePayload, actor);
  for (const [field, expected] of Object.entries(updatePayload)) {
    assert.equal(updated[field], expected, `${entityName} update should persist ${field}`);
  }

  const listed = await crudService.list(config, {});
  assert.ok(listed.data.some((row) => row.id === created.id), `${entityName} list should include created row`);

  const removed = await crudService.remove(config, created.id, actor);
  assert.equal(removed.id, created.id, `${entityName} delete should return deleted row`);

  await assert.rejects(
    () => crudService.getById(config, created.id),
    /not found/i,
    `${entityName} get after delete should fail`
  );
}

async function main() {
  resetDb();
  const admin = insertRow('users', {
    name: 'Smoke Admin',
    email: 'admin@clinicfeed.test',
    password_hash: 'hashed:secret-password',
    role: 'admin',
    is_active: true
  });

  await test('Login works', async () => {
    const login = await authService.login({
      email: 'admin@clinicfeed.test',
      password: 'secret-password'
    });

    assert.ok(login.token, 'login should return JWT token');
    assert.equal(login.user.id, admin.id);
    assert.equal(login.user.role, 'admin');

    await assert.rejects(
      () => authService.login({ email: 'admin@clinicfeed.test', password: 'wrong' }),
      /Invalid email or password/
    );
  });

  await test('Suppliers CRUD works', async () => {
    await runCrudLifecycle('suppliers', {
      name_ar: 'مورد اختبار',
      name_en: 'Smoke Supplier',
      cr_number: 'CR-100',
      vat_number: 'VAT-100',
      city: 'Riyadh',
      category: 'Food',
      status: 'Pending',
      notes: 'Created by smoke test'
    }, {
      status: 'Active',
      notes: 'Updated by smoke test'
    });
  });

  await test('Contacts CRUD works', async () => {
    const supplier = await crudService.create(entityConfigs.suppliers, {
      name_ar: 'مورد جهات الاتصال',
      name_en: 'Contact Supplier',
      status: 'Active'
    }, admin);

    await runCrudLifecycle('contacts', {
      supplier_id: supplier.id,
      name: 'Operations Contact',
      position: 'Manager',
      phone: '+966500000001',
      whatsapp: '+966500000001',
      email: 'ops@example.com',
      is_primary: true
    }, {
      position: 'Senior Manager',
      phone: '+966500000002'
    });
  });

  await test('Contracts CRUD works', async () => {
    const supplier = await crudService.create(entityConfigs.suppliers, {
      name_ar: 'مورد العقود',
      name_en: 'Contract Supplier',
      status: 'Active'
    }, admin);

    await runCrudLifecycle('contracts', {
      supplier_id: supplier.id,
      contract_number: 'CN-100',
      start_date: TEST_TODAY,
      end_date: addDays(TEST_TODAY, 365),
      status: 'Active',
      file_url: 'https://example.com/contract.pdf',
      owner: 'Operations'
    }, {
      status: 'Terminated',
      owner: 'Legal'
    });
  });

  await test('Documents CRUD works', async () => {
    const supplier = await crudService.create(entityConfigs.suppliers, {
      name_ar: 'مورد المستندات',
      name_en: 'Document Supplier',
      status: 'Active'
    }, admin);

    await runCrudLifecycle('documents', {
      supplier_id: supplier.id,
      type: 'CR',
      file_url: 'https://example.com/cr.pdf',
      expiry_date: addDays(TEST_TODAY, 45),
      last_updated: now()
    }, {
      type: 'VAT',
      expiry_date: addDays(TEST_TODAY, 60)
    });
  });

  await test('Alerts logic works', async () => {
    db.suppliers = [];
    db.contacts = [];
    db.contracts = [];
    db.documents = [];
    db.activity_logs = [];

    const healthySupplier = await crudService.create(entityConfigs.suppliers, {
      name_ar: 'مورد مكتمل',
      name_en: 'Healthy Supplier',
      status: 'Active'
    }, admin);
    await crudService.create(entityConfigs.contacts, {
      supplier_id: healthySupplier.id,
      name: 'Complete Contact',
      phone: '+966500000010',
      whatsapp: '+966500000010',
      email: 'complete@example.com',
      is_primary: true
    }, admin);
    await crudService.create(entityConfigs.documents, {
      supplier_id: healthySupplier.id,
      type: 'Price List',
      file_url: 'https://example.com/recent-price-list.xlsx',
      last_updated: daysAgo(10)
    }, admin);

    const alertSupplier = await crudService.create(entityConfigs.suppliers, {
      name_ar: 'مورد تنبيهات',
      name_en: 'Alert Supplier',
      status: 'Active'
    }, admin);
    await crudService.create(entityConfigs.documents, {
      supplier_id: alertSupplier.id,
      type: 'CR',
      file_url: 'https://example.com/expired-cr.pdf',
      expiry_date: addDays(TEST_TODAY, -1),
      last_updated: now()
    }, admin);
    await crudService.create(entityConfigs.documents, {
      supplier_id: alertSupplier.id,
      type: 'VAT',
      file_url: 'https://example.com/expiring-vat.pdf',
      expiry_date: addDays(TEST_TODAY, 15),
      last_updated: now()
    }, admin);
    await crudService.create(entityConfigs.documents, {
      supplier_id: alertSupplier.id,
      type: 'Price List',
      file_url: 'https://example.com/old-price-list.xlsx',
      last_updated: daysAgo(91)
    }, admin);

    const expired = await alertsService.expiredDocuments();
    assert.ok(expired.some((row) => row.supplier_id === alertSupplier.id && row.type === 'CR'));

    const expiringSoon = await alertsService.documentsExpiringIn30Days();
    assert.ok(expiringSoon.some((row) => row.supplier_id === alertSupplier.id && row.type === 'VAT'));

    const missingContacts = await alertsService.missingContactInfo();
    assert.ok(missingContacts.some((row) => row.supplier_id === alertSupplier.id && row.missing_fields.includes('primary_contact')));
    assert.ok(!missingContacts.some((row) => row.supplier_id === healthySupplier.id));

    const outdated = await alertsService.outdatedPriceLists();
    assert.ok(outdated.some((row) => row.supplier_id === alertSupplier.id && row.alert_type === 'outdated_price_list'));
    assert.ok(!outdated.some((row) => row.supplier_id === healthySupplier.id));

    const summary = await alertsService.summary();
    assert.equal(summary.counts.expired_documents, expired.length);
    assert.equal(summary.counts.documents_expiring_in_30_days, expiringSoon.length);
    assert.equal(summary.counts.missing_contact_info, missingContacts.length);
    assert.equal(summary.counts.outdated_price_lists, outdated.length);
  });

  const failed = results.filter((result) => result.status === 'failed');

  for (const result of results) {
    if (result.status === 'passed') {
      console.log(`PASS ${result.name}`);
    } else {
      console.error(`FAIL ${result.name}`);
      console.error(result.error.stack || result.error.message);
    }
  }

  if (failed.length > 0) {
    process.exitCode = 1;
    return;
  }

  console.log(`Smoke tests passed: ${results.length}/${results.length}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
