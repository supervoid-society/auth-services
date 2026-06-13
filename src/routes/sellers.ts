import { Hono } from "hono";
import { adminMiddleware, authMiddleware } from "../middleware/auth";
import { saveImage } from "../utils/image";

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

const sellers = new Hono<{ Bindings: Bindings; Variables: { jwtPayload: JWTPayload } }>();

sellers.get("/", adminMiddleware, async (c) => {
  const sellers = await c.env.D1.prepare("SELECT * FROM sellers").all();
  return c.json(sellers.results);
});

sellers.get("/me", authMiddleware, async (c) => {
  const payload = c.get("jwtPayload");
  const seller = await c.env.D1.prepare("SELECT * FROM sellers WHERE user_id = ?").bind(payload.userId).first();
  if (seller) return c.json(seller);
  return c.json({ error: "Seller profile not found" }, 404);
});

sellers.get("/public/:userId", async (c) => {
  const userId = c.req.param("userId");
  const seller = await c.env.D1.prepare("SELECT * FROM sellers WHERE user_id = ?").bind(userId).first();
  if (seller) return c.json(seller);
  return c.json({ error: "Seller not found" }, 404);
});

sellers.get("/:id", adminMiddleware, async (c) => {
  const id = c.req.param("id");
  const seller = await c.env.D1.prepare("SELECT * FROM sellers WHERE id = ?").bind(id).first();
  if (seller) return c.json(seller);
  return c.json({ error: "Seller not found" }, 404);
});

sellers.post("/", async (c) => {
  const { user_id, store_name, description, contact_phone } = await c.req.json();
  const existing = await c.env.D1.prepare("SELECT id FROM sellers WHERE user_id = ?").bind(user_id).first();
  if (existing) return c.json({ error: "Seller already exists for this user" }, 400);
  const sellerId = crypto.randomUUID();
  await c.env.D1.prepare("INSERT INTO sellers (id, user_id, store_name, description, contact_phone) VALUES (?, ?, ?, ?, ?)").bind(sellerId, user_id, store_name, description || null, contact_phone || null).run();
  return c.json({ id: sellerId });
});

sellers.put("/me", authMiddleware, async (c) => {
  const payload = c.get("jwtPayload");
  const { store_name, description, contact_phone, image_base64, image_content_type } = await c.req.json();
  
  let imageId = null;
  if (image_base64) {
    imageId = await saveImage(c, image_base64, image_content_type || "image/jpeg");
    if (!imageId) {
      return c.json({ error: "Failed to save image" }, 500);
    }
  }
  
  const result = await c.env.D1.prepare("UPDATE sellers SET store_name = ?, description = ?, contact_phone = ?, image_id = ?, updated_at = current_timestamp WHERE user_id = ?").bind(store_name, description || null, contact_phone || null, imageId, payload.userId).run();
  if (result.meta.changes > 0) return c.json({ message: "Seller profile updated" });
  return c.json({ error: "Seller profile not found" }, 404);
});

sellers.put("/:id", adminMiddleware, async (c) => {
  const id = c.req.param("id");
  const { user_id, store_name, description, contact_phone } = await c.req.json();
  const result = await c.env.D1.prepare("UPDATE sellers SET user_id = ?, store_name = ?, description = ?, contact_phone = ?, updated_at = current_timestamp WHERE id = ?").bind(user_id, store_name, description || null, contact_phone || null, id).run();
  if (result.meta.changes > 0) return c.json({ message: "Seller updated" });
  return c.json({ error: "Seller not found" }, 404);
});

sellers.delete("/:id", adminMiddleware, async (c) => {
  const id = c.req.param("id");
  const result = await c.env.D1.prepare("DELETE FROM sellers WHERE id = ?").bind(id).run();
  if (result.meta.changes > 0) return c.json({ message: "Seller deleted" });
  return c.json({ error: "Seller not found" }, 404);
});

export default sellers;