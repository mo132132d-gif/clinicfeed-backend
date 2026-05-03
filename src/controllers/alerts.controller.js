const alertsService = require('../services/alerts.service');
const { asyncHandler } = require('../utils/asyncHandler');

const getSummary = asyncHandler(async (req, res) => {
  const data = await alertsService.summary();
  res.json({ data });
});

const getExpiredDocuments = asyncHandler(async (req, res) => {
  const data = await alertsService.expiredDocuments();
  res.json({ data });
});

const getDocumentsExpiringIn30Days = asyncHandler(async (req, res) => {
  const data = await alertsService.documentsExpiringIn30Days();
  res.json({ data });
});

const getMissingContactInfo = asyncHandler(async (req, res) => {
  const data = await alertsService.missingContactInfo();
  res.json({ data });
});

const getOutdatedPriceLists = asyncHandler(async (req, res) => {
  const data = await alertsService.outdatedPriceLists();
  res.json({ data });
});

module.exports = {
  getSummary,
  getExpiredDocuments,
  getDocumentsExpiringIn30Days,
  getMissingContactInfo,
  getOutdatedPriceLists
};
