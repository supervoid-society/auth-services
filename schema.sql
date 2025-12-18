DROP TABLE IF EXISTS users;

CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    created_at TEXT DEFAULT current_timestamp,
    updated_at TEXT DEFAULT current_timestamp
);

INSERT INTO users (username, password) VALUES ('admin', 'admin');