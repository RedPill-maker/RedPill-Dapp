/**
 * Filecoin Storage Manager - Using Synapse SDK
 *
 * Singleton that manages:
 * 1. Cached Synapse SDK instance (one password input per session)
 * 2. Upload progress tracking (survives page navigation)
 * 3. Subscriber-based progress notifications (components subscribe/unsubscribe)
 */

import type { PieceCID, Synapse } from '@filoz/synapse-sdk'
import { calibration, mainnet } from '@filoz/synapse-sdk'
import { ethers } from 'ethers'
import { parseUnits } from 'viem'
import { rpcConnectorInstance } from './rpcConnector'
import { walletMgr } from './walletMgr'
import { FILECOIN_STORAGE_PRICING } from '../../config'
import { createFilterClient, selectProvider } from './spFilter'

// ==================== Type Definitions ====================

export interface StorageResult {
  success: boolean
  cid: string // original IPFS CID (for input matching)
  pieceCid?: string // converted to string for storage and transmission
  pieceCidRaw?: PieceCID // raw PieceCID object
  dataSetId?: string // on-chain data set ID (bigint serialized as string)
  providerName?: string // SP name that stored this piece
  providerServiceURL?: string // SP's PDP service endpoint
  error?: string
  txHash?: string
}

export type OnchainVerifyStatus = 'verified' | 'pending' | 'overdue' | 'not_found'

export interface OnchainVerifyResult {
  pieceCid: string
  status: OnchainVerifyStatus
  retrievalUrl?: string
  error?: string
}

/** Upload progress info for a single CID */
export interface StorageProgressInfo {
  cid: string
  phase: 'fetching' | 'uploading' | 'done' | 'error'
  bytesUploaded?: number
  totalBytes?: number
  totalFiles: number
  completedFiles: number
  error?: string
  timestamp?: number
}

export type StorageProgressCallback = (info: StorageProgressInfo) => void

/** Aggregated progress state exposed to subscribers */
export interface StorageProgressState {
  /** true when any upload is in progress */
  isUploading: boolean
  /** Per-CID progress map */
  cidProgress: Map<string, StorageProgressInfo>
  /** Overall summary progress (latest emitted info) */
  summary: StorageProgressInfo | null
}

export type StorageProgressListener = (state: StorageProgressState) => void

export interface StorageStatus {
  success: boolean
  pieceCid: string
  status?: 'pending' | 'active' | 'completed' | 'failed' | 'unknown'
  dealId?: string
  error?: string
  exists?: boolean
  lastProven?: string
  nextProofDue?: string
  retrievalUrl?: string
  pieceId?: number
  inChallengeWindow?: boolean
  hoursUntilChallenge?: number
  isProofOverdue?: boolean
}

// ==================== Storage Manager Class ====================

class FileStoreMgr {
  // Synapse instance cache
  private _synapse: Synapse | null = null
  private _synapseAddress: string | null = null

  // Progress management
  private _cidProgress: Map<string, StorageProgressInfo> = new Map()
  private _summary: StorageProgressInfo | null = null
  private _activeUploadCount = 0
  private _listeners: Set<StorageProgressListener> = new Set()
  private _clearTimer: ReturnType<typeof setTimeout> | null = null

  // ==================== Synapse Instance Management ====================

  /**
   * Check if a cached Synapse instance exists for the given address.
   * If no address provided, checks if any instance exists.
   */
  hasSynapse(address?: string): boolean {
    if (!this._synapse) return false
    if (address) return this._synapseAddress?.toLowerCase() === address.toLowerCase()
    return true
  }

  /**
   * Initialize and cache a Synapse instance for the given wallet.
   * Call this after WalletSelectorModal confirms address + password.
   * Private key is used only to create the instance, then discarded.
   */
  async initSynapse(address: string, password: string): Promise<boolean> {
    try {
      const privateKey = await this.getPrivateKey(address, password)
      if (!privateKey) return false

      this._synapse = rpcConnectorInstance.getSynapseInstance(privateKey)
      this._synapseAddress = address
      // privateKey goes out of scope here — not stored
      return true
    } catch (error) {
      console.error('Failed to initialize Synapse instance:', error)
      return false
    }
  }

  /** Clear cached Synapse instance (on network switch, logout, etc.) */
  clearSynapse(): void {
    this._synapse = null
    this._synapseAddress = null
  }

  /** Get the address associated with the cached Synapse instance */
  get synapseAddress(): string | null {
    return this._synapseAddress
  }

