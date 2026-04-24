/**
 * Sync contract event historical data (契約イベント履歴データを同期)
 * Uses Filecoin RPC eth_getLogs interface to fetch events in batches
 */
import { createPublicClient, http, type Log } from 'viem'
import { filecoinCalibration } from 'viem/chains'
import {
  writeEventsToDB,
  getCurrentSyncState,
  getContractDeployBlock,
  resetSyncState,
  setNetworkConfig,
  type BlockRange,
} from './eventToDB.js'
import {
  extractWalletTransactions,
  writeWalletTransactions,
  getTrackedWallets,
} from './transactionAPI.js'
import { fetchEventsFromIPFS, getAllEventData, type IpfsProgressCallback } from './ipfsEventFetcher.js'
import { IPFS_CONFIG } from '../config.js'

export type { IpfsProgressCallback }

// ============ Configuration Constants ============

// Contract deployment block (updated when network config is applied)
let CONTRACT_DEPLOY_BLOCK = getContractDeployBlock()

// Maximum block range per query
const MAX_BLOCK_RANGE = 2000

// Interval between RPC calls (milliseconds)
const RPC_CALL_INTERVAL = 5000

// Active viem client - replaced when network switches
let client = createPublicClient({
  chain: filecoinCalibration,
  transport: http(),
})

// Active contract addresses - updated by applySyncNetworkConfig
let activeCreatorHubAddress = ''
let activeAdsAddress = ''

// ============ Network Configuration ============

export interface SyncNetworkConfig {
  networkId: string
  rpcUrl: string
  chainId: number
  contractAddress: string   // creator_hub
  adsAddress?: string       // ads contract (optional, for log filtering)
  deployBlock: number
}

/**
 * Apply network configuration to syncHistory and propagate to eventToDB.
 * Must be called before any sync operations.
 */
export function applySyncNetworkConfig(config: SyncNetworkConfig): void {
  CONTRACT_DEPLOY_BLOCK = config.deployBlock
  activeCreatorHubAddress = config.contractAddress.toLowerCase()
  activeAdsAddress = (config.adsAddress ?? '').toLowerCase()

  // Rebuild viem client with the provided RPC URL (no hardcoded chain needed)
  client = createPublicClient({
    chain: { ...filecoinCalibration, id: config.chainId as any },
    transport: http(config.rpcUrl),
  })

  // Propagate to eventToDB
  setNetworkConfig({
    networkId: config.networkId,
    contractAddress: config.contractAddress,
    chainId: config.chainId,
    deployBlock: config.deployBlock,
  })

  console.log(`Sync network configured: ${config.networkId}, RPC: ${config.rpcUrl}, contract: ${config.contractAddress}`)
}

// ============ Utility Functions (ユーティリティ関数) ============

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Convert viem Log to RawEvent format (viem LogをRawEvent形式に変換)
interface RawEvent {
  topics: string[]
  data: string
  blockNumber: number
  transactionHash: string
  logIndex: number
  address: string
}

function logToRawEvent(log: Log): RawEvent {
  return {
    topics: log.topics as string[],
    data: log.data,
    blockNumber: Number(log.blockNumber),
    transactionHash: log.transactionHash || '',
    logIndex: Number(log.logIndex),
    address: log.address,
  }
}

// ============ Sync State (同期状態) ============

export interface SyncProgress {
  currentBlock: number
  targetBlock: number
  progress: number
  isComplete: boolean
}

export type SyncCompleteCallback = () => void
export type SyncProgressCallback = (progress: SyncProgress) => void
export type SyncStatusMessageCallback = (message: string) => void

// ============ Core Sync Logic (コア同期ロジック) ============

function getStartBlock(): number {
  const state = getCurrentSyncState()
  if (state.core && state.core.last_synced_block >= CONTRACT_DEPLOY_BLOCK) {
    return state.core.last_synced_block + 1
  }
  
  // If last_synced_block in database < deploy_block, indicates database corruption (データベース内のlast_synced_block < deploy_blockの場合、データベース破損を示す)
  if (state.core && state.core.last_synced_block < CONTRACT_DEPLOY_BLOCK) {
    console.error(
      `Database state anomaly: last_synced_block=${state.core.last_synced_block} < deploy_block=${CONTRACT_DEPLOY_BLOCK}`
    )
    console.log('Resetting database sync state to contract deployment block')
    // Reset sync state (同期状態をリセット)
    resetSyncState()
  }
  
  return CONTRACT_DEPLOY_BLOCK
}

