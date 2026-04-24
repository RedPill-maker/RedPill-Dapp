/**
 * Decode contract event logs and store in SQLite database (契約イベントログをデコードしてSQLiteデータベースに保存)
 * Implemented according to CreatorHub_DB_Design.md design document
 * Core database (core.db) + Peripheral database (peripheral.db)
 */
import { DatabaseSync } from 'node:sqlite'
import { decodeEventLog, type Abi } from 'viem'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load contract ABI (契約ABIをロード)
const abiPath = path.resolve(__dirname, '../contract_info/CreatorHub_abi.json')
const contractAbi: Abi = JSON.parse(fs.readFileSync(abiPath, 'utf-8'))

// Database directory - supports environment variable configuration, with network subdirectory
function getDbDir(): string {
  const base = process.env.DB_DATA_PATH || path.resolve(__dirname, '../data')
  return path.join(base, currentNetworkId)
}

// Contract configuration - injected at runtime via setNetworkConfig()
let CONTRACT_ADDRESS = ''
let CHAIN_ID = 0
let CONTRACT_DEPLOY_BLOCK = 0

// Network subdirectory name (set by setNetworkConfig)
let currentNetworkId = 'calibration'

// Ensure database directory exists (called lazily when network is configured)
function ensureDbDir(): void {
  const dir = getDbDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

// Database instances (データベースインスタンス)
let coreDb: DatabaseSync | null = null
let peripheralDb: DatabaseSync | null = null

// Decoded event interface (デコードされたイベントインターフェース)
interface RawEvent {
  topics: string[]
  data: string
  blockNumber: number | string
  transactionHash: string
  logIndex: number | string
  address?: string
}

interface DecodedEvent {
  eventName: string
  args: Record<string, unknown>
  blockNumber: number
  transactionHash: string
  logIndex: number
}

// ============ Database Initialization (データベース初期化) ============

function initCoreDb(): DatabaseSync {
  const DB_DIR = getDbDir()
  ensureDbDir()
  const dbPath = path.join(DB_DIR, 'core.db')
  const db = new DatabaseSync(dbPath)

  db.exec(`
    -- Creator table (クリエイターテーブル)
    CREATE TABLE IF NOT EXISTS creators (
      username TEXT PRIMARY KEY,
      wallet_address TEXT NOT NULL,
      avatar_cid TEXT,
      background_cid TEXT,
      ipns_address TEXT,
      ipns_signature BLOB,
      title TEXT,
      description TEXT,
      min_offer_price TEXT DEFAULT '0',
      work_count INTEGER DEFAULT 0,
      registered_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_creators_wallet ON creators(wallet_address);
    CREATE INDEX IF NOT EXISTS idx_creators_registered ON creators(registered_at DESC);

    -- Creator full-text search (クリエイター全文検索)
    CREATE VIRTUAL TABLE IF NOT EXISTS creators_fts USING fts5(
      username, title, description,
      content='creators', content_rowid='rowid'
    );

    -- Work table (作品テーブル)
    CREATE TABLE IF NOT EXISTS works (
      work_cid TEXT PRIMARY KEY,
      owner_username TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      work_type INTEGER NOT NULL,
      img_cid TEXT,
      claimed_at INTEGER NOT NULL,
      transfer_count INTEGER DEFAULT 0,
      is_deleted INTEGER DEFAULT 0,
      deleted_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_works_owner ON works(owner_username);
    CREATE INDEX IF NOT EXISTS idx_works_type ON works(work_type);
    CREATE INDEX IF NOT EXISTS idx_works_claimed ON works(claimed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_works_deleted ON works(is_deleted);

    -- Work full-text search (作品全文検索)
    CREATE VIRTUAL TABLE IF NOT EXISTS works_fts USING fts5(
      work_cid, title, description,
      content='works', content_rowid='rowid'
    );

    -- Work tip statistics table (作品チップ統計テーブル)
    CREATE TABLE IF NOT EXISTS work_tip_stats (
      work_cid TEXT NOT NULL,
      token_address TEXT NOT NULL,
      total_amount TEXT DEFAULT '0',
      total_amount_numeric REAL DEFAULT 0,
      tip_count INTEGER DEFAULT 0,
      last_tip_at INTEGER,
      PRIMARY KEY (work_cid, token_address)
    );
    CREATE INDEX IF NOT EXISTS idx_tip_stats_token ON work_tip_stats(token_address);
    CREATE INDEX IF NOT EXISTS idx_tip_stats_token_amount ON work_tip_stats(token_address, total_amount_numeric DESC);

    -- Jackpot epoch table (ジャックポット周期テーブル)
    CREATE TABLE IF NOT EXISTS jackpot_epochs (
      token_address TEXT NOT NULL,
      epoch INTEGER NOT NULL,
      pool_amount TEXT DEFAULT '0',
      start_time INTEGER NOT NULL,
      end_time INTEGER NOT NULL,
      extension_count INTEGER DEFAULT 0,
      is_settled INTEGER DEFAULT 0,
      winner_address TEXT,
      winner_work_cid TEXT,
      winner_total_tips TEXT,
      settled_amount TEXT,
      settled_at INTEGER,
      PRIMARY KEY (token_address, epoch)
    );
    CREATE INDEX IF NOT EXISTS idx_jackpot_settled ON jackpot_epochs(is_settled, token_address);

    -- Current jackpot status table (現在のジャックポット状態テーブル)
    CREATE TABLE IF NOT EXISTS jackpot_current (
      token_address TEXT PRIMARY KEY,
      current_epoch INTEGER NOT NULL,
      pool_amount TEXT DEFAULT '0',
      leader_work_cid TEXT,
      leader_address TEXT,
      leader_total_tips TEXT DEFAULT '0',
      start_time INTEGER,
      end_time INTEGER,
      extension_count INTEGER DEFAULT 0
    );

    -- Supported tokens table (サポートされているトークンテーブル)
    CREATE TABLE IF NOT EXISTS supported_tokens (
      token_address TEXT PRIMARY KEY,
      is_supported INTEGER DEFAULT 1,
      updated_at INTEGER NOT NULL
    );

    -- Sync state table (同期状態テーブル)
    CREATE TABLE IF NOT EXISTS sync_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      contract_address TEXT NOT NULL,
      chain_id INTEGER NOT NULL,
      start_block INTEGER NOT NULL,
      last_synced_block INTEGER NOT NULL,
      last_synced_tx_hash TEXT,
      last_synced_log_index INTEGER,
      updated_at INTEGER NOT NULL
    );
  `)

  return db
}

function initPeripheralDb(): DatabaseSync {
  const DB_DIR = getDbDir()
  ensureDbDir()
  const dbPath = path.join(DB_DIR, 'peripheral.db')
  const db = new DatabaseSync(dbPath)

  db.exec(`
    -- Tip records table (チップ記録テーブル)
    CREATE TABLE IF NOT EXISTS tip_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tx_hash TEXT NOT NULL,
      block_number INTEGER NOT NULL,
      tipper_address TEXT NOT NULL,
      creator_address TEXT NOT NULL,
      work_cid TEXT NOT NULL,
      token_address TEXT NOT NULL,
      amount_sent TEXT NOT NULL,
      creator_share TEXT NOT NULL,
      platform_fee TEXT NOT NULL,
      jackpot_fee TEXT NOT NULL,
      message TEXT,
      timestamp INTEGER NOT NULL,
      parent_tx_hash TEXT,
      reply_count INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_tips_tipper ON tip_records(tipper_address);
    CREATE INDEX IF NOT EXISTS idx_tips_creator ON tip_records(creator_address);
    CREATE INDEX IF NOT EXISTS idx_tips_work ON tip_records(work_cid);
    CREATE INDEX IF NOT EXISTS idx_tips_time ON tip_records(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_tips_parent ON tip_records(parent_tx_hash);

    -- Account offer table (アカウントオファーテーブル)
    CREATE TABLE IF NOT EXISTS account_offers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tx_hash TEXT NOT NULL,
      block_number INTEGER NOT NULL,
      buyer_address TEXT NOT NULL,
      username TEXT NOT NULL,
      amount TEXT NOT NULL,
      message TEXT,
      status TEXT DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_offers_buyer ON account_offers(buyer_address);
    CREATE INDEX IF NOT EXISTS idx_offers_username ON account_offers(username);
    CREATE INDEX IF NOT EXISTS idx_offers_status ON account_offers(status);

    -- Account transfer records table (アカウント転送記録テーブル)
    CREATE TABLE IF NOT EXISTS account_transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tx_hash TEXT NOT NULL,
      block_number INTEGER NOT NULL,
      username TEXT NOT NULL,
      old_owner TEXT NOT NULL,
      new_owner TEXT NOT NULL,
      amount TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_transfers_username ON account_transfers(username);
    CREATE INDEX IF NOT EXISTS idx_transfers_time ON account_transfers(timestamp DESC);

    -- Work transfer records table (作品転送記録テーブル)
    CREATE TABLE IF NOT EXISTS work_transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tx_hash TEXT NOT NULL,
      block_number INTEGER NOT NULL,
      work_cid TEXT NOT NULL,
      from_username TEXT NOT NULL,
      to_username TEXT NOT NULL,
      from_address TEXT NOT NULL,
      to_address TEXT NOT NULL,
      transfer_count INTEGER NOT NULL,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_work_transfers_cid ON work_transfers(work_cid);
    CREATE INDEX IF NOT EXISTS idx_work_transfers_time ON work_transfers(timestamp DESC);

    -- Withdrawal records table (出金記録テーブル)
    CREATE TABLE IF NOT EXISTS withdrawals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tx_hash TEXT NOT NULL,
      block_number INTEGER NOT NULL,
      user_address TEXT NOT NULL,
      token_address TEXT NOT NULL,
      amount TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_address);
    CREATE INDEX IF NOT EXISTS idx_withdrawals_time ON withdrawals(timestamp DESC);

    -- Config change records table (設定変更記録テーブル)
    CREATE TABLE IF NOT EXISTS config_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tx_hash TEXT NOT NULL,
      block_number INTEGER NOT NULL,
      param_name TEXT NOT NULL,
      param_value TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );

    -- Emergency withdrawal records table (緊急出金記録テーブル)
    CREATE TABLE IF NOT EXISTS emergency_withdrawals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tx_hash TEXT NOT NULL,
      block_number INTEGER NOT NULL,
      owner_address TEXT NOT NULL,
      token_address TEXT NOT NULL,
      amount TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );

    -- Sync state table (同期状態テーブル)
    CREATE TABLE IF NOT EXISTS sync_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      contract_address TEXT NOT NULL,
      chain_id INTEGER NOT NULL,
      start_block INTEGER NOT NULL,
      last_synced_block INTEGER NOT NULL,
      last_synced_tx_hash TEXT,
      last_synced_log_index INTEGER,
      updated_at INTEGER NOT NULL
    );
  `)

  // Migration: add reply columns to existing databases
  try { db.exec(`ALTER TABLE tip_records ADD COLUMN parent_tx_hash TEXT`) } catch { /* column already exists */ }
  try { db.exec(`ALTER TABLE tip_records ADD COLUMN reply_count INTEGER DEFAULT 0`) } catch { /* column already exists */ }
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_tips_parent ON tip_records(parent_tx_hash)`) } catch { /* index already exists */ }

  return db
}

// ============ Sync State Management (同期状態管理) ============

interface SyncState {
  contract_address: string
  chain_id: number
  start_block: number
  last_synced_block: number
  last_synced_tx_hash: string | null
  last_synced_log_index: number | null
  updated_at: number
}

function getSyncState(db: DatabaseSync): SyncState | null {
  try {
    const stmt = db.prepare('SELECT * FROM sync_state WHERE id = 1')
    const row = stmt.get() as SyncState | undefined
    return row || null
  } catch {
    return null
  }
}

function initSyncState(db: DatabaseSync): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO sync_state (id, contract_address, chain_id, start_block, last_synced_block, updated_at)
    VALUES (1, ?, ?, ?, ?, ?)
  `)
  stmt.run(
    CONTRACT_ADDRESS.toLowerCase(),
    CHAIN_ID,
    CONTRACT_DEPLOY_BLOCK,
    CONTRACT_DEPLOY_BLOCK - 1,
    Math.floor(Date.now() / 1000),
  )
}

