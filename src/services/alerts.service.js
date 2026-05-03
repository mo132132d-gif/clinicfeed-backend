const { query } = require('../db/query');

async function expiredDocuments() {
  const result = await query(`
    SELECT
      d.*,
      s.name_ar AS supplier_name_ar,
      s.name_en AS supplier_name_en
    FROM documents d
    JOIN suppliers s ON s.id = d.supplier_id
    WHERE d.expiry_date IS NOT NULL
      AND d.expiry_date < CURRENT_DATE
    ORDER BY d.expiry_date ASC
  `);

  return result.rows;
}

async function documentsExpiringIn30Days() {
  const result = await query(`
    SELECT
      d.*,
      s.name_ar AS supplier_name_ar,
      s.name_en AS supplier_name_en
    FROM documents d
    JOIN suppliers s ON s.id = d.supplier_id
    WHERE d.expiry_date IS NOT NULL
      AND d.expiry_date >= CURRENT_DATE
      AND d.expiry_date <= CURRENT_DATE + INTERVAL '30 days'
    ORDER BY d.expiry_date ASC
  `);

  return result.rows;
}

async function missingContactInfo() {
  const result = await query(`
    SELECT
      s.id AS supplier_id,
      s.name_ar AS supplier_name_ar,
      s.name_en AS supplier_name_en,
      s.status AS supplier_status,
      c.id AS contact_id,
      c.name AS contact_name,
      array_remove(ARRAY[
        CASE WHEN c.id IS NULL THEN 'primary_contact' END,
        CASE WHEN c.id IS NOT NULL AND nullif(c.phone, '') IS NULL THEN 'phone' END,
        CASE WHEN c.id IS NOT NULL AND nullif(c.whatsapp, '') IS NULL THEN 'whatsapp' END,
        CASE WHEN c.id IS NOT NULL AND nullif(c.email, '') IS NULL THEN 'email' END
      ], NULL) AS missing_fields
    FROM suppliers s
    LEFT JOIN contacts c ON c.supplier_id = s.id AND c.is_primary = true
    WHERE c.id IS NULL
      OR nullif(c.phone, '') IS NULL
      OR nullif(c.whatsapp, '') IS NULL
      OR nullif(c.email, '') IS NULL
    ORDER BY s.name_en ASC
  `);

  return result.rows;
}

async function outdatedPriceLists() {
  const result = await query(`
    SELECT
      s.id AS supplier_id,
      s.name_ar AS supplier_name_ar,
      s.name_en AS supplier_name_en,
      s.status AS supplier_status,
      max(d.last_updated) AS last_price_list_updated,
      CASE
        WHEN max(d.last_updated) IS NULL THEN 'missing_price_list'
        ELSE 'outdated_price_list'
      END AS alert_type
    FROM suppliers s
    LEFT JOIN documents d ON d.supplier_id = s.id AND d.type = 'Price List'
    GROUP BY s.id, s.name_ar, s.name_en, s.status
    HAVING max(d.last_updated) IS NULL
      OR max(d.last_updated) < now() - INTERVAL '90 days'
    ORDER BY last_price_list_updated ASC NULLS FIRST, s.name_en ASC
  `);

  return result.rows;
}

async function summary() {
  const [
    expired,
    expiringSoon,
    missingContacts,
    outdatedPriceListRows
  ] = await Promise.all([
    expiredDocuments(),
    documentsExpiringIn30Days(),
    missingContactInfo(),
    outdatedPriceLists()
  ]);

  return {
    counts: {
      expired_documents: expired.length,
      documents_expiring_in_30_days: expiringSoon.length,
      missing_contact_info: missingContacts.length,
      outdated_price_lists: outdatedPriceListRows.length
    },
    data: {
      expired_documents: expired,
      documents_expiring_in_30_days: expiringSoon,
      missing_contact_info: missingContacts,
      outdated_price_lists: outdatedPriceListRows
    }
  };
}

module.exports = {
  expiredDocuments,
  documentsExpiringIn30Days,
  missingContactInfo,
  outdatedPriceLists,
  summary
};
