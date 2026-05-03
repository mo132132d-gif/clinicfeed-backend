const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');

const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { validate } = require('../middleware/validate');
const { createCrudController } = require('../controllers/crud.controller');
const { query } = require('../db/query');

function createCrudRouter(config, validators) {
  const router = express.Router();
  const controller = createCrudController(config);
  const upload = multer({ storage: multer.memoryStorage() });

  router.use(authenticate);

  router.post('/import', authorize(config.permissions.write), upload.single('file'), async (req, res, next) => {
    try {
      if (config.table !== 'suppliers') {
        return res.status(404).json({ message: 'Import is only available for suppliers' });
      }

      if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
      }

      const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: null });

      let imported = 0;
      let skipped = 0;
      let incomplete = 0;

      for (const row of rows) {
        const supplierName = row.Supplier_Name ? String(row.Supplier_Name).trim() : null;

        if (!supplierName) {
          skipped++;
          continue;
        }

        const rawMobile = row.Mobile ? String(row.Mobile).trim() : null;
        const rawEmail = row.Email ? String(row.Email).trim() : null;

        const phone =
          rawMobile &&
          rawMobile.toLowerCase() !== 'missing' &&
          rawMobile !== '0'
            ? rawMobile
            : null;

        const email =
          rawEmail &&
          rawEmail.toLowerCase() !== 'missing'
            ? rawEmail
            : null;

        const hasMissingInfo = !phone || !email;

        if (hasMissingInfo) {
          incomplete++;
        }

        const supplierResult = await query(
          `
          INSERT INTO suppliers (name_ar, name_en, status, notes)
          VALUES ($1, $2, $3, $4)
          RETURNING id
          `,
          [
            supplierName,
            supplierName,
            hasMissingInfo ? 'incomplete' : 'active',
            hasMissingInfo ? 'معلومات ناقصة' : null
          ]
        );

        const supplierId = supplierResult.rows[0].id;

        if (phone || email) {
          await query(
            `
            INSERT INTO contacts (supplier_id, name, phone, whatsapp, email, is_primary)
            VALUES ($1, $2, $3, $4, $5, $6)
            `,
            [
              supplierId,
              supplierName,
              phone,
              phone,
              email,
              true
            ]
          );
        }

        imported++;
      }

      return res.json({
        message: 'Suppliers imported successfully',
        imported,
        skipped,
        incomplete
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/', authorize(config.permissions.read), controller.list);
  router.get('/:id', authorize(config.permissions.read), controller.getById);
  router.post('/', authorize(config.permissions.write), validate(validators.create), controller.create);
  router.patch('/:id', authorize(config.permissions.write), validate(validators.update), controller.update);
  router.delete('/:id', authorize(config.permissions.write), controller.remove);

  return router;
}

module.exports = { createCrudRouter };