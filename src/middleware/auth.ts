import { verify } from "@tsndr/cloudflare-worker-jwt";
import { Context, Next } from "hono";

interface JWTPayload {
  userId: number;
  username: string;
  role: string;
  exp: number;
}

export const authMiddleware = async (c: Context, next: Next) => {
  const auth = c.req.header("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const token = auth.slice(7);
  try {
    const decoded = await verify(token, c.env.JWT_SECRET);
    if (!decoded || !decoded.payload) {
      return c.json({ error: "Invalid token payload" }, 401);
    }
    c.set("jwtPayload", decoded.payload);
    await next();
  } catch {
    return c.json({ error: "Invalid token" }, 401);
  }
};

export const adminMiddleware = async (c: Context, next: Next) => {
  const auth = c.req.header("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const token = auth.slice(7);
  try {
    const decoded = await verify(token, c.env.JWT_SECRET);
    if (!decoded || !decoded.payload) {
      return c.json({ error: "Invalid token payload" }, 401);
    }
    const payload = decoded.payload as JWTPayload;
    c.set("jwtPayload", payload);
    if (payload.role !== 'admin') {
      return c.json({ error: "Admin access required" }, 403);
    }
    await next();
  } catch {
    return c.json({ error: "Invalid token" }, 401);
  }
};