function updateSyncState(
  db: DatabaseSync,
  blockNumber: number,
  txHash?: string,
  logIndex?: number,
): void {
  const stmt = db.prepare(`
    UPDATE sync_state SET last_synced_block = ?, last_synced_tx_hash = ?, last_synced_log_index = ?, updated_at = ?
    WHERE id = 1
  `)
  stmt.run(
    blockNumber,
    txHash || null,
    logIndex ?? null,
    Math.floor(Date.now() / 1000),
  )
}

// ============ Event Decoding (イベントデコード) ============

function decodeEvent(event: RawEvent): DecodedEvent | null {
  try {
    const decoded = decodeEventLog({
      abi: contractAbi,
      data: event.data as `0x${string}`,
      topics: event.topics as [`0x${string}`, ...`0x${string}`[]],
    })
    return {
      eventName: String(decoded.eventName),
      args: (decoded.args ?? {}) as Record<string, unknown>,
      blockNumber:
        typeof event.blockNumber === 'string'
          ? parseInt(event.blockNumber)
          : event.blockNumber,
      transactionHash: event.transactionHash,
      logIndex:
        typeof event.logIndex === 'string'
          ? parseInt(event.logIndex)
          : event.logIndex,
    }
  } catch {
    return null
  }
}

// ============ Core Database Event Handlers (コアデータベースイベントハンドラー) ============

