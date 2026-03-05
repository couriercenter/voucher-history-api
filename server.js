import express from "express";
import pg from "pg";

const { Pool } = pg;
const app = express();
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("render.com")
    ? { rejectUnauthorized: false }
    : undefined
});

const requireKey = (req, res, next) => {
  const key = req.headers["x-api-key"];
  if (!process.env.API_KEY || key !== process.env.API_KEY) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  next();
};

app.get("/health", (_req, res) => res.json({ ok: true }));

// Track (history, dedupe per voucher+conversation)
app.post("/track", requireKey, async (req, res) => {
  const voucher = String(req.body?.voucher ?? "").replace(/\D/g, "");
  const conversationId = String(req.body?.conversationId ?? "");
  const userId = req.body?.userId ? String(req.body.userId) : null;
  const channel = req.body?.channel ? String(req.body.channel) : null;

  if (!voucher || !conversationId) {
    return res.status(400).json({ ok: false, error: "voucher & conversationId required" });
  }

  const q = `
    INSERT INTO voucher_conversations (voucher, conversation_id, user_id, channel, created_at)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (voucher, conversation_id)
    DO UPDATE SET created_at = NOW(),
      user_id = COALESCE(EXCLUDED.user_id, voucher_conversations.user_id),
      channel = COALESCE(EXCLUDED.channel, voucher_conversations.channel)
    RETURNING voucher, conversation_id, user_id, channel, created_at;
  `;

  const { rows } = await pool.query(q, [voucher, conversationId, userId, channel]);
  return res.json({ ok: true, data: rows[0] });
});

// Search (list history newest->oldest)
app.get("/search", requireKey, async (req, res) => {
  const voucher = String(req.query?.voucher ?? "").replace(/\D/g, "");
  const limit = Math.min(Number(req.query?.limit ?? 50) || 50, 500);

  if (!voucher) return res.status(400).json({ ok: false, error: "voucher required" });

  const q = `
    SELECT voucher, conversation_id, user_id, channel, created_at
    FROM voucher_conversations
    WHERE voucher = $1
    ORDER BY created_at DESC
    LIMIT $2;
  `;

  const { rows } = await pool.query(q, [voucher, limit]);

  return res.json({
    ok: true,
    voucher,
    count: rows.length,
    results: rows.map(r => ({
      voucher: r.voucher,
      conversationId: r.conversation_id,
      userId: r.user_id,
      channel: r.channel,
      date: r.created_at
    }))
  });
});

// Cleanup (> 6 months)
app.post("/cleanup", requireKey, async (_req, res) => {
  const q = `
    DELETE FROM voucher_conversations
    WHERE created_at < NOW() - INTERVAL '6 months';
  `;
  const result = await pool.query(q);
  return res.json({ ok: true, deleted: result.rowCount });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("API listening on", port));
