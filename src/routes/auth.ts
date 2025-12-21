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

auth.get("/sellers/me", async (c) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const token = authHeader.substring(7);
  const secret = c.env.JWT_SECRET;
  try {
    const { payload } = await import("@tsndr/cloudflare-worker-jwt").then(m => m.verify(token, secret));
    const userId = payload.userId;

    const result = await c.env.D1.prepare("SELECT * FROM sellers WHERE user_id = ?").bind(userId).first();
    if (result) {
      return c.json(result);
    } else {
      return c.json({ error: "Seller profile not found" }, 404);
    }
  } catch {
    return c.json({ error: "Invalid token" }, 401);
  }
});

auth.get("/buyers/me", async (c) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const token = authHeader.substring(7);
  const secret = c.env.JWT_SECRET;
  try {
    const { payload } = await import("@tsndr/cloudflare-worker-jwt").then(m => m.verify(token, secret));
    const userId = payload.userId;

    const result = await c.env.D1.prepare("SELECT * FROM buyers WHERE user_id = ?").bind(userId).first();
    if (result) {
      return c.json(result);
    } else {
      return c.json({ error: "Buyer profile not found" }, 404);
    }
  } catch {
    return c.json({ error: "Invalid token" }, 401);
  }
});

auth.get("/leaderboard", async (c) => {
  const buyers = await c.env.D1.prepare(`
    SELECT u.username, b.balance, 'buyer' as role
    FROM users u
    JOIN buyers b ON u.id = b.user_id
  `).all();

  const sellers = await c.env.D1.prepare(`
    SELECT u.username, s.balance, 'seller' as role
    FROM users u
    JOIN sellers s ON u.id = s.user_id
  `).all();

  const leaderboard = [...(buyers.results || []), ...(sellers.results || [])]
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 50); // Top 50

  return c.json(leaderboard);
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

auth.get("/task", async (c) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const token = authHeader.substring(7);
  const secret = c.env.JWT_SECRET;
  try {
    const { payload } = await import("@tsndr/cloudflare-worker-jwt").then(m => m.verify(token, secret));
    const userId = payload.userId;

    // Get total solved tasks globally for difficulty
    const totalSolved = await c.env.D1.prepare("SELECT COUNT(*) as count FROM solved_tasks").first();
    const difficulty = Math.min(24, Math.max(6, 6 + Math.floor((totalSolved.count as number) / 100))); // Start at 6, increase slowly

    // Check if there's an active challenge
    let activeChallenge = await c.env.D1.prepare("SELECT challenge FROM active_challenges LIMIT 1").first();
    let challenge;
    if (activeChallenge) {
      challenge = activeChallenge.challenge;
    } else {
      // Generate new challenge and save to active
      challenge = crypto.getRandomValues(new Uint8Array(16)).reduce((acc, byte) => acc + byte.toString(16).padStart(2, '0'), '');
      const activeId = crypto.randomUUID();
      await c.env.D1.prepare("INSERT INTO active_challenges (id, challenge, difficulty) VALUES (?, ?, ?)").bind(activeId, challenge, difficulty).run();
    }

    return c.json({ challenge, difficulty });
  } catch {
    return c.json({ error: "Invalid token" }, 401);
  }
});

auth.get("/task/:challenge/valid", async (c) => {
  const challenge = c.req.param("challenge");
  const existing = await c.env.D1.prepare("SELECT id FROM solved_tasks WHERE challenge = ?").bind(challenge).first();
  return c.json({ valid: !existing });
});

auth.post("/submit-task", async (c) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const token = authHeader.substring(7);
  const secret = c.env.JWT_SECRET;
  try {
    const { payload } = await import("@tsndr/cloudflare-worker-jwt").then(m => m.verify(token, secret));
    const userId = payload.userId;
    const { challenge, nonce, difficulty } = await c.req.json();

    // Verify proof-of-work
    function hexToBytes(hex: string): Uint8Array {
      const bytes = [];
      for (let i = 0; i < hex.length; i += 2) {
        bytes.push(parseInt(hex.substr(i, 2), 16));
      }
      return new Uint8Array(bytes);
    }
    const challengeBytes = hexToBytes(challenge);
    const nonceHex = nonce;
    const nonceBytes = hexToBytes(nonceHex.length % 2 === 0 ? nonceHex : '0' + nonceHex);
    const data = new Uint8Array([...challengeBytes, ...nonceBytes]);
    const hash = await crypto.subtle.digest("SHA-256", data);
    const hashHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    const leadingZeros = hashHex.match(/^0*/)?.[0].length || 0;

    if (leadingZeros < difficulty) {
      return c.json({ error: "Invalid proof-of-work" }, 400);
    }

    // Check if already solved
    const existing = await c.env.D1.prepare("SELECT id FROM solved_tasks WHERE user_id = ? AND challenge = ?").bind(userId, challenge).first();
    if (existing) {
      return c.json({ error: "Task already solved" }, 400);
    }

    // Save solved task
    const taskId = crypto.randomUUID();
    await c.env.D1.prepare("INSERT INTO solved_tasks (id, user_id, challenge, nonce, difficulty) VALUES (?, ?, ?, ?, ?)").bind(taskId, userId, challenge, nonce, difficulty).run();

    // Remove from active challenges
    await c.env.D1.prepare("DELETE FROM active_challenges WHERE challenge = ?").bind(challenge).run();

    // Update balance
    const role = payload.role;
    const table = role === 'seller' ? 'sellers' : 'buyers';
    await c.env.D1.prepare(`UPDATE ${table} SET balance = balance + 100000 WHERE user_id = ?`).bind(userId).run();

    return c.json({ message: "Task solved, balance updated" });
  } catch {
    return c.json({ error: "Invalid token" }, 401);
  }
});

auth.get("/leaderboard", async (c) => {
  // Get buyers leaderboard
  const buyers = await c.env.D1.prepare(`
    SELECT u.username, b.balance, 'buyer' as role
    FROM buyers b
    JOIN users u ON b.user_id = u.id
    ORDER BY b.balance DESC
    LIMIT 50
  `).all();

  // Get sellers leaderboard
  const sellers = await c.env.D1.prepare(`
    SELECT u.username, s.balance, 'seller' as role
    FROM sellers s
    JOIN users u ON s.user_id = u.id
    ORDER BY s.balance DESC
    LIMIT 50
  `).all();

  // Combine and sort
  const allUsers = [...(buyers.results || []), ...(sellers.results || [])];
  allUsers.sort((a, b) => b.balance - a.balance);
  const top50 = allUsers.slice(0, 50);

  return c.json(top50);
});

export default auth;