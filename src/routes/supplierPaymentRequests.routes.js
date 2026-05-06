const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { multipartUpload } = require('../middleware/multipartUpload');
const { asyncHandler } = require('../utils/asyncHandler');
const supplierPaymentRequestsService = require('../services/supplierPaymentRequests.service');

const router = express.Router();

router.use(authenticate);

router.get(
  '/',
  authorize('supplier_payment_requests:read'),
  asyncHandler(async (req, res) => {
    const data = await supplierPaymentRequestsService.list(req.query);
    res.json(data);
  })
);

router.get(
  '/:id',
  authorize('supplier_payment_requests:read'),
  asyncHandler(async (req, res) => {
    const data = await supplierPaymentRequestsService.getById(req.params.id);
    res.json({ data });
  })
);

router.post(
  '/',
  authorize('supplier_payment_requests:write'),
  asyncHandler(async (req, res) => {
    const data = await supplierPaymentRequestsService.create(req.body, req.user?.id);
    res.status(201).json({ data });
  })
);

router.put(
  '/:id',
  authorize('supplier_payment_requests:write'),
  asyncHandler(async (req, res) => {
    const data = await supplierPaymentRequestsService.update(req.params.id, req.body, req.user?.id);
    res.json({ data });
  })
);

router.patch(
  '/:id',
  authorize('supplier_payment_requests:write'),
  asyncHandler(async (req, res) => {
    const data = await supplierPaymentRequestsService.update(req.params.id, req.body, req.user?.id);
    res.json({ data });
  })
);

router.delete(
  '/:id',
  authorize('supplier_payment_requests:write'),
  asyncHandler(async (req, res) => {
    const data = await supplierPaymentRequestsService.remove(req.params.id, req.user?.id);
    res.json({ data });
  })
);

router.post(
  '/:id/documents/upload',
  authorize('supplier_payment_requests:write'),
  multipartUpload,
  asyncHandler(async (req, res) => {
    const data = await supplierPaymentRequestsService.uploadDocument(req.params.id, req.file, req.body, req.user?.id);
    res.status(201).json({ data });
  })
);

router.get(
  '/:id/documents',
  authorize('supplier_payment_requests:read'),
  asyncHandler(async (req, res) => {
    const data = await supplierPaymentRequestsService.listDocuments(req.params.id);
    res.json({ data });
  })
);

router.delete(
  '/:id/documents/:documentId',
  authorize('supplier_payment_requests:write'),
  asyncHandler(async (req, res) => {
    const data = await supplierPaymentRequestsService.deleteDocument(req.params.id, req.params.documentId, req.user?.id);
    res.json({ data });
  })
);

module.exports = { supplierPaymentRequestsRouter: router };
