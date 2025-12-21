DROP TABLE IF EXISTS sellers;
DROP TABLE IF EXISTS buyers;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS images;

CREATE TABLE images (
    id TEXT PRIMARY KEY,
    data BLOB NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'image/jpeg',
    created_at TEXT DEFAULT current_timestamp,
    updated_at TEXT DEFAULT current_timestamp
);

CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'seller', 'buyer')),
    created_at TEXT DEFAULT current_timestamp,
    updated_at TEXT DEFAULT current_timestamp
);

CREATE TABLE sellers (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE,
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
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE,
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

INSERT INTO users (username, password, role) VALUES ('admin', 'admin', 'admin');