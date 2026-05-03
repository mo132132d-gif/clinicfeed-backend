/**
 * Deletes ALL suppliers from the database and related cascading rows.
 *
 * Prerequisites (from migrations):
 * - contacts, contracts, documents FK -> suppliers ON DELETE CASCADE
 * - activity_logs has NO FK cleanup for supplier-related entities
 *
 * Usage:
 *   node scripts/clearSuppliers.js --confirm
 *
 * Options:
 *   --export=<path.json>   Write a lightweight JSON snapshot (counts + ids + names)
 *                           before deleting. Does not restore automatically.
 */

require('dotenv').config();

const fs = require('node:fs/promises');
const path = require('node:path');
const { pool } = require('../src/db/pool');

function argValue(flag) {
  const inline = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const index = process.argv.indexOf(flag);
  if (index !== -1) return process.argv[index + 1];
  return null;
}

function usage() {
  console.log(`
Deletes every supplier plus dependent contacts/contracts/documents (CASCADE).

This will ALSO remove matching activity_logs rows for suppliers, contacts,
contracts, and documents linked to those suppliers.

⚠️  IRREVERSIBLE. Create a Postgres backup/export first if unsure.

Usage:
  node scripts/clearSuppliers.js --confirm [--export=out.json]

Or:
  DATABASE_URL='postgres://…' node scripts/clearSuppliers.js --confirm
`);
}

async function main() {
  if (!process.argv.includes('--confirm')) {
    usage();
    console.error('\nMissing --confirm. Refusing to run.\n');
    process.exitCode = 1;
    return;
  }

  const exportPathRaw = argValue('--export');

  const client = await pool.connect();

  try {
    const countsBefore = (
      await client.query(`
        SELECT
          (SELECT COUNT(*)::bigint FROM suppliers) AS suppliers,
          (SELECT COUNT(*)::bigint FROM contacts) AS contacts,
          (SELECT COUNT(*)::bigint FROM contracts) AS contracts,
          (SELECT COUNT(*)::bigint FROM documents) AS documents
      `)
    ).rows[0];

    const suppliersSample = (
      await client.query(
        `SELECT id, name_ar, name_en, city, status, created_at FROM suppliers ORDER BY created_at DESC`
      )
    ).rows;

    console.table(countsBefore);

    if (Number(countsBefore.contracts) > 0 || Number(countsBefore.documents) > 0) {
      console.warn(
        `\n⚠️  WARNING: You have ${countsBefore.contracts} contract row(s) and ${countsBefore.documents} document row(s) linked to suppliers. They will CASCADE DELETE.\n`
      );
    }

    const snapshot = {
      exported_at: new Date().toISOString(),
      counts_before: countsBefore,
      suppliers: suppliersSample
    };

    if (exportPathRaw) {
      const exportPath = path.resolve(exportPathRaw);
      await fs.writeFile(exportPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
      console.log(`Wrote snapshot: ${exportPath}`);
    }

    await client.query('BEGIN');

    await client.query(`
      DELETE FROM activity_logs al
      WHERE al.entity_type = 'Contact'
        AND EXISTS (
          SELECT 1 FROM contacts c
          WHERE c.id = al.entity_id
            AND EXISTS (SELECT 1 FROM suppliers s WHERE s.id = c.supplier_id)
        )
    `);

    await client.query(`
      DELETE FROM activity_logs al
      WHERE al.entity_type = 'Contract'
        AND EXISTS (
          SELECT 1 FROM contracts ct
          WHERE ct.id = al.entity_id
            AND EXISTS (SELECT 1 FROM suppliers s WHERE s.id = ct.supplier_id)
        )
    `);

    await client.query(`
      DELETE FROM activity_logs al
      WHERE al.entity_type = 'Document'
        AND EXISTS (
          SELECT 1 FROM documents d
          WHERE d.id = al.entity_id
            AND EXISTS (SELECT 1 FROM suppliers s WHERE s.id = d.supplier_id)
        )
    `);

    await client.query(`
      DELETE FROM activity_logs
      WHERE entity_type = 'Supplier' AND entity_id IN (SELECT id FROM suppliers)
    `);

    await client.query(`DELETE FROM suppliers`);

    const countsAfter = (
      await client.query(`
        SELECT
          (SELECT COUNT(*)::bigint FROM suppliers) AS suppliers,
          (SELECT COUNT(*)::bigint FROM contacts) AS contacts,
          (SELECT COUNT(*)::bigint FROM contracts) AS contracts,
          (SELECT COUNT(*)::bigint FROM documents) AS documents
      `)
    ).rows[0];

    await client.query('COMMIT');

    console.log('\nAfter deletion:');
    console.table(countsAfter);
    console.log('Done.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('clearSuppliers failed:', error.message || error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
