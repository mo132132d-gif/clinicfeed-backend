const COMPLETED_STATUSES = new Set([
  'completed',
  'executed',
  'done',
  'success',
  'fulfilled',
  'منفذ',
  'منفذة',
  'مكتمل',
  'مكتملة',
  'تم التنفيذ'
]);

const CANCELLED_STATUSES = new Set([
  'cancelled',
  'canceled',
  'rejected',
  'failed',
  'ملغي',
  'ملغية',
  'ملغى',
  'مرفوض'
]);

const PENDING_STATUSES = new Set([
  'pending',
  'open',
  'new',
  'in_progress',
  'processing',
  'waiting',
  'under_review',
  'waiting_customer',
  'waiting_supplier',
  'quotation_sent',
  'جديد',
  'قيد المراجعة',
  'بأنتظار العميل',
  'بانتظار العميل',
  'بإنتظار العميل',
  'بأنتظار المورد',
  'بانتظار المورد',
  'بإنتظار المورد',
  'تم ارسال عرض سعر',
  'تم إرسال عرض سعر',
  'قيد التنفيذ',
  'معلق'
]);

function normalizeStatusInput(status) {
  if (status === null || status === undefined) {
    return '';
  }

  return String(status).trim().toLowerCase();
}

function normalizeTicketStatus(status) {
  const normalized = normalizeStatusInput(status);

  if (COMPLETED_STATUSES.has(normalized)) {
    return 'completed';
  }

  if (CANCELLED_STATUSES.has(normalized)) {
    return 'cancelled';
  }

  if (PENDING_STATUSES.has(normalized)) {
    return 'pending';
  }

  return null;
}

function isClosedStatus(status) {
  const normalized = normalizeTicketStatus(status);
  return normalized === 'completed' || normalized === 'cancelled';
}

module.exports = {
  COMPLETED_STATUSES,
  CANCELLED_STATUSES,
  PENDING_STATUSES,
  normalizeTicketStatus,
  isClosedStatus
};
