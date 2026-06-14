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

  let platformFee = 0;
  let discountAmount = 0;

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
    platformFee = Number(sigPayload.platform_fee || 0);
    discountAmount = Number(sigPayload.discount_amount || 0);
  } catch (error) {
    return c.json({ error: "Signature verification failed" }, 400);
  }

  // 1. If there's a promo discount, check if admin wallet has enough balance to cover it
  if (discountAmount > 0) {
    const admin = (await c.env.D1.prepare("SELECT balance FROM buyers WHERE user_id = '550e8400-e29b-41d4-a716-446655440000'").first()) as { balance: number } | undefined;
    if (!admin || admin.balance < discountAmount) {
      return c.json({ error: "Transaksi gagal: Saldo wallet admin tidak cukup untuk mensubsidi diskon promo." }, 400);
    }
  }

  // Get buyer balance
  const buyer = (await c.env.D1.prepare("SELECT balance FROM buyers WHERE user_id = ?").bind(buyerId).first()) as { balance: number } | undefined;
  if (!buyer) {
    return c.json({ error: "Buyer not found" }, 404);
  }

  const buyerCost = amount + platformFee - discountAmount;
  if (buyer.balance < buyerCost) {
    return c.json({ error: "Insufficient balance" }, 400);
  }

  // Get seller
  const seller = await c.env.D1.prepare("SELECT id FROM sellers WHERE user_id = ?").bind(sellerId).first();
  if (!seller) {
    return c.json({ error: "Seller not found" }, 404);
  }

  // Perform transfer in transaction
  try {
    const batchQueries = [
      c.env.D1.prepare("UPDATE buyers SET balance = balance - ? WHERE user_id = ?").bind(buyerCost, buyerId),
      c.env.D1.prepare("UPDATE sellers SET balance = balance + ? WHERE user_id = ?").bind(amount, sellerId),
      c.env.D1.prepare("UPDATE buyers SET balance = balance + ? - ? WHERE user_id = '550e8400-e29b-41d4-a716-446655440000'").bind(platformFee, discountAmount),
    ];

    if (platformFee > 0) {
      batchQueries.push(
        c.env.D1.prepare("INSERT INTO wallet_transfers (id, sender_id, receiver_id, amount) VALUES (?, ?, '550e8400-e29b-41d4-a716-446655440000', ?)")
          .bind(crypto.randomUUID(), buyerId, platformFee)
      );
    }
    if (discountAmount > 0) {
      batchQueries.push(
        c.env.D1.prepare("INSERT INTO wallet_transfers (id, sender_id, receiver_id, amount) VALUES (?, '550e8400-e29b-41d4-a716-446655440000', ?, ?)")
          .bind(crypto.randomUUID(), sellerId, discountAmount)
      );
    }

    await c.env.D1.batch(batchQueries);
  } catch (error) {
    console.error("Transfer execution failed:", error);
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
