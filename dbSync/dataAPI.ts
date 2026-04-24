/**
 * Data Query API (データクエリAPI)
 * Provides database query interface for page components from data directory
 * Implemented according to CreatorHub_DB_Design.md design document
 */

import { DatabaseSync } from 'node:sqlite'
import * as fs from 'fs'

import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Database path configuration - supports environment variable, with network subdirectory
let currentNetworkId = 'calibration'

function getDbDir(): string {
  const base = process.env.DB_DATA_PATH || path.resolve(__dirname, '../data')
  return path.join(base, currentNetworkId)
}

// Export database directory getter function
export function getDBDir(): string {
  return getDbDir()
}

/**
 * Set the active network, which switches the database directory.
 */
export function setDataApiNetwork(networkId: string): void {
  currentNetworkId = networkId
}

// FIL native token address (FILネイティブトークンアドレス)
export const NATIVE_FIL_ADDRESS = '0x0000000000000000000000000000000000000000'

// ============ Interface Definitions (インターフェース定義) ============

export interface SyncState {
  id: number
  contract_address: string
  chain_id: number
  start_block: number
  last_synced_block: number
  last_synced_tx_hash: string | null
  last_synced_log_index: number | null
  updated_at: number
}

export interface SyncStateResponse {
  core: SyncState | null
  peripheral: SyncState | null
}

export interface Creator {
  username: string
  wallet_address: string
  avatar_cid: string | null
  background_cid: string | null
  ipns_address: string | null
  title: string | null
  description: string | null
  min_offer_price: string
  work_count: number
  registered_at: number
  updated_at: number
}

export interface WorkItem {
  work_cid: string
  owner_username: string
  title: string
  description: string | null
  work_type: number
  img_cid: string | null
  claimed_at: number
  transfer_count: number
  is_deleted: number
  // Associated creator information (関連するクリエイター情報)
  creator_avatar?: string
  creator_wallet?: string
}

export interface TopTippedWork extends WorkItem {
  total_tips: string
  tip_count: number
}

export interface JackpotCurrent {
  token_address: string
  current_epoch: number
  pool_amount: string
  leader_work_cid: string | null
  leader_address: string | null
  leader_total_tips: string
  start_time: number | null
  end_time: number | null
  extension_count: number
}

// ============ Utility Functions (ユーティリティ関数) ============

function dbExists(dbPath: string): boolean {
  return fs.existsSync(dbPath)
}

function openReadonlyDb(dbPath: string): DatabaseSync | null {
  if (!dbExists(dbPath)) return null
  try {
    return new DatabaseSync(dbPath, { readOnly: true })
  } catch {
    return null
  }
}

// ============ Sync State Query (同期状態クエリ) ============

/**
 * Get sync state of both databases (両方のデータベースの同期状態を取得)
 * Returns null if database does not exist
 */
export function getSyncStates(): SyncStateResponse {
  let coreState: SyncState | null = null
  let peripheralState: SyncState | null = null

  const coreDb = openReadonlyDb(path.join(getDbDir(), 'core.db'))
  if (coreDb) {
    try {
      const stmt = coreDb.prepare('SELECT * FROM sync_state WHERE id = 1')
      coreState = stmt.get() as SyncState | null
    } catch {
      /* Table may not exist */
    }
    coreDb.close()
  }

  const peripheralDb = openReadonlyDb(path.join(getDbDir(), 'peripheral.db'))
  if (peripheralDb) {
    try {
      const stmt = peripheralDb.prepare('SELECT * FROM sync_state WHERE id = 1')
      peripheralState = stmt.get() as SyncState | null
    } catch {
      /* Table may not exist (テーブルが存在しない可能性) */
    }
    peripheralDb.close()
  }

  return { core: coreState, peripheral: peripheralState }
}

// ============ Creator Query (クリエイタークエリ) ============

/**
 * Query creator by username (ユーザー名でクリエイターを検索)
 */
export function getCreatorByUsername(username: string): Creator | null {
  const db = openReadonlyDb(path.join(getDbDir(), 'core.db'))
  if (!db) return null
  try {
    const stmt = db.prepare('SELECT * FROM creators WHERE username = ?')
    return stmt.get(username) as Creator | null
  } finally {
    db.close()
  }
}

/**
 * Query creator by wallet address (ウォレットアドレスでクリエイターを検索)
 */
