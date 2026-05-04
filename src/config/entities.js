const entityConfigs = {
  suppliers: {
    table: 'suppliers',
    route: '/suppliers',
    entityType: 'Supplier',
    fields: ['name_ar', 'name_en', 'cr_number', 'vat_number', 'city', 'category', 'status', 'notes'],
    filters: ['status', 'city', 'category', 'cr_number', 'vat_number'],
    searchable: ['name_ar', 'name_en', 'cr_number', 'vat_number', 'city', 'category'],
    sortable: ['created_at', 'name_ar', 'name_en', 'status', 'city', 'category'],
    defaultSort: { field: 'created_at', direction: 'DESC' },
    permissions: { read: 'suppliers:read', write: 'suppliers:write' },
    audit: true
  },
  contacts: {
    table: 'contacts',
    route: '/contacts',
    entityType: 'Contact',
    fields: ['supplier_id', 'name', 'position', 'phone', 'whatsapp', 'email', 'is_primary'],
    filters: ['supplier_id', 'is_primary', 'email', 'phone', 'whatsapp'],
    searchable: ['name', 'position', 'phone', 'whatsapp', 'email'],
    sortable: ['created_at', 'name', 'position', 'is_primary'],
    defaultSort: { field: 'created_at', direction: 'DESC' },
    permissions: { read: 'contacts:read', write: 'contacts:write' },
    audit: true
  },
  contracts: {
    table: 'contracts',
    route: '/contracts',
    entityType: 'Contract',
    fields: ['supplier_id', 'contract_number', 'start_date', 'end_date', 'status', 'file_url', 'owner'],
    filters: ['supplier_id', 'status', 'contract_number', 'owner'],
    searchable: ['contract_number', 'owner', 'file_url'],
    sortable: ['created_at', 'start_date', 'end_date', 'status', 'contract_number'],
    defaultSort: { field: 'created_at', direction: 'DESC' },
    permissions: { read: 'contracts:read', write: 'contracts:write' },
    audit: true
  },
  documents: {
    table: 'documents',
    route: '/documents',
    entityType: 'Document',
    fields: ['supplier_id', 'type', 'file_url', 'expiry_date', 'last_updated'],
    filters: ['supplier_id', 'type'],
    searchable: ['type', 'file_url'],
    sortable: ['created_at', 'expiry_date', 'last_updated', 'type'],
    defaultSort: { field: 'created_at', direction: 'DESC' },
    permissions: { read: 'documents:read', write: 'documents:write' },
    audit: true
  },
  requestTickets: {
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
  activityLogs: {
    table: 'activity_logs',
    route: '/activity-logs',
    entityType: 'ActivityLog',
    fields: ['user_id', 'action', 'entity_type', 'entity_id', 'old_value', 'new_value'],
    filters: ['user_id', 'action', 'entity_type', 'entity_id'],
    searchable: ['action', 'entity_type'],
    sortable: ['created_at', 'action', 'entity_type'],
    defaultSort: { field: 'created_at', direction: 'DESC' },
    permissions: { read: 'activity_logs:read', write: 'activity_logs:write' },
    audit: false
  }
};

module.exports = { entityConfigs };
