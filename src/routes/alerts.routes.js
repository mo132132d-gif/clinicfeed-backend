const express = require('express');
const alertsController = require('../controllers/alerts.controller');
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');

const router = express.Router();

router.use(authenticate);
router.use(authorize('alerts:read'));

router.get('/', alertsController.getSummary);
router.get('/expired-documents', alertsController.getExpiredDocuments);
router.get('/documents-expiring-in-30-days', alertsController.getDocumentsExpiringIn30Days);
router.get('/missing-contact-info', alertsController.getMissingContactInfo);
router.get('/outdated-price-lists', alertsController.getOutdatedPriceLists);

module.exports = { alertsRouter: router };
