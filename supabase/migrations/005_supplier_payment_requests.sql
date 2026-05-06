CREATE TABLE IF NOT EXISTS supplier_payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  request_number text UNIQUE NOT NULL DEFAULT (
    'PAY-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6))
  ),

  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,

  assigned_to text,
  amount numeric(12,2) NOT NULL,
  currency text NOT NULL DEFAULT 'SAR',

  payment_reason text NOT NULL,
  description text,

  priority text NOT NULL DEFAULT 'عادي',
  status text NOT NULL DEFAULT 'جديد',

  due_date date,

  manager_notes text,
  rejection_reason text,

  paid_amount numeric(12,2),
  paid_at timestamp,

  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS supplier_payment_request_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  payment_request_id uuid NOT NULL REFERENCES supplier_payment_requests(id) ON DELETE CASCADE,

  document_type text NOT NULL,
  file_url text NOT NULL,
  file_name text,
  file_mime_type text,
  file_size integer,
  file_path text,

  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,

  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_payment_requests_supplier_id
  ON supplier_payment_requests(supplier_id);

CREATE INDEX IF NOT EXISTS idx_supplier_payment_requests_status
  ON supplier_payment_requests(status);

CREATE INDEX IF NOT EXISTS idx_supplier_payment_requests_created_at
  ON supplier_payment_requests(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_supplier_payment_request_documents_request_id
  ON supplier_payment_request_documents(payment_request_id);