  /**
   * Get or create a Synapse instance.
   * Uses cache if available for the same address, otherwise creates new.
   */
  private async getOrCreateSynapse(address: string, password: string): Promise<Synapse | null> {
    if (this.hasSynapse(address) && this._synapse) {
      return this._synapse
    }
    const ok = await this.initSynapse(address, password)
    return ok ? this._synapse : null
  }

  // ==================== Progress Subscription ====================

  /** Subscribe to upload progress changes */
  subscribe(listener: StorageProgressListener): void {
    this._listeners.add(listener)
    // Immediately emit current state so component gets existing progress
    listener(this.getProgressState())
  }

  /** Unsubscribe from upload progress changes */
  unsubscribe(listener: StorageProgressListener): void {
    this._listeners.delete(listener)
  }

  /** Get current progress state snapshot */
  getProgressState(): StorageProgressState {
    return {
      isUploading: this._activeUploadCount > 0,
      cidProgress: new Map(this._cidProgress),
      summary: this._summary,
    }
  }

  /** Notify all listeners of progress change */
  private notifyListeners(): void {
    const state = this.getProgressState()
    this._listeners.forEach(l => {
      try { l(state) } catch (e) { console.error('Progress listener error:', e) }
    })
  }

  /** Internal progress handler that updates state and notifies */
  private handleProgress(info: StorageProgressInfo): void {
    // Cancel any pending clear timer when new progress arrives
    if (this._clearTimer) {
      clearTimeout(this._clearTimer)
      this._clearTimer = null
    }
    this._cidProgress.set(info.cid, info)
    this._summary = info
    this.notifyListeners()
  }

  /** Schedule clearing progress state after uploads complete */
  private scheduleClearProgress(delayMs = 5000): void {
    if (this._clearTimer) clearTimeout(this._clearTimer)
    this._clearTimer = setTimeout(() => {
      this._cidProgress.clear()
      this._summary = null
      this._clearTimer = null
      this.notifyListeners()
    }, delayMs)
  }

  // ==================== Storage Operations ====================

  /**
   * Store content by CID(s). Uses cached Synapse instance when available.
   * Progress is tracked globally and available to all subscribers.
   */
  async storeContent(
    cids: string | string[],
    address: string,
    password: string,
    onProgress?: StorageProgressCallback,
  ): Promise<StorageResult | StorageResult[]> {
    const cidArray = Array.isArray(cids) ? cids : [cids]
    const totalFiles = cidArray.length

    const synapse = await this.getOrCreateSynapse(address, password)
    if (!synapse) {
      const errorResult: StorageResult = {
        success: false,
        cid: cidArray[0],
        error: 'Failed to access wallet. Please check your password.',
      }
      return Array.isArray(cids)
        ? cidArray.map((cid) => ({ ...errorResult, cid }))
        : errorResult
    }

    // Ensure FilecoinPay has sufficient lockup funds
    try {
      await this.ensureLockupFunds(synapse)
    } catch (error: any) {
      const errorResult: StorageResult = {
        success: false,
        cid: cidArray[0],
        error: error.message || 'Failed to prepare storage payment',
      }
      return Array.isArray(cids)
        ? cidArray.map((cid) => ({ ...errorResult, cid }))
        : errorResult
    }

    this._activeUploadCount++
    let completedFiles = 0

    // Pre-select IPNI-capable SP (once for all CIDs in this batch)
    const ipniProvider = await this.selectIpniProvider()
    if (!ipniProvider) {
      this._activeUploadCount--
      const errorMsg = 'No IPNI-capable storage provider available. Files cannot be pinned to IPFS network.'
      const errorResult: StorageResult = { success: false, cid: cidArray[0], error: errorMsg }
      return Array.isArray(cids)
        ? cidArray.map((cid) => ({ ...errorResult, cid }))
        : errorResult
    }

    // Combined progress handler: updates global state + calls caller's callback
    const emitProgress = (info: StorageProgressInfo) => {
      this.handleProgress(info)
      onProgress?.(info)
    }

    const uploadOne = async (cid: string): Promise<StorageResult> => {
      try {
        emitProgress({ cid, phase: 'fetching', totalFiles, completedFiles })
        const data = await this.fetchFromIPFS(cid)
        if (!data) {
          emitProgress({ cid, phase: 'error', totalFiles, completedFiles, error: 'Cannot fetch file from IPFS' })
          return { success: false, cid, error: 'Failed to fetch content from IPFS' }
        }

        const totalBytes = data.byteLength
        const uploadContext = await synapse.storage.createContext({
          metadata: { withIPFSIndexing: '' },
          providerId: ipniProvider.providerId,
        })

        emitProgress({ cid, phase: 'uploading', bytesUploaded: 0, totalBytes, totalFiles, completedFiles, timestamp: Date.now() })
        const upload = await uploadContext.upload(data, {
          pieceMetadata: { ipfsRootCID: cid },
          onProgress: (bytesUploaded: number) => {
            emitProgress({ cid, phase: 'uploading', bytesUploaded, totalBytes, totalFiles, completedFiles, timestamp: Date.now() })
          },
        })

        const pieceCidString = upload.pieceCid.toString()
        const dataSetId = upload.copies[0]?.dataSetId?.toString()
        console.log(`Storage initiated. Piece CID: ${pieceCidString}, Data Set ID: ${dataSetId}`)

        completedFiles++
        emitProgress({ cid, phase: 'done', totalFiles, completedFiles })

        return {
          success: true,
          cid,
          pieceCid: pieceCidString,
          pieceCidRaw: upload.pieceCid,
          dataSetId,
          providerName: ipniProvider.name,
          providerServiceURL: ipniProvider.serviceURL,
        }
      } catch (error: any) {
        console.error(`Error storing content for CID ${cid}:`, error)
        emitProgress({ cid, phase: 'error', totalFiles, completedFiles, error: error.message })
        return { success: false, cid, error: error.message || 'Failed to store content' }
      }
    }

    try {
      const settled = await Promise.allSettled(cidArray.map(uploadOne))
      const results = settled.map((s, i) =>
        s.status === 'fulfilled'
          ? s.value
          : { success: false, cid: cidArray[i], error: (s.reason as Error)?.message || 'Unknown error' } as StorageResult
      )
      return Array.isArray(cids) ? results : results[0]
    } finally {
      this._activeUploadCount--
      if (this._activeUploadCount <= 0) {
        this._activeUploadCount = 0
        this.scheduleClearProgress()
      }
    }
  }

