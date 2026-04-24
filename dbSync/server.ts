/**
 * dbSync HTTP Service (dbSync HTTPサービス)
 * Executes historical sync on startup, then enters real-time sync mode after completion
 */

import express from 'express'
import cors from 'cors'
import {
  getSyncStates,
  getLatestWorks,
  getTopTippedWorks,
  getCreatorByUsername,
  getCreatorByWallet,
  searchCreators,
  searchWorks,
  getWorksByCreator,
  getWorksByCreators,
  getWorkByCid,
  getWorkTipStats,
  getCurrentJackpots,
  getJackpotByToken,
  getEpochEndTime,
  getTipsByWork,
  getRepliesByTip,
  getTipsByTipper,
  getTipsByCreator,
  getRecentTips,
  NATIVE_FIL_ADDRESS,
  getDBDir,
  setDataApiNetwork,
} from './dataAPI.js'
import {
  syncHistory,
  syncLatest,
  getCurrentBlockNumber,
  getSyncConfig,
  applySyncNetworkConfig,
  type SyncNetworkConfig,
} from './syncHistory.js'
import { closeDBs } from './eventToDB.js'
import {
  addTransactionFromApp,
  getWalletTransactions,
  trackWallet,
  untrackWallet,
  setTxApiNetwork,
  setTxContractAddresses,
} from './transactionAPI.js'
import { setIpfsFetcherConfig } from './ipfsEventFetcher.js'

const app = express()
const PORT = process.env.DB_SERVER_PORT || 3001

// Real-time sync interval (milliseconds) (リアルタイム同期間隔・ミリ秒)
const REALTIME_SYNC_INTERVAL = 30000

// Sync status (同期状態)
let isHistorySyncComplete = false
let realtimeSyncTimer: NodeJS.Timeout | null = null

// ============ Service Status Tracking (サービス状態追跡) ============

interface ServiceStatus {
  available: boolean
  phase: 'starting' | 'ipfs_download' | 'db_building' | 'ready' | 'error'
  // Phase 1: IPFS shard download (フェーズ1：IPFSシャードダウンロード)
  ipfs_total_shards: number
  ipfs_downloaded_shards: number
  // Phase 2: Database building (block sync) (フェーズ2：データベース構築・ブロック同期)
  sync_current_block: number
  sync_target_block: number
  sync_progress: number // 0-100
  // Human-readable status message for frontend display
  status_message: string
  // Error information (エラー情報)
  error: string | null
  updated_at: number
}

const serviceStatus: ServiceStatus = {
  available: false,
  phase: 'starting',
  ipfs_total_shards: 0,
  ipfs_downloaded_shards: 0,
  sync_current_block: 0,
  sync_target_block: 0,
  sync_progress: 0,
  status_message: 'Initializing...',
  error: null,
  updated_at: Date.now(),
}

function updateServiceStatus(partial: Partial<ServiceStatus>) {
  Object.assign(serviceStatus, partial, { updated_at: Date.now() })
}

// ============ Network State ============

let activeNetworkConfig: SyncNetworkConfig | null = null

/**
 * Apply a new network config: stop sync, close DBs, reconfigure all modules, restart sync.
 */
