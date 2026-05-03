const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { asyncHandler } = require('../utils/asyncHandler');
const { createHttpError } = require('../utils/httpError');
const { withTransaction } = require('../db/transaction');
const crudRepository = require('../repositories/crud.repository');
const { entityConfigs } = require('../config/entities');

const router = express.Router();
const contactsConfig = entityConfigs.contacts;

router.use(authenticate);

router.patch(
  '/:id/primary',
  authorize('contacts:write'),
  asyncHandler(async (req, res) => {
    const data = await withTransaction(async (client) => {
      const contact = await crudRepository.findById(contactsConfig, req.params.id, client);
      if (!contact) {
        throw createHttpError(404, 'Contact not found');
      }

      await client.query('UPDATE contacts SET is_primary = false WHERE supplier_id = $1', [contact.supplier_id]);

      const result = await client.query(
        `
          UPDATE contacts
          SET is_primary = true
          WHERE id = $1
          RETURNING *
        `,
        [req.params.id]
      );

      return result.rows[0];
    });

    res.json({ data });
  })
);

module.exports = { contactExtrasRouter: router };