  /**
   * Query storage deal status (supports single or multiple)
   */
  async getStorageStatus(
    pieceCids: string | string[],
    address: string,
    password: string,
  ): Promise<StorageStatus | StorageStatus[]> {
    const pieceCidArray = Array.isArray(pieceCids) ? pieceCids : [pieceCids]
    const results: StorageStatus[] = []

    const synapse = await this.getOrCreateSynapse(address, password)
    if (!synapse) {
      const errorResult: StorageStatus = {
        success: false,
        pieceCid: pieceCidArray[0],
        error: 'Failed to access wallet. Please check your password.',
      }
      return Array.isArray(pieceCids)
        ? pieceCidArray.map((pieceCid) => ({ ...errorResult, pieceCid }))
        : errorResult
    }

    let context
    try {
      context = await synapse.storage.getDefaultContext()
    } catch (error: any) {
      const errorResult: StorageStatus = {
        success: false,
        pieceCid: pieceCidArray[0],
        error: error.message || 'Failed to initialize storage context',
      }
      return Array.isArray(pieceCids)
        ? pieceCidArray.map((pieceCid) => ({ ...errorResult, pieceCid }))
        : errorResult
    }

    for (const pieceCid of pieceCidArray) {
      try {
        console.log(`Querying storage status for Piece CID: ${pieceCid}`)
        const status = await context.pieceStatus({ pieceCid })

        let dealStatus: 'pending' | 'active' | 'completed' | 'failed' | 'unknown' = 'unknown'
        if (status == null) {
          dealStatus = 'pending'
        } else if (status.isProofOverdue) {
          dealStatus = 'failed'
        } else if (status.dataSetLastProven) {
          dealStatus = 'active'
        } else {
          dealStatus = 'pending'
        }

        results.push({
          success: true,
          pieceCid,
          status: dealStatus,
          exists: status != null,
          lastProven: status?.dataSetLastProven?.toISOString(),
          nextProofDue: status?.dataSetNextProofDue?.toISOString(),
          retrievalUrl: status?.retrievalUrl || undefined,
          pieceId: status?.pieceId != null ? Number(status.pieceId) : undefined,
          inChallengeWindow: status?.inChallengeWindow,
          hoursUntilChallenge: status?.hoursUntilChallengeWindow,
          isProofOverdue: status?.isProofOverdue,
        })
      } catch (error: any) {
        console.error(`Error querying storage status for ${pieceCid}:`, error)
        results.push({
          success: false,
          pieceCid,
          error: error.message || 'Failed to query storage status',
        })
      }
    }

    return Array.isArray(pieceCids) ? results : results[0]
  }

