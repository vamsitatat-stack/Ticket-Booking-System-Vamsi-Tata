-- Users Table (Customers, Organisers, Admins)
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) CHECK (role IN ('CUSTOMER', 'ORGANISER', 'ADMIN')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Venues & Seats Layout
CREATE TABLE venues (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    total_rows INT NOT NULL,
    total_cols INT NOT NULL
);

CREATE TABLE show_seats (
    id SERIAL PRIMARY KEY,
    show_id INT NOT NULL,
    row_label VARCHAR(5) NOT NULL,
    seat_number INT NOT NULL,
    category VARCHAR(20) CHECK (category IN ('Standard', 'Premium')),
    status VARCHAR(20) CHECK (status IN ('AVAILABLE', 'HELD', 'BOOKED')) DEFAULT 'AVAILABLE',
    held_by INT REFERENCES users(id),
    UNIQUE(show_id, row_label, seat_number)
);

-- Bookings Table
CREATE TABLE bookings (
    id SERIAL PRIMARY KEY,
    booking_ref VARCHAR(36) UNIQUE NOT NULL,
    user_id INT REFERENCES users(id),
    show_id INT NOT NULL,
    seat_ids INT[] NOT NULL,
    qr_code_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
