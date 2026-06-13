import { Hono } from "hono";
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

const wallets = new Hono<{ Bindings: Bindings; Variables: { jwtPayload: JWTPayload } }>();

// Search users to transfer/request (by username)
wallets.get("/search", authMiddleware, async (c) => {
  const query = c.req.query("q");
  const payload = c.get("jwtPayload");

  if (!query || query.length < 2) {
    return c.json([]);
  }

  const users = await c.env.D1.prepare(`
    SELECT id, username, role 
    FROM users 
    WHERE username LIKE ? AND id != ?
    LIMIT 10
  `).bind(`%${query}%`, payload.userId).all();

  return c.json(users.results);
});

// Perform atomic transfer
wallets.post("/transfer", authMiddleware, async (c) => {
  const payload = c.get("jwtPayload");
  const { recipientId, amount } = await c.req.json();

  if (!recipientId || !amount || amount <= 0) {
    return c.json({ error: "Invalid recipient or amount" }, 400);
  }

  // 1. Get sender info and balance
  const senderRole = payload.role;
  const senderTable = senderRole === 'seller' ? 'sellers' : 'buyers';
  const sender = await c.env.D1.prepare(`SELECT balance FROM ${senderTable} WHERE user_id = ?`).bind(payload.userId).first() as { balance: number } | undefined;

  console.log("Transfer - Sender Table:", senderTable);
  console.log("Transfer - Sender ID:", payload.userId);
  console.log("Transfer - Sender balance:", sender?.balance);
  console.log("Transfer - Requested amount:", amount);

  if (!sender || sender.balance < amount) {
    return c.json({ error: "Insufficient balance" }, 400);
  }

  // 2. Get recipient info
  const recipient = await c.env.D1.prepare("SELECT role FROM users WHERE id = ?").bind(recipientId).first() as { role: string } | undefined;
  if (!recipient) {
    return c.json({ error: "Recipient not found" }, 404);
  }
  const recipientTable = recipient.role === 'seller' ? 'sellers' : 'buyers';

  // 3. Atomic Batch Update
  const transferId = crypto.randomUUID();
  try {
    await c.env.D1.batch([
      c.env.D1.prepare(`UPDATE ${senderTable} SET balance = balance - ? WHERE user_id = ?`).bind(amount, payload.userId),
      c.env.D1.prepare(`UPDATE ${recipientTable} SET balance = balance + ? WHERE user_id = ?`).bind(amount, recipientId),
      c.env.D1.prepare("INSERT INTO wallet_transfers (id, sender_id, receiver_id, amount) VALUES (?, ?, ?, ?)").bind(transferId, payload.userId, recipientId, amount)
    ]);
    return c.json({ message: "Transfer successful", transferId });
  } catch (error) {
    console.error("Transfer failed:", error);
    return c.json({ error: "Transfer failed" }, 500);
  }
});

// Create money request
wallets.post("/request", authMiddleware, async (c) => {
  const payload = c.get("jwtPayload");
  const { targetId, amount } = await c.req.json();

  if (!targetId || !amount || amount <= 0) {
    return c.json({ error: "Invalid target or amount" }, 400);
  }

  const requestId = crypto.randomUUID();
  await c.env.D1.prepare("INSERT INTO wallet_requests (id, requester_id, target_id, amount, status) VALUES (?, ?, ?, ?, 'pending')")
    .bind(requestId, payload.userId, targetId, amount).run();

  return c.json({ message: "Request sent", requestId });
});

// Get pending requests (Incoming and Outgoing)
wallets.get("/requests/pending", authMiddleware, async (c) => {
  const payload = c.get("jwtPayload");

  const incoming = await c.env.D1.prepare(`
    SELECT wr.*, u.username as requester_name 
    FROM wallet_requests wr
    JOIN users u ON wr.requester_id = u.id
    WHERE wr.target_id = ? AND wr.status = 'pending'
  `).bind(payload.userId).all();

  const outgoing = await c.env.D1.prepare(`
    SELECT wr.*, u.username as target_name 
    FROM wallet_requests wr
    JOIN users u ON wr.target_id = u.id
    WHERE wr.requester_id = ? AND wr.status = 'pending'
  `).bind(payload.userId).all();

  return c.json({
    incoming: incoming.results,
    outgoing: outgoing.results
  });
});

// Respond to request
wallets.post("/requests/:id/respond", authMiddleware, async (c) => {
  const requestId = c.req.param("id");
  const payload = c.get("jwtPayload");
  const { action } = await c.req.json(); // 'accept' or 'reject'

  const request = await c.env.D1.prepare("SELECT * FROM wallet_requests WHERE id = ? AND target_id = ? AND status = 'pending'")
    .bind(requestId, payload.userId).first() as { id: string, requester_id: string, amount: number } | undefined;

  if (!request) {
    return c.json({ error: "Request not found or already processed" }, 404);
  }

  if (action === 'reject') {
    await c.env.D1.prepare("UPDATE wallet_requests SET status = 'rejected', updated_at = current_timestamp WHERE id = ?").bind(requestId).run();
    return c.json({ message: "Request rejected" });
  }

  if (action === 'accept') {
    // Logic similar to transfer
    const amount = request.amount;
    const senderRole = payload.role;
    const senderTable = senderRole === 'seller' ? 'sellers' : 'buyers';
    
    const sender = await c.env.D1.prepare(`SELECT balance FROM ${senderTable} WHERE user_id = ?`).bind(payload.userId).first() as { balance: number } | undefined;
    if (!sender || sender.balance < amount) {
      return c.json({ error: "Insufficient balance" }, 400);
    }

    const recipient = await c.env.D1.prepare("SELECT role FROM users WHERE id = ?").bind(request.requester_id).first() as { role: string } | undefined;
    const recipientTable = recipient?.role === 'seller' ? 'sellers' : 'buyers';

    const transferId = crypto.randomUUID();
    try {
      await c.env.D1.batch([
        c.env.D1.prepare(`UPDATE ${senderTable} SET balance = balance - ? WHERE user_id = ?`).bind(amount, payload.userId),
        c.env.D1.prepare(`UPDATE ${recipientTable} SET balance = balance + ? WHERE user_id = ?`).bind(amount, request.requester_id),
        c.env.D1.prepare("INSERT INTO wallet_transfers (id, sender_id, receiver_id, amount) VALUES (?, ?, ?, ?)").bind(transferId, payload.userId, request.requester_id, amount),
        c.env.D1.prepare("UPDATE wallet_requests SET status = 'accepted', updated_at = current_timestamp WHERE id = ?").bind(requestId)
      ]);
      return c.json({ message: "Payment successful" });
    } catch (error) {
      console.error("Payment failed:", error);
      return c.json({ error: "Payment failed" }, 500);
    }
  }

  return c.json({ error: "Invalid action" }, 400);
});

// Wallet history (ledgers)
wallets.get("/history", authMiddleware, async (c) => {
  const payload = c.get("jwtPayload");

  const history = await c.env.D1.prepare(`
    SELECT wt.*, u_from.username as sender_name, u_to.username as receiver_name
    FROM wallet_transfers wt
    JOIN users u_from ON wt.sender_id = u_from.id
    JOIN users u_to ON wt.receiver_id = u_to.id
    WHERE wt.sender_id = ? OR wt.receiver_id = ?
    ORDER BY wt.created_at DESC
    LIMIT 50
  `).bind(payload.userId, payload.userId).all();

  return c.json(history.results);
});

export default wallets;