  // ==================== Private Helpers ====================

  /**
   * Ensure FilecoinPay contract has sufficient USDFC lockup funds.
   * Auto-deposits if balance is insufficient.
   */
  private async ensureLockupFunds(synapse: Synapse): Promise<void> {
    const balance = await synapse.payments.balance()
    const minDeposit = parseUnits(FILECOIN_STORAGE_PRICING.MIN_DEPOSIT_USDFC, 18)

    if (balance >= minDeposit) {
      console.log(`FilecoinPay balance sufficient: ${ethers.formatEther(balance)} USDFC`)
      return
    }

    console.log(
      `FilecoinPay balance insufficient: ${ethers.formatEther(balance)} USDFC, ` +
      `depositing ${FILECOIN_STORAGE_PRICING.MIN_DEPOSIT_USDFC} USDFC...`
    )

    const walletUsdfc = await synapse.payments.walletBalance({ token: 'USDFC' })
    if (walletUsdfc < minDeposit) {
      throw new Error(
        `Insufficient wallet USDFC balance. Need at least ${FILECOIN_STORAGE_PRICING.MIN_DEPOSIT_USDFC} USDFC for storage fees, ` +
        `current balance: ${ethers.formatEther(walletUsdfc)} USDFC`
      )
    }

    await synapse.payments.depositWithPermitAndApproveOperator({
      amount: minDeposit,
    })

    console.log(`Successfully deposited ${FILECOIN_STORAGE_PRICING.MIN_DEPOSIT_USDFC} USDFC to FilecoinPay`)
  }

  /** Get the Synapse chain object for the current network */
  private getSynapseChain() {
    const network = rpcConnectorInstance.getCurrentNetwork()
    return network.chainId === 't' ? calibration : mainnet
  }

  /**
   * Select an IPNI-capable storage provider for the current network.
   * Returns provider info if found, null otherwise.
   */
  private async selectIpniProvider(): Promise<{ providerId: bigint; name: string; serviceURL: string } | null> {
    try {
      const chain = this.getSynapseChain()
      const client = createFilterClient(chain)
      const result = await selectProvider(client)
      if (result) {
        console.log(`Selected IPNI-capable SP: providerId=${result.providerId}, name=${result.provider.name}`)
        return {
          providerId: result.providerId,
          name: result.provider.name,
          serviceURL: result.provider.pdp.serviceURL,
        }
      }
      return null
    } catch (error) {
      console.warn('SP filtering failed:', error)
      return null
    }
  }

  /** Securely get private key via walletMgr (temporary access) */
  private async getPrivateKey(address: string, password: string): Promise<string | null> {
    try {
      const signer = await walletMgr.getSigner(address, password)
      if (!signer) return null
      const privateKey = (signer as any).privateKey
      return privateKey
    } catch (error) {
      console.error('Error getting private key:', error)
      return null
    }
  }

  /** Fetch CAR data from IPFS for storage */
  private async fetchFromIPFS(cid: string): Promise<Uint8Array | null> {
    try {
      console.log(`Fetching CAR from IPFS: ${cid}`)
      return await (await import('./ipfsConnector')).ipfsConnector.exportCar(cid, {
        timeout: 60000,
      })
    } catch (error: any) {
      console.error('Error fetching CAR from IPFS:', error)
      return null
    }
  }

  /** Estimate storage cost using SDK's preflight API */
  async estimateStorageCost(
    dataSize: number,
    address: string,
    password: string,
  ): Promise<{
    success: boolean
    estimatedCostPerDay?: string
    estimatedCostPerMonth?: string
    currency?: string
    error?: string
  }> {
    try {
      const synapse = await this.getOrCreateSynapse(address, password)
      if (!synapse) {
        return { success: false, error: 'Cannot access wallet, please check password' }
      }
      const preflight = await synapse.storage.preflightUpload({ size: dataSize })
      return {
        success: true,
        estimatedCostPerDay: ethers.formatEther(preflight.estimatedCost.perDay),
        estimatedCostPerMonth: ethers.formatEther(preflight.estimatedCost.perMonth),
        currency: 'USDFC',
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Cannot estimate storage cost',
      }
    }
  }

