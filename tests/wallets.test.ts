import { env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import app from "../src/index";

describe("Wallet Services", () => {
  let buyerToken: string;
  let sellerToken: string;
  let buyerId: string;
  let sellerId: string;

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
    const queries = schema.split(";").filter((q) => q.trim());
    for (const query of queries) {
      await env.D1.prepare(query).run();
    }

    // Create a buyer
    const buyerRes = await app.request(
      "/auth/users",
      {
        method: "POST",
        body: JSON.stringify({ username: "buyer1", password: "password", role: "buyer" }),
        headers: { "Content-Type": "application/json" },
      },
      env
    );
    const buyerData: any = await buyerRes.json();
    buyerId = buyerData.id;

    // Create buyer profile
    await app.request(
      "/auth/buyers",
      {
        method: "POST",
        body: JSON.stringify({ user_id: buyerId, full_name: "Buyer One" }),
        headers: { "Content-Type": "application/json" },
      },
      env
    );

    // Create a seller
    const sellerRes = await app.request(
      "/auth/users",
      {
        method: "POST",
        body: JSON.stringify({ username: "seller1", password: "password", role: "seller" }),
        headers: { "Content-Type": "application/json" },
      },
      env
    );
    const sellerData: any = await sellerRes.json();
    sellerId = sellerData.id;

    // Create seller profile
    await app.request(
      "/auth/sellers",
      {
        method: "POST",
        body: JSON.stringify({ user_id: sellerId, store_name: "Seller One" }),
        headers: { "Content-Type": "application/json" },
      },
      env
    );

    // Login buyer
    const buyerLogin = await app.request(
      "/auth/login",
      {
        method: "POST",
        body: JSON.stringify({ username: "buyer1", password: "password" }),
        headers: { "Content-Type": "application/json" },
      },
      env
    );
    buyerToken = ((await buyerLogin.json()) as any).token;

    // Login seller
    const sellerLogin = await app.request(
      "/auth/login",
      {
        method: "POST",
        body: JSON.stringify({ username: "seller1", password: "password" }),
        headers: { "Content-Type": "application/json" },
      },
      env
    );
    sellerToken = ((await sellerLogin.json()) as any).token;

    // Give buyer some balance
    await env.D1.prepare("UPDATE buyers SET balance = 1000 WHERE user_id = ?").bind(buyerId).run();
  });

  it("should search users", async () => {
    const res = await app.request(
      "/wallets/search?q=sel",
      {
        headers: { Authorization: `Bearer ${buyerToken}` },
      },
      env
    );
    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.length).toBeGreaterThan(0);
    expect(data[0].username).toBe("seller1");
  });

  it("should perform a transfer", async () => {
    const res = await app.request(
      "/wallets/transfer",
      {
        method: "POST",
        body: JSON.stringify({ recipientId: sellerId, amount: 100 }),
        headers: {
          Authorization: `Bearer ${buyerToken}`,
          "Content-Type": "application/json",
        },
      },
      env
    );
    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.message).toBe("Transfer successful");

    // Check balances
    const buyer: any = await env.D1.prepare("SELECT balance FROM buyers WHERE user_id = ?").bind(buyerId).first();
    const seller: any = await env.D1.prepare("SELECT balance FROM sellers WHERE user_id = ?").bind(sellerId).first();
    expect(buyer.balance).toBe(900);
    expect(seller.balance).toBe(100);
  });

  it("should create a money request", async () => {
    const res = await app.request(
      "/wallets/request",
      {
        method: "POST",
        body: JSON.stringify({ targetId: buyerId, amount: 50 }),
        headers: {
          Authorization: `Bearer ${sellerToken}`,
          "Content-Type": "application/json",
        },
      },
      env
    );
    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.message).toBe("Request sent");
  });

  it("should get pending requests", async () => {
    const res = await app.request(
      "/wallets/requests/pending",
      {
        headers: { Authorization: `Bearer ${buyerToken}` },
      },
      env
    );
    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.incoming.length).toBeGreaterThan(0);
    expect(data.incoming[0].amount).toBe(50);
  });
});
