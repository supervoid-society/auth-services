import { Hono } from "hono";
import { sign } from "@tsndr/cloudflare-worker-jwt";

type Bindings = {
  JWT_SECRET: string;
  D1: D1Database;
};

const auth = new Hono<{ Bindings: Bindings }>();

auth.post("/login", async (c) => {
  const { username, password } = await c.req.json();

  const user = await c.env.D1.prepare("SELECT * FROM users WHERE username = ? AND password = ?").bind(username, password).first();

  if (user) {
    const secret = c.env.JWT_SECRET;
    const payload = {
      userId: user.id,
      username: user.username,
      role: user.role,
      exp: Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60,
    };
    const token = await sign(payload, secret);
    return c.json({ token });
  } else {
    return c.json({ error: "Invalid credentials" }, 401);
  }
});

auth.post("/users", async (c) => {
  const { username, password, role } = await c.req.json();

  if (!username || !password || !role) {
    return c.json({ error: "Username, password, and role are required" }, 400);
  }

  try {
    const userId = crypto.randomUUID();
    await c.env.D1.prepare(
      "INSERT INTO users (id, username, password, role) VALUES (?, ?, ?, ?)"
    ).bind(userId, username, password, role).run();

    return c.json({ id: userId });
  } catch {
    return c.json({ error: "Failed to create user" }, 500);
  }
});

auth.post("/buyers", async (c) => {
  const { user_id, full_name, address, phone } = await c.req.json();

  if (!user_id || !full_name) {
    return c.json({ error: "User ID and full name are required" }, 400);
  }

  try {
    const buyerId = crypto.randomUUID();
    await c.env.D1.prepare(
      "INSERT INTO buyers (id, user_id, full_name, address, phone) VALUES (?, ?, ?, ?, ?)"
    ).bind(buyerId, user_id, full_name, address || null, phone || null).run();

    return c.json({ id: buyerId });
  } catch {
    return c.json({ error: "Failed to create buyer" }, 500);
  }
});

auth.post("/sellers", async (c) => {
  const { user_id, store_name, description, contact_phone } = await c.req.json();

  if (!user_id || !store_name) {
    return c.json({ error: "User ID and store name are required" }, 400);
  }

  try {
    const sellerId = crypto.randomUUID();
    await c.env.D1.prepare(
      "INSERT INTO sellers (id, user_id, store_name, description, contact_phone) VALUES (?, ?, ?, ?, ?)"
    ).bind(sellerId, user_id, store_name, description || null, contact_phone || null).run();

    return c.json({ id: sellerId });
  } catch {
    return c.json({ error: "Failed to create seller" }, 500);
  }
});

auth.put("/balance/:userId", async (c) => {
  const userId = c.req.param("userId");
  const { role, amount } = await c.req.json();

  const table = role === 'seller' ? 'sellers' : 'buyers';
  await c.env.D1.prepare(`UPDATE ${table} SET balance = balance + ? WHERE user_id = ?`).bind(amount, userId).run();

  return c.json({ message: "Balance updated" });
});

auth.get("/balance/:userId/:role", async (c) => {
  const userId = c.req.param("userId");
  const role = c.req.param("role"); // 'buyer' or 'seller'

  const table = role === 'seller' ? 'sellers' : 'buyers';
  const result = await c.env.D1.prepare(`SELECT balance FROM ${table} WHERE user_id = ?`).bind(userId).first();

  if (result) {
    return c.json({ balance: result.balance });
  } else {
    return c.json({ error: "User not found" }, 404);
  }
});

auth.post("/transfer", async (c) => {
  const { buyerId, sellerId, amount } = await c.req.json();

  // Get buyer balance
  const buyer = await c.env.D1.prepare("SELECT balance FROM buyers WHERE user_id = ?").bind(buyerId).first();
  if (!buyer || (buyer as { balance: number }).balance < amount) {
    return c.json({ error: "Insufficient balance" }, 400);
  }

  // Deduct from buyer
  await c.env.D1.prepare("UPDATE buyers SET balance = balance - ? WHERE user_id = ?").bind(amount, buyerId).run();

  // Add to seller
  await c.env.D1.prepare("UPDATE sellers SET balance = balance + ? WHERE user_id = ?").bind(amount, sellerId).run();

  return c.json({ message: "Transfer successful" });
});

export default auth;