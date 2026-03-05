CREATE TABLE IF NOT EXISTS voucher_conversations (
  id BIGSERIAL PRIMARY KEY,
  voucher TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  user_id TEXT,
  channel TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voucher_created
  ON voucher_conversations (voucher, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_voucher_conversation
  ON voucher_conversations (voucher, conversation_id);