async function syncBlockRange(
  fromBlock: number,
  toBlock: number,
): Promise<{
  success: boolean
  eventsCount: number
  walletTxCount: number
  error?: string
}> {
  try {
    const addresses: `0x${string}`[] = [activeCreatorHubAddress as `0x${string}`]
    if (activeAdsAddress) addresses.push(activeAdsAddress as `0x${string}`)

    const logs = await client.getLogs({
      address: addresses,
      fromBlock: BigInt(fromBlock),
      toBlock: BigInt(toBlock),
    })

    const events = logs.map(logToRawEvent)

    // 1. Extract wallet transaction data (for tracked wallets)
    const trackedWallets = getTrackedWallets()
    let walletTxCount = 0

    if (trackedWallets.length > 0) {
      const { transactions, filteredEvents } = extractWalletTransactions(
        events,
        trackedWallets,
      )

      if (transactions.length > 0) {
        const walletResult = writeWalletTransactions(transactions)
        if (walletResult.success) {
          walletTxCount = walletResult.count
        }
      }

      // 2. Only pass CreatorHub contract events to eventToDB
      const creatorHubEvents = filteredEvents.filter(
        (e) => e.address.toLowerCase() === activeCreatorHubAddress,
      )

      const range: BlockRange = { fromBlock, toBlock }
      const result = writeEventsToDB(creatorHubEvents, range)

      if (!result.success) {
        return {
          success: false,
          eventsCount: 0,
          walletTxCount,
          error: result.error,
        }
      }
      return {
        success: true,
        eventsCount: result.processedCount,
        walletTxCount,
      }
    } else {
      // No tracked wallets, directly filter CreatorHub events
      const creatorHubEvents = events.filter(
        (e) => e.address.toLowerCase() === activeCreatorHubAddress,
      )

      const range: BlockRange = { fromBlock, toBlock }
      const result = writeEventsToDB(creatorHubEvents, range)

      if (!result.success) {
        return {
          success: false,
          eventsCount: 0,
          walletTxCount: 0,
          error: result.error,
        }
      }
      return {
        success: true,
        eventsCount: result.processedCount,
        walletTxCount: 0,
      }
    }
  } catch (error) {
    return {
      success: false,
      eventsCount: 0,
      walletTxCount: 0,
      error: String(error),
    }
  }
}

/**
 * Fetch event data from IPFS and write to database (IPFSからイベントデータを取得してデータベースに書き込み)
 * Used when RPC cannot fetch historical data due to time wall limitation
 */
