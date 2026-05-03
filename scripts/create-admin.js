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

async function main() {
  const pool = new Pool({
    connectionString: requireEnv('DATABASE_URL'),
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
  });

  const name = process.env.ADMIN_NAME || 'ClinicFeed Admin';
  const email = requireEnv('ADMIN_EMAIL').toLowerCase();
  const password = requireEnv('ADMIN_PASSWORD');
  const rounds = Number(process.env.BCRYPT_ROUNDS || 12);
  const passwordHash = await bcrypt.hash(password, rounds);

  const result = await pool.query(
    `
      INSERT INTO users (name, email, password_hash, role, is_active)
      VALUES ($1, $2, $3, 'admin', true)
      ON CONFLICT (email)
      DO UPDATE SET
        name = EXCLUDED.name,
        password_hash = EXCLUDED.password_hash,
        role = 'admin',
        is_active = true,
        updated_at = now()
      RETURNING id, name, email, role, is_active
    `,
    [name, email, passwordHash]
  );

  console.log('Admin user ready:');
  console.log(result.rows[0]);
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
