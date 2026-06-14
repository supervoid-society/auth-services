import { Hono } from "hono";
import { sign } from "@tsndr/cloudflare-worker-jwt";
import { authMiddleware } from "../middleware/auth";

type Bindings = {
  JWT_SECRET: string;
  D1: D1Database;
};

interface JWTPayload {
  userId: string;
  username: string;
  role: string;
  exp: number;
}

const auth = new Hono<{ Bindings: Bindings; Variables: { jwtPayload: JWTPayload } }>();

auth.post("/login", async (c) => {
  const { username, password } = await c.req.json();

  const user = (await c.env.D1.prepare("SELECT * FROM users WHERE username = ? AND password = ?").bind(username, password).first()) as
    | { id: string; username: string; role: string; is_banned?: number }
    | undefined;

  if (user) {
    if (user.is_banned === 1) {
      return c.json({ error: "Akun Anda telah dibanned." }, 403);
    }
    
    // Auto-create buyer profile/wallet for admin if missing
    if (user.role === "admin") {
      const existingBuyer = await c.env.D1.prepare("SELECT id FROM buyers WHERE user_id = ?").bind(user.id).first();
      if (!existingBuyer) {
        const buyerId = crypto.randomUUID();
        await c.env.D1.prepare("INSERT INTO buyers (id, user_id, full_name, balance) VALUES (?, ?, ?, 1000000.00)")
          .bind(buyerId, user.id, "Admin Platform")
          .run();
      }
    }

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
    await c.env.D1.prepare("INSERT INTO users (id, username, password, role) VALUES (?, ?, ?, ?)").bind(userId, username, password, role).run();

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
    await c.env.D1.prepare("INSERT INTO buyers (id, user_id, full_name, address, phone) VALUES (?, ?, ?, ?, ?)")
      .bind(buyerId, user_id, full_name, address || null, phone || null)
      .run();

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
    const user = (await c.env.D1.prepare("SELECT username FROM users WHERE id = ?").bind(user_id).first()) as { username: string } | undefined;
    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    const sellerId = crypto.randomUUID();
    await c.env.D1.prepare("INSERT INTO sellers (id, user_id, store_name, description, contact_phone) VALUES (?, ?, ?, ?, ?)")
      .bind(sellerId, user_id, store_name, description || null, contact_phone || null)
      .run();

    // Update user role to 'seller'
    await c.env.D1.prepare("UPDATE users SET role = 'seller' WHERE id = ?").bind(user_id).run();

    // Generate new JWT token
    const secret = c.env.JWT_SECRET;
    const payload = {
      userId: user_id,
      username: user.username,
      role: "seller",
      exp: Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60,
    };
    const token = await sign(payload, secret);

    return c.json({ id: sellerId, token });
  } catch {
    return c.json({ error: "Failed to create seller" }, 500);
  }
});

auth.put("/balance/:userId", async (c) => {
  const userId = c.req.param("userId");
  const { role, amount } = await c.req.json();

  const table = role === "seller" ? "sellers" : "buyers";
  await c.env.D1.prepare(`UPDATE ${table} SET balance = balance + ? WHERE user_id = ?`).bind(amount, userId).run();

  return c.json({ message: "Balance updated" });
});

auth.get("/balance/:userId/:role", async (c) => {
  const userId = c.req.param("userId");
  const role = c.req.param("role"); // 'buyer' or 'seller'

  const table = role === "seller" ? "sellers" : "buyers";
  const result = (await c.env.D1.prepare(`SELECT balance FROM ${table} WHERE user_id = ?`).bind(userId).first()) as { balance: number } | undefined;

  if (result) {
    return c.json({ balance: result.balance });
  } else {
    return c.json({ error: "User not found" }, 404);
  }
});

auth.get("/sellers/me", authMiddleware, async (c) => {
  const payload = c.get("jwtPayload");
  const result = await c.env.D1.prepare("SELECT * FROM sellers WHERE user_id = ?").bind(payload.userId).first();
  if (result) {
    return c.json(result);
  } else {
    return c.json({ error: "Seller profile not found" }, 404);
  }
});

auth.get("/buyers/me", authMiddleware, async (c) => {
  const payload = c.get("jwtPayload");
  const result = await c.env.D1.prepare("SELECT * FROM buyers WHERE user_id = ?").bind(payload.userId).first();
  if (result) {
    return c.json(result);
  } else {
    return c.json({ error: "Buyer profile not found" }, 404);
  }
});

auth.post("/transfer", async (c) => {
  const { buyerId, sellerId, amount } = await c.req.json();

  const buyer = (await c.env.D1.prepare("SELECT balance FROM buyers WHERE user_id = ?").bind(buyerId).first()) as { balance: number } | undefined;
  if (!buyer || buyer.balance < amount) {
    return c.json({ error: "Insufficient balance" }, 400);
  }

  await c.env.D1.prepare("UPDATE buyers SET balance = balance - ? WHERE user_id = ?").bind(amount, buyerId).run();
  await c.env.D1.prepare("UPDATE sellers SET balance = balance + ? WHERE user_id = ?").bind(amount, sellerId).run();

  return c.json({ message: "Transfer successful" });
});

auth.get("/leaderboard", async (c) => {
  const leaderboard = await c.env.D1.prepare(
    `
    SELECT 
      u.id as user_id, 
      u.username, 
      b.full_name as display_name, 
      (COALESCE(b.balance, 0) + COALESCE(s.balance, 0)) as balance,
      COALESCE(b.balance, 0) as buyer_balance,
      COALESCE(s.balance, 0) as seller_balance,
      CASE WHEN s.id IS NOT NULL THEN 'merchant' ELSE 'member' END as status
    FROM users u
    JOIN buyers b ON u.id = b.user_id
    LEFT JOIN sellers s ON u.id = s.user_id
    ORDER BY balance DESC
    LIMIT 50
  `
  ).all();

  return c.json(leaderboard.results);
});

auth.post("/switch-role", authMiddleware, async (c) => {
  const payload = c.get("jwtPayload");
  const { role } = await c.req.json();

  if (!role || (role !== "buyer" && role !== "seller")) {
    return c.json({ error: "Invalid role target. Must be 'buyer' or 'seller'" }, 400);
  }

  try {
    // Check if target profile exists
    if (role === "seller") {
      const seller = await c.env.D1.prepare("SELECT id FROM sellers WHERE user_id = ?").bind(payload.userId).first();
      if (!seller) {
        return c.json({ error: "seller_profile_missing", message: "Seller profile not found. Please complete onboarding." }, 400);
      }
    } else {
      const buyer = await c.env.D1.prepare("SELECT id FROM buyers WHERE user_id = ?").bind(payload.userId).first();
      if (!buyer) {
        // Auto-create buyer profile for legacy seller
        const buyerId = crypto.randomUUID();
        await c.env.D1.prepare("INSERT INTO buyers (id, user_id, full_name, balance) VALUES (?, ?, ?, 0.0)")
          .bind(buyerId, payload.userId, payload.username || "Buyer")
          .run();
      }
    }

    // Update active role in database
    await c.env.D1.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, payload.userId).run();

    // Sign new JWT token
    const secret = c.env.JWT_SECRET;
    const newPayload = {
      userId: payload.userId,
      username: payload.username,
      role: role,
      exp: Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60,
    };
    const token = await sign(newPayload, secret);
    return c.json({ token });
  } catch (err) {
    return c.json({ error: "Failed to switch role" }, 500);
  }
});

export default auth;
