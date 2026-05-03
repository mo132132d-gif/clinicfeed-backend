const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { supplierImportUpload } = require('../middleware/multipartUpload');
const supplierImportService = require('../services/supplierImport.service');

const router = express.Router();

router.use(authenticate);

router.post(
  '/import/preview',
  authorize('suppliers:write'),
  supplierImportUpload,
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
      }

      const result = await supplierImportService.importSupplierFile(req.file, {
        dryRun: true
      });

      return res.json({ data: result });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/import',
  authorize('suppliers:write'),
  supplierImportUpload,
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
      }

      const result = await supplierImportService.importSupplierFile(req.file, {
        dryRun: false
      });

      return res.json({ data: result });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = { supplierExtrasRouter: router };