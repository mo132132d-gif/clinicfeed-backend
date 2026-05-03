# ClinicFeed Supplier Management Backend

Node.js, Express, Supabase PostgreSQL, and JWT backend for ClinicFeed's internal Supplier Management System.

## What Is Included

- JWT login with hashed passwords.
- Role-based access for `admin`, `operations`, `sales`, and `viewer`.
- Full CRUD APIs for suppliers, contacts, contracts, documents, and activity logs.
- Admin user management APIs.
- Automatic audit logging for supplier, contact, contract, document, and user changes.
- Alert APIs for expired documents, documents expiring within 30 days, missing primary contact info, and outdated price lists.
- Supabase PostgreSQL migration with constraints, indexes, foreign keys, and update timestamps.

## Project Structure

```text
src/
  app.js                 Express app and security middleware
  server.js              HTTP server and graceful shutdown
  config/                Environment, enums, RBAC, entity metadata
  controllers/           Request handlers
  db/                    PostgreSQL pool and transaction helper
  middleware/            Auth, authorization, validation, errors
  repositories/          Generic CRUD repository
  routes/                API routes
  services/              Business logic, auth, alerts, audit logs
  validators/            Zod request schemas
supabase/migrations/     Database migrations
scripts/                 Migration, seed, admin, and smoke-test helpers
```

## Required Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `NODE_ENV` | Yes | `development`, `test`, or `production`. |
| `PORT` | Yes | HTTP port for the Express API. |
| `DATABASE_URL` | Yes | Supabase PostgreSQL connection string from the Supabase Connect panel. |
| `DATABASE_SSL` | Yes | Use `true` for Supabase. Use `false` only for local non-SSL PostgreSQL. |
| `DB_POOL_MAX` | Yes | Maximum `pg` connection pool size. |
| `JWT_SECRET` | Yes | Long random secret used to sign JWTs. |
| `JWT_EXPIRES_IN` | Yes | JWT lifetime, for example `8h`. |
| `BCRYPT_ROUNDS` | Yes | Password hashing cost. Use `12` or higher for production unless latency requires tuning. |
| `CORS_ORIGIN` | Yes | Comma-separated allowed frontend origins. |
| `REQUEST_BODY_LIMIT` | Yes | Express JSON/body limit, for example `1mb`. |
| `ADMIN_NAME` | Only for `db:create-admin` | Name for the bootstrap admin user. |
| `ADMIN_EMAIL` | Only for `db:create-admin` | Email for the bootstrap admin user. |
| `ADMIN_PASSWORD` | Only for `db:create-admin` | Password for the bootstrap admin user. |
| `SEED_SAMPLE_PASSWORD` | Only for `db:seed` | Password assigned to seeded test users. |

The production app refuses `DATABASE_URL` values containing `memory` unless `NODE_ENV=test`. The in-memory smoke test is isolated in `scripts/smoke-test.js` and is not used by the server, migrations, admin bootstrap, or seed script.

## Supabase Connection Setup

1. Open your Supabase project.
2. Click **Connect** in the project dashboard.
3. Copy a PostgreSQL URI into `DATABASE_URL`.
4. For a persistent backend server, use the direct connection if your hosting environment supports IPv6.
5. If IPv6 is not available, use the Supavisor **Session Pooler** URI.
6. Keep `DATABASE_SSL=true`.

This backend uses the `pg` package directly against PostgreSQL. It does not require `SUPABASE_URL`, anon keys, or service-role keys unless a later file-storage feature needs Supabase Storage.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create an environment file:

```bash
cp .env.example .env
```

3. Update `.env` with your Supabase PostgreSQL connection string and JWT secret.

4. Run the migration:

```bash
npm run db:migrate
```

5. Create or reset the first admin user:

```bash
npm run db:create-admin
```

6. Optional: seed test users and sample suppliers:

```bash
npm run db:seed
```

7. Start the API:

```bash
npm run dev
```

The default API URL is `http://localhost:4000`.

## Migrations

