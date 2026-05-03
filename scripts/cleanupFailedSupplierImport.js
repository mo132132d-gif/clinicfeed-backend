const fs = require('node:fs/promises');
const path = require('node:path');
require('dotenv').config();

const { pool } = require('../src/db/pool');
const {
  parseSupplierImportFile,
  previewCleanupCandidates
} = require('../src/services/supplierImport.service');

function argValue(name) {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);

  const index = process.argv.indexOf(name);
  if (index !== -1) return process.argv[index + 1];

  return null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

async function namesFromFile(filePath) {
  if (!filePath) return [];

  const absolute = path.resolve(filePath);
  const buffer = await fs.readFile(absolute);
  const rows = await parseSupplierImportFile({
    originalName: path.basename(absolute),
    buffer
  });

  return [...new Set(rows.map((row) => row.name).filter(Boolean))];
}

async function deleteCandidates(candidates) {
  const ids = candidates.map((row) => row.id);
  if (ids.length === 0) {
    return { deletedContacts: 0, deletedSuppliers: 0 };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const contacts = await client.query(
      'DELETE FROM contacts WHERE supplier_id = ANY($1::uuid[]) RETURNING id',
      [ids]
    );
    const suppliers = await client.query(
      'DELETE FROM suppliers WHERE id = ANY($1::uuid[]) RETURNING id, name_ar',
      [ids]
    );
    await client.query('COMMIT');

    return {
      deletedContacts: contacts.rowCount,
      deletedSuppliers: suppliers.rowCount
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const file = argValue('--file');
  const since = argValue('--since');
  const until = argValue('--until');
  const confirm = hasFlag('--confirm');
  const names = await namesFromFile(file);

  const { candidates, excludedLinked } = await previewCleanupCandidates({ names, since, until });

  console.log('ClinicFeed failed supplier import cleanup');
  console.log('Mode:', confirm ? 'CONFIRM DELETE' : 'PREVIEW ONLY');
  console.log('Matched supplier names from file:', names.length);
  console.log('Candidates safe to delete:', candidates.length);
  console.log('Excluded because they have contracts/documents:', excludedLinked.length);
  console.table(
    candidates.slice(0, 25).map((row) => ({
      id: row.id,
      name_ar: row.name_ar,
      status: row.status,
      contacts: row.contacts_count,
      created_at: row.created_at
    }))
  );

  if (!confirm) {
    console.log('No data was deleted. Re-run with --confirm after reviewing the count.');
    return;
  }

  const result = await deleteCandidates(candidates);
  console.log('Deleted suppliers:', result.deletedSuppliers);
  console.log('Deleted contacts:', result.deletedContacts);
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
