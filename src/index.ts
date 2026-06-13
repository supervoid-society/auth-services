import { Hono } from "hono";
import { cors } from "hono/cors";
import authRoutes from "./routes/auth";
import userRoutes from "./routes/users";
import sellerRoutes from "./routes/sellers";
import buyerRoutes from "./routes/buyers";
import imageRoutes from "./routes/images";
import transactionRoutes from "./routes/transactions";
import walletRoutes from "./routes/wallets";

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

const app = new Hono<{ Bindings: Bindings; Variables: { jwtPayload: JWTPayload } }>();

app.use('*', async (c, next) => {
  if (!c.env.D1) {
    console.error("PROD ERROR: D1 binding is MISSING!");
  }
  if (!c.env.JWT_SECRET || c.env.JWT_SECRET === "your-secret-key-here") {
    console.error("PROD ERROR: JWT_SECRET is MISSING or default!");
  }
  await next();
});

app.use('*', cors({ origin: '*' }));

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

app.route("/auth", authRoutes);
app.route("/users", userRoutes);
app.route("/sellers", sellerRoutes);
app.route("/buyers", buyerRoutes);
app.route("/images", imageRoutes);
app.route("/transactions", transactionRoutes);
app.route("/wallets", walletRoutes);

export default app;