| File | Purpose |
| --- | --- |
| `supabase/migrations/001_initial_schema.sql` | Creates `users`, `suppliers`, `contacts`, `contracts`, `documents`, `activity_logs`, indexes, constraints, foreign keys, and update timestamp triggers. |

Run migrations with:

```bash
npm run db:migrate
```

The migration runner records applied files in `schema_migrations`.

## Seed Data

Run the seed only after migrations:

```bash
npm run db:seed
```

Seeded users:

| Email | Role |
| --- | --- |
| `admin@clinicfeed.local` | `admin` |
| `operations@clinicfeed.local` | `operations` |
| `sales@clinicfeed.local` | `sales` |
| `viewer@clinicfeed.local` | `viewer` |

The password for all seeded users is `SEED_SAMPLE_PASSWORD`.

Seeded suppliers include one complete supplier and one alert-testing supplier with:

- expired VAT document
- authorization document expiring within 30 days
- missing phone and WhatsApp on the primary contact
- outdated price list older than 90 days

## Smoke Tests

Smoke tests are separate from production setup:

```bash
npm run test:smoke
```

They use an isolated in-memory test double for backend logic checks only. Do not use that script for migrations, seeding, deployment, or production validation against Supabase.

## Authentication

Login:

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "admin@clinicfeed.local",
  "password": "change-this-password"
}
```

Use the returned token on protected routes:

```http
Authorization: Bearer <jwt>
```

## Roles

| Role | Access |
| --- | --- |
| `admin` | Full access, including user management and activity log writes |
| `operations` | Read/write supplier records, read activity logs, read alerts |
| `sales` | Read supplier records and alerts |
| `viewer` | Read supplier records and alerts |

## Main Endpoints

| Resource | Endpoints |
| --- | --- |
| Auth | `POST /api/auth/login`, `GET /api/auth/me` |
| Users | `GET/POST /api/auth/users`, `GET/PATCH/DELETE /api/auth/users/:id` |
| Suppliers | `GET/POST /api/suppliers`, `GET/PATCH/DELETE /api/suppliers/:id` |
| Contacts | `GET/POST /api/contacts`, `GET/PATCH/DELETE /api/contacts/:id` |
| Contracts | `GET/POST /api/contracts`, `GET/PATCH/DELETE /api/contracts/:id` |
| Documents | `GET/POST /api/documents`, `GET/PATCH/DELETE /api/documents/:id` |
| Activity Logs | `GET/POST /api/activity-logs`, `GET/PATCH/DELETE /api/activity-logs/:id` |
| Alerts | `GET /api/alerts` |

List endpoints support:

- `limit` and `offset`
- `q` search where supported
- `sort_by` and `order=ASC|DESC`
- entity-specific filters such as `status`, `supplier_id`, `type`, `city`, and `category`

## Alert Endpoints

| Alert | Endpoint | Rule |
| --- | --- | --- |
| Expired documents | `GET /api/alerts/expired-documents` | `expiry_date < CURRENT_DATE` |
| Documents expiring soon | `GET /api/alerts/documents-expiring-in-30-days` | `expiry_date` is within the next 30 days |
| Missing contact info | `GET /api/alerts/missing-contact-info` | Supplier has no primary contact, or primary contact is missing phone, WhatsApp, or email |
| Outdated price lists | `GET /api/alerts/outdated-price-lists` | Supplier has no `Price List`, or latest price list is older than 90 days |

## Database Notes

The migration creates:

- `users`
- `suppliers`
- `contacts`
- `contracts`
- `documents`
- `activity_logs`

It also enables `pgcrypto` for UUID generation, adds check constraints for all allowed enum-like fields, cascades supplier child records, and enforces one primary contact per supplier.

## Production Notes

- Use a long random `JWT_SECRET`.
- Keep `DATABASE_SSL=true` for Supabase.
- Restrict `CORS_ORIGIN` to your frontend origin.
- Store uploaded files in Supabase Storage and persist the signed or public URL in `file_url`.
- Run migrations from CI/CD or a controlled admin workstation.
