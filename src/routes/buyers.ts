import { Hono } from "hono";
import { adminMiddleware, authMiddleware } from "../middleware/auth";

type Bindings = {
  JWT_SECRET: string;
  D1: D1Database;
};

const buyers = new Hono<{ Bindings: Bindings }>();

buyers.get("/", adminMiddleware, async (c) => {
  const buyers = await c.env.D1.prepare("SELECT * FROM buyers").all();
  return c.json(buyers.results);
});

buyers.get("/me", authMiddleware, async (c) => {
  const payload = c.get("jwtPayload");
  const buyer = await c.env.D1.prepare("SELECT * FROM buyers WHERE user_id = ?").bind(payload.userId).first();
  if (buyer) return c.json(buyer);
  return c.json({ error: "Buyer profile not found" }, 404);
});

buyers.get("/:id", adminMiddleware, async (c) => {
  const id = c.req.param("id");
  const buyer = await c.env.D1.prepare("SELECT * FROM buyers WHERE id = ?").bind(id).first();
  if (buyer) return c.json(buyer);
  return c.json({ error: "Buyer not found" }, 404);
});

buyers.post("/", async (c) => {
  const { user_id, full_name, address, phone } = await c.req.json();
  const existing = await c.env.D1.prepare("SELECT id FROM buyers WHERE user_id = ?").bind(user_id).first();
  if (existing) return c.json({ error: "Buyer already exists for this user" }, 400);
  const result = await c.env.D1.prepare("INSERT INTO buyers (user_id, full_name, address, phone) VALUES (?, ?, ?, ?)").bind(user_id, full_name, address || null, phone || null).run();
  return c.json({ id: result.meta.last_row_id });
});

buyers.put("/me", authMiddleware, async (c) => {
  const payload = c.get("jwtPayload");
  const { full_name, address, phone } = await c.req.json();
  const result = await c.env.D1.prepare("UPDATE buyers SET full_name = ?, address = ?, phone = ?, updated_at = current_timestamp WHERE user_id = ?").bind(full_name, address || null, phone || null, payload.userId).run();
  if (result.meta.changes > 0) return c.json({ message: "Buyer profile updated" });
  return c.json({ error: "Buyer profile not found" }, 404);
});

buyers.put("/:id", adminMiddleware, async (c) => {
  const id = c.req.param("id");
  const { user_id, full_name, address, phone } = await c.req.json();
  const result = await c.env.D1.prepare("UPDATE buyers SET user_id = ?, full_name = ?, address = ?, phone = ?, updated_at = current_timestamp WHERE id = ?").bind(user_id, full_name, address || null, phone || null, id).run();
  if (result.meta.changes > 0) return c.json({ message: "Buyer updated" });
  return c.json({ error: "Buyer not found" }, 404);
});

buyers.delete("/:id", adminMiddleware, async (c) => {
  const id = c.req.param("id");
  const result = await c.env.D1.prepare("DELETE FROM buyers WHERE id = ?").bind(id).run();
  if (result.meta.changes > 0) return c.json({ message: "Buyer deleted" });
  return c.json({ error: "Buyer not found" }, 404);
});

export default buyers;