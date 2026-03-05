const express = require('express')
const { Pool } = require('pg')

const app = express()
app.use(express.json())

// ✅ Render Postgres usually requires SSL/TLS
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

// ✅ Auto-create table + index on boot
async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS voucher_conversations (
      id BIGSERIAL PRIMARY KEY,
      voucher TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      user_id TEXT,
      channel TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_voucher_created
    ON voucher_conversations (voucher, created_at DESC)
  `)

  // avoid duplicate (same voucher in same conversation)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_voucher_conversation
    ON voucher_conversations (voucher, conversation_id)
  `)

  console.log('✅ DB init OK')
}

init().catch((e) => {
  console.error('❌ DB init failed:', e)
  process.exit(1)
})

// --- simple API key guard ---
function requireKey(req, res, next) {
  const key = req.headers['x-api-key']
  if (!process.env.API_KEY || key !== process.env.API_KEY) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' })
  }
  next()
}

app.get('/health', (_req, res) => res.json({ ok: true }))

// 1) Track (POST) - writes history row, dedupes per (voucher, conversation_id)
app.post('/track', requireKey, async (req, res) => {
  const voucher = String(req.body?.voucher ?? '').replace(/\D/g, '')
  const conversationId = String(req.body?.conversationId ?? '')
  const userId = req.body?.userId ? String(req.body.userId) : null
  const channel = req.body?.channel ? String(req.body.channel) : null

  if (!voucher || !conversationId) {
    return res.status(400).json({ ok: false, error: 'voucher & conversationId required' })
  }

  await pool.query(
    `
    INSERT INTO voucher_conversations (voucher, conversation_id, user_id, channel, created_at)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (voucher, conversation_id)
    DO UPDATE SET created_at = NOW(),
      user_id = COALESCE(EXCLUDED.user_id, voucher_conversations.user_id),
      channel = COALESCE(EXCLUDED.channel, voucher_conversations.channel)
    `,
    [voucher, conversationId, userId, channel]
  )

  return res.json({ ok: true })
})

// 2) Search (POST) - reads voucher from BODY and returns full list
app.post('/search', requireKey, async (req, res) => {
  const voucher = String(req.body?.voucher ?? '').replace(/\D/g, '')
  const limit = Math.min(Number(req.body?.limit ?? 50) || 50, 500)

  if (!voucher) {
    return res.status(400).json({ ok: false, error: 'voucher required' })
  }

  const result = await pool.query(
    `
    SELECT voucher, conversation_id, user_id, channel, created_at
    FROM voucher_conversations
    WHERE voucher = $1
    ORDER BY created_at DESC
    LIMIT $2
    `,
    [voucher, limit]
  )

  return res.json({
    ok: true,
    voucher,
    count: result.rows.length,
    results: result.rows.map((r) => ({
      voucher: r.voucher,
      conversationId: r.conversation_id,
      userId: r.user_id,
      channel: r.channel,
      date: r.created_at
    }))
  })
})

// 3) Cleanup (POST) - deletes rows older than 6 months
app.post('/cleanup', requireKey, async (_req, res) => {
  const out = await pool.query(`
    DELETE FROM voucher_conversations
    WHERE created_at < NOW() - INTERVAL '6 months'
  `)

  return res.json({ ok: true, deleted: out.rowCount })
})

const port = process.env.PORT || 3000
app.listen(port, () => console.log('API running on port', port))
