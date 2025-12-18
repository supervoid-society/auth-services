import { Hono } from "hono";
import { cors } from "hono/cors";
import { sign, verify } from "@tsndr/cloudflare-worker-jwt";

type Bindings = {
  JWT_SECRET: string;
  D1: D1Database;
};

const app = new Hono<{ Bindings: Bindings; Variables: { jwtPayload: any } }>();

app.use('*', cors({ origin: '*' }));

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

app.post("/login", async (c) => {
  const { username, password } = await c.req.json();

  const user = await c.env.D1.prepare("SELECT * FROM users WHERE username = ? AND password = ?").bind(username, password).first();

  if (user) {
    const secret = c.env.JWT_SECRET;
    const payload = {
      userId: user.id,
      username: user.username,
      exp: Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60,
    };
    const token = await sign(payload, secret);
    return c.json({ token });
  } else {
    return c.json({ error: "Invalid credentials" }, 401);
  }
});

// Protected routes for users CRUD
app.use("/users/*", async (c, next) => {
  const auth = c.req.header("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const token = auth.slice(7);
  try {
    const payload = await verify(token, c.env.JWT_SECRET);
    c.set("jwtPayload", payload);
    await next();
  } catch {
    return c.json({ error: "Invalid token" }, 401);
  }
});

app.get("/users", async (c) => {
  const users = await c.env.D1.prepare("SELECT id, username, created_at, updated_at FROM users").all();
  return c.json(users.results);
});

app.get("/users/:id", async (c) => {
  const id = c.req.param("id");
  const user = await c.env.D1.prepare("SELECT id, username, created_at, updated_at FROM users WHERE id = ?").bind(id).first();
  if (user) return c.json(user);
  return c.json({ error: "User not found" }, 404);
});

app.post("/users", async (c) => {
  const { username, password } = await c.req.json();
  const existing = await c.env.D1.prepare("SELECT id FROM users WHERE username = ?").bind(username).first();
  if (existing) return c.json({ error: "Username already exists" }, 400);
  const result = await c.env.D1.prepare("INSERT INTO users (username, password) VALUES (?, ?)").bind(username, password).run();
  return c.json({ id: result.meta.last_row_id });
});

app.put("/users/:id", async (c) => {
  const id = c.req.param("id");
  const { username, password } = await c.req.json();
  const result = await c.env.D1.prepare("UPDATE users SET username = ?, password = ?, updated_at = current_timestamp WHERE id = ?").bind(username, password, id).run();
  if (result.meta.changes > 0) return c.json({ message: "User updated" });
  return c.json({ error: "User not found" }, 404);
});

app.delete("/users/:id", async (c) => {
  const id = c.req.param("id");
  const jwtPayload = c.get("jwtPayload");

  if (parseInt(id) === jwtPayload.userId) {
    return c.json({ error: "Cannot delete your own account" }, 400);
  }

  const userCount = await c.env.D1.prepare("SELECT COUNT(*) as count FROM users").first();
  if (userCount.count <= 1) {
    return c.json({ error: "Cannot delete the last user" }, 400);
  }

  const result = await c.env.D1.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
  if (result.meta.changes > 0) return c.json({ message: "User deleted" });
  return c.json({ error: "User not found" }, 404);
});

export default app;
