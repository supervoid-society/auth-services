import { env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import app from "../src/index";

describe("Auth Services - Full Integration Flow", () => {
  let buyerToken: string;
  let sellerToken: string;
  let buyerId: string;
  let sellerId: string;

  beforeAll(async () => {
    const schema = `
DROP TABLE IF EXISTS sellers;
DROP TABLE IF EXISTS buyers;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS images;
DROP TABLE IF EXISTS solved_tasks;
DROP TABLE IF EXISTS active_challenges;

CREATE TABLE images (id TEXT PRIMARY KEY, data BLOB NOT NULL, content_type TEXT NOT NULL DEFAULT 'image/jpeg', created_at TEXT DEFAULT current_timestamp, updated_at TEXT DEFAULT current_timestamp);
CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('admin', 'seller', 'buyer')), created_at TEXT DEFAULT current_timestamp, updated_at TEXT DEFAULT current_timestamp);
CREATE TABLE sellers (id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE, store_name TEXT NOT NULL, description TEXT, contact_phone TEXT, image_id TEXT, balance DECIMAL(10,2) DEFAULT 0.0, created_at TEXT DEFAULT current_timestamp, updated_at TEXT DEFAULT current_timestamp, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE SET NULL);
CREATE TABLE buyers (id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE, full_name TEXT NOT NULL, address TEXT, phone TEXT, image_id TEXT, balance DECIMAL(10,2) DEFAULT 0.0, created_at TEXT DEFAULT current_timestamp, updated_at TEXT DEFAULT current_timestamp, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE SET NULL);
CREATE TABLE solved_tasks (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, challenge TEXT NOT NULL, nonce TEXT NOT NULL, difficulty INTEGER NOT NULL, solved_at TEXT DEFAULT current_timestamp, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE active_challenges (id TEXT PRIMARY KEY, challenge TEXT NOT NULL UNIQUE, difficulty INTEGER NOT NULL, created_at TEXT DEFAULT current_timestamp);
`;
    const queries = schema.split(";").filter((q) => q.trim());
    for (const query of queries) {
      await env.D1.prepare(query).run();
    }
  });

  it("1. Register a new buyer", async () => {
    const res = await app.request(
      "/auth/users",
      {
        method: "POST",
        body: JSON.stringify({ username: "int_buyer", password: "pwd", role: "buyer" }),
        headers: { "Content-Type": "application/json" },
      },
      env
    );
    expect(res.status).toBe(200);
    const data: any = await res.json();
    buyerId = data.id;

    // Create buyer profile
    const profileRes = await app.request(
      "/auth/buyers",
      {
        method: "POST",
        body: JSON.stringify({ user_id: buyerId, full_name: "Integration Buyer" }),
        headers: { "Content-Type": "application/json" },
      },
      env
    );
    expect(profileRes.status).toBe(200);
  });

  it("2. Register a new seller", async () => {
    const res = await app.request(
      "/auth/users",
      {
        method: "POST",
        body: JSON.stringify({ username: "int_seller", password: "pwd", role: "seller" }),
        headers: { "Content-Type": "application/json" },
      },
      env
    );
    expect(res.status).toBe(200);
    const data: any = await res.json();
    sellerId = data.id;

    // Create seller profile
    const profileRes = await app.request(
      "/auth/sellers",
      {
        method: "POST",
        body: JSON.stringify({ user_id: sellerId, store_name: "Integration Store" }),
        headers: { "Content-Type": "application/json" },
      },
      env
    );
    expect(profileRes.status).toBe(200);
  });

  it("3. Login as buyer", async () => {
    const res = await app.request(
      "/auth/login",
      {
        method: "POST",
        body: JSON.stringify({ username: "int_buyer", password: "pwd" }),
        headers: { "Content-Type": "application/json" },
      },
      env
    );
    expect(res.status).toBe(200);
    const data: any = await res.json();
    buyerToken = data.token;
    expect(buyerToken).toBeDefined();
  });

  it("4. Buyer attempts to fetch profile", async () => {
    const res = await app.request(
      "/buyers/me",
      {
        headers: { Authorization: `Bearer ${buyerToken}` },
      },
      env
    );
    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.full_name).toBe("Integration Buyer");
  });

  it("5. Test profile-image fetching with role query param", async () => {
    // 1. Insert dummy image
    const imageId = crypto.randomUUID();
    const dummyData = new Uint8Array([255, 216, 255, 224]);
    await env.D1.prepare("INSERT INTO images (id, data, content_type) VALUES (?, ?, ?)").bind(imageId, dummyData, "image/jpeg").run();

    // 2. Link image to buyer
    await env.D1.prepare("UPDATE buyers SET image_id = ? WHERE user_id = ?").bind(imageId, buyerId).run();

    // 3. Request buyer profile image using default role (buyer)
    const resDefault = await app.request(`/users/profile-image/${buyerId}`, {}, env);
    expect(resDefault.status).toBe(200);

    // 4. Request buyer profile image by forcing role=buyer
    const resForced = await app.request(`/users/profile-image/${buyerId}?role=buyer`, {}, env);
    expect(resForced.status).toBe(200);

    // 5. Change user role to seller directly in DB
    await env.D1.prepare("UPDATE users SET role = 'seller' WHERE id = ?").bind(buyerId).run();

    // Since buyer has no seller profile/image, default role (seller) should return 404
    const resDefaultSeller = await app.request(`/users/profile-image/${buyerId}`, {}, env);
    expect(resDefaultSeller.status).toBe(404);

    // But forcing role=buyer should still retrieve the buyer profile image!
    const resForcedBuyer = await app.request(`/users/profile-image/${buyerId}?role=buyer`, {}, env);
    expect(resForcedBuyer.status).toBe(200);
  });
});
