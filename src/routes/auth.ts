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

export default auth;