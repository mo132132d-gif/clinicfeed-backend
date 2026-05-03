const dotenv = require('dotenv');

dotenv.config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function numberFromEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`${name} must be a number`);
  }

  return parsed;
}

function booleanFromEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    return fallback;
  }

  return value.toLowerCase() === 'true';
}

function corsOriginsFromEnv() {
  const value = process.env.CORS_ORIGIN || '*';
  if (value === '*') {
    return '*';
  }

  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: numberFromEnv('PORT', 4000),
  databaseUrl: required('DATABASE_URL'),
  databaseSsl: booleanFromEnv('DATABASE_SSL', true),
  dbPoolMax: numberFromEnv('DB_POOL_MAX', 10),
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  bcryptRounds: numberFromEnv('BCRYPT_ROUNDS', 12),
  corsOrigins: corsOriginsFromEnv(),
  requestBodyLimit: process.env.REQUEST_BODY_LIMIT || '1mb'
};

env.isProduction = env.nodeEnv === 'production';

if (env.nodeEnv !== 'test' && env.databaseUrl.includes('memory')) {
  throw new Error('DATABASE_URL must point to a real Supabase PostgreSQL database outside test mode');
}

module.exports = { env };