async function syncFromIPFS(
  fromBlock: number,
  targetBlock: number,
  onProgress?: SyncProgressCallback,
  onIpfsProgress?: IpfsProgressCallback,
): Promise<{
  success: boolean
  eventsCount: number
  nextBlock: number
  error?: string
}> {
  try {
    let totalProcessed = 0
    let lastWrittenBlock = fromBlock - 1
    let writeError: string | undefined

    // Use callback mode: immediately write to database in order after each file download completes (コールバックモードを使用：各ファイルダウンロード完了後、順次データベースに即座に書き込み)
    const ipfsResult = await fetchEventsFromIPFS(fromBlock, (events, coveredRange) => {
      // Only keep CreatorHub contract events (CreatorHub契約のイベントのみを保持)
      const creatorHubEvents = events.filter(
        (e) => e.address && e.address.toLowerCase() === activeCreatorHubAddress,
      )

      // Write to database in batches (バッチでデータベースに書き込み)
      let currentFrom = coveredRange.fromBlock
      while (currentFrom <= coveredRange.toBlock) {
        const currentTo = Math.min(currentFrom + MAX_BLOCK_RANGE - 1, coveredRange.toBlock)
        const batchEvents = creatorHubEvents.filter(
          (e) => e.blockNumber >= currentFrom && e.blockNumber <= currentTo,
        )

        const range: BlockRange = { fromBlock: currentFrom, toBlock: currentTo }
        const result = writeEventsToDB(batchEvents, range)

        if (!result.success) {
          writeError = result.error
          return false // Stop processing (処理を停止)
        }

        totalProcessed += result.processedCount
        lastWrittenBlock = currentTo

        if (onProgress) {
          const progress = targetBlock === fromBlock
            ? 100
            : Math.floor(((currentTo - fromBlock) / (targetBlock - fromBlock)) * 100)
          onProgress({ currentBlock: currentTo, targetBlock, progress, isComplete: false })
        }

        currentFrom = currentTo + 1
      }

      return true // Continue processing next file (次のファイルの処理を続行)
    }, onIpfsProgress)

    if (writeError) {
      // Check if it's a database schema error or other database error (データベーススキーマエラーまたは他のデータベースエラーかチェック)
      if (writeError.includes('has no column named') || 
          writeError.includes('no such column') ||
          writeError.includes('no such table') ||
          writeError.includes('Block discontinuous')) {
        return { 
          success: false, 
          eventsCount: totalProcessed, 
          nextBlock: lastWrittenBlock + 1, 
          error: `Server data error: ${writeError}` 
        }
      }
      return { success: false, eventsCount: totalProcessed, nextBlock: lastWrittenBlock + 1, error: writeError }
    }

    if (!ipfsResult.success && ipfsResult.processedChunks === 0) {
      return { success: false, eventsCount: 0, nextBlock: fromBlock, error: ipfsResult.error }
    }

    // If coveredEndBlock didn't advance past fromBlock, treat as failure so outer retry kicks in
    if (ipfsResult.coveredEndBlock < fromBlock) {
      return {
        success: false,
        eventsCount: totalProcessed,
        nextBlock: fromBlock,
        error: ipfsResult.error || 'IPFS data verification produced no usable blocks',
      }
    }

    // Even if partially failed, successfully processed data is still valid (部分的に失敗しても、成功処理済みデータは有効)
    const nextBlock = ipfsResult.coveredEndBlock + 1
    return {
      success: ipfsResult.success,
      eventsCount: totalProcessed,
      nextBlock,
      error: ipfsResult.error,
    }
  } catch (err: any) {
    return { success: false, eventsCount: 0, nextBlock: fromBlock, error: err.message || String(err) }
  }
}

