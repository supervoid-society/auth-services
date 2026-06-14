import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import { verify, sign } from "@tsndr/cloudflare-worker-jwt";

interface JWTPayload {
  userId: string;
  username: string;
  role: string;
  exp: number;
}

type Bindings = {
  JWT_SECRET: string;
  D1: D1Database;
};

const transactions = new Hono<{ Bindings: Bindings; Variables: { jwtPayload: JWTPayload } }>();

// Transfer money from buyer to seller
transactions.post("/transfer", authMiddleware, async (c) => {
  const { transactionId, sellerId, amount, signature } = await c.req.json();
  const payload = c.get("jwtPayload");

  if (payload.role !== "buyer") {
    return c.json({ error: "Only buyers can initiate transfers" }, 403);
  }

  const buyerId = payload.userId;

  // Verify signature
  try {
    const decoded = await verify(signature, c.env.JWT_SECRET);
    if (!decoded) {
      return c.json({ error: "Invalid signature" }, 400);
    }
    const sigPayload = decoded.payload as any;
    if (!sigPayload || sigPayload.transactionId !== transactionId || sigPayload.sellerId !== sellerId || sigPayload.amount !== amount || sigPayload.buyerId !== buyerId) {
      return c.json({ error: "Invalid signature" }, 400);
    }
  } catch (error) {
    return c.json({ error: "Signature verification failed" }, 400);
  }

  // Get buyer balance
  const buyer = (await c.env.D1.prepare("SELECT balance FROM buyers WHERE user_id = ?").bind(buyerId).first()) as { balance: number } | undefined;
  if (!buyer) {
    return c.json({ error: "Buyer not found" }, 404);
  }

  if (buyer.balance < amount) {
    return c.json({ error: "Insufficient balance" }, 400);
  }

  // Get seller
  const seller = await c.env.D1.prepare("SELECT id FROM sellers WHERE user_id = ?").bind(sellerId).first();
  if (!seller) {
    return c.json({ error: "Seller not found" }, 404);
  }

  // Perform transfer in transaction
  try {
    await c.env.D1.prepare("UPDATE buyers SET balance = balance - ? WHERE user_id = ?").bind(amount, buyerId).run();
    await c.env.D1.prepare("UPDATE sellers SET balance = balance + ? WHERE user_id = ?").bind(amount, sellerId).run();
  } catch (error) {
    return c.json({ error: "Transfer failed" }, 500);
  }

  return c.json({ message: "Transfer successful" });
});

// Get balance for authenticated user
transactions.get("/balance", authMiddleware, async (c) => {
  const payload = c.get("jwtPayload");
  const userId = payload.userId;
  const role = payload.role;

  let balance = 0;
  if (role === "buyer") {
    const buyer = (await c.env.D1.prepare("SELECT balance FROM buyers WHERE user_id = ?").bind(userId).first()) as { balance: number } | undefined;
    balance = buyer ? buyer.balance : 0;
  } else if (role === "seller") {
    const seller = (await c.env.D1.prepare("SELECT balance FROM sellers WHERE user_id = ?").bind(userId).first()) as { balance: number } | undefined;
    balance = seller ? seller.balance : 0;
  }

  // Create signature for balance
  const data = { balance, userId, timestamp: Date.now() };
  const signature = await sign(data, c.env.JWT_SECRET);

  return c.json({ balance, signature });
});

export default transactions;
