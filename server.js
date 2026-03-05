const express = require('express')
const { Pool } = require('pg')

const app = express()
app.use(express.json())

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

// create table automatically
async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS voucher_conversations (
      id BIGSERIAL PRIMARY KEY,
      voucher TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      user_id TEXT,
      channel TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_voucher_created
    ON voucher_conversations (voucher, created_at DESC)
  `)
}

init()

app.get('/health', (req,res)=>{
  res.json({ok:true})
})

app.post('/track', async (req,res)=>{

  if(req.headers['x-api-key'] !== process.env.API_KEY){
    return res.status(403).json({error:'unauthorized'})
  }

  const {voucher,conversationId,userId,channel} = req.body

  await pool.query(`
    INSERT INTO voucher_conversations
    (voucher,conversation_id,user_id,channel)
    VALUES ($1,$2,$3,$4)
  `,[voucher,conversationId,userId,channel])

  res.json({ok:true})
})

app.get('/search', async (req,res)=>{

  const voucher = req.query.voucher

  const result = await pool.query(`
    SELECT voucher,conversation_id,created_at
    FROM voucher_conversations
    WHERE voucher=$1
    ORDER BY created_at DESC
  `,[voucher])

  res.json({
    voucher,
    count:result.rows.length,
    results:result.rows
  })
})

app.post('/cleanup', async (req,res)=>{

  if(req.headers['x-api-key'] !== process.env.API_KEY){
    return res.status(403).json({error:'unauthorized'})
  }

  await pool.query(`
    DELETE FROM voucher_conversations
    WHERE created_at < NOW() - INTERVAL '6 months'
  `)

  res.json({cleaned:true})
})

app.listen(3000,()=>{
  console.log('API running')
})