export async function syncHistory(
  onComplete?: SyncCompleteCallback,
  onProgress?: SyncProgressCallback,
  onIpfsProgress?: IpfsProgressCallback,
  onStatusMessage?: SyncStatusMessageCallback,
): Promise<void> {
  const startBlock = getStartBlock()

  onStatusMessage?.('Fetching current block from RPC...')
  const currentBlockNumber = await client.getBlockNumber()
  const targetBlock = Number(currentBlockNumber)

  console.log(`=== Starting Event Data Sync ===`)
  console.log(`Contract address: ${activeCreatorHubAddress}`)
  console.log(`Start block: ${startBlock}`)
  console.log(`Target block: ${targetBlock}`)
  console.log(`Block range: ${targetBlock - startBlock + 1}`)
  console.log(`Blocks per batch: ${MAX_BLOCK_RANGE}`)
  console.log(`Call interval: ${RPC_CALL_INTERVAL}ms`)
  console.log('========================')

  if (startBlock > targetBlock) {
    console.log(`Already synced to latest block ${targetBlock}, no sync needed`)
    onComplete?.()
    return
  }

  let currentBlock = startBlock
  let totalEvents = 0
  let totalWalletTx = 0
  let batchCount = 0
  let consecutiveFailures = 0
  let ipfsAttempted = false // Mark whether it has been tried IPFS

  while (currentBlock <= targetBlock) {
    const endBlock = Math.min(currentBlock + MAX_BLOCK_RANGE - 1, targetBlock)
    batchCount++

    const result = await syncBlockRange(currentBlock, endBlock)

    if (result.success) {
      totalEvents += result.eventsCount
      totalWalletTx += result.walletTxCount
      consecutiveFailures = 0
      ipfsAttempted = false // Reset IPFS tring mark
      const progress =
        targetBlock === startBlock
          ? 100
          : Math.floor(
              ((endBlock - startBlock) / (targetBlock - startBlock)) * 100,
            )
      const walletInfo =
        result.walletTxCount > 0 ? `, ${result.walletTxCount} wallet transactions` : ''
      console.log(
        `[${batchCount}] block ${currentBlock}-${endBlock}: ${result.eventsCount} events${walletInfo} (${progress}%)`,
      )
      onProgress?.({
        currentBlock: endBlock,
        targetBlock,
        progress,
        isComplete: false,
      })
    } else {
      consecutiveFailures++
      console.error(
        `[${batchCount}] block ${currentBlock}-${endBlock} sync failed: ${result.error}`,
      )
      if (consecutiveFailures === 1) {
        onStatusMessage?.(`RPC sync failed, retrying... (${result.error?.slice(0, 60)})`)
      }

      // RPC consecutive failures 2 times and IPFS not attempted, switch to IPFS to fetch historical data (RPC連続失敗2回でIPFS未試行、IPFSに切り替えて履歴データを取得)
      if (consecutiveFailures >= 2 && !ipfsAttempted) {
        console.log('RPC consecutive failures, switching to IPFS to fetch historical event data...')
        ipfsAttempted = true
        onStatusMessage?.('RPC unavailable, switching to IPFS archive data...')

        let ipfsSuccess = false
        for (let outerRound = 1; outerRound <= IPFS_CONFIG.MAX_OUTER_RETRY_ROUNDS; outerRound++) {
          if (outerRound > 1) {
            console.log(`IPFS outer retry round ${outerRound}/${IPFS_CONFIG.MAX_OUTER_RETRY_ROUNDS}: re-fetching contract event CIDs...`)
            onStatusMessage?.(`IPFS retry round ${outerRound}/${IPFS_CONFIG.MAX_OUTER_RETRY_ROUNDS}: re-fetching CIDs from contract...`)
            try {
              // Re-fetch latest CIDs from contract — eth_call is not subject to lookback limits
              const { maintainers } = await getAllEventData()
              console.log(`  Contract returned ${maintainers.length} maintainer(s) with updated CIDs`)
              onStatusMessage?.(`Fetched ${maintainers.length} source(s) from contract, downloading IPFS data...`)
            } catch (cidErr) {
              console.error(`  Failed to re-fetch contract CIDs: ${cidErr}`)
              onStatusMessage?.(`Failed to fetch contract CIDs, retrying IPFS download...`)
            }
          } else {
            onStatusMessage?.('Downloading event archive from IPFS...')
          }

          const ipfsResult = await syncFromIPFS(currentBlock, targetBlock, onProgress, onIpfsProgress)

          if (ipfsResult.success) {
            totalEvents += ipfsResult.eventsCount
            currentBlock = ipfsResult.nextBlock
            consecutiveFailures = 0
            ipfsSuccess = true
            console.log(`IPFS sync complete (round ${outerRound}), continuing from block ${currentBlock} using RPC sync`)
            onStatusMessage?.(`IPFS archive loaded, resuming RPC sync from block ${currentBlock}...`)
            break
          }

          console.error(`IPFS sync failed (round ${outerRound}/${IPFS_CONFIG.MAX_OUTER_RETRY_ROUNDS}): ${ipfsResult.error}`)
          onStatusMessage?.(`IPFS download failed (round ${outerRound}/${IPFS_CONFIG.MAX_OUTER_RETRY_ROUNDS}): ${ipfsResult.error?.slice(0, 80)}`)

          // Hard errors — no point retrying
          if (ipfsResult.error?.includes('Server data error') || ipfsResult.error?.includes('Server data stale')) {
            console.error('Detected server data issue, terminating sync')
            throw new Error(ipfsResult.error)
          }

          if (outerRound < IPFS_CONFIG.MAX_OUTER_RETRY_ROUNDS) {
            console.log(`  Will re-fetch contract CIDs and retry IPFS download...`)
          }
        }

        if (!ipfsSuccess) {
          console.error(`IPFS sync failed after ${IPFS_CONFIG.MAX_OUTER_RETRY_ROUNDS} outer rounds, terminating sync`)
          throw new Error(`IPFS sync failed after ${IPFS_CONFIG.MAX_OUTER_RETRY_ROUNDS} retry rounds`)
        }

        continue
      }

      // If IPFS already attempted but still failed, wait and retry RPC (すでにIPFSを試行したが失敗した場合、待機してRPCをリトライ)
      await sleep(RPC_CALL_INTERVAL * 2)
      continue
    }

    currentBlock = endBlock + 1
    if (currentBlock <= targetBlock) {
      await sleep(RPC_CALL_INTERVAL)
    }
  }

  console.log('========================')
  console.log(
    `Historical sync complete! Processed ${totalEvents} events${totalWalletTx > 0 ? `, ${totalWalletTx} wallet transactions` : ''}`,
  )
  console.log('========================')
  onProgress?.({
    currentBlock: targetBlock,
    targetBlock,
    progress: 100,
    isComplete: true,
  })
  onComplete?.()
}

