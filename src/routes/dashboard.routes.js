const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { asyncHandler } = require('../utils/asyncHandler');
const requestTicketsService = require('../services/requestTickets.service');

const router = express.Router();

router.use(authenticate);

router.get(
  '/request-tickets-summary',
  authorize('request_tickets:read'),
  asyncHandler(async (req, res) => {
    const data = await requestTicketsService.dashboardSummary(req.query);
    res.json(data);
  })
);

module.exports = { dashboardRouter: router };