export function getCreatorByWallet(walletAddress: string): Creator | null {
  const db = openReadonlyDb(path.join(getDbDir(), 'core.db'))
  if (!db) return null
  try {
    const stmt = db.prepare('SELECT * FROM creators WHERE wallet_address = ?')
    return stmt.get(walletAddress.toLowerCase()) as Creator | null
  } finally {
    db.close()
  }
}

/**
 * Search creators (full-text search) (クリエイターを検索・全文検索)
 */
export function searchCreators(keyword: string, limit: number = 20): Creator[] {
  const db = openReadonlyDb(path.join(getDbDir(), 'core.db'))
  if (!db) return []
  try {
    // Order by total tip count across all tokens for all works by this creator, then by work_count
    const stmt = db.prepare(`
      SELECT c.*,
             COALESCE(SUM(s.tip_count), 0) AS total_tip_count
      FROM creators c
      JOIN creators_fts fts ON c.rowid = fts.rowid
      LEFT JOIN works w ON w.owner_username = c.username AND w.is_deleted = 0
      LEFT JOIN work_tip_stats s ON s.work_cid = w.work_cid
      WHERE creators_fts MATCH ?
      GROUP BY c.username
      ORDER BY total_tip_count DESC, c.work_count DESC
      LIMIT ?
    `)
    return stmt.all(keyword, limit) as Creator[]
  } catch {
    return []
  } finally {
    db.close()
  }
}

// ============ Work Query (作品クエリ) ============

/**
 * Query latest works (最新の作品を検索)
 */
export function getLatestWorks(
  page: number = 1,
  pageSize: number = 20,
): WorkItem[] {
  const db = openReadonlyDb(path.join(getDbDir(), 'core.db'))
  if (!db) return []
  try {
    const offset = (page - 1) * pageSize
    const stmt = db.prepare(`
      SELECT w.*, c.avatar_cid as creator_avatar, c.wallet_address as creator_wallet
      FROM works w
      LEFT JOIN creators c ON w.owner_username = c.username
      WHERE w.is_deleted = 0
      ORDER BY w.claimed_at DESC
      LIMIT ? OFFSET ?
    `)
    return stmt.all(pageSize, offset) as WorkItem[]
  } finally {
    db.close()
  }
}

/**
 * Query top tipped works ranking (チップランキングを検索)
 */
export function getTopTippedWorks(
  tokenAddress: string = NATIVE_FIL_ADDRESS,
  limit: number = 30,
  claimedAfter: number = 0,
  since: number = 0,
): TopTippedWork[] {
  const db = openReadonlyDb(path.join(getDbDir(), 'core.db'))
  if (!db) return []
  try {
    // Attach peripheral.db to query tip_records within the current jackpot epoch window
    db.exec(`ATTACH DATABASE '${path.join(getDbDir(), 'peripheral.db')}' AS peripheral`)
    const stmt = db.prepare(`
      SELECT w.*, c.avatar_cid as creator_avatar, c.wallet_address as creator_wallet,
             CAST(SUM(CAST(t.amount_sent AS REAL)) AS TEXT) as total_tips,
             COUNT(t.id) as tip_count
      FROM works w
      JOIN peripheral.tip_records t ON w.work_cid = t.work_cid
      LEFT JOIN creators c ON w.owner_username = c.username
      WHERE t.token_address = ? AND w.is_deleted = 0 AND w.claimed_at > ?
        AND t.timestamp >= ?
      GROUP BY w.work_cid
      ORDER BY SUM(CAST(t.amount_sent AS REAL)) DESC
      LIMIT ?
    `)
    return stmt.all(
      tokenAddress.toLowerCase(),
      claimedAfter,
      since,
      limit,
    ) as TopTippedWork[]
  } finally {
    try { db.exec('DETACH DATABASE peripheral') } catch { /* ignore if not attached */ }
    db.close()
  }
}

/**
 * Search works (full-text search) (作品を検索・全文検索)
 */
export function searchWorks(keyword: string, limit: number = 20): WorkItem[] {
  const db = openReadonlyDb(path.join(getDbDir(), 'core.db'))
  if (!db) return []
  try {
    // Order by total tip count across all tokens
    const stmt = db.prepare(`
      SELECT w.*, c.avatar_cid as creator_avatar, c.wallet_address as creator_wallet,
             COALESCE(SUM(s.tip_count), 0) AS total_tip_count
      FROM works w
      JOIN works_fts fts ON w.rowid = fts.rowid
      LEFT JOIN creators c ON w.owner_username = c.username
      LEFT JOIN work_tip_stats s ON s.work_cid = w.work_cid
      WHERE works_fts MATCH ? AND w.is_deleted = 0
      GROUP BY w.work_cid
      ORDER BY total_tip_count DESC
      LIMIT ?
    `)
    return stmt.all(keyword, limit) as WorkItem[]
  } catch {
    return []
  } finally {
    db.close()
  }
}