async function switchNetwork(config: SyncNetworkConfig): Promise<void> {
  console.log(`Switching network to: ${config.networkId}`)

  // Stop real-time sync
  stopRealtimeSync()

  // Close all open DB connections
  closeDBs()

  // Reset service status
  isHistorySyncComplete = false
  updateServiceStatus({
    available: false,
    phase: 'starting',
    sync_progress: 0,
    error: null,
    status_message: 'Connecting to network...',
  })

  // Propagate config to all modules
  setDataApiNetwork(config.networkId)
  setTxApiNetwork(config.networkId)
  setTxContractAddresses(config.contractAddress, config.adsAddress ?? '')
  setIpfsFetcherConfig(config.rpcUrl, config.chainId, config.contractAddress)
  applySyncNetworkConfig(config)

  activeNetworkConfig = config

  // Restart historical sync
  syncHistory(
    () => {
      isHistorySyncComplete = true
      updateServiceStatus({ available: true, phase: 'ready', sync_progress: 100, error: null, status_message: 'Ready' })
      console.log(`Network ${config.networkId}: historical sync complete, entering real-time sync`)
      startRealtimeSync()
    },
    (progress) => {
      updateServiceStatus({
        phase: 'db_building',
        sync_current_block: progress.currentBlock,
        sync_target_block: progress.targetBlock,
        sync_progress: progress.progress,
      })
    },
    (downloaded, total) => {
      updateServiceStatus({
        phase: 'ipfs_download',
        ipfs_downloaded_shards: downloaded,
        ipfs_total_shards: total,
      })
    },
    (message) => {
      updateServiceStatus({ status_message: message })
    },
  ).catch((err) => {
    updateServiceStatus({ phase: 'error', error: String(err), status_message: String(err) })
    console.error(`Network ${config.networkId}: historical sync failed:`, err)
    isHistorySyncComplete = true
    startRealtimeSync()
  })
}

app.use(cors())
app.use(express.json())

// ============ Network Switch API ============

app.post('/api/network/switch', async (req, res) => {
  try {
    const { networkId, rpcUrl, chainId, contractAddress, adsAddress, deployBlock } = req.body
    if (!networkId || !rpcUrl || !chainId || !contractAddress || deployBlock === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: networkId, rpcUrl, chainId, contractAddress, deployBlock',
      })
    }

    // Idempotent: skip if already on this network and sync is running
    if (
      activeNetworkConfig?.networkId === networkId &&
      activeNetworkConfig?.contractAddress === contractAddress &&
      isHistorySyncComplete
    ) {
      return res.json({ success: true, message: `Already on network: ${networkId}` })
    }

    const config: SyncNetworkConfig = { networkId, rpcUrl, chainId, contractAddress, adsAddress, deployBlock }

    // Respond immediately, switch runs asynchronously
    res.json({ success: true, message: `Switching to network: ${networkId}` })

    await switchNetwork(config)
  } catch (error: any) {
    // Error after response already sent - just log it
    console.error('Network switch error:', error)
  }
})

// Get current active network config
app.get('/api/network/current', (_req, res) => {
  res.json({ success: true, data: activeNetworkConfig })
})

// ============ Sync State API ============

