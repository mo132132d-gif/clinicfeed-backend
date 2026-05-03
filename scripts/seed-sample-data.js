const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
require('dotenv').config();

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function assertRealDatabaseUrl(databaseUrl) {
  if (databaseUrl === 'postgresql://memory' || databaseUrl.includes('memory')) {
    throw new Error('Refusing to seed an in-memory test database. Set DATABASE_URL to your real Supabase PostgreSQL URI.');
  }
}

async function upsertUser(client, user, passwordHash) {
  const result = await client.query(
    `
      INSERT INTO users (name, email, password_hash, role, is_active)
      VALUES ($1, $2, $3, $4, true)
      ON CONFLICT (email)
      DO UPDATE SET
        name = EXCLUDED.name,
        password_hash = EXCLUDED.password_hash,
        role = EXCLUDED.role,
        is_active = true,
        updated_at = now()
      RETURNING id, name, email, role
    `,
    [user.name, user.email.toLowerCase(), passwordHash, user.role]
  );

  return result.rows[0];
}

async function findOrCreateSupplier(client, supplier) {
  const existing = await client.query(
    'SELECT * FROM suppliers WHERE cr_number = $1 LIMIT 1',
    [supplier.cr_number]
  );

  if (existing.rows[0]) {
    const result = await client.query(
      `
        UPDATE suppliers
        SET
          name_ar = $2,
          name_en = $3,
          vat_number = $4,
          city = $5,
          category = $6,
          status = $7,
          notes = $8
        WHERE id = $1
        RETURNING *
      `,
      [
        existing.rows[0].id,
        supplier.name_ar,
        supplier.name_en,
        supplier.vat_number,
        supplier.city,
        supplier.category,
        supplier.status,
        supplier.notes
      ]
    );

    return result.rows[0];
  }

  const result = await client.query(
    `
      INSERT INTO suppliers (
        name_ar,
        name_en,
        cr_number,
        vat_number,
        city,
        category,
        status,
        notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `,
    [
      supplier.name_ar,
      supplier.name_en,
      supplier.cr_number,
      supplier.vat_number,
      supplier.city,
      supplier.category,
      supplier.status,
      supplier.notes
    ]
  );

  return result.rows[0];
}

async function upsertContact(client, supplierId, contact) {
  const existing = await client.query(
    'SELECT id FROM contacts WHERE supplier_id = $1 AND email = $2 LIMIT 1',
    [supplierId, contact.email]
  );

  if (contact.is_primary) {
    await client.query(
      'UPDATE contacts SET is_primary = false WHERE supplier_id = $1',
      [supplierId]
    );
  }

  if (existing.rows[0]) {
    await client.query(
      `
        UPDATE contacts
        SET
          name = $2,
          position = $3,
          phone = $4,
          whatsapp = $5,
          is_primary = $6
        WHERE id = $1
      `,
      [
        existing.rows[0].id,
        contact.name,
        contact.position,
        contact.phone,
        contact.whatsapp,
        contact.is_primary
      ]
    );
    return;
  }

  await client.query(
    `
      INSERT INTO contacts (supplier_id, name, position, phone, whatsapp, email, is_primary)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      supplierId,
      contact.name,
      contact.position,
      contact.phone,
      contact.whatsapp,
      contact.email,
      contact.is_primary
    ]
  );
}

async function upsertContract(client, supplierId, contract) {
  const existing = await client.query(
    'SELECT id FROM contracts WHERE supplier_id = $1 AND contract_number = $2 LIMIT 1',
    [supplierId, contract.contract_number]
  );

  if (existing.rows[0]) {
    await client.query(
      `
        UPDATE contracts
        SET
          start_date = $2,
          end_date = $3,
          status = $4,
          file_url = $5,
          owner = $6
        WHERE id = $1
      `,
      [
        existing.rows[0].id,
        contract.start_date,
        contract.end_date,
        contract.status,
        contract.file_url,
        contract.owner
      ]
    );
    return;
  }

  await client.query(
    `
      INSERT INTO contracts (
        supplier_id,
        contract_number,
        start_date,
        end_date,
        status,
        file_url,
        owner
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      supplierId,
      contract.contract_number,
      contract.start_date,
      contract.end_date,
      contract.status,
      contract.file_url,
      contract.owner
    ]
  );
}

async function upsertDocument(client, supplierId, document) {
  const existing = await client.query(
    'SELECT id FROM documents WHERE supplier_id = $1 AND type = $2 AND file_url = $3 LIMIT 1',
    [supplierId, document.type, document.file_url]
  );

  if (existing.rows[0]) {
    await client.query(
      `
        UPDATE documents
        SET
          expiry_date = $2,
          last_updated = $3
        WHERE id = $1
      `,
      [existing.rows[0].id, document.expiry_date, document.last_updated]
    );
    return;
  }

  await client.query(
    `
      INSERT INTO documents (supplier_id, type, file_url, expiry_date, last_updated)
      VALUES ($1, $2, $3, $4, $5)
    `,
    [
      supplierId,
      document.type,
      document.file_url,
      document.expiry_date,
      document.last_updated
    ]
  );
}