function handleCreatorRegistered(event: DecodedEvent): void {
  if (!coreDb) return
  const args = event.args
  const stmt = coreDb.prepare(`
    INSERT OR REPLACE INTO creators 
    (username, wallet_address, avatar_cid, background_cid, ipns_address, ipns_signature, title, description, min_offer_price, registered_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  stmt.run(
    args.username as string,
    (args.creatorAddress as string).toLowerCase(),
    args.avatarCid as string,
    args.backgroundCid as string,
    args.ipnsAddress as string,
    (args.ipnsSignature as Uint8Array) || null,
    args.title as string,
    args.description as string,
    String(args.minOfferPrice),
    Number(args.timestamp),
    Number(args.timestamp),
  )
  // Update FTS (FTSを更新)
  coreDb.exec(`INSERT INTO creators_fts(creators_fts) VALUES('rebuild')`)
}

function handleCreatorProfileUpdated(event: DecodedEvent): void {
  if (!coreDb) return
  const args = event.args
  const stmt = coreDb.prepare(`
    UPDATE creators SET 
      avatar_cid = COALESCE(NULLIF(?, ''), avatar_cid),
      background_cid = COALESCE(NULLIF(?, ''), background_cid),
      ipns_address = COALESCE(NULLIF(?, ''), ipns_address),
      ipns_signature = COALESCE(?, ipns_signature),
      title = COALESCE(NULLIF(?, ''), title),
      description = COALESCE(NULLIF(?, ''), description),
      updated_at = ?
    WHERE username = ?
  `)
  stmt.run(
    args.avatarCid as string,
    args.backgroundCid as string,
    args.ipnsAddress as string,
    (args.ipnsSignature as Uint8Array) || null,
    args.title as string,
    args.description as string,
    Number(args.timestamp),
    args.username as string,
  )
  coreDb.exec(`INSERT INTO creators_fts(creators_fts) VALUES('rebuild')`)
}

function handleMinOfferPriceUpdated(event: DecodedEvent): void {
  if (!coreDb) return
  const args = event.args
  const stmt = coreDb.prepare(
    `UPDATE creators SET min_offer_price = ?, updated_at = ? WHERE username = ?`,
  )
  stmt.run(
    String(args.minOfferPrice),
    Number(args.timestamp),
    args.username as string,
  )
}

function handleIPNSDisabled(event: DecodedEvent): void {
  if (!coreDb) return
  const args = event.args
  const stmt = coreDb.prepare(
    `UPDATE creators SET ipns_address = NULL, ipns_signature = NULL, updated_at = ? WHERE username = ?`,
  )
  stmt.run(Number(args.timestamp), args.username as string)
}

function handleWorkClaimed(event: DecodedEvent): void {
  if (!coreDb) return
  const args = event.args
  const stmt = coreDb.prepare(`
    INSERT OR REPLACE INTO works 
    (work_cid, owner_username, title, description, work_type, img_cid, claimed_at, transfer_count, is_deleted)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
  `)
  stmt.run(
    args.workCid as string,
    args.ownerUsername as string,
    args.title as string,
    args.description as string,
    Number(args.workType),
    args.imgCid as string,
    Number(args.claimedAt),
    Number(args.transferCount),
  )
  // Update creator work count (クリエイターの作品数を更新)
  const updateStmt = coreDb.prepare(
    `UPDATE creators SET work_count = work_count + 1 WHERE username = ?`,
  )
  updateStmt.run(args.ownerUsername as string)
  coreDb.exec(`INSERT INTO works_fts(works_fts) VALUES('rebuild')`)
}

function handleWorkTransferred(event: DecodedEvent): void {
  if (!coreDb || !peripheralDb) return
  const args = event.args
  // Update works table (worksテーブルを更新)
  const stmt = coreDb.prepare(
    `UPDATE works SET owner_username = ?, transfer_count = ? WHERE work_cid = ?`,
  )
  stmt.run(
    args.toUsername as string,
    Number(args.transferCount),
    args.workCid as string,
  )
  // Update creator work count (クリエイターの作品数を更新)
  coreDb
    .prepare(
      `UPDATE creators SET work_count = work_count - 1 WHERE username = ?`,
    )
    .run(args.fromUsername as string)
  coreDb
    .prepare(
      `UPDATE creators SET work_count = work_count + 1 WHERE username = ?`,
    )
    .run(args.toUsername as string)
  // Insert peripheral database record (周辺データベースレコードを挿入)
  const pStmt = peripheralDb.prepare(`
    INSERT INTO work_transfers (tx_hash, block_number, work_cid, from_username, to_username, from_address, to_address, transfer_count, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  pStmt.run(
    event.transactionHash,
    event.blockNumber,
    args.workCid as string,
    args.fromUsername as string,
    args.toUsername as string,
    (args.fromAddress as string).toLowerCase(),
    (args.toAddress as string).toLowerCase(),
    Number(args.transferCount),
    Number(args.timestamp),
  )
}

function handleWorkDeleted(event: DecodedEvent): void {
  if (!coreDb) return
  const args = event.args
  const stmt = coreDb.prepare(
    `UPDATE works SET is_deleted = 1, deleted_at = ? WHERE work_cid = ?`,
  )
  stmt.run(Number(args.timestamp), args.workCid as string)
  coreDb
    .prepare(
      `UPDATE creators SET work_count = work_count - 1 WHERE username = ?`,
    )
    .run(args.ownerUsername as string)
}

function handleWorkUpdated(event: DecodedEvent): void {
  if (!coreDb) return
  const args = event.args
  const workCid = args.workCid as string
  const title = args.title as string
  const description = args.description as string
  const workType = Number(args.workType)
  const imgCid = args.imgCid as string
  // Max uint256 means no update for workType
  const UINT256_MAX = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

  // Lazy update: only update non-empty fields
  const updates: string[] = []
  const values: (string | number)[] = []

  if (title.length > 0) {
    updates.push('title = ?')
    values.push(title)
  }
  if (description.length > 0) {
    updates.push('description = ?')
    values.push(description)
  }
  if (BigInt(args.workType) !== UINT256_MAX) {
    updates.push('work_type = ?')
    values.push(workType)
  }
  if (imgCid.length > 0) {
    updates.push('img_cid = ?')
    values.push(imgCid)
  }

  if (updates.length === 0) return

  values.push(workCid)
  const sql = `UPDATE works SET ${updates.join(', ')} WHERE work_cid = ?`
  coreDb.prepare(sql).run(...values)
  coreDb.exec(`INSERT INTO works_fts(works_fts) VALUES('rebuild')`)
}

function handleTipped(event: DecodedEvent): void {
  if (!coreDb || !peripheralDb) return
  const args = event.args
  const tokenAddr = (args.token as string).toLowerCase()
  const amountSent = BigInt(String(args.amountSent))
  const jackpotFee = BigInt(String(args.jackpotFee))

  // Update core database tip statistics (コアデータベースのチップ統計を更新)
  const existingStmt = coreDb.prepare(
    `SELECT total_amount, tip_count FROM work_tip_stats WHERE work_cid = ? AND token_address = ?`,
  )
  const existing = existingStmt.get(args.workCid as string, tokenAddr) as
    | { total_amount: string; tip_count: number }
    | undefined

  if (existing) {
    const newTotal = BigInt(existing.total_amount) + amountSent
    coreDb.prepare(`
      UPDATE work_tip_stats SET total_amount = ?, total_amount_numeric = ?, tip_count = ?, last_tip_at = ?
      WHERE work_cid = ? AND token_address = ?
    `).run(
      newTotal.toString(),
      Number(newTotal) / 1e18,
      existing.tip_count + 1,
      Number(args.timestamp),
      args.workCid as string,
      tokenAddr,
    )
  } else {
    coreDb.prepare(`
      INSERT INTO work_tip_stats (work_cid, token_address, total_amount, total_amount_numeric, tip_count, last_tip_at)
      VALUES (?, ?, ?, ?, 1, ?)
    `).run(
      args.workCid as string,
      tokenAddr,
      amountSent.toString(),
      Number(amountSent) / 1e18,
      Number(args.timestamp),
    )
  }

  // Accumulate jackpot amount to jackpot_current, initialize start_time/end_time on first tip (ジャックポット金額をjackpot_currentに累積、初回チップ時にstart_time/end_timeを初期化)
  const JACKPOT_DURATION = 7 * 24 * 3600
  const blockTime = Number(args.timestamp)
  const currentJackpot = coreDb.prepare(
    `SELECT pool_amount, start_time, end_time, current_epoch FROM jackpot_current WHERE token_address = ?`,
  ).get(tokenAddr) as { pool_amount: string; start_time: number | null; end_time: number | null; current_epoch: number } | undefined

  if (currentJackpot) {
    const newPool = BigInt(currentJackpot.pool_amount || '0') + jackpotFee
    const startTime = currentJackpot.start_time ?? blockTime
    const endTime = currentJackpot.end_time ?? (blockTime + JACKPOT_DURATION)
    coreDb.prepare(`
      UPDATE jackpot_current SET pool_amount = ?, start_time = COALESCE(start_time, ?), end_time = COALESCE(end_time, ?)
      WHERE token_address = ?
    `).run(newPool.toString(), startTime, endTime, tokenAddr)
    // Sync update jackpot_epochs (jackpot_epochsを同期更新)
    coreDb.prepare(`
      UPDATE jackpot_epochs SET pool_amount = ?, start_time = COALESCE(start_time, ?), end_time = COALESCE(end_time, ?)
      WHERE token_address = ? AND epoch = ?
    `).run(newPool.toString(), startTime, endTime, tokenAddr, currentJackpot.current_epoch)
  } else {
    // First tip, initialize jackpot (初回チップ、ジャックポットを初期化)
    coreDb.prepare(`
      INSERT INTO jackpot_current (token_address, current_epoch, pool_amount, start_time, end_time, extension_count)
      VALUES (?, 1, ?, ?, ?, 0)
    `).run(tokenAddr, jackpotFee.toString(), blockTime, blockTime + JACKPOT_DURATION)
    coreDb.prepare(`
      INSERT OR IGNORE INTO jackpot_epochs (token_address, epoch, pool_amount, start_time, end_time)
      VALUES (?, 1, ?, ?, ?)
    `).run(tokenAddr, jackpotFee.toString(), blockTime, blockTime + JACKPOT_DURATION)
  }

  // Insert peripheral database tip record (周辺データベースにチップ記録を挿入)
  const rawMessage = (args.message as string) || null
  // Parse reply prefix: @rp:<parent_tx_hash>|<actual content>
  let parentTxHash: string | null = null
  let storedMessage: string | null = rawMessage
  if (rawMessage && rawMessage.startsWith('@rp:')) {
    const pipeIdx = rawMessage.indexOf('|', 4)
    if (pipeIdx !== -1) {
      parentTxHash = rawMessage.slice(4, pipeIdx)
      storedMessage = rawMessage.slice(pipeIdx + 1) || null
    }
  }

  peripheralDb.prepare(`
    INSERT INTO tip_records (tx_hash, block_number, tipper_address, creator_address, work_cid, token_address, amount_sent, creator_share, platform_fee, jackpot_fee, message, timestamp, parent_tx_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.transactionHash,
    event.blockNumber,
    (args.tipper as string).toLowerCase(),
    (args.creator as string).toLowerCase(),
    args.workCid as string,
    tokenAddr,
    String(args.amountSent),
    String(args.creatorShare),
    String(args.platformFee),
    String(args.jackpotFee),
    storedMessage,
    Number(args.timestamp),
    parentTxHash,
  )

  // Increment reply_count on parent if this is a reply
  if (parentTxHash) {
    peripheralDb.prepare(
      `UPDATE tip_records SET reply_count = reply_count + 1 WHERE tx_hash = ?`
    ).run(parentTxHash)
  }
}

function handleJackpotLeaderChanged(event: DecodedEvent): void {
  if (!coreDb) return
  const args = event.args
  const tokenAddr = (args.token as string).toLowerCase()
  const epoch = Number(args.epoch)
  const workHash = String(args.workHash)
  const creatorAddr = (args.creator as string).toLowerCase()
  const totalTips = String(args.totalTips)

  // Reverse lookup work_cid via workHash (workHash = keccak256(workCid), cannot reverse lookup) (workHashを介してwork_cidを逆引き・workHash = keccak256(workCid)、逆引き不可)
  // Changed to: Find the work with most tips for this creator in this epoch from work_tip_stats (変更：work_tip_statsからこのクリエイターのこのエポックで最もチップが多い作品を見つける)
  // Actually, contract JackpotLeaderChanged only has workHash, cannot directly reverse lookup CID (実際、契約JackpotLeaderChangedにはworkHashしかなく、CIDを直接逆引きできない)
  // We approximate by finding the work with most tips for this token and creator from work_tip_stats (work_tip_statsからこのトークンとクリエイターで最もチップが多い作品を近似的に見つける)
  const leaderWork = coreDb.prepare(`
    SELECT w.work_cid FROM work_tip_stats s
    JOIN works w ON s.work_cid = w.work_cid
    JOIN creators c ON w.owner_username = c.username
    WHERE s.token_address = ? AND c.wallet_address = ? AND w.is_deleted = 0
    ORDER BY s.total_amount_numeric DESC LIMIT 1
  `).get(tokenAddr, creatorAddr) as { work_cid: string } | undefined

  const leaderWorkCid = leaderWork?.work_cid ?? null

  // Ensure jackpot_epochs record exists (time written by handleTipped, only supplement leader info here) (jackpot_epochsレコードの存在を確認・時間はhandleTippedで書き込み、ここではリーダー情報のみ補足)
  const existingEpoch = coreDb.prepare(
    `SELECT epoch FROM jackpot_epochs WHERE token_address = ? AND epoch = ?`,
  ).get(tokenAddr, epoch)
  if (!existingEpoch) {
    const current = coreDb.prepare(
      `SELECT start_time, end_time FROM jackpot_current WHERE token_address = ?`,
    ).get(tokenAddr) as { start_time: number | null; end_time: number | null } | undefined
    const now = Math.floor(Date.now() / 1000)
    coreDb.prepare(
      `INSERT OR IGNORE INTO jackpot_epochs (token_address, epoch, start_time, end_time) VALUES (?, ?, ?, ?)`,
    ).run(tokenAddr, epoch, current?.start_time ?? now, current?.end_time ?? now + 7 * 24 * 3600)
  }

  // Update jackpot_current (preserve existing pool_amount / start_time / end_time) (jackpot_currentを更新・既存のpool_amount/start_time/end_timeを保持)
  const existing = coreDb.prepare(
    `SELECT pool_amount, start_time, end_time, extension_count FROM jackpot_current WHERE token_address = ?`,
  ).get(tokenAddr) as { pool_amount: string; start_time: number | null; end_time: number | null; extension_count: number } | undefined

  if (existing) {
    coreDb.prepare(`
      UPDATE jackpot_current SET current_epoch = ?, leader_work_cid = ?, leader_address = ?, leader_total_tips = ?
      WHERE token_address = ?
    `).run(epoch, leaderWorkCid, creatorAddr, totalTips, tokenAddr)
  } else {
    coreDb.prepare(`
      INSERT INTO jackpot_current (token_address, current_epoch, pool_amount, leader_work_cid, leader_address, leader_total_tips, extension_count)
      VALUES (?, ?, '0', ?, ?, ?, 0)
    `).run(tokenAddr, epoch, leaderWorkCid, creatorAddr, totalTips)
  }
}

function handleJackpotExtended(event: DecodedEvent): void {
  if (!coreDb) return
  const args = event.args
  const tokenAddr = (args.token as string).toLowerCase()

  // Get current epoch (現在のエポックを取得)
  const current = coreDb
    .prepare(
      `SELECT current_epoch FROM jackpot_current WHERE token_address = ?`,
    )
    .get(tokenAddr) as { current_epoch: number } | undefined
  if (!current) return

  coreDb
    .prepare(
      `UPDATE jackpot_epochs SET end_time = ?, extension_count = ? WHERE token_address = ? AND epoch = ?`,
    )
    .run(
      Number(args.newEndTime),
      Number(args.extensionCount),
      tokenAddr,
      current.current_epoch,
    )
  coreDb
    .prepare(
      `UPDATE jackpot_current SET end_time = ?, extension_count = ? WHERE token_address = ?`,
    )
    .run(Number(args.newEndTime), Number(args.extensionCount), tokenAddr)
}

function handleJackpotSettled(event: DecodedEvent): void {
  if (!coreDb) return
  const args = event.args
  const tokenAddr = (args.token as string).toLowerCase()
  const epoch = Number(args.epoch)
  const winnerAddr = (args.winner as string).toLowerCase()

  // Reverse lookup winning work CID (same logic as handleJackpotLeaderChanged) (獲得作品CIDを逆引き・handleJackpotLeaderChangedと同じロジック)
  const winnerWork = coreDb.prepare(`
    SELECT w.work_cid FROM work_tip_stats s
    JOIN works w ON s.work_cid = w.work_cid
    JOIN creators c ON w.owner_username = c.username
    WHERE s.token_address = ? AND c.wallet_address = ? AND w.is_deleted = 0
    ORDER BY s.total_amount_numeric DESC LIMIT 1
  `).get(tokenAddr, winnerAddr) as { work_cid: string } | undefined

  const winnerWorkCid = winnerWork?.work_cid ?? null

  coreDb.prepare(`
    UPDATE jackpot_epochs SET is_settled = 1, winner_address = ?, winner_work_cid = ?, settled_amount = ?, settled_at = ?
    WHERE token_address = ? AND epoch = ?
  `).run(winnerAddr, winnerWorkCid, String(args.amount), Number(args.timestamp), tokenAddr, epoch)

  // Reset jackpot_current to new cycle (preserve pool_amount as there may be rollover) (jackpot_currentを新しいサイクルにリセット・pool_amountは保持、ロールオーバーの可能性があるため)
  const settledAt = Number(args.timestamp)
  coreDb.prepare(`
    INSERT OR REPLACE INTO jackpot_current (token_address, current_epoch, pool_amount, leader_work_cid, leader_address, leader_total_tips, start_time, end_time, extension_count)
    VALUES (?, ?, '0', NULL, NULL, '0', ?, ?, 0)
  `).run(tokenAddr, epoch + 1, settledAt, settledAt + 7 * 24 * 3600)
}

function handleTokenSupportUpdated(event: DecodedEvent): void {
  if (!coreDb) return
  const args = event.args
  coreDb
    .prepare(
      `INSERT OR REPLACE INTO supported_tokens (token_address, is_supported, updated_at) VALUES (?, ?, ?)`,
    )
    .run(
      (args.token as string).toLowerCase(),
      args.supported ? 1 : 0,
      Math.floor(Date.now() / 1000),
    )
}

// ============ Peripheral Library Event Handling ============

function handleOfferMade(event: DecodedEvent): void {
  if (!peripheralDb) return
  const args = event.args
  peripheralDb
    .prepare(
      `
    INSERT INTO account_offers (tx_hash, block_number, buyer_address, username, amount, message, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `,
    )
    .run(
      event.transactionHash,
      event.blockNumber,
      (args.buyer as string).toLowerCase(),
      args.username as string,
      String(args.amount),
      args.message as string,
      Number(args.timestamp),
      Number(args.timestamp),
    )
}

function handleOfferWithdrawn(event: DecodedEvent): void {
  if (!peripheralDb) return
  const args = event.args
  peripheralDb
    .prepare(
      `
    UPDATE account_offers SET status = 'withdrawn', updated_at = ?
    WHERE username = ? AND buyer_address = ? AND status = 'active'
  `,
    )
    .run(
      Number(args.timestamp),
      args.username as string,
      (args.buyer as string).toLowerCase(),
    )
}

function handleOfferAccepted(event: DecodedEvent): void {
  if (!coreDb || !peripheralDb) return
  const args = event.args
  const newOwner = (args.newOwner as string).toLowerCase()
  const oldOwner = (args.oldOwner as string).toLowerCase()

  // Update the core library creator wallet address
  coreDb
    .prepare(
      `UPDATE creators SET wallet_address = ?, updated_at = ? WHERE username = ?`,
    )
    .run(newOwner, Number(args.timestamp), args.username as string)

  // Update Peripheral Library Bid Status
  peripheralDb
    .prepare(
      `
    UPDATE account_offers SET status = 'accepted', updated_at = ?
    WHERE username = ? AND buyer_address = ? AND status = 'active'
  `,
    )
    .run(Number(args.timestamp), args.username as string, newOwner)

  // Insert account transaction record
  peripheralDb
    .prepare(
      `
    INSERT INTO account_transfers (tx_hash, block_number, username, old_owner, new_owner, amount, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      event.transactionHash,
      event.blockNumber,
      args.username as string,
      oldOwner,
      newOwner,
      String(args.amount),
      Number(args.timestamp),
    )
}

function handleWithdrawn(event: DecodedEvent): void {
  if (!peripheralDb) return
  const args = event.args
  peripheralDb
    .prepare(
      `
    INSERT INTO withdrawals (tx_hash, block_number, user_address, token_address, amount, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      event.transactionHash,
      event.blockNumber,
      (args.user as string).toLowerCase(),
      (args.token as string).toLowerCase(),
      String(args.amount),
      Number(args.timestamp),
    )
}

function handleConfigUpdated(event: DecodedEvent): void {
  if (!peripheralDb) return
  const args = event.args
  peripheralDb
    .prepare(
      `
    INSERT INTO config_changes (tx_hash, block_number, param_name, param_value, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `,
    )
    .run(
      event.transactionHash,
      event.blockNumber,
      args.param as string,
      String(args.value),
      Math.floor(Date.now() / 1000),
    )
}

function handleEmergencyWithdraw(event: DecodedEvent): void {
  if (!peripheralDb) return
  const args = event.args
  peripheralDb
    .prepare(
      `
    INSERT INTO emergency_withdrawals (tx_hash, block_number, owner_address, token_address, amount, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      event.transactionHash,
      event.blockNumber,
      (args.owner as string).toLowerCase(),
      (args.token as string).toLowerCase(),
      String(args.amount),
      Math.floor(Date.now() / 1000),
    )
}

// ============ Event Routing (イベントルーティング) ============

function routeEvent(event: DecodedEvent): void {
  switch (event.eventName) {
    // Core database events (コアデータベースイベント)
    case 'CreatorRegistered':
      handleCreatorRegistered(event)
      break
    case 'CreatorProfileUpdated':
      handleCreatorProfileUpdated(event)
      break
    case 'MinOfferPriceUpdated':
      handleMinOfferPriceUpdated(event)
      break
    case 'IPNSDisabled':
      handleIPNSDisabled(event)
      break
    case 'WorkClaimed':
      handleWorkClaimed(event)
      break
    case 'WorkTransferred':
      handleWorkTransferred(event)
      break
    case 'WorkDeleted':
      handleWorkDeleted(event)
      break
    case 'WorkUpdated':
      handleWorkUpdated(event)
      break
    case 'Tipped':
      handleTipped(event)
      break
    case 'JackpotLeaderChanged':
      handleJackpotLeaderChanged(event)
      break
    case 'JackpotExtended':
      handleJackpotExtended(event)
      break
    case 'JackpotSettled':
      handleJackpotSettled(event)
      break
    case 'TokenSupportUpdated':
      handleTokenSupportUpdated(event)
      break
    // Peripheral database events (周辺データベースイベント)
    case 'OfferMade':
      handleOfferMade(event)
      break
    case 'OfferWithdrawn':
      handleOfferWithdrawn(event)
      break
    case 'OfferAccepted':
      handleOfferAccepted(event)
      break
    case 'Withdrawn':
      handleWithdrawn(event)
      break
    case 'ConfigUpdated':
      handleConfigUpdated(event)
      break
    case 'EmergencyWithdraw':
      handleEmergencyWithdraw(event)
      break
    default:
      break
  }
}

// ============ Main Entry Function (メインエントリー関数) ============

export interface BlockRange {
  fromBlock: number
  toBlock: number
}

export interface WriteResult {
  success: boolean
  error?: string
  processedCount: number
  lastBlock: number
}

/**
 * Validate if block range can be written continuously (ブロック範囲が連続して書き込み可能かを検証)
 */
function validateBlockContinuity(
  db: DatabaseSync,
  range: BlockRange,
): { valid: boolean; error?: string } {
  const state = getSyncState(db)
  if (!state) {
    // First write, initialize state (初回書き込み、状態を初期化)
    initSyncState(db)
    return { valid: true }
  }

  const lastSynced = state.last_synced_block
  // Incoming start block should be <= lastSynced + 1, end block should be > lastSynced (渡された開始ブロックはlastSynced + 1以下、終了ブロックはlastSyncedより大きい必要がある)
  if (range.fromBlock > lastSynced + 1) {
    return {
      valid: false,
      error: `Block discontinuous: database last_synced_block=${lastSynced}, incoming fromBlock=${range.fromBlock}`,
    }
  }
  if (range.toBlock <= lastSynced) {
    return {
      valid: false,
      error: `Block range already processed: toBlock=${range.toBlock} <= last_synced_block=${lastSynced}`,
    }
  }
  return { valid: true }
}

/**
 * Write event data to database (イベントデータをデータベースに書き込み)
 * @param events Raw event array
 * @param range Block range { fromBlock, toBlock }
 * @returns Write result
 */
export function writeEventsToDB(
  events: RawEvent[],
  range: BlockRange,
): WriteResult {
  // Initialize databases (データベースを初期化)
  if (!coreDb) coreDb = initCoreDb()
  if (!peripheralDb) peripheralDb = initPeripheralDb()

  // Validate core database block continuity (コアデータベースのブロック連続性を検証)
  const coreValidation = validateBlockContinuity(coreDb, range)
  if (!coreValidation.valid) {
    return {
      success: false,
      error: `Core database: ${coreValidation.error}`,
      processedCount: 0,
      lastBlock: range.fromBlock - 1,
    }
  }

  // Validate peripheral database block continuity (周辺データベースのブロック連続性を検証)
  const peripheralValidation = validateBlockContinuity(peripheralDb, range)
  if (!peripheralValidation.valid) {
    return {
      success: false,
      error: `Peripheral database: ${peripheralValidation.error}`,
      processedCount: 0,
      lastBlock: range.fromBlock - 1,
    }
  }

  let processedCount = 0
  let lastTxHash: string | undefined
  let lastLogIndex: number | undefined

  try {
    // Begin transaction (トランザクションを開始)
    coreDb.exec('BEGIN TRANSACTION')
    peripheralDb.exec('BEGIN TRANSACTION')

    for (const rawEvent of events) {
      const decoded = decodeEvent(rawEvent)
      if (decoded) {
        routeEvent(decoded)
        processedCount++
        lastTxHash = decoded.transactionHash
        lastLogIndex = decoded.logIndex
      }
    }

    // Update sync state (同期状態を更新)
    updateSyncState(coreDb, range.toBlock, lastTxHash, lastLogIndex)
    updateSyncState(peripheralDb, range.toBlock, lastTxHash, lastLogIndex)

    // Commit transaction (トランザクションをコミット)
    coreDb.exec('COMMIT')
    peripheralDb.exec('COMMIT')

    return { success: true, processedCount, lastBlock: range.toBlock }
  } catch (error) {
    // Rollback transaction (トランザクションをロールバック)
    try {
      coreDb.exec('ROLLBACK')
    } catch {}
    try {
      peripheralDb.exec('ROLLBACK')
    } catch {}
    return {
      success: false,
      error: String(error),
      processedCount: 0,
      lastBlock: range.fromBlock - 1,
    }
  }
}

/**
 * Get current sync state (現在の同期状態を取得)
 */
export function getCurrentSyncState(): {
  core: SyncState | null
  peripheral: SyncState | null
} {
  if (!coreDb) coreDb = initCoreDb()
  if (!peripheralDb) peripheralDb = initPeripheralDb()
  return {
    core: getSyncState(coreDb),
    peripheral: getSyncState(peripheralDb),
  }
}

/**
 * Close database connections (データベース接続を閉じる)
 */
export function closeDBs(): void {
  if (coreDb) {
    coreDb.close()
    coreDb = null
  }
  if (peripheralDb) {
    peripheralDb.close()
    peripheralDb = null
  }
}

/**
 * Inject network configuration at runtime.
 * Must be called before any database operations.
 */
export function setNetworkConfig(config: {
  networkId: string
  contractAddress: string
  chainId: number
  deployBlock: number
}): void {
  currentNetworkId = config.networkId
  CONTRACT_ADDRESS = config.contractAddress as `0x${string}`
  CHAIN_ID = config.chainId
  CONTRACT_DEPLOY_BLOCK = config.deployBlock
}

/**
 * Get database directory path (データベースディレクトリパスを取得)
 */
export function getDBDir(): string {
  return getDbDir()
}

/**
 * Get contract deployment block (契約デプロイブロックを取得)
 */
export function getContractDeployBlock(): number {
  return CONTRACT_DEPLOY_BLOCK
}

/**
 * Reset database sync state to contract deployment block (データベース同期状態を契約デプロイブロックにリセット)
 * Used to fix database corruption state (last_synced_block < deploy_block)
 */
export function resetSyncState(): void {
  if (!coreDb) coreDb = initCoreDb()
  if (!peripheralDb) peripheralDb = initPeripheralDb()
  
  const resetBlock = CONTRACT_DEPLOY_BLOCK - 1
  const now = Math.floor(Date.now() / 1000)
  
  // Reset core database sync state (コアデータベースの同期状態をリセット)
  coreDb.prepare(`
    UPDATE sync_state SET 
      last_synced_block = ?,
      last_synced_tx_hash = NULL,
      last_synced_log_index = NULL,
      updated_at = ?
    WHERE id = 1
  `).run(resetBlock, now)
  
  // Reset peripheral database sync state (周辺データベースの同期状態をリセット)
  peripheralDb.prepare(`
    UPDATE sync_state SET 
      last_synced_block = ?,
      last_synced_tx_hash = NULL,
      last_synced_log_index = NULL,
      updated_at = ?
    WHERE id = 1
  `).run(resetBlock, now)
  
  console.log(`Sync state reset to block ${resetBlock}`)
}
