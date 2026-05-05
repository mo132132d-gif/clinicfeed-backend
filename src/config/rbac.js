const rolePermissions = {
  admin: ['*'],
  manager: [
    'suppliers:read',
    'suppliers:write',
    'contacts:read',
    'contacts:write',
    'contracts:read',
    'contracts:write',
    'documents:read',
    'documents:write',
    'activity_logs:read',
    'alerts:read',
    'request_tickets:read',
    'request_tickets:write'
  ],
  operations: [
    'suppliers:read',
    'suppliers:write',
    'contacts:read',
    'contacts:write',
    'contracts:read',
    'contracts:write',
    'documents:read',
    'documents:write',
    'activity_logs:read',
    'alerts:read',
    'request_tickets:read',
    'request_tickets:write'
  ],
  sales: [
    'suppliers:read',
    'contacts:read',
    'contracts:read',
    'documents:read',
    'alerts:read',
    'request_tickets:read'
  ],
  viewer: [
    'suppliers:read',
    'contacts:read',
    'contracts:read',
    'documents:read',
    'alerts:read',
    'request_tickets:read'
  ]
};

function hasPermission(role, permission) {
  const permissions = rolePermissions[role] || [];
  return permissions.includes('*') || permissions.includes(permission);
}

module.exports = {
  hasPermission,
  rolePermissions
};
