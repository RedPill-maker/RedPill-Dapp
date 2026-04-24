/**
 * Transaction History API
 *
 * Records wallet transaction history from two sources:
 * 1. Outgoing transactions: Recorded by WalletSelectorModal when user initiates transactions
 * 2. Incoming transactions: Extracted from contract events (tips received, withdrawals, etc.)
 *
 * Note: This database only stores transaction history, no private keys or sensitive data
 */
import { DatabaseSync } from 'node:sqlite'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { decodeEventLog, type Abi } from 'viem'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Database path configuration - supports environment variable, with network subdirectory
let currentNetworkId = 'calibration'

function getTxDbPath(): string {
  const base = process.env.DB_DATA_PATH || path.resolve(__dirname, '../data')
  return path.join(base, currentNetworkId, 'txhistory2.db')
}

/**
 * Set the active network, which switches the transaction database.
 */
export function setTxApiNetwork(networkId: string): void {
  currentNetworkId = networkId
}

// Active contract addresses for event filtering - updated by setTxApiNetwork indirectly
// via the network config passed from server.ts
let activeCreatorHubAddress = ''
let activeAdsAddress = ''

/**
 * Update the contract addresses used for event filtering.
 * Called alongside setTxApiNetwork when the network switches.
 */
export function setTxContractAddresses(creatorHub: string, ads: string): void {
  activeCreatorHubAddress = creatorHub.toLowerCase()
  activeAdsAddress = ads.toLowerCase()
}

// Load contract ABI
const creatorHubAbiPath = path.resolve(
  __dirname,
  '../contract_info/CreatorHub_abi.json',
)
const creatorHubAbi: Abi = JSON.parse(
  fs.readFileSync(creatorHubAbiPath, 'utf-8'),
)

// ============ Interface Definitions ============

export interface TransactionRecord {
  id: number
  wallet_address: string
  token_address: string
  amount: string
  gas_fee: string
  contract_method: string
  is_outgoing: number // 1=outgoing, 0=incoming
  counterparty_address: string | null
  tx_hash: string
  timestamp: number
  source: string // 'app' | 'blockchain'
}

