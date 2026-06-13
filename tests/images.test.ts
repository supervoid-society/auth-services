import { env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import app from "../src/index";

describe("Auth Services - Images", () => {
  let imageId: string;

  beforeAll(async () => {
    // Initialize schema
    const schema = `
DROP TABLE IF EXISTS images;
CREATE TABLE images (
    id TEXT PRIMARY KEY,
    data BLOB NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'image/jpeg',
    created_at TEXT DEFAULT current_timestamp,
    updated_at TEXT DEFAULT current_timestamp
);
`;
    const queries = schema.split(";").filter(q => q.trim());
    for (const query of queries) {
      await env.D1.prepare(query).run();
    }

    // Insert dummy image
    imageId = crypto.randomUUID();
    const dummyData = new Uint8Array([255, 216, 255, 224]); // Tiny JPEG header
    // Use Array.from(dummyData) to ensure it's handled as binary if possible, 
    // or just pass the Uint8Array directly if the environment supports it.
    await env.D1.prepare("INSERT INTO images (id, data, content_type) VALUES (?, ?, ?)")
      .bind(imageId, dummyData, "image/jpeg").run();
  });

  it("should get an image", async () => {
    const res = await app.request(`/images/${imageId}`, {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    const data = new Uint8Array(await res.arrayBuffer());
    expect(data[0]).toBe(255);
  });

  it("should return 404 for non-existent image", async () => {
    const res = await app.request("/images/non-existent", {}, env);
    expect(res.status).toBe(404);
  });
});