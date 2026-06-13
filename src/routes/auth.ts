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

  const user = await c.env.D1.prepare("SELECT * FROM users WHERE username = ? AND password = ?").bind(username, password).first() as { id: string, username: string, role: string } | undefined;

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
  const result = await c.env.D1.prepare(`SELECT balance FROM ${table} WHERE user_id = ?`).bind(userId).first() as { balance: number } | undefined;

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

  const buyer = await c.env.D1.prepare("SELECT balance FROM buyers WHERE user_id = ?").bind(buyerId).first() as { balance: number } | undefined;
  if (!buyer || buyer.balance < amount) {
    return c.json({ error: "Insufficient balance" }, 400);
  }

  await c.env.D1.prepare("UPDATE buyers SET balance = balance - ? WHERE user_id = ?").bind(amount, buyerId).run();
  await c.env.D1.prepare("UPDATE sellers SET balance = balance + ? WHERE user_id = ?").bind(amount, sellerId).run();

  return c.json({ message: "Transfer successful" });
});

auth.get("/solved-history", authMiddleware, async (c) => {
  const payload = c.get("jwtPayload");
  const history = await c.env.D1.prepare("SELECT nonce, solved_at FROM solved_tasks WHERE user_id = ? ORDER BY solved_at DESC LIMIT 50").bind(payload.userId).all();
  return c.json(history.results);
});

auth.get("/task/:challenge/valid", async (c) => {
  const challenge = c.req.param("challenge");
  const existing = await c.env.D1.prepare("SELECT id FROM solved_tasks WHERE challenge = ?").bind(challenge).first();
  return c.json({ valid: !existing });
});

auth.get("/task", authMiddleware, async (c) => {
  let difficulty = 6; // Fixed difficulty

  let activeChallenge = await c.env.D1.prepare("SELECT challenge FROM active_challenges LIMIT 1").first() as { challenge: string } | undefined;
  let challenge;
  if (activeChallenge) {
    challenge = activeChallenge.challenge;
  } else {
    challenge = crypto.getRandomValues(new Uint8Array(16)).reduce((acc, byte) => acc + byte.toString(16).padStart(2, '0'), '');
    const activeId = crypto.randomUUID();
    await c.env.D1.prepare("INSERT INTO active_challenges (id, challenge, difficulty) VALUES (?, ?, ?)").bind(activeId, challenge, difficulty).run();
  }

  return c.json({ challenge, difficulty });
});

auth.post("/submit-task", authMiddleware, async (c) => {
  const payload = c.get("jwtPayload");
  const { challenge, nonce, difficulty } = await c.req.json();

  function hexToBytes(hex: string): Uint8Array {
    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) {
      bytes.push(parseInt(hex.substr(i, 2), 16));
    }
    return new Uint8Array(bytes);
  }

  const challengeBytes = hexToBytes(challenge);
  const nonceBytes = hexToBytes(nonce.length % 2 === 0 ? nonce : '0' + nonce);
  const combinedData = new Uint8Array([...challengeBytes, ...nonceBytes]);
  const hash = await crypto.subtle.digest("SHA-256", combinedData);
  const hashHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  const leadingZeros = hashHex.match(/^0*/)?.[0].length || 0;

  if (leadingZeros < difficulty) {
    return c.json({ error: "Invalid proof-of-work" }, 400);
  }

  const existing = await c.env.D1.prepare("SELECT id FROM solved_tasks WHERE user_id = ? AND challenge = ?").bind(payload.userId, challenge).first();
  if (existing) {
    return c.json({ error: "Task already solved" }, 400);
  }

  const taskId = crypto.randomUUID();
  await c.env.D1.prepare("INSERT INTO solved_tasks (id, user_id, challenge, nonce, difficulty) VALUES (?, ?, ?, ?, ?)").bind(taskId, payload.userId, challenge, nonce, difficulty).run();
  await c.env.D1.prepare("DELETE FROM active_challenges WHERE challenge = ?").bind(challenge).run();

  const table = payload.role === 'seller' ? 'sellers' : 'buyers';
  await c.env.D1.prepare(`UPDATE ${table} SET balance = balance + 100000 WHERE user_id = ?`).bind(payload.userId).run();

  return c.json({ message: "Task solved, balance updated" });
});

auth.get("/leaderboard", async (c) => {
  const leaderboard = await c.env.D1.prepare(`
    SELECT u.username, b.balance, 'buyer' as role
    FROM buyers b
    JOIN users u ON b.user_id = u.id
    UNION ALL
    SELECT u.username, s.balance, 'seller' as role
    FROM sellers s
    JOIN users u ON s.user_id = u.id
    ORDER BY balance DESC
    LIMIT 50
  `).all();

  return c.json(leaderboard.results);
});


export default auth;