const express = require('express');
const { entityConfigs } = require('../config/entities');
const { entityValidators } = require('../validators/entity.validators');
const { alertsRouter } = require('./alerts.routes');
const { authRouter } = require('./auth.routes');
const { createCrudRouter } = require('./crud.routes');
const { dashboardRouter } = require('./dashboard.routes');
const { requestTicketsRouter } = require('./requestTickets.routes');
const { supplierPaymentRequestsRouter } = require('./supplierPaymentRequests.routes');
const { supplierExtrasRouter } = require('./supplierExtras.routes');
const { contactExtrasRouter } = require('./contactExtras.routes');
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
router.use('/dashboard', dashboardRouter);
router.use('/request-tickets', requestTicketsRouter);
router.use('/supplier-payment-requests', supplierPaymentRequestsRouter);

// Supplier custom routes must be registered before the generic CRUD router.
// This includes:
// POST /api/suppliers/import/preview
// POST /api/suppliers/import
router.use('/suppliers', supplierExtrasRouter);

// Must be registered before generic /contacts/:id CRUD routes.
router.use('/contacts', contactExtrasRouter);

for (const [key, config] of Object.entries(entityConfigs)) {
  router.use(config.route, createCrudRouter(config, entityValidators[key]));
}

module.exports = { apiRouter: router };
