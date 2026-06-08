-- Supabase Database Schema for AP Invoice Application

-- Vendors Table
CREATE TABLE IF NOT EXISTS vendors (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  category TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Invoices Table
CREATE TABLE IF NOT EXISTS invoices (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_number TEXT NOT NULL,
  vendor_id UUID REFERENCES vendors(id),
  vendor_name TEXT,
  amount NUMERIC(12,2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  category TEXT,
  status TEXT DEFAULT 'pending_validation',
  priority TEXT DEFAULT 'medium',
  date_issued DATE,
  date_due DATE,
  notes TEXT,
  file_url TEXT,
  is_handwritten BOOLEAN DEFAULT false,
  is_non_usd BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;

-- Policies (adjust per your auth setup)
-- For development, allow all operations. In production, restrict to authenticated users
CREATE POLICY "Allow all for invoices" ON invoices
  FOR ALL USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all for vendors" ON vendors
  FOR ALL USING (true)
  WITH CHECK (true);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_vendor_id ON invoices(vendor_id);
CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON invoices(created_at);
CREATE INDEX IF NOT EXISTS idx_invoices_date_due ON invoices(date_due);
CREATE INDEX IF NOT EXISTS idx_vendors_name ON vendors(name);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
CREATE TRIGGER update_invoices_updated_at
  BEFORE UPDATE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Storage bucket for invoice files
-- Note: This needs to be created in the Supabase dashboard:
-- Storage → New Bucket → "invoices" → Public: false