// Get database sync state (データベース同期状態を取得)
app.get('/api/sync/state', (_req, res) => {
  try {
    const states = getSyncStates()
    res.json({ success: true, data: states })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// Get service status (for frontend polling) (サービス状態を取得・フロントエンドポーリング用)
app.get('/api/sync/service-status', (_req, res) => {
  res.json({ success: true, data: { ...serviceStatus } })
})

// Get sync configuration (同期設定を取得)
app.get('/api/sync/config', (_req, res) => {
  try {
    const config = getSyncConfig()
    res.json({
      success: true,
      data: {
        ...config,
        isHistorySyncComplete,
        realtimeSyncInterval: REALTIME_SYNC_INTERVAL,
      },
    })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// Get current block height (現在のブロック高さを取得)
app.get('/api/sync/block', async (_req, res) => {
  try {
    const blockNumber = await getCurrentBlockNumber()
    res.json({ success: true, data: { blockNumber } })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// ============ Creator API (クリエイターAPI) ============

app.get('/api/creators/:username', (req, res) => {
  try {
    const creator = getCreatorByUsername(req.params.username)
    if (creator) {
      res.json({ success: true, data: creator })
    } else {
      res.status(404).json({ success: false, error: 'Creator not found' })
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

app.get('/api/creators/wallet/:address', (req, res) => {
  try {
    const creator = getCreatorByWallet(req.params.address)
    if (creator) {
      res.json({ success: true, data: creator })
    } else {
      res.status(404).json({ success: false, error: 'Creator not found' })
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

app.get('/api/creators/search/:keyword', (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20
    const creators = searchCreators(req.params.keyword, limit)
    res.json({ success: true, data: creators })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// ============ Work API (作品API) ============

app.get('/api/works/latest', (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1
    const pageSize = parseInt(req.query.pageSize as string) || 20
    const works = getLatestWorks(page, pageSize)

    // フィールド名をマッピングしてフロントエンドの期待に一致させる（契約の命名に従う）
    const mappedWorks = works.map((work) => ({
      cid: work.work_cid,
      creator_username: work.owner_username,
      title: work.title,
      description: work.description,
      content_type: work.work_type,
      img_cid: work.img_cid,
      created_at: new Date(work.claimed_at * 1000).toISOString(),
      creator_avatar: work.creator_avatar,
      creator_wallet: work.creator_wallet,
    }))

    res.json({ success: true, data: mappedWorks })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

app.get('/api/works/top-tipped', (req, res) => {
  try {
    const tokenAddress = (req.query.token as string) || NATIVE_FIL_ADDRESS
    const limit = parseInt(req.query.limit as string) || 30
    const claimedAfter = parseInt(req.query.after as string) || 0

    // Determine the start of the current jackpot epoch.
    // getEpochEndTime returns settled_at if the epoch was settled early (matching
    // the tip timestamp), otherwise returns end_time. This ensures tips that land
    // in the same block as the settlement event are always included.
    let since = 0
    const jackpot = getJackpotByToken(tokenAddress)
    if (jackpot && jackpot.current_epoch > 1) {
      const boundary = getEpochEndTime(tokenAddress, jackpot.current_epoch - 1)
      since = boundary ?? jackpot.start_time ?? 0
    } else if (jackpot?.start_time) {
      since = jackpot.start_time
    }

    const works = getTopTippedWorks(tokenAddress, limit, claimedAfter, since)

    const mappedWorks = works.map((work) => ({
      cid: work.work_cid,
      creator_username: work.owner_username,
      title: work.title,
      description: work.description,
      content_type: work.work_type,
      img_cid: work.img_cid,
      created_at: new Date(work.claimed_at * 1000).toISOString(),
      creator_avatar: work.creator_avatar,
      creator_wallet: work.creator_wallet,
      total_tips: work.total_tips,
      tip_count: work.tip_count,
    }))

    res.json({ success: true, data: mappedWorks })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

app.get('/api/works/search/:keyword', (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20
    const works = searchWorks(req.params.keyword, limit)

    // Map field names to match frontend expectations (following contract naming)
    const mappedWorks = works.map((work) => ({
      cid: work.work_cid,
      creator_username: work.owner_username,
      title: work.title,
      description: work.description,
      content_type: work.work_type,
      img_cid: work.img_cid,
      created_at: new Date(work.claimed_at * 1000).toISOString(),
      creator_avatar: work.creator_avatar,
      creator_wallet: work.creator_wallet,
    }))

    res.json({ success: true, data: mappedWorks })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

app.get('/api/works/cid/:cid', (req, res) => {
  try {
    const work = getWorkByCid(req.params.cid)
    if (work) {
      const mapped = {
        cid: work.work_cid,
        creator_username: work.owner_username,
        title: work.title,
        description: work.description,
        content_type: work.work_type,
        img_cid: work.img_cid,
        created_at: new Date(work.claimed_at * 1000).toISOString(),
        creator_avatar: work.creator_avatar,
        creator_wallet: work.creator_wallet,
      }
      res.json({ success: true, data: mapped })
    } else {
      res.status(404).json({ success: false, error: 'Work not found' })
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

app.get('/api/works/cid/:cid/tip-stats', (req, res) => {
  try {
    const stats = getWorkTipStats(req.params.cid)
    res.json({ success: true, data: stats })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

app.get('/api/works/creator/:username', (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1
    const pageSize = parseInt(req.query.pageSize as string) || 20
    const works = getWorksByCreator(req.params.username, page, pageSize)

    // Map field names to match frontend expectations (following contract naming)
    const mappedWorks = works.map((work) => ({
      cid: work.work_cid,
      creator_username: work.owner_username,
      title: work.title,
      description: work.description,
      content_type: work.work_type,
      img_cid: work.img_cid,
      created_at: new Date(work.claimed_at * 1000).toISOString(),
    }))

    res.json({ success: true, data: mappedWorks })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// Query works by multiple creators (reverse chronological order, paginated) (複数のクリエイターの作品を検索・時系列逆順・ページネーション)
app.post('/api/works/creators', (req, res) => {
  try {
    const { usernames, page = 1, pageSize = 20 } = req.body
    if (!Array.isArray(usernames) || usernames.length === 0) {
      return res.status(400).json({ success: false, error: 'usernames array is required' })
    }
    const works = getWorksByCreators(usernames, page, pageSize)

    const mappedWorks = works.map((work) => ({
      cid: work.work_cid,
      creator_username: work.owner_username,
      title: work.title,
      description: work.description,
      content_type: work.work_type,
      img_cid: work.img_cid,
      created_at: new Date(work.claimed_at * 1000).toISOString(),
      creator_avatar: work.creator_avatar,
      creator_wallet: work.creator_wallet,
    }))

    res.json({ success: true, data: mappedWorks })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// ============ Jackpot API (ジャックポットAPI) ============

app.get('/api/jackpots', (_req, res) => {
  try {
    const jackpots = getCurrentJackpots()
    res.json({ success: true, data: jackpots })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// wei string → ether string (for jackpot amount display) (wei文字列 → ether文字列・ジャックポット金額表示用)
function weiToEther(wei: string | null | undefined): string {
  if (!wei || wei === '0') return '0'
  try {
    const n = BigInt(wei)
    // Preserve 6 decimal places precision (6桁の小数精度を保持)
    const whole = n / BigInt(1e18)
    const remainder = n % BigInt(1e18)
    const decimal = remainder.toString().padStart(18, '0').slice(0, 6).replace(/0+$/, '')
    return decimal ? `${whole}.${decimal}` : `${whole}`
  } catch {
    return '0'
  }
}

// Jackpot details: merge leader creator info + leader work info + tip statistics (ジャックポット詳細：リーダークリエイター情報+リーダー作品情報+チップ統計をマージ)
app.get('/api/jackpots/detail', (_req, res) => {
  try {
    const jackpots = getCurrentJackpots()
    const details = jackpots.map((j) => {
      let leader_username: string | null = null
      let leader_avatar_cid: string | null = null
      let leader_ipns_address: string | null = null
      let leader_work_title: string | null = null
      let leader_work_tips: string | null = null

      if (j.leader_address) {
        const creator = getCreatorByWallet(j.leader_address)
        if (creator) {
          leader_username = creator.username
          leader_avatar_cid = creator.avatar_cid
          leader_ipns_address = creator.ipns_address
        }
      }
      if (j.leader_work_cid) {
        const work = getWorkByCid(j.leader_work_cid)
        if (work) {
          leader_work_title = work.title
        }
        const stats = getWorkTipStats(j.leader_work_cid)
        const stat = stats.find((s) => s.token_address === j.token_address)
        // total_amount stored in wei, convert to ether (total_amountはweiで保存、etherに変換)
        if (stat) leader_work_tips = weiToEther(stat.total_amount)
      }

      return {
        ...j,
        // pool_amount / leader_total_tips stored in wei in database, convert to ether for frontend display (pool_amount/leader_total_tipsはデータベースにweiで保存、フロントエンド表示用にetherに変換)
        pool_amount: weiToEther(j.pool_amount),
        leader_total_tips: weiToEther(j.leader_total_tips),
        leader_username,
        leader_avatar_cid,
        leader_ipns_address,
        leader_work_title,
        leader_work_tips,
      }
    })
    res.json({ success: true, data: details })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

app.get('/api/jackpots/:token', (req, res) => {
  try {
    const jackpot = getJackpotByToken(req.params.token)
    if (jackpot) {
      res.json({ success: true, data: jackpot })
    } else {
      res.status(404).json({ success: false, error: 'Jackpot not found' })
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// ============ Tip Records API (チップ記録API) ============

app.get('/api/tips/recent', (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20
    const tips = getRecentTips(limit)
    res.json({ success: true, data: tips })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

app.get('/api/tips/work/:workCid', (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20
    const offset = parseInt(req.query.offset as string) || 0
    const tips = getTipsByWork(req.params.workCid, limit, offset)
    res.json({ success: true, data: tips })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

app.get('/api/tips/:txHash/replies', (req, res) => {
  try {
    const replies = getRepliesByTip(req.params.txHash)
    res.json({ success: true, data: replies })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

app.get('/api/tips/tipper/:address', (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50
    const tips = getTipsByTipper(req.params.address, limit)
    res.json({ success: true, data: tips })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

app.get('/api/tips/creator/:address', (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50
    const tips = getTipsByCreator(req.params.address, limit)
    res.json({ success: true, data: tips })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// ============ Health Check (ヘルスチェック) ============

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    isHistorySyncComplete,
    timestamp: Date.now(),
  })
})

// ============ Wallet Transaction History API ============

// Track wallet (simplified import - just adds to tracking list)
app.post('/api/wallet/import', (req, res) => {
  try {
    const { walletAddress } = req.body
    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: 'walletAddress is required',
      })
    }

    const result = trackWallet(walletAddress)
    res.json(result)
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// Untrack wallet (remove from tracking list, but preserve transaction history)
app.delete('/api/wallet/:address', (req, res) => {
  try {
    const { address } = req.params
    const result = untrackWallet(address)
    res.json(result)
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// Add transaction record from app
app.post('/api/transaction', (req, res) => {
  try {
    const {
      wallet_address,
      token_address,
      amount,
      gas_fee,
      contract_method,
      is_outgoing,
      counterparty_address,
      tx_hash,
      timestamp,
      source,
    } = req.body

    if (
      !wallet_address ||
      !token_address ||
      !amount ||
      gas_fee === undefined ||
      !contract_method ||
      is_outgoing === undefined ||
      !tx_hash ||
      !timestamp ||
      !source
    ) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
      })
    }

    const result = addTransactionFromApp({
      wallet_address,
      token_address,
      amount,
      gas_fee,
      contract_method,
      is_outgoing,
      counterparty_address,
      tx_hash,
      timestamp,
      source,
    })

    res.json(result)
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// Get wallet transaction records (paginated)
app.get('/api/wallet/:address/transactions', (req, res) => {
  try {
    const { address } = req.params
    const page = parseInt(req.query.page as string) || 1
    const pageSize = parseInt(req.query.pageSize as string) || 20

    const result = getWalletTransactions(address, page, pageSize)
    res.json({ success: true, data: result })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// ============ Sync Control (同期制御) ============

function startRealtimeSync() {
  if (realtimeSyncTimer) return

  console.log(`Starting real-time sync, interval ${REALTIME_SYNC_INTERVAL / 1000} seconds`)

  realtimeSyncTimer = setInterval(async () => {
    try {
      const result = await syncLatest()
      if (result.eventsCount > 0 || result.walletTxCount > 0) {
        const walletInfo =
          result.walletTxCount > 0 ? `, ${result.walletTxCount} wallet transactions` : ''
        console.log(
          `Real-time sync complete: ${result.eventsCount} new events${walletInfo}, block ${result.newBlock}`,
        )
      }
    } catch (error) {
      console.error('Real-time sync error:', error)
    }
  }, REALTIME_SYNC_INTERVAL)
}

function stopRealtimeSync() {
  if (realtimeSyncTimer) {
    clearInterval(realtimeSyncTimer)
    realtimeSyncTimer = null
    console.log('Real-time sync stopped')
  }
}

// ============ Start Server (サーバー起動) ============

async function startServer() {
  const DB_DIR = getDBDir()

  app.listen(PORT, () => {
    console.log(`dbSync service started: http://localhost:${PORT}`)
    console.log(`Database base path: ${DB_DIR}`)
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`)
    console.log('Waiting for frontend to call /api/network/switch to begin sync...')
    updateServiceStatus({ phase: 'starting' })
  })
}

// Graceful shutdown (グレースフルシャットダウン)
process.on('SIGINT', () => {
  console.log('\nShutting down service...')
  stopRealtimeSync()
  closeDBs()
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('\nShutting down service...')
  stopRealtimeSync()
  closeDBs()
  process.exit(0)
})

// Start (起動)
startServer().catch(console.error)
