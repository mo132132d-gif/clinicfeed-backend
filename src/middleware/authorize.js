const { hasPermission } = require('../config/rbac');
const { createHttpError } = require('../utils/httpError');

function authorize(requiredPermission) {
  return (req, res, next) => {
    if (!req.user) {
      next(createHttpError(401, 'Authentication is required'));
      return;
    }

    if (!hasPermission(req.user.role, requiredPermission)) {
      next(createHttpError(403, 'You do not have permission to perform this action'));
      return;
    }

    next();
  };
}

module.exports = { authorize };