async function main() {
  const databaseUrl = requireEnv('DATABASE_URL');
  assertRealDatabaseUrl(databaseUrl);

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
  });

  const password = process.env.SEED_SAMPLE_PASSWORD || 'ClinicFeed123!';
  const rounds = Number(process.env.BCRYPT_ROUNDS || 12);
  const passwordHash = await bcrypt.hash(password, rounds);
  const client = await pool.connect();

  const users = [
    { name: 'ClinicFeed Admin', email: 'admin@clinicfeed.local', role: 'admin' },
    { name: 'ClinicFeed Operations', email: 'operations@clinicfeed.local', role: 'operations' },
    { name: 'ClinicFeed Sales', email: 'sales@clinicfeed.local', role: 'sales' },
    { name: 'ClinicFeed Viewer', email: 'viewer@clinicfeed.local', role: 'viewer' }
  ];

  const suppliers = [
    {
      name_ar: 'شركة الرياض للتوريدات الطبية',
      name_en: 'Riyadh Medical Supplies Co.',
      cr_number: 'CF-SEED-CR-1001',
      vat_number: 'CF-SEED-VAT-1001',
      city: 'Riyadh',
      category: 'Medical Supplies',
      status: 'Active',
      notes: 'Seed supplier with complete contact info and a current price list.',
      contact: {
        name: 'Noura Alharbi',
        position: 'Account Manager',
        phone: '+966500000001',
        whatsapp: '+966500000001',
        email: 'noura.seed@example.com',
        is_primary: true
      },
      contract: {
        contract_number: 'CF-SEED-CON-1001',
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        status: 'Active',
        file_url: 'https://example.com/contracts/cf-seed-con-1001.pdf',
        owner: 'Operations'
      },
      documents: [
        {
          type: 'CR',
          file_url: 'https://example.com/documents/cf-seed-cr-1001.pdf',
          expiry_date: '2027-01-01',
          last_updated: '2026-04-01T00:00:00.000Z'
        },
        {
          type: 'Price List',
          file_url: 'https://example.com/documents/cf-seed-price-list-current.xlsx',
          expiry_date: null,
          last_updated: '2026-04-01T00:00:00.000Z'
        }
      ]
    },
    {
      name_ar: 'مؤسسة جدة للأغذية',
      name_en: 'Jeddah Food Establishment',
      cr_number: 'CF-SEED-CR-1002',
      vat_number: 'CF-SEED-VAT-1002',
      city: 'Jeddah',
      category: 'Food',
      status: 'Pending',
      notes: 'Seed supplier intentionally missing primary contact details and using an outdated price list for alert testing.',
      contact: {
        name: 'Omar Salem',
        position: 'Sales Coordinator',
        phone: '',
        whatsapp: '',
        email: 'omar.seed@example.com',
        is_primary: true
      },
      contract: {
        contract_number: 'CF-SEED-CON-1002',
        start_date: '2025-01-01',
        end_date: '2026-12-31',
        status: 'Active',
        file_url: 'https://example.com/contracts/cf-seed-con-1002.pdf',
        owner: 'Procurement'
      },
      documents: [
        {
          type: 'VAT',
          file_url: 'https://example.com/documents/cf-seed-vat-expired.pdf',
          expiry_date: '2026-01-15',
          last_updated: '2026-01-01T00:00:00.000Z'
        },
        {
          type: 'Authorization',
          file_url: 'https://example.com/documents/cf-seed-auth-expiring.pdf',
          expiry_date: '2026-05-15',
          last_updated: '2026-04-01T00:00:00.000Z'
        },
        {
          type: 'Price List',
          file_url: 'https://example.com/documents/cf-seed-price-list-old.xlsx',
          expiry_date: null,
          last_updated: '2026-01-01T00:00:00.000Z'
        }
      ]
    }
  ];

  try {
    await client.query('BEGIN');

    const seededUsers = [];
    for (const user of users) {
      seededUsers.push(await upsertUser(client, user, passwordHash));
    }

    const seededSuppliers = [];
    for (const supplier of suppliers) {
      const savedSupplier = await findOrCreateSupplier(client, supplier);
      seededSuppliers.push(savedSupplier);
      await upsertContact(client, savedSupplier.id, supplier.contact);
      await upsertContract(client, savedSupplier.id, supplier.contract);

      for (const document of supplier.documents) {
        await upsertDocument(client, savedSupplier.id, document);
      }
    }

    await client.query('COMMIT');

    console.log('Seed complete.');
    console.table(seededUsers);
    console.table(seededSuppliers.map((supplier) => ({
      id: supplier.id,
      name_en: supplier.name_en,
      cr_number: supplier.cr_number,
      status: supplier.status
    })));
    console.log(`Sample password for seeded users: ${password}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
