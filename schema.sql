DROP TABLE IF EXISTS sellers;
DROP TABLE IF EXISTS buyers;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS images;
DROP TABLE IF EXISTS wallet_transfers;
DROP TABLE IF EXISTS wallet_requests;

CREATE TABLE images (
    id TEXT PRIMARY KEY,
    data BLOB NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'image/jpeg',
    created_at TEXT DEFAULT current_timestamp,
    updated_at TEXT DEFAULT current_timestamp
);

CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'seller', 'buyer')),
    is_banned INTEGER DEFAULT 0,
    created_at TEXT DEFAULT current_timestamp,
    updated_at TEXT DEFAULT current_timestamp
);

CREATE TABLE sellers (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    store_name TEXT NOT NULL,
    description TEXT,
    contact_phone TEXT,
    image_id TEXT,
    balance DECIMAL(10,2) DEFAULT 0.0,
    created_at TEXT DEFAULT current_timestamp,
    updated_at TEXT DEFAULT current_timestamp,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE SET NULL
);

CREATE TABLE buyers (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    address TEXT,
    phone TEXT,
    image_id TEXT,
    balance DECIMAL(10,2) DEFAULT 0.0,
    created_at TEXT DEFAULT current_timestamp,
    updated_at TEXT DEFAULT current_timestamp,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE SET NULL
);

CREATE TABLE wallet_transfers (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL,
    receiver_id TEXT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    created_at TEXT DEFAULT current_timestamp,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE wallet_requests (
    id TEXT PRIMARY KEY,
    requester_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
    created_at TEXT DEFAULT current_timestamp,
    updated_at TEXT DEFAULT current_timestamp,
    FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (target_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO users (id, username, password, role) VALUES ('550e8400-e29b-41d4-a716-446655440000', 'admin', 'admin', 'admin');
INSERT INTO buyers (id, user_id, full_name, balance) VALUES ('550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440000', 'Admin Platform', 1000000.00);