/**
 * dbSync Server API Connector
 * Unified wrapper for all API interactions with dbSync/server
 */

import { getDbApiBaseUrl } from './portManager'

// API base URL (dynamically fetched)
let API_BASE_URL: string | null = null

/**
 * Get API base URL
 */
async function getApiBaseUrl(): Promise<string> {
  if (!API_BASE_URL) {
    API_BASE_URL = await getDbApiBaseUrl()
    console.log('dbConnector: API_BASE_URL =', API_BASE_URL)
  }
  return API_BASE_URL
}

// ============ Type Definitions ============

export interface Creator {
  username: string
  wallet_address: string
  avatar_cid: string | null
  background_cid: string | null
  ipns_address: string | null
  title: string | null
  description: string | null
  work_count: number
  registered_at: number
  updated_at: number
}

export interface Work {
  cid: string
  creator_username: string
  title: string
  description: string | null
  content_type: number
  img_cid: string | null
  created_at: string
}

export interface WalletTransaction {
  id: number
  wallet_address: string
  token_address: string
  amount: string
  gas_fee: string
  contract_method: string
  is_outgoing: number
  counterparty_address: string | null
  tx_hash: string
  timestamp: number
  source: string
}

export interface PaginatedTransactions {
  transactions: WalletTransaction[]
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

// ============ Network Switch API ============

export interface DbSyncNetworkConfig {
  networkId: string
  rpcUrl: string
  chainId: number
  contractAddress: string
  adsAddress?: string
  deployBlock: number
}

/**
 * Notify dbSync server to switch to a new network.
 * Called by rpcConnector when the user switches networks.
 */
export async function notifyDbSyncNetworkSwitch(config: DbSyncNetworkConfig): Promise<void> {
  const base = await getApiBaseUrl()
  const response = await fetch(`${base}/network/switch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
  if (!response.ok) {
    throw new Error(`dbSync network switch failed: ${response.status}`)
  }
}

// ============ Creator API ============

/**
 * Query creator information by wallet address
 */
export async function getCreatorByWallet(
  address: string,
): Promise<Creator | null> {
  try {
    const baseUrl = await getApiBaseUrl()
    const response = await fetch(`${baseUrl}/creators/wallet/${address}`)

    // 404 is normal (wallet not registered as creator), no error needed
    if (response.status === 404) {
      return null
    }

    if (!response.ok) {
      console.error(
        `Failed to get creator by wallet: ${response.status} ${response.statusText}`,
      )
      return null
    }

    const result = await response.json()
    return result.success ? result.data : null
  } catch (error) {
    console.error('Failed to get creator by wallet:', error)
    return null
  }
}

/**
 * Query creator information by username
 */
export async function getCreatorByUsername(
  username: string,
): Promise<Creator | null> {
  try {
    const baseUrl = await getApiBaseUrl()
    const response = await fetch(`${baseUrl}/creators/${username}`)
    const result = await response.json()
    return result.success ? result.data : null
  } catch (error) {
    console.error('Failed to get creator by username:', error)
    return null
  }
}

// ============ Wallet Transaction API ============

/**
 * Track wallet (add to tracking list for recording incoming transactions)
 */
export async function importWallet(address: string): Promise<{
  success: boolean
  error?: string
}> {
  try {
    const baseUrl = await getApiBaseUrl()
    const response = await fetch(`${baseUrl}/wallet/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress: address }),
    })
    const result = await response.json()
    return result
  } catch (error) {
    console.error('Failed to track wallet:', error)
    return { success: false, error: String(error) }
  }
}

/**
 * Untrack wallet (remove from tracking list, but keep transaction records)
 */
export async function removeWallet(address: string): Promise<{
  success: boolean
  error?: string
}> {
  try {
    const baseUrl = await getApiBaseUrl()
    const response = await fetch(`${baseUrl}/wallet/${address}`, {
      method: 'DELETE',
    })
    const result = await response.json()
    return result
  } catch (error) {
    console.error('Failed to untrack wallet:', error)
    return { success: false, error: String(error) }
  }
}

