const express = require('express');
const multer = require('multer');
const { asyncHandler } = require('../middleware/asyncHandler');
const { authorize } = require('../middleware/auth');
const supplierPaymentRequestsService = require('../services/supplierPaymentRequests.service');
const { uploadSupplierFile } = require('../services/storage.service');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get(
  '/',
  authorize('request_tickets:read'),
  asyncHandler(async (req, res) => {
    const data = await supplierPaymentRequestsService.list(req.query);
    res.json(data);
  })
);

router.get(
  '/:id',
  authorize('request_tickets:read'),
  asyncHandler(async (req, res) => {
    const data = await supplierPaymentRequestsService.getById(req.params.id);
    res.json(data);
  })
);

router.post(
  '/',
  authorize('request_tickets:write'),
  asyncHandler(async (req, res) => {
    const data = await supplierPaymentRequestsService.create(req.body, req.user);
    res.status(201).json(data);
  })
);

router.patch(
  '/:id',
  authorize('request_tickets:write'),
  asyncHandler(async (req, res) => {
    const data = await supplierPaymentRequestsService.update(req.params.id, req.body);
    res.json(data);
  })
);

router.delete(
  '/:id',
  authorize('request_tickets:write'),
  asyncHandler(async (req, res) => {
    const data = await supplierPaymentRequestsService.remove(req.params.id);
    res.json(data);
  })
);

router.get(
  '/:id/documents',
  authorize('request_tickets:read'),
  asyncHandler(async (req, res) => {
    const data = await supplierPaymentRequestsService.listDocuments(req.params.id);
    res.json(data);
  })
);

router.post(
  '/:id/documents/upload',
  authorize('request_tickets:write'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const uploaded = await uploadSupplierFile(req.file, `supplier-payment-requests/${req.params.id}`);

    const data = await supplierPaymentRequestsService.addDocument(req.params.id, {
      document_type: req.body.document_type || 'مستند آخر',
      file_url: uploaded.url,
      file_name: req.file.originalname,
      file_mime_type: req.file.mimetype,
      file_size: req.file.size,
      file_path: uploaded.path
    }, req.user);

    res.status(201).json(data);
  })
);

module.exports = { supplierPaymentRequestsRouter: router };