  /** Get current network info */
  getCurrentNetwork(): { name: string; chainId: string; isTestnet: boolean } {
    const network = rpcConnectorInstance.getCurrentNetwork()
    return {
      name: network.name,
      chainId: network.chainId,
      isTestnet: network.isTestnet,
    }
  }

  /** Query FilecoinPay contract USDFC balance. Uses cached Synapse if available. */
  async getPaymentBalance(
    address: string,
    password: string,
  ): Promise<{ success: boolean; balance?: string; walletBalance?: string; error?: string }> {
    try {
      const synapse = await this.getOrCreateSynapse(address, password)
      if (!synapse) {
        return { success: false, error: 'Cannot access wallet, please check password' }
      }
      const balance = await synapse.payments.balance()
      const walletUsdfc = await synapse.payments.walletBalance({ token: 'USDFC' })
      return {
        success: true,
        balance: ethers.formatEther(balance),
        walletBalance: ethers.formatEther(walletUsdfc),
      }
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to query balance' }
    }
  }

  /** Deposit USDFC to FilecoinPay contract */
  async depositUSDFC(
    address: string,
    password: string,
    amount: string,
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      const synapse = await this.getOrCreateSynapse(address, password)
      if (!synapse) {
        return { success: false, error: 'Cannot access wallet, please check password' }
      }
      const depositAmount = parseUnits(amount, 18)
      const tx = await synapse.payments.depositWithPermitAndApproveOperator({ amount: depositAmount })
      const txHash = tx?.hash ?? tx?.transactionHash ?? (typeof tx === 'string' ? tx : undefined)
      return { success: true, txHash }
    } catch (error: any) {
      return { success: false, error: error.message || 'Deposit failed' }
    }
  }

  /**
   * Verify on-chain storage status for known piece CIDs.
   * Uses cached Synapse if available.
   */
  async verifyOnchainStorage(
    address: string,
    password: string,
    entries: Array<{ pieceCid: string; dataSetId?: string }>,
    onProgress?: (checked: number, total: number) => void,
  ): Promise<{ success: boolean; results?: OnchainVerifyResult[]; error?: string }> {
    try {
      if (entries.length === 0) {
        return { success: true, results: [] }
      }

      const synapse = await this.getOrCreateSynapse(address, password)
      if (!synapse) {
        return { success: false, error: 'Cannot access wallet, please check password' }
      }

      console.log(`[verifyOnchainStorage] Starting verification for ${entries.length} piece(s):`, entries.map(e => e.pieceCid))
      const results: OnchainVerifyResult[] = []
      for (let i = 0; i < entries.length; i++) {
        const { pieceCid, dataSetId } = entries[i]
        onProgress?.(i, entries.length)
        try {
          const context = dataSetId
            ? await synapse.storage.createContext({ dataSetId: BigInt(dataSetId) })
            : await synapse.storage.getDefaultContext()

          const status = await context.pieceStatus({ pieceCid })
          let verifyStatus: OnchainVerifyStatus
          if (status == null) {
            verifyStatus = 'not_found'
          } else if (status.isProofOverdue) {
            verifyStatus = 'overdue'
          } else if (!status.dataSetLastProven) {
            verifyStatus = 'pending'
          } else {
            verifyStatus = 'verified'
          }
          console.log(`[verifyOnchainStorage] [${i + 1}/${entries.length}] pieceCid=${pieceCid} | dataSetId=${dataSetId ?? 'default'} | status=${verifyStatus} | retrievalUrl=${status?.retrievalUrl || 'N/A'}`)
          results.push({ pieceCid, status: verifyStatus, retrievalUrl: status?.retrievalUrl || undefined })
        } catch (err: any) {
          console.warn(`[verifyOnchainStorage] [${i + 1}/${entries.length}] pieceCid=${pieceCid} | dataSetId=${dataSetId ?? 'default'} | status=not_found | error=${err.message}`)
          results.push({ pieceCid, status: 'not_found', error: err.message })
        }
      }
      onProgress?.(entries.length, entries.length)
      console.log('[verifyOnchainStorage] Verification complete. Summary:')
      results.forEach(r => console.log(`  pieceCid=${r.pieceCid} | status=${r.status} | retrievalUrl=${r.retrievalUrl || 'N/A'}`))

      return { success: true, results }
    } catch (error: any) {
      return { success: false, error: error.message || 'Verification failed' }
    }
  }
}

// ==================== Export Singleton ====================

export { FileStoreMgr }
export const fileStoreMgr = new FileStoreMgr()
export default fileStoreMgr