export interface PaginatedTransactions {
  transactions: TransactionRecord[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface AddTransactionParams {
  wallet_address: string
  token_address: string
  amount: string
  gas_fee: string
  contract_method: string
  is_outgoing: number
  counterparty_address?: string
  tx_hash: string
  timestamp: number
  source: 'app' | 'blockchain'
}

// ============ Database Initialization ============

function initTxHistoryDb(): DatabaseSync {
  // Ensure data directory exists
  const txDbPath = getTxDbPath()
  const dir = path.dirname(txDbPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const db = new DatabaseSync(txDbPath)

  db.exec(`
    -- Tracked wallets table (lightweight tracking)
    CREATE TABLE IF NOT EXISTS tracked_wallets (
      wallet_address TEXT PRIMARY KEY,
      tracked_at INTEGER NOT NULL
    );

    -- Transaction history table
    CREATE TABLE IF NOT EXISTS transaction_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet_address TEXT NOT NULL,
      token_address TEXT NOT NULL,
      amount TEXT NOT NULL,
      gas_fee TEXT NOT NULL,
      contract_method TEXT NOT NULL,
      is_outgoing INTEGER NOT NULL,
      counterparty_address TEXT,
      tx_hash TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      source TEXT NOT NULL,
      UNIQUE(tx_hash, wallet_address, is_outgoing)
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_tx_wallet ON transaction_records(wallet_address);
    CREATE INDEX IF NOT EXISTS idx_tx_timestamp ON transaction_records(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_tx_hash ON transaction_records(tx_hash);
  `)

  return db
}

// ============ Wallet Tracking ============

/**
 * Track a wallet address (add to tracked_wallets table)
 */
export function trackWallet(walletAddress: string): {
  success: boolean
  error?: string
} {
  const normalizedAddress = walletAddress.toLowerCase()
  const db = initTxHistoryDb()

  try {
    const now = Math.floor(Date.now() / 1000)
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO tracked_wallets (wallet_address, tracked_at)
      VALUES (?, ?)
    `)
    stmt.run(normalizedAddress, now)
    db.close()
    return { success: true }
  } catch (error: any) {
    db.close()
    return { success: false, error: String(error) }
  }
}

/**
 * Untrack a wallet address (remove from tracked_wallets table)
 * Note: Transaction records are preserved
 */
export function untrackWallet(walletAddress: string): {
  success: boolean
  error?: string
} {
  const normalizedAddress = walletAddress.toLowerCase()
  const db = initTxHistoryDb()

  try {
    const stmt = db.prepare('DELETE FROM tracked_wallets WHERE wallet_address = ?')
    stmt.run(normalizedAddress)
    db.close()
    return { success: true }
  } catch (error: any) {
    db.close()
    return { success: false, error: String(error) }
  }
}

/**
 * Get all tracked wallet addresses
 */
export function getTrackedWallets(): string[] {
  if (!fs.existsSync(getTxDbPath())) {
    return []
  }

  const db = new DatabaseSync(getTxDbPath(), { readOnly: true })

  try {
    const stmt = db.prepare('SELECT wallet_address FROM tracked_wallets')
    const results = stmt.all() as { wallet_address: string }[]
    db.close()
    return results.map((r) => r.wallet_address)
  } catch (error) {
    db.close()
    return []
  }
}

// ============ Add Transaction from App ============

/**
 * Add transaction record from app (called by WalletSelectorModal)
 * Also automatically tracks the wallet if not already tracked
 */
export function addTransactionFromApp(
  params: AddTransactionParams,
): { success: boolean; error?: string } {
  const db = initTxHistoryDb()

  try {
    db.exec('BEGIN TRANSACTION')

    // Automatically track the wallet
    const now = Math.floor(Date.now() / 1000)
    const trackStmt = db.prepare(`
      INSERT OR IGNORE INTO tracked_wallets (wallet_address, tracked_at)
      VALUES (?, ?)
    `)
    trackStmt.run(params.wallet_address.toLowerCase(), now)

    // Insert transaction record
    const txStmt = db.prepare(`
      INSERT INTO transaction_records 
      (wallet_address, token_address, amount, gas_fee, contract_method, is_outgoing, counterparty_address, tx_hash, timestamp, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    txStmt.run(
      params.wallet_address.toLowerCase(),
      params.token_address.toLowerCase(),
      params.amount,
      params.gas_fee,
      params.contract_method,
      params.is_outgoing,
      params.counterparty_address?.toLowerCase() || null,
      params.tx_hash,
      params.timestamp,
      params.source,
    )

    db.exec('COMMIT')
    db.close()
    return { success: true }
  } catch (error: any) {
    try {
      db.exec('ROLLBACK')
    } catch {}
    db.close()
    // Ignore duplicate errors (UNIQUE constraint)
    if (error.message?.includes('UNIQUE constraint')) {
      return { success: true }
    }
    return { success: false, error: String(error) }
  }
}

// ============ Extract Wallet Transactions from Event Logs ============

// ============ Extract Wallet Transactions from Event Logs ============

interface RawEvent {
  topics: string[]
  data: string
  blockNumber: number
  transactionHash: string
  logIndex: number
  address: string
}

interface ExtractedTransaction {
  wallet_address: string
  token_address: string
  amount: string
  contract_method: string
  is_outgoing: number
  counterparty_address: string | null
  tx_hash: string
  timestamp: number
}

/**
 * Convert wei to FIL (divide by 10^18)
 */
function weiToFil(weiAmount: bigint | string): string {
  const wei = typeof weiAmount === 'string' ? BigInt(weiAmount) : weiAmount
  // Convert to FIL with 6 decimal places precision
  const fil = Number(wei) / 1e18
  return fil.toFixed(6)
}

/**
 * Extract incoming transactions for tracked wallets from event logs
 * Only extracts incoming transactions (is_outgoing = 0)
 * Outgoing transactions are recorded by WalletSelectorModal
 */
export function extractWalletTransactions(
  events: RawEvent[],
  walletAddresses: string[],
): { transactions: ExtractedTransaction[]; filteredEvents: RawEvent[] } {
  const normalizedWallets = walletAddresses.map((addr) => addr.toLowerCase())
  const transactions: ExtractedTransaction[] = []
  const filteredEvents: RawEvent[] = []

  for (const event of events) {
    const contractAddress = event.address.toLowerCase()

    // Only process CreatorHub contract events for core.db and peripheral.db
    if (contractAddress === activeCreatorHubAddress) {
      filteredEvents.push(event)
    }

    // Decode event
    let decoded: any
    try {
      let abi: Abi = creatorHubAbi
      if (contractAddress === activeAdsAddress) {
        // If there is ads contract ABI, load it here
        abi = creatorHubAbi
      }

      decoded = decodeEventLog({
        abi,
        data: event.data as `0x${string}`,
        topics: event.topics as [`0x${string}`, ...`0x${string}`[]],
      })
    } catch {
      continue // Decoding failed, skip
    }

    const eventName = String(decoded.eventName)
    const args = decoded.args as Record<string, any>
    const timestamp = args.timestamp
      ? Number(args.timestamp)
      : Math.floor(Date.now() / 1000)

    // Extract INCOMING transactions only
    switch (eventName) {
      case 'Tipped': {
        // Creator receives tip (incoming)
        const creator = (args.creator as string).toLowerCase()
        const token = (args.token as string).toLowerCase()
        const tipper = (args.tipper as string).toLowerCase()

        if (normalizedWallets.includes(creator)) {
          transactions.push({
            wallet_address: creator,
            token_address: token,
            amount: weiToFil(args.creatorShare),
            contract_method: 'tipWork',
            is_outgoing: 0,
            counterparty_address: tipper,
            tx_hash: event.transactionHash,
            timestamp,
          })
        }
        break
      }

      case 'Withdrawn': {
        // User withdraws from contract balance (incoming to wallet)
        const user = (args.user as string).toLowerCase()
        if (normalizedWallets.includes(user)) {
          transactions.push({
            wallet_address: user,
            token_address: (args.token as string).toLowerCase(),
            amount: weiToFil(args.amount),
            contract_method: 'withdraw',
            is_outgoing: 0,
            counterparty_address: null,
            tx_hash: event.transactionHash,
            timestamp,
          })
        }
        break
      }

      case 'OfferAccepted': {
        // Old owner receives payment (incoming)
        const oldOwner = (args.oldOwner as string).toLowerCase()
        const newOwner = (args.newOwner as string).toLowerCase()

        if (normalizedWallets.includes(oldOwner)) {
          transactions.push({
            wallet_address: oldOwner,
            token_address: '0x0000000000000000000000000000000000000000',
            amount: weiToFil(args.amount),
            contract_method: 'acceptOffer',
            is_outgoing: 0,
            counterparty_address: newOwner,
            tx_hash: event.transactionHash,
            timestamp,
          })
        }
        break
      }

      case 'WorkTransferred': {
        // Receiver gets work (incoming, no token transfer but record the event)
        const toAddress = (args.toAddress as string).toLowerCase()
        const fromAddress = (args.fromAddress as string).toLowerCase()

        if (normalizedWallets.includes(toAddress)) {
          transactions.push({
            wallet_address: toAddress,
            token_address: '0x0000000000000000000000000000000000000000',
            amount: '0',
            contract_method: 'transferWork',
            is_outgoing: 0,
            counterparty_address: fromAddress,
            tx_hash: event.transactionHash,
            timestamp,
          })
        }
        break
      }
    }
  }

  return { transactions, filteredEvents }
}

/**
 * Batch write extracted transaction records to txhistory.db
 */
export function writeWalletTransactions(transactions: ExtractedTransaction[]): {
  success: boolean
  count: number
  error?: string
} {
  if (transactions.length === 0) {
    return { success: true, count: 0 }
  }

  const db = initTxHistoryDb()

  try {
    db.exec('BEGIN TRANSACTION')

    const stmt = db.prepare(`
      INSERT OR IGNORE INTO transaction_records 
      (wallet_address, token_address, amount, gas_fee, contract_method, is_outgoing, counterparty_address, tx_hash, timestamp, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    for (const tx of transactions) {
      stmt.run(
        tx.wallet_address.toLowerCase(),
        tx.token_address.toLowerCase(),
        tx.amount,
        '0', // Incoming transactions have no gas fee
        tx.contract_method,
        tx.is_outgoing,
        tx.counterparty_address?.toLowerCase() || null,
        tx.tx_hash,
        tx.timestamp,
        'blockchain',
      )
    }

    db.exec('COMMIT')
    db.close()

    return { success: true, count: transactions.length }
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {}
    db.close()
    return { success: false, count: 0, error: String(error) }
  }
}

// ============ Query Wallet Transaction Records ============

/**
 * Get wallet transaction records (paginated, sorted by timestamp descending)
 */
export function getWalletTransactions(
  walletAddress: string,
  page: number = 1,
  pageSize: number = 20,
): PaginatedTransactions {
  const normalizedAddress = walletAddress.toLowerCase()

  if (!fs.existsSync(getTxDbPath())) {
    return {
      transactions: [],
      total: 0,
      page,
      pageSize,
      totalPages: 0,
    }
  }

  const db = new DatabaseSync(getTxDbPath(), { readOnly: true })

  try {
    // Query total count
    const countStmt = db.prepare(
      'SELECT COUNT(*) as total FROM transaction_records WHERE wallet_address = ?',
    )
    const countResult = countStmt.get(normalizedAddress) as { total: number }
    const total = countResult.total

    if (total === 0) {
      db.close()
      return {
        transactions: [],
        total: 0,
        page,
        pageSize,
        totalPages: 0,
      }
    }

    // Query paginated data
    const offset = (page - 1) * pageSize
    const stmt = db.prepare(`
      SELECT * FROM transaction_records 
      WHERE wallet_address = ? 
      ORDER BY timestamp DESC, is_outgoing DESC
      LIMIT ? OFFSET ?
    `)
    const transactions = stmt.all(
      normalizedAddress,
      pageSize,
      offset,
    ) as TransactionRecord[]

    db.close()

    return {
      transactions,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    }
  } catch (error) {
    db.close()
    throw error
  }
}
