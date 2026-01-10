-- Create clients table
CREATE TABLE clients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Contact Information
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(20) NOT NULL,
  country_code VARCHAR(5) DEFAULT '+1',
  
  -- Notes
  notes TEXT,
  
  -- Address
  address_line_1 VARCHAR(255),
  address_line_2 VARCHAR(255),
  city VARCHAR(100),
  state VARCHAR(100),
  postal_code VARCHAR(20),
  country VARCHAR(100),
  
  -- Travel Preferences
  hotel_preference VARCHAR(50),
  seat_preference VARCHAR(50),
  dietary_preference VARCHAR(50),
  travel_style VARCHAR(50),
  
  -- Key Dates
  birthday DATE,
  anniversary DATE,
  passport_expiry DATE,
  visa_expiry DATE,
  
  -- Documents
  passport_number VARCHAR(50),
  driver_license_number VARCHAR(50),
  license_expiry DATE,
  visa_details TEXT,
  
  -- Tags and Loyalty Programs (JSON)
  tags JSONB DEFAULT '[]',
  loyalty_programs JSONB DEFAULT '[]',
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create RLS policies
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

-- Users can only see their own clients
CREATE POLICY "Users can view own clients" ON clients
  FOR SELECT USING (auth.uid() = user_id);

-- Users can insert their own clients
CREATE POLICY "Users can insert own clients" ON clients
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own clients
CREATE POLICY "Users can update own clients" ON clients
  FOR UPDATE USING (auth.uid() = user_id);

-- Users can delete their own clients
CREATE POLICY "Users can delete own clients" ON clients
  FOR DELETE USING (auth.uid() = user_id);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_clients_updated_at BEFORE UPDATE
    ON clients FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create indexes for better performance
CREATE INDEX idx_clients_user_id ON clients(user_id);
CREATE INDEX idx_clients_email ON clients(email);
CREATE INDEX idx_clients_created_at ON clients(created_at);
