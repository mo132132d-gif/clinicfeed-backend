const express = require('express');
const { entityConfigs } = require('../config/entities');
const { entityValidators } = require('../validators/entity.validators');
const { alertsRouter } = require('./alerts.routes');
const { authRouter } = require('./auth.routes');
const { createCrudRouter } = require('./crud.routes');
const { supplierExtrasRouter } = require('./supplierExtras.routes');
const { authenticate } = require('../middleware/authenticate');

const router = express.Router();

router.get('/', authenticate, (req, res) => {
  res.json({
    service: 'ClinicFeed Supplier Management API',
    version: '1.0.0'
  });
});

router.use('/auth', authRouter);
router.use('/alerts', alertsRouter);

// Supplier custom routes must be registered before the generic CRUD router.
// This includes:
// POST /api/suppliers/import/preview
// POST /api/suppliers/import
router.use('/suppliers', supplierExtrasRouter);

for (const [key, config] of Object.entries(entityConfigs)) {
  router.use(config.route, createCrudRouter(config, entityValidators[key]));
}

module.exports = { apiRouter: router };