import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import app from "../src/index";

describe("Auth Services", () => {
  beforeAll(async () => {
    // Initialize schema
    const schema = `
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
`;
    const queries = schema.split(";").filter(q => q.trim());
    for (const query of queries) {
      await env.D1.prepare(query).run();
    }
  });

  it("should return Hello Hono!", async () => {
    const res = await app.request("/", {}, env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Hello Hono!");
  });

  it("should create a user", async () => {
    const res = await app.request("/auth/users", {
      method: "POST",
      body: JSON.stringify({
        username: "testuser",
        password: "testpassword",
        role: "buyer"
      }),
      headers: { "Content-Type": "application/json" }
    }, env);

    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.id).toBeDefined();
  });

  it("should login successfully", async () => {
    const res = await app.request("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: "testuser",
        password: "testpassword"
      }),
      headers: { "Content-Type": "application/json" }
    }, env);

    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.token).toBeDefined();
  });

  it("should return error for invalid login", async () => {
    const res = await app.request("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: "testuser",
        password: "wrongpassword"
      }),
      headers: { "Content-Type": "application/json" }
    }, env);

    expect(res.status).toBe(401);
    const data: any = await res.json();
    expect(data.error).toBe("Invalid credentials");
  });
});