/**
 * Query works by creator (クリエイターの作品を検索)
 */
export function getWorksByCreator(
  username: string,
  page: number = 1,
  pageSize: number = 20,
): WorkItem[] {
  const db = openReadonlyDb(path.join(getDbDir(), 'core.db'))
  if (!db) return []
  try {
    const offset = (page - 1) * pageSize
    const stmt = db.prepare(`
      SELECT * FROM works
      WHERE owner_username = ? AND is_deleted = 0
      ORDER BY claimed_at DESC
      LIMIT ? OFFSET ?
    `)
    return stmt.all(username, pageSize, offset) as WorkItem[]
  } finally {
    db.close()
  }
}

/**
 * Query works by multiple creators (reverse chronological order, paginated) (複数のクリエイターの作品を検索・時系列逆順・ページネーション)
 */
export function getWorksByCreators(
  usernames: string[],
  page: number = 1,
  pageSize: number = 20,
): WorkItem[] {
  if (usernames.length === 0) return []
  const db = openReadonlyDb(path.join(getDbDir(), 'core.db'))
  if (!db) return []
  try {
    const offset = (page - 1) * pageSize
    const placeholders = usernames.map(() => '?').join(',')
    const stmt = db.prepare(`
      SELECT w.*, c.avatar_cid as creator_avatar, c.wallet_address as creator_wallet
      FROM works w
      LEFT JOIN creators c ON w.owner_username = c.username
      WHERE w.owner_username IN (${placeholders}) AND w.is_deleted = 0
      ORDER BY w.claimed_at DESC
      LIMIT ? OFFSET ?
    `)
    return stmt.all(...usernames, pageSize, offset) as WorkItem[]
  } finally {
    db.close()
  }
}


/**
 * Query single work by CID (CIDで単一の作品を検索)
 */
export function getWorkByCid(workCid: string): WorkItem | null {
  const db = openReadonlyDb(path.join(getDbDir(), 'core.db'))
  if (!db) return null
  try {
    const stmt = db.prepare(`
      SELECT w.*, c.avatar_cid as creator_avatar, c.wallet_address as creator_wallet
      FROM works w
      LEFT JOIN creators c ON w.owner_username = c.username
      WHERE w.work_cid = ? AND w.is_deleted = 0
    `)
    return stmt.get(workCid) as WorkItem | null
  } finally {
    db.close()
  }
}

export interface WorkTipStat {
  token_address: string
  total_amount: string
  tip_count: number
}

/**
 * Query tip statistics for each token of a work (作品の各トークンのチップ統計を検索)
 */
export function getWorkTipStats(workCid: string): WorkTipStat[] {
  const db = openReadonlyDb(path.join(getDbDir(), 'core.db'))
  if (!db) return []
  try {
    const stmt = db.prepare(`
      SELECT token_address, total_amount, tip_count
      FROM work_tip_stats
      WHERE work_cid = ? AND tip_count > 0
      ORDER BY tip_count DESC
    `)
    return stmt.all(workCid) as WorkTipStat[]
  } finally {
    db.close()
  }
}

// ============ Jackpot Query (ジャックポットクエリ) ============

/**
 * Query current jackpot status (現在のジャックポット状態を検索)
 */
export function getCurrentJackpots(): JackpotCurrent[] {
  const db = openReadonlyDb(path.join(getDbDir(), 'core.db'))
  if (!db) return []
  try {
    const stmt = db.prepare('SELECT * FROM jackpot_current')
    return stmt.all() as JackpotCurrent[]
  } finally {
    db.close()
  }
}

/**
 * Query current jackpot for specified token (指定されたトークンの現在のジャックポットを検索)
 */
export function getJackpotByToken(tokenAddress: string): JackpotCurrent | null {
  const db = openReadonlyDb(path.join(getDbDir(), 'core.db'))
  if (!db) return null
  try {
    const stmt = db.prepare(
      'SELECT * FROM jackpot_current WHERE token_address = ?',
    )
    return stmt.get(tokenAddress.toLowerCase()) as JackpotCurrent | null
  } finally {
    db.close()
  }
}