/**
 * Add transaction record (called by WalletSelectorModal)
 */
export async function addTransaction(
  params: AddTransactionParams,
): Promise<{ success: boolean; error?: string }> {
  try {
    const baseUrl = await getApiBaseUrl()
    const response = await fetch(`${baseUrl}/transaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    const result = await response.json()
    return result
  } catch (error) {
    console.error('Failed to add transaction:', error)
    return { success: false, error: String(error) }
  }
}

/**
 * Get wallet transaction records (paginated)
 */
export async function getWalletTransactions(
  address: string,
  page: number = 1,
  pageSize: number = 20,
): Promise<PaginatedTransactions | null> {
  try {
    const baseUrl = await getApiBaseUrl()
    const response = await fetch(
      `${baseUrl}/wallet/${address}/transactions?page=${page}&pageSize=${pageSize}`,
    )
    const result = await response.json()
    return result.success ? result.data : null
  } catch (error) {
    console.error('Failed to get wallet transactions:', error)
    return null
  }
}

// ============ Search API ============

/**
 * Search creators
 */
export async function searchCreators(
  keyword: string,
  limit: number = 60,
): Promise<Creator[]> {
  try {
    const baseUrl = await getApiBaseUrl()
    const response = await fetch(
      `${baseUrl}/creators/search/${encodeURIComponent(keyword)}?limit=${limit}`,
    )
    if (!response.ok) {
      return []
    }
    const result = await response.json()
    return result.success ? result.data : []
  } catch (error) {
    console.error('Failed to search creators:', error)
    return []
  }
}

/**
 * Search works
 */
export async function searchWorks(
  keyword: string,
  limit: number = 60,
): Promise<Work[]> {
  try {
    const baseUrl = await getApiBaseUrl()
    const response = await fetch(
      `${baseUrl}/works/search/${encodeURIComponent(keyword)}?limit=${limit}`,
    )
    if (!response.ok) {
      return []
    }
    const result = await response.json()
    return result.success ? result.data : []
  } catch (error) {
    console.error('Failed to search works:', error)
    return []
  }
}

/**
 * Get works list by creator
 */
export async function getWorksByCreator(
  username: string,
  page: number = 1,
  pageSize: number = 20,
): Promise<Work[]> {
  try {
    const baseUrl = await getApiBaseUrl()
    const response = await fetch(
      `${baseUrl}/works/creator/${username}?page=${page}&pageSize=${pageSize}`,
    )
    if (!response.ok) {
      return []
    }
    const result = await response.json()
    return result.success ? result.data : []
  } catch (error) {
    console.error('Failed to get works by creator:', error)
    return []
  }
}

/**
 * Batch query works from multiple creators (sorted by time descending, paginated)
 */
export async function getWorksByCreators(
  usernames: string[],
  page: number = 1,
  pageSize: number = 20,
): Promise<Work[]> {
  if (usernames.length === 0) return []
  try {
    const baseUrl = await getApiBaseUrl()
    const response = await fetch(`${baseUrl}/works/creators`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames, page, pageSize }),
    })
    if (!response.ok) return []
    const result = await response.json()
    return result.success ? result.data : []
  } catch (error) {
    console.error('Failed to get works by creators:', error)
    return []
  }
}

// ============ Work Details API ============

export interface WorkDetail extends Work {
  creator_avatar?: string | null
  creator_wallet?: string | null
}

export interface WorkTipStat {
  token_address: string
  total_amount: string
  tip_count: number
}

/**
 * Query work details by CID
 */
export async function getWorkByCid(cid: string): Promise<WorkDetail | null> {
  try {
    const baseUrl = await getApiBaseUrl()
    const response = await fetch(
      `${baseUrl}/works/cid/${encodeURIComponent(cid)}`,
    )
    if (response.status === 404) return null
    if (!response.ok) return null
    const result = await response.json()
    return result.success ? result.data : null
  } catch (error) {
    console.error('Failed to get work by cid:', error)
    return null
  }
}

/**
 * Query tip statistics for a work by different tokens
 */
export async function getWorkTipStats(cid: string): Promise<WorkTipStat[]> {
  try {
    const baseUrl = await getApiBaseUrl()
    const response = await fetch(
      `${baseUrl}/works/cid/${encodeURIComponent(cid)}/tip-stats`,
    )
    if (!response.ok) return []
    const result = await response.json()
    return result.success ? result.data : []
  } catch (error) {
    console.error('Failed to get work tip stats:', error)
    return []
  }
}

// ============ Tip Records API ============

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
 * Query tip records for a work with pagination
 */
export async function getTipsByWork(cid: string, limit: number = 20, offset: number = 0): Promise<TipRecord[]> {
  try {
    const baseUrl = await getApiBaseUrl()
    const response = await fetch(
      `${baseUrl}/tips/work/${encodeURIComponent(cid)}?limit=${limit}&offset=${offset}`,
    )
    if (!response.ok) return []
    const result = await response.json()
    return result.success ? result.data : []
  } catch (error) {
    console.error('Failed to get tips by work:', error)
    return []
  }
}

/**
 * Query replies to a specific tip comment
 */
export async function getRepliesByTip(txHash: string): Promise<TipRecord[]> {
  try {
    const baseUrl = await getApiBaseUrl()
    const response = await fetch(`${baseUrl}/tips/${encodeURIComponent(txHash)}/replies`)
    if (!response.ok) return []
    const result = await response.json()
    return result.success ? result.data : []
  } catch (error) {
    console.error('Failed to get replies by tip:', error)
    return []
  }
}

/**
 * Query all tip records received by a creator (sorted by time descending)
 */
export async function getTipsByCreator(
  creatorAddress: string,
  limit: number = 200,
): Promise<TipRecord[]> {
  try {
    const baseUrl = await getApiBaseUrl()
    const response = await fetch(
      `${baseUrl}/tips/creator/${encodeURIComponent(creatorAddress)}?limit=${limit}`,
    )
    if (!response.ok) return []
    const result = await response.json()
    return result.success ? result.data : []
  } catch (error) {
    console.error('Failed to get tips by creator:', error)
    return []
  }
}


// ============ Jackpot API ============

export interface JackpotData {
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

export interface JackpotDetail extends JackpotData {
  leader_username: string | null
  leader_avatar_cid: string | null
  leader_ipns_address: string | null
  leader_work_title: string | null
  leader_work_tips: string | null
}

/**
 * Get all current jackpot data
 */
export async function getCurrentJackpots(): Promise<JackpotData[]> {
  try {
    const baseUrl = await getApiBaseUrl()
    const response = await fetch(`${baseUrl}/jackpots`)
    if (!response.ok) return []
    const result = await response.json()
    return result.success ? result.data : []
  } catch (error) {
    console.error('Failed to get jackpots:', error)
    return []
  }
}

/**
 * Get jackpot details (including leader creator info and work info)
 */
export async function getJackpotDetails(): Promise<JackpotDetail[]> {
  try {
    const baseUrl = await getApiBaseUrl()
    const response = await fetch(`${baseUrl}/jackpots/detail`)
    if (!response.ok) return []
    const result = await response.json()
    return result.success ? result.data : []
  } catch (error) {
    console.error('Failed to get jackpot details:', error)
    return []
  }
}

/**
 * Get recent tip records (global)
 */
export async function getRecentTips(limit: number = 20): Promise<TipRecord[]> {
  try {
    const baseUrl = await getApiBaseUrl()
    const response = await fetch(`${baseUrl}/tips/recent?limit=${limit}`)
    if (!response.ok) return []
    const result = await response.json()
    return result.success ? result.data : []
  } catch (error) {
    console.error('Failed to get recent tips:', error)
    return []
  }
}

// ============ Service Status API ============

/**
 * Query dbSync service status
 */
export async function getServiceStatus(): Promise<ServiceStatus | null> {
  try {
    const baseUrl = await getApiBaseUrl()
    const response = await fetch(`${baseUrl}/sync/service-status`)
    if (!response.ok) return null
    const result = await response.json()
    return result.success ? result.data : null
  } catch {
    return null
  }
}
