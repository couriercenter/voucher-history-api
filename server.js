const express = require('express')
const { Pool } = require('pg')

const app = express()
app.use(express.json())

// ✅ Render Postgres often requires SSL/TLS
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

// ✅ Auto-create table + indexes on boot
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

/**
 * Optional: set this in Render env vars:
 * BOTPRESS_INBOX_BASE_URL = "https://studio.botpress.cloud/.../conversations/"
 * We will return: link = BASE + conversationId
 */
function buildConversationLink(conversationId) {
  const base = String(process.env.BOTPRESS_INBOX_BASE_URL || '').trim()
  if (!base || !conversationId) return null
  // ensure base ends with /
  const normalizedBase = base.endsWith('/') ? base : base + '/'
  return normalizedBase + conversationId
}

app.get('/health', (_req, res) => res.json({ ok: true }))

// 1) Track (PUBLIC) - write history row, dedupe per (voucher, conversation_id)
app.post('/track', async (req, res) => {
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

// 2) Search (PUBLIC, POST) - reads voucher from BODY and returns full list + clickable links
app.post('/search', async (req, res) => {
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

  const results = result.rows.map((r) => ({
    voucher: r.voucher,
    conversationId: r.conversation_id,
    userId: r.user_id,
    channel: r.channel,
    date: r.created_at,
    link: buildConversationLink(r.conversation_id)
  }))

  return res.json({
    ok: true,
    voucher,
    count: results.length,
    results
  })
})

// 3) Cleanup (PUBLIC) - deletes rows older than 4 months
app.post('/cleanup', async (_req, res) => {
  const out = await pool.query(`
    DELETE FROM voucher_conversations
    WHERE created_at < NOW() - INTERVAL '4 months'
  `)

  return res.json({ ok: true, deleted: out.rowCount })
})

const port = process.env.PORT || 3000
app.listen(port, () => console.log('API running on port', port))
