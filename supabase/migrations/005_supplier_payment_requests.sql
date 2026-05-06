CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS supplier_payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number text UNIQUE,
  supplier_id uuid NULL REFERENCES suppliers(id),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'New',
  priority text DEFAULT 'Normal',
  due_date date NULL,
  payment_method text NULL,
  invoice_number text NULL,
  reference_number text NULL,
  assigned_to text NULL,
  notes text NULL,
  created_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz NULL
);

CREATE TABLE IF NOT EXISTS supplier_payment_request_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_request_id uuid REFERENCES supplier_payment_requests(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(payment_request_id, supplier_id)
);

CREATE TABLE IF NOT EXISTS supplier_payment_request_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_request_id uuid REFERENCES supplier_payment_requests(id) ON DELETE CASCADE,
  document_type text NOT NULL DEFAULT 'Other',
  file_name text,
  file_url text,
  file_path text,
  file_mime_type text,
  file_size bigint,
  uploaded_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS supplier_payment_request_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_request_id uuid REFERENCES supplier_payment_requests(id) ON DELETE CASCADE,
  action text NOT NULL,
  old_value text NULL,
  new_value text NULL,
  description text NULL,
  created_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS supplier_payment_requests_status_idx ON supplier_payment_requests (status);
CREATE INDEX IF NOT EXISTS supplier_payment_requests_supplier_id_idx ON supplier_payment_requests (supplier_id);
CREATE INDEX IF NOT EXISTS supplier_payment_requests_created_at_idx ON supplier_payment_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS supplier_payment_requests_request_number_idx ON supplier_payment_requests (request_number);
CREATE INDEX IF NOT EXISTS supplier_payment_request_suppliers_payment_request_id_idx ON supplier_payment_request_suppliers (payment_request_id);
CREATE INDEX IF NOT EXISTS supplier_payment_request_suppliers_supplier_id_idx ON supplier_payment_request_suppliers (supplier_id);
CREATE INDEX IF NOT EXISTS supplier_payment_request_documents_payment_request_id_idx ON supplier_payment_request_documents (payment_request_id);
CREATE INDEX IF NOT EXISTS supplier_payment_request_activity_logs_payment_request_id_idx ON supplier_payment_request_activity_logs (payment_request_id);

DROP TRIGGER IF EXISTS set_supplier_payment_requests_updated_at ON supplier_payment_requests;
CREATE TRIGGER set_supplier_payment_requests_updated_at
BEFORE UPDATE ON supplier_payment_requests
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