/**
 * Get end_time of a specific jackpot epoch (特定のジャックポット周期のend_timeを取得)
 */
export function getEpochEndTime(tokenAddress: string, epoch: number): number | null {
  const db = openReadonlyDb(path.join(getDbDir(), 'core.db'))
  if (!db) return null
  try {
    const row = db.prepare(
      'SELECT end_time, settled_at FROM jackpot_epochs WHERE token_address = ? AND epoch = ?',
    ).get(tokenAddress.toLowerCase(), epoch) as { end_time: number; settled_at: number | null } | undefined
    // If epoch was settled early, use settled_at as the boundary (it matches the tip timestamp)
    // Otherwise fall back to end_time
    if (row?.settled_at) return row.settled_at
    return row?.end_time ?? null
  } finally {
    db.close()
  }
}

// ============ Peripheral Database Query (周辺データベースクエリ) ============

export interface TipRecord {
  id: number
  tx_hash: string
  block_number: number
  tipper_address: string
  creator_address: string
  work_cid: string
  token_address: string
  amount_sent: string
  creator_share: string
  platform_fee: string
  jackpot_fee: string
  message: string | null
  timestamp: number
  parent_tx_hash: string | null
  reply_count: number
}

/**
 * Query tip records for a work with pagination (作品のチップ記録を検索、ページネーション対応)
 * Only returns top-level comments (parent_tx_hash IS NULL)
 */
export function getTipsByWork(
  workCid: string,
  limit: number = 20,
  offset: number = 0,
): TipRecord[] {
  const db = openReadonlyDb(path.join(getDbDir(), 'peripheral.db'))
  if (!db) return []
  try {
    const stmt = db.prepare(`
      SELECT * FROM tip_records WHERE work_cid = ? AND (parent_tx_hash IS NULL OR parent_tx_hash = '')
      ORDER BY timestamp DESC LIMIT ? OFFSET ?
    `)
    return stmt.all(workCid, limit, offset) as TipRecord[]
  } finally {
    db.close()
  }
}

/**
 * Query replies to a specific tip comment
 */
export function getRepliesByTip(parentTxHash: string): TipRecord[] {
  const db = openReadonlyDb(path.join(getDbDir(), 'peripheral.db'))
  if (!db) return []
  try {
    const stmt = db.prepare(`
      SELECT * FROM tip_records WHERE parent_tx_hash = ?
      ORDER BY timestamp ASC
    `)
    return stmt.all(parentTxHash) as TipRecord[]
  } finally {
    db.close()
  }
}

/**
 * Query tip records by tipper (ユーザーのチップ記録を検索)
 */
export function getTipsByTipper(
  tipperAddress: string,
  limit: number = 50,
): TipRecord[] {
  const db = openReadonlyDb(path.join(getDbDir(), 'peripheral.db'))
  if (!db) return []
  try {
    const stmt = db.prepare(`
      SELECT * FROM tip_records WHERE tipper_address = ?
      ORDER BY timestamp DESC LIMIT ?
    `)
    return stmt.all(tipperAddress.toLowerCase(), limit) as TipRecord[]
  } finally {
    db.close()
  }
}

/**
 * Query recent global tip records (グローバルな最近のチップ記録を検索)
 */
export function getRecentTips(limit: number = 20): TipRecord[] {
  const db = openReadonlyDb(path.join(getDbDir(), 'peripheral.db'))
  if (!db) return []
  try {
    const stmt = db.prepare(`
      SELECT * FROM tip_records
      ORDER BY timestamp DESC LIMIT ?
    `)
    return stmt.all(limit) as TipRecord[]
  } finally {
    db.close()
  }
}

/**
 * Query tip records received by creator (クリエイターが受け取ったチップ記録を検索)
 */
export function getTipsByCreator(
  creatorAddress: string,
  limit: number = 50,
): TipRecord[] {
  const db = openReadonlyDb(path.join(getDbDir(), 'peripheral.db'))
  if (!db) return []
  try {
    const stmt = db.prepare(`
      SELECT * FROM tip_records WHERE creator_address = ?
      ORDER BY timestamp DESC LIMIT ?
    `)
    return stmt.all(creatorAddress.toLowerCase(), limit) as TipRecord[]
  } finally {
    db.close()
  }
}
