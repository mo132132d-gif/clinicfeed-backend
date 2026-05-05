CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS request_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number text UNIQUE,
  customer_name text NOT NULL,
  phone text,
  email text,
  country text,
  region text,
  request_description text NOT NULL,
  assigned_to text,
  status text NOT NULL DEFAULT 'new',
  priority text DEFAULT 'medium',
  source text,
  internal_notes text,
  cancellation_reason text,
  order_amount numeric(12,2),
  vat_amount numeric(12,2),
  total_amount numeric(12,2),
  qr_code text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  closed_at timestamptz
);

CREATE TABLE IF NOT EXISTS request_ticket_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES request_tickets(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(ticket_id, supplier_id)
);

CREATE INDEX IF NOT EXISTS request_tickets_status_idx ON request_tickets (status);
CREATE INDEX IF NOT EXISTS request_tickets_assigned_to_idx ON request_tickets (assigned_to);
CREATE INDEX IF NOT EXISTS request_tickets_created_at_idx ON request_tickets (created_at DESC);
CREATE INDEX IF NOT EXISTS request_ticket_suppliers_ticket_id_idx ON request_ticket_suppliers (ticket_id);
CREATE INDEX IF NOT EXISTS request_ticket_suppliers_supplier_id_idx ON request_ticket_suppliers (supplier_id);

DROP TRIGGER IF EXISTS set_request_tickets_updated_at ON request_tickets;
CREATE TRIGGER set_request_tickets_updated_at
BEFORE UPDATE ON request_tickets
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