export async function syncLatest(): Promise<{
  success: boolean
  eventsCount: number
  walletTxCount: number
  newBlock: number
}> {
  const startBlock = getStartBlock()
  const currentBlockNumber = await client.getBlockNumber()
  const targetBlock = Number(currentBlockNumber)

  console.log(`[Real-time Sync] Checking new blocks: ${startBlock} -> ${targetBlock}`)

  if (startBlock > targetBlock) {
    return {
      success: true,
      eventsCount: 0,
      walletTxCount: 0,
      newBlock: targetBlock,
    }
  }

  // Process in batches, avoid span exceeding MAX_BLOCK_RANGE (バッチで処理、MAX_BLOCK_RANGEを超えるスパンを回避)
  let currentBlock = startBlock
  let totalEvents = 0
  let totalWalletTx = 0
  let consecutiveFailures = 0

  while (currentBlock <= targetBlock) {
    const endBlock = Math.min(currentBlock + MAX_BLOCK_RANGE - 1, targetBlock)
    
    const result = await syncBlockRange(currentBlock, endBlock)

    if (result.success) {
      totalEvents += result.eventsCount
      totalWalletTx += result.walletTxCount
      currentBlock = endBlock + 1
      consecutiveFailures = 0
    } else {
      consecutiveFailures++
      console.error(`[Real-time Sync] Failed (blocks ${currentBlock}-${endBlock}): ${result.error}`)

      // RPC consecutive failures 2 times, switch to IPFS (RPC連続失敗2回、IPFSに切り替え)
      if (consecutiveFailures >= 2) {
        console.log('[Real-time Sync] RPC consecutive failures, switching to IPFS...')
        const ipfsResult = await syncFromIPFS(currentBlock, targetBlock)
        if (ipfsResult.success) {
          totalEvents += ipfsResult.eventsCount
          currentBlock = ipfsResult.nextBlock
          consecutiveFailures = 0
          continue
        } else {
          // IPFS also failed, terminate sync (IPFSも失敗、同期を終了)
          console.error(`[Real-time Sync] IPFS sync failed: ${ipfsResult.error}`)
          return {
            success: false,
            eventsCount: totalEvents,
            walletTxCount: totalWalletTx,
            newBlock: currentBlock - 1,
          }
        }
      }

      return {
        success: false,
        eventsCount: totalEvents,
        walletTxCount: totalWalletTx,
        newBlock: currentBlock - 1,
      }
    }
  }

  if (totalEvents > 0 || totalWalletTx > 0) {
    const walletInfo = totalWalletTx > 0 ? `, ${totalWalletTx} wallet transactions` : ''
    console.log(
      `[Real-time Sync] Complete: blocks ${startBlock}-${targetBlock}, ${totalEvents} events${walletInfo}`,
    )
  }

  return {
    success: true,
    eventsCount: totalEvents,
    walletTxCount: totalWalletTx,
    newBlock: targetBlock,
  }
}

export async function getCurrentBlockNumber(): Promise<number> {
  const blockNumber = await client.getBlockNumber()
  return Number(blockNumber)
}

export function getSyncConfig() {
  return {
    contractDeployBlock: CONTRACT_DEPLOY_BLOCK,
    maxBlockRange: MAX_BLOCK_RANGE,
    rpcCallInterval: RPC_CALL_INTERVAL,
  }
}
