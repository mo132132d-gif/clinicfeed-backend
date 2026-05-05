const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { asyncHandler } = require('../utils/asyncHandler');
const requestTicketsService = require('../services/requestTickets.service');

const router = express.Router();

router.use(authenticate);

router.get(
  '/',
  authorize('request_tickets:read'),
  asyncHandler(async (req, res) => {
    const data = await requestTicketsService.list(req.query);
    res.json(data);
  })
);

router.get(
  '/summary',
  authorize('request_tickets:read'),
  asyncHandler(async (req, res) => {
    const data = await requestTicketsService.summary(req.query);
    res.json(data);
  })
);

router.get(
  '/export',
  authorize('request_tickets:read'),
  asyncHandler(async (req, res) => {
    const buffer = await requestTicketsService.exportWorkbook(req.query);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="request-tickets.xlsx"');
    res.send(buffer);
  })
);

router.get(
  '/:id',
  authorize('request_tickets:read'),
  asyncHandler(async (req, res) => {
    const data = await requestTicketsService.getById(req.params.id);
    res.json(data);
  })
);

router.post(
  '/',
  authorize('request_tickets:write'),
  asyncHandler(async (req, res) => {
    const data = await requestTicketsService.create(req.body);
    res.status(201).json(data);
  })
);

router.patch(
  '/:id',
  authorize('request_tickets:write'),
  asyncHandler(async (req, res) => {
    const data = await requestTicketsService.update(req.params.id, req.body);
    res.json(data);
  })
);

router.delete(
  '/:id',
  authorize('request_tickets:write'),
  asyncHandler(async (req, res) => {
    const data = await requestTicketsService.remove(req.params.id);
    res.json(data);
  })
);

module.exports = { requestTicketsRouter: router };
