const { z } = require('zod');
const { contractStatuses, documentTypes, roles, supplierStatuses } = require('../config/enums');

const uuid = z.string().uuid();
const requiredText = z.string().trim().min(1);
const optionalText = z.preprocess(
  (value) => (value === '' ? null : value),
  z.string().trim().min(1).nullable().optional()
);
const optionalEmail = z.preprocess(
  (value) => (value === '' ? null : value),
  z.string().email().nullable().optional()
);
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date format YYYY-MM-DD');
const optionalDate = z.preprocess(
  (value) => (value === '' ? null : value),
  dateString.nullable().optional()
);
const optionalDateTime = z.preprocess(
  (value) => (value === '' ? null : value),
  z.string().trim().min(1).nullable().optional()
);

function nonEmptyUpdate(schema) {
  return schema.partial().refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required'
  });
}

const supplierCreate = z.object({
  name_ar: requiredText,
  name_en: requiredText,
  cr_number: optionalText,
  vat_number: optionalText,
  city: optionalText,
  category: optionalText,
  status: z.enum(supplierStatuses).optional(),
  notes: optionalText
}).strict();

const contactCreate = z.object({
  supplier_id: uuid,
  name: requiredText,
  position: optionalText,
  phone: optionalText,
  whatsapp: optionalText,
  email: optionalEmail,
  is_primary: z.boolean().optional()
}).strict();

const contractCreate = z.object({
  supplier_id: uuid,
  contract_number: requiredText,
  start_date: dateString,
  end_date: dateString,
  status: z.enum(contractStatuses).optional(),
  file_url: optionalText,
  owner: optionalText
}).strict();

const documentCreate = z.object({
  supplier_id: uuid,
  type: z.enum(documentTypes),
  file_url: requiredText,
  expiry_date: optionalDate,
  last_updated: optionalDateTime
}).strict();

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

const requestTicketCreate = z.object({
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

const activityLogCreate = z.object({
  user_id: uuid.nullable().optional(),
  action: requiredText,
  entity_type: requiredText,
  entity_id: uuid.nullable().optional(),
  old_value: z.record(z.any()).nullable().optional(),
  new_value: z.record(z.any()).nullable().optional()
}).strict();

const entityValidators = {
  suppliers: {
    create: supplierCreate,
    update: nonEmptyUpdate(supplierCreate)
  },
  contacts: {
    create: contactCreate,
    update: nonEmptyUpdate(contactCreate)
  },
  contracts: {
    create: contractCreate,
    update: nonEmptyUpdate(contractCreate)
  },
  documents: {
    create: documentCreate,
    update: nonEmptyUpdate(documentCreate)
  },
  requestTickets: {
    create: requestTicketCreate,
    update: nonEmptyUpdate(requestTicketCreate)
  },
  activityLogs: {
    create: activityLogCreate,
    update: nonEmptyUpdate(activityLogCreate)
  }
};

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
}).strict();

const createUserSchema = z.object({
  name: requiredText,
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(roles),
  is_active: z.boolean().optional()
}).strict();

const updateUserSchema = nonEmptyUpdate(z.object({
  name: requiredText,
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(roles),
  is_active: z.boolean()
}).strict());

module.exports = {
  entityValidators,
  loginSchema,
  createUserSchema,
  updateUserSchema
};
