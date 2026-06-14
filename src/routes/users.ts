import { Hono } from "hono";
import { adminMiddleware, authMiddleware } from "../middleware/auth";

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

const users = new Hono<{ Bindings: Bindings; Variables: { jwtPayload: JWTPayload } }>();

users.get("/", adminMiddleware, async (c) => {
  const users = await c.env.D1.prepare("SELECT id, username, role, is_banned, created_at, updated_at FROM users").all();
  return c.json(users.results);
});

users.get("/me", authMiddleware, async (c) => {
  const payload = c.get("jwtPayload");
  const user = await c.env.D1.prepare("SELECT id, username, role, created_at, updated_at FROM users WHERE id = ?").bind(payload.userId).first();
  if (user) return c.json(user);
  return c.json({ error: "User not found" }, 404);
});

users.get("/:id", async (c) => {
  const userId = c.req.param("id");
  const user = (await c.env.D1.prepare("SELECT id, username, role, created_at, updated_at FROM users WHERE id = ?").bind(userId).first()) as
    | { id: string; username: string; role: string }
    | undefined;

  if (user) {
    let displayName = user.username;
    if (user.role === "buyer") {
      const buyer = (await c.env.D1.prepare("SELECT full_name FROM buyers WHERE user_id = ?").bind(userId).first()) as { full_name: string } | undefined;
      if (buyer) displayName = buyer.full_name;
    } else if (user.role === "seller") {
      const seller = (await c.env.D1.prepare("SELECT store_name FROM sellers WHERE user_id = ?").bind(userId).first()) as { store_name: string } | undefined;
      if (seller) displayName = seller.store_name;
    }
    return c.json({ ...user, display_name: displayName });
  }
  return c.json({ error: "User not found" }, 404);
});

users.get("/profile-image/:userId", async (c) => {
  const userId = c.req.param("userId");

  // First check if user exists
  const user = await c.env.D1.prepare("SELECT role FROM users WHERE id = ?").bind(userId).first();
  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  let profileImage = null;

  if (user.role === "seller") {
    const seller = await c.env.D1.prepare("SELECT image_id FROM sellers WHERE user_id = ?").bind(userId).first();
    if (seller && seller.image_id) {
      profileImage = await c.env.D1.prepare("SELECT * FROM images WHERE id = ?").bind(seller.image_id).first();
    }
  } else if (user.role === "buyer") {
    const buyer = await c.env.D1.prepare("SELECT image_id FROM buyers WHERE user_id = ?").bind(userId).first();
    if (buyer && buyer.image_id) {
      profileImage = await c.env.D1.prepare("SELECT * FROM images WHERE id = ?").bind(buyer.image_id).first();
    }
  }

  if (profileImage) {
    const { data, content_type } = profileImage as { data: any; content_type: string };
    let binaryData: Uint8Array;

    if (typeof data === "string") {
      // Assume base64
      try {
        binaryData = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      } catch (e) {
        console.error("Invalid base64 data:", e);
        return new Response("Invalid image data", { status: 500 });
      }
    } else if (data instanceof ArrayBuffer) {
      binaryData = new Uint8Array(data);
    } else if (data instanceof Uint8Array) {
      binaryData = data;
    } else if (data && typeof data === "object" && !Array.isArray(data)) {
      // Handle cases where it might be a Buffer-like object with numeric keys
      binaryData = new Uint8Array(Object.values(data));
    } else {
      console.error("Unsupported data type:", typeof data);
      return new Response("Unsupported image data type", { status: 500 });
    }
    return new Response(binaryData, { headers: { "Content-Type": content_type } });
  } else {
    return c.json({ error: "Profile image not found" }, 404);
  }
});

users.post("/", async (c) => {
  const { username, password, role } = await c.req.json();
  if (!role || !["admin", "seller", "buyer"].includes(role)) {
    return c.json({ error: "Invalid role" }, 400);
  }
  const existing = await c.env.D1.prepare("SELECT id FROM users WHERE username = ?").bind(username).first();
  if (existing) return c.json({ error: "Username already exists" }, 400);
  const userId = crypto.randomUUID();
  await c.env.D1.prepare("INSERT INTO users (id, username, password, role) VALUES (?, ?, ?, ?)").bind(userId, username, password, role).run();
  return c.json({ id: userId });
});

users.put("/me", authMiddleware, async (c) => {
  const payload = c.get("jwtPayload");
  const { username, currentPassword, newPassword } = await c.req.json();

  // Verify current password if changing password
  if (newPassword) {
    if (!currentPassword) {
      return c.json({ error: "Current password required to change password" }, 400);
    }
    const user = await c.env.D1.prepare("SELECT password FROM users WHERE id = ?").bind(payload.userId).first();
    if (!user || (user as { password: string }).password !== currentPassword) {
      return c.json({ error: "Current password is incorrect" }, 400);
    }
  }

  // Check if new username is already taken
  if (username && username !== payload.username) {
    const existing = await c.env.D1.prepare("SELECT id FROM users WHERE username = ? AND id != ?").bind(username, payload.userId).first();
    if (existing) return c.json({ error: "Username already exists" }, 400);
  }

  const updateFields = [];
  const values = [];

  if (username) {
    updateFields.push("username = ?");
    values.push(username);
  }

  if (newPassword) {
    updateFields.push("password = ?");
    values.push(newPassword);
  }

  if (updateFields.length === 0) {
    return c.json({ error: "No fields to update" }, 400);
  }

  updateFields.push("updated_at = current_timestamp");
  values.push(payload.userId);

  const result = await c.env.D1.prepare(`UPDATE users SET ${updateFields.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();
  if (result.meta.changes > 0) return c.json({ message: "User updated" });
  return c.json({ error: "User not found" }, 404);
});

users.post("/:id/ban", adminMiddleware, async (c) => {
  const id = c.req.param("id");
  const jwtPayload = c.get("jwtPayload");

  if (id === jwtPayload.userId) {
    return c.json({ error: "Anda tidak bisa membanned akun sendiri." }, 400);
  }

  const result = await c.env.D1.prepare("UPDATE users SET is_banned = 1, updated_at = current_timestamp WHERE id = ?").bind(id).run();
  if (result.meta.changes > 0) return c.json({ message: "User banned successfully" });
  return c.json({ error: "User not found" }, 404);
});

users.post("/:id/unban", adminMiddleware, async (c) => {
  const id = c.req.param("id");
  const result = await c.env.D1.prepare("UPDATE users SET is_banned = 0, updated_at = current_timestamp WHERE id = ?").bind(id).run();
  if (result.meta.changes > 0) return c.json({ message: "User unbanned successfully" });
  return c.json({ error: "User not found" }, 404);
});

export default users;
