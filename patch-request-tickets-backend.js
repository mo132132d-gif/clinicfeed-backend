const fs = require("fs");

function write(file, content) {
  fs.writeFileSync(file, content, "utf8");
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

/* 1) Add requestTickets entity config */
const entitiesPath = "src/config/entities.js";
let entities = read(entitiesPath);

if (!entities.includes("requestTickets:")) {
  const block = `  requestTickets: {
    table: 'request_tickets',
    route: '/request-tickets',
    entityType: 'RequestTicket',
    fields: [
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
      'qr_code',
      'closed_at'
    ],
    filters: ['status', 'assigned_to', 'country', 'region', 'priority', 'source'],
    searchable: ['ticket_number', 'customer_name', 'phone', 'email', 'country', 'region', 'request_description', 'assigned_to'],
    sortable: ['created_at', 'updated_at', 'closed_at', 'ticket_number', 'customer_name', 'status', 'priority'],
    defaultSort: { field: 'created_at', direction: 'DESC' },
    permissions: { read: 'suppliers:read', write: 'suppliers:write' },
    audit: true
  },
`;

  entities = entities.replace("  activityLogs: {", block + "  activityLogs: {");
  write(entitiesPath, entities);
}

/* 2) Add validators */
const validatorsPath = "src/validators/entity.validators.js";
let validators = read(validatorsPath);

if (!validators.includes("requestTicketStatuses")) {
  validators = validators.replace(
    "const optionalDateTime = z.preprocess(\n  (value) => (value === '' ? null : value),\n  z.string().trim().min(1).nullable().optional()\n);\n",
    `const optionalDateTime = z.preprocess(
  (value) => (value === '' ? null : value),
  z.string().trim().min(1).nullable().optional()
);

const requestTicketStatuses = [
  'new',
  'under_review',
  'waiting_customer',
  'waiting_supplier',
  'quotation_sent',
  'in_progress',
  'completed',
  'cancelled'
];

const requestTicketPriorities = ['low', 'medium', 'high', 'urgent'];
`
  );
}

if (!validators.includes("const requestTicketCreate")) {
  validators = validators.replace(
    "const activityLogCreate = z.object({",
    `const requestTicketCreate = z.object({
  customer_name: requiredText,
  phone: optionalText,
  email: optionalEmail,
  country: optionalText,
  region: optionalText,
  request_description: requiredText,
  assigned_to: optionalText,
  status: z.enum(requestTicketStatuses).optional(),
  priority: z.enum(requestTicketPriorities).optional(),
  source: optionalText,
  internal_notes: optionalText,
  cancellation_reason: optionalText,
  qr_code: optionalText,
  closed_at: optionalDateTime
}).strict();

const activityLogCreate = z.object({`
  );
}

if (!validators.includes("requestTickets:")) {
  validators = validators.replace(
    "  activityLogs: {",
    `  requestTickets: {
    create: requestTicketCreate,
    update: nonEmptyUpdate(requestTicketCreate)
  },
  activityLogs: {`
  );
}

write(validatorsPath, validators);

/* 3) Add search alias and request ticket view filters in repository */
const repoPath = "src/repositories/crud.repository.js";
let repo = read(repoPath);

if (!repo.includes("const searchValue = queryParams.q || queryParams.search;")) {
  repo = repo.replace(
    `  if (queryParams.q && config.searchable.length > 0) {
    const searchConditions = [];
    for (const field of config.searchable) {
      values.push(\`%\${queryParams.q}%\`);
      searchConditions.push(\`\${quoteIdentifier(field)} ILIKE $\${values.length}\`);
    }

    conditions.push(\`(\${searchConditions.join(' OR ')})\`);
  }`,
    `  const searchValue = queryParams.q || queryParams.search;

  if (searchValue && config.searchable.length > 0) {
    const searchConditions = [];
    for (const field of config.searchable) {
      values.push(\`%\${searchValue}%\`);
      searchConditions.push(\`\${quoteIdentifier(field)} ILIKE $\${values.length}\`);
    }

    conditions.push(\`(\${searchConditions.join(' OR ')})\`);
  }

  if (config.table === 'request_tickets' && queryParams.view) {
    if (queryParams.view === 'active') {
      conditions.push(\`"status" NOT IN ('completed', 'cancelled')\`);
    }

    if (queryParams.view === 'completed') {
      conditions.push(\`"status" = 'completed'\`);
    }

    if (queryParams.view === 'cancelled') {
      conditions.push(\`"status" = 'cancelled'\`);
    }
  }`
  );
}

write(repoPath, repo);

console.log("Backend request tickets patch done.");
