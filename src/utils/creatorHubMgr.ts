/**
 * CreatorHub Contract Manager
 *
 * Wraps CreatorHub smart contract call methods.
 * Provides creator registration, work management, tipping, jackpot, and account trading features.
 *
 * Main feature modules:
 * 1. Creator management - register, update profile, query creator info
 * 2. Work management - claim works, batch claim, transfer, delete works
 * 3. Tipping & jackpot - tip works, query jackpot info, settle jackpot
 * 4. Account market - bid to buy accounts, accept/withdraw bids
 * 5. Balance management - query balance, withdraw
 * 6. Event listening - listen to on-chain events
 *
 * Security Architecture:
 * - This module never touches private keys
 * - Gets signer through walletMgr
 * - Only accepts address and password parameters
 */

import { ethers } from 'ethers'
import { rpcConnectorInstance, waitForTransaction } from './rpcConnector'
import { calibration, mainnet } from '@filoz/synapse-sdk'
import { walletMgr } from './walletMgr'
import CreatorHubABI from '../../contract_info/CreatorHub_abi.json'
import { NETWORK_CONTRACTS, getKnownTokens } from '../../config'

// ==================== Constant Definition ====================

const NATIVE_FIL = '0x0000000000000000000000000000000000000000'

function getContractAddress(): string {
  const network = rpcConnectorInstance.getCurrentNetwork()
  const networkId = network.chainId === 'f' ? 'mainnet' : network.chainId === 't' ? 'calibration' : 'localnet'
  return NETWORK_CONTRACTS[networkId]?.creator_hub ?? '0x0000000000000000000000000000000000000000'
}



// Export token list for external use (network-aware)
export { getKnownTokens }

export interface TokenInfo {
  address: string
  symbol: string
  name: string
}

// ==================== Interface Definition ====================

// Contract transaction result (includes raw error object for error parsing)
export interface ContractTransactionResult {
  success: boolean
  txHash?: string
  error?: string
  rawError?: any // raw error object, preserves data/transaction fields for contractErrorParser
}

// Jackpot info
export interface JackpotInfo {
  poolAmount: string // total jackpot amount
  leaderWorkHash: string // leading work hash
  leaderCreator: string // leading creator address
  leaderTotalTips: string // leader's total tips this epoch
  startTime: number // epoch start time
  endTime: number // epoch end time
  epoch: number // current epoch number
  extensionCount: number // extension count
  lastExtensionTime: number // last extension time
  settled: boolean // whether settled
}

// Creator profile
export interface CreatorProfile {
  username: string // username
  walletAddress: string // wallet address
  minOfferPrice: string // minimum offer price (0 = not for sale)
  isRegistered: boolean // whether registered
  workCount: number // work count
  registeredAt: number // registration timestamp
}

// Work info
export interface WorkInfo {
  ownerUsername: string // owner username
  workCid: string // work CID
  claimedAt: number // claim timestamp
  transferCount: number // transfer count
  workType: number // work type (0=file, 1=video, 2=audio, 3=markdown, etc.)
}

// Work tip statistics
export interface WorkTipStats {
  totalAmount: string // total tips this epoch
  lastEpoch: number // last tip epoch
  isLeader: boolean // whether current leader
}

// Tip record
export interface TipRecord {
  tipper: string // tipper address
  creator: string // creator address
  workCid: string // work CID
  token: string // token address
  amount: string // total tip amount
  creatorShare: string // creator share (80%)
  platformFee: string // platform fee (1%)
  jackpotFee: string // jackpot fee (19%)
  timestamp: string // timestamp
  txHash: string // transaction hash
}

// Account offer info
export interface AccountOffer {
  buyer: string // buyer address
  amount: string // bid amount
  timestamp: number // bid timestamp
  active: boolean // whether active
}

// Contract health status
export interface ContractHealth {
  actualBalance: string // actual balance
  totalLiabilitiesAmount: string // total liabilities
  surplus: string // surplus
  isHealthy: boolean // whether healthy
}

// Jackpot leader info
export interface JackpotLeader {
  leaderWorkHash: string // leading work hash
  leaderCreator: string // leading creator address
  leaderTotalTips: string // leader total tips
}

// ==================== CreatorHubManager Class ====================

class CreatorHubManager {
  private contract: ethers.Contract | null = null
  private provider: ethers.JsonRpcProvider | null = null

  constructor() {
    this.initializeProvider()
  }

  // ==================== Initialization ====================

  private initializeProvider(): void {
    const network = rpcConnectorInstance.getCurrentNetwork()
    const rpcUrl = network.isTestnet
      ? calibration.rpcUrls.default.http[0]
      : mainnet.rpcUrls.default.http[0]
    this.provider = new ethers.JsonRpcProvider(rpcUrl)
    this.initializeContract()
  }

  private initializeContract(): void {
    if (!this.provider) return
    this.contract = new ethers.Contract(
      getContractAddress(),
      CreatorHubABI,
      this.provider,
    )
  }

  refreshProvider(): void {
    this.initializeProvider()
  }

  /**
   * Get signer (internal helper method)
   * @param address Wallet address
   * @param password Password
   * @returns Signer
   */
  private async getSigner(address: string, password: string): Promise<ethers.Wallet> {
    if (!this.provider) throw new Error('Provider not initialized')
    return await walletMgr.getSigner(address, password)
  }

  // ==================== Token Management ====================

  /**
   * Get supported token list from contract.
   * Queries which tokens in the predefined list are supported by the contract.
   * @returns Array of supported token info
   */
  async getSupportedTokens(): Promise<TokenInfo[]> {
    try {
      if (!this.contract) throw new Error('Contract not initialized')
      const tokens = getKnownTokens()
      const addresses = tokens.map((t) => t.address)
      const supported: boolean[] =
        await this.contract.getSupportedTokens(addresses)
      return tokens.filter((_, i) => supported[i])
    } catch (error: any) {
      console.error('Failed to get supported tokens:', error)
      // Fallback: return FIL (native token is always supported)
      return [getKnownTokens()[0]]
    }
  }

  // ==================== Jackpot Related Methods ====================

  /**
   * Get jackpot info.
   * Queries the jackpot state for a specified token, including pool amount, leader, epoch times, etc.
   * @param token Token address, defaults to Native FIL
   * @returns Detailed jackpot info
   */
  async getJackpotInfo(token: string = NATIVE_FIL): Promise<JackpotInfo> {
    try {
      if (!this.contract) throw new Error('Contract not initialized')
      const j = await this.contract.getJackpotInfo(token)
      return {
        poolAmount: ethers.formatEther(j.poolAmount),
        leaderWorkHash: j.leaderWorkHash,
        leaderCreator: j.leaderCreator,
        leaderTotalTips: ethers.formatEther(j.leaderTotalTips),
        startTime: Number(j.startTime),
        endTime: Number(j.endTime),
        epoch: Number(j.epoch),
        extensionCount: Number(j.extensionCount),
        lastExtensionTime: Number(j.lastExtensionTime),
        settled: j.settled,
      }
    } catch (error: any) {
      console.error('Failed to get jackpot info:', error)
      throw new Error(error.message || 'Failed to get jackpot info')
    }
  }

  /**
   * Get jackpot leader info.
   * Queries the leading work and creator for the current epoch.
   * @param token Token address, defaults to Native FIL
   * @returns Leader info
   */
  async getJackpotLeader(token: string = NATIVE_FIL): Promise<JackpotLeader> {
    try {
      if (!this.contract) throw new Error('Contract not initialized')
      const leader = await this.contract.getJackpotLeader(token)
      return {
        leaderWorkHash: leader.leaderWorkHash,
        leaderCreator: leader.leaderCreator,
        leaderTotalTips: ethers.formatEther(leader.leaderTotalTips),
      }
    } catch (error: any) {
      console.error('Failed to get jackpot leader:', error)
      throw new Error(error.message || 'Failed to get jackpot leader')
    }
  }

  /**
   * Settle jackpot.
   * Called after epoch ends; distributes prize to leader, or rolls over to next epoch if no leader.
   * @param address Wallet address
   * @param password Wallet password
   * @param token Token address, defaults to Native FIL
   * @returns Transaction result
   */
  async settleJackpot(
    address: string,
    password: string,
    token: string = NATIVE_FIL,
  ): Promise<ContractTransactionResult> {
    try {
      if (!this.provider) throw new Error('Provider not initialized')

      // Get signer via walletMgr (do not expose private key)
      const signer = await walletMgr.getSigner(address, password)
      const contract = new ethers.Contract(
        getContractAddress(),
        CreatorHubABI,
        signer,
      )

      const tx = await contract.settleJackpot(token)
      console.log('Settle jackpot tx sent:', tx.hash)
      const receipt = await waitForTransaction(tx, rpcConnectorInstance.getProvider())
      if (receipt && receipt.status === 1) {
        return { success: true, txHash: tx.hash }
      }
      return { success: false, error: 'Transaction failed' }
    } catch (error: any) {
      console.error('Failed to settle jackpot:', error)
      return { success: false, error: error.message || 'Failed to settle jackpot', rawError: error }
    }
  }

  // ==================== Creator Management ====================

  /**
   * Register creator.
   * Creates a creator account; requires paying registration fee; username is globally unique.
   * @param address Wallet address
   * @param password Wallet password
   * @param username Username (1-64 characters)
   * @param avatarCid Avatar CID (optional)
   * @param backgroundCid Background image CID (optional)
   * @param ipnsAddress IPNS address (optional)
   * @param ipnsSignature IPNS signature (64 bytes, optional)
   * @param title Title (≤128 characters, optional)
   * @param description Description (≤512 characters, optional)
   * @returns Transaction result
   */
  async registerCreator(
    address: string,
    password: string,
    username: string,
    avatarCid: string = '',
    backgroundCid: string = '',
    ipnsAddress: string = '',
    ipnsSignature: string = '0x',
    title: string = '',
    description: string = '',
  ): Promise<ContractTransactionResult> {
    try {
      const signer = await this.getSigner(address, password)
      const contract = new ethers.Contract(
        getContractAddress(),
        CreatorHubABI,
        signer,
      )
      const registrationFee = await contract.registrationFee()
      const tx = await contract.registerCreator(
        username,
        avatarCid,
        backgroundCid,
        ipnsAddress,
        ipnsSignature,
        title,
        description,
        { value: registrationFee },
      )
      console.log('Register creator tx sent:', tx.hash)
      const receipt = await waitForTransaction(tx, rpcConnectorInstance.getProvider())
      if (receipt && receipt.status === 1) {
        return { success: true, txHash: tx.hash }
      }
      return { success: false, error: 'Transaction failed' }
    } catch (error: any) {
      console.error('Failed to register creator:', error)
      return { success: false, error: error.message || 'Failed to register creator', rawError: error }
    }
  }

  /**
   * Update creator profile.
   * Updates avatar, background, IPNS, title, description, etc. Empty string means no update.
   * @param address Wallet address
   * @param password Wallet password
   * @param avatarCid Avatar CID
   * @param backgroundCid Background image CID
   * @param ipnsAddress IPNS address
   * @param ipnsSignature IPNS signature
   * @param title Title
   * @param description Description
   * @returns Transaction result
   */
  async updateProfile(
    address: string,

    password: string,
    avatarCid: string,
    backgroundCid: string,
    ipnsAddress: string,
    ipnsSignature: string,
    title: string,
    description: string,
  ): Promise<ContractTransactionResult> {
    try {
      if (!this.provider) throw new Error('Provider not initialized')
      const signer = await this.getSigner(address, password)
      const contract = new ethers.Contract(
        getContractAddress(),
        CreatorHubABI,
        signer,
      )
      const tx = await contract.updateProfile(
        avatarCid,
        backgroundCid,
        ipnsAddress,
        ipnsSignature,
        title,
        description,
      )
      console.log('Update profile tx sent:', tx.hash)
      const receipt = await waitForTransaction(tx, rpcConnectorInstance.getProvider())
      if (receipt && receipt.status === 1) {
        return { success: true, txHash: tx.hash }
      }
      return { success: false, error: 'Transaction failed' }
    } catch (error: any) {
      console.error('Failed to update profile:', error)
      return { success: false, error: error.message || 'Failed to update profile', rawError: error }
    }
  }

  /**
   * Disable IPNS.
   * Clears IPNS info to eliminate IP tracking risk.
   * @param address Wallet address
   * @param password Wallet password
   * @returns Transaction result
   */
  async disableIPNS(
    address: string,
    password: string,
  ): Promise<ContractTransactionResult> {
    try {
      if (!this.provider) throw new Error('Provider not initialized')
      const signer = await this.getSigner(address, password)
      const contract = new ethers.Contract(
        getContractAddress(),
        CreatorHubABI,
        signer,
      )
      const tx = await contract.disableIPNS()
      console.log('Disable IPNS tx sent:', tx.hash)
      const receipt = await waitForTransaction(tx, rpcConnectorInstance.getProvider())
      if (receipt && receipt.status === 1) {
        return { success: true, txHash: tx.hash }
      }
      return { success: false, error: 'Transaction failed' }
    } catch (error: any) {
      console.error('Failed to disable IPNS:', error)
      return { success: false, error: error.message || 'Failed to disable IPNS', rawError: error }
    }
  }

  /**
   * Get creator profile.
   * Queries detailed info for a creator.
   * @param username Username
   * @param silentNotFound Whether to silently handle "Not found" errors (used for checking username availability)
   * @returns Creator profile
   */
  async getCreatorProfile(username: string, silentNotFound: boolean = false): Promise<CreatorProfile> {
    try {
      if (!this.contract) throw new Error('Contract not initialized')
      const p = await this.contract.getCreatorProfile(username)
      return {
        username: p.username,
        walletAddress: p.walletAddress,
        minOfferPrice: ethers.formatEther(p.minOfferPrice),
        isRegistered: p.isRegistered,
        workCount: Number(p.workCount),
        registeredAt: Number(p.registeredAt),
      }
    } catch (error: any) {
      // If "Not found" error and silent mode is set, don't log
      const errorMessage = error.message || error.reason || error.toString()
      const isNotFoundError = errorMessage.includes('Not found') || errorMessage.includes('NotRegistered')
      
      if (!silentNotFound || !isNotFoundError) {
        console.error('Failed to get creator info:', error)
      }
      
      throw new Error(error.message || 'Failed to get creator info')
    }
  }

  /**
   * Get creator username.
   * Queries username by address.
   * @param address Wallet address
   * @returns Username, returns empty string if not registered
   */
  async getCreatorUsername(address: string): Promise<string> {
    try {
      if (!this.contract) throw new Error('Contract not initialized')
      return await this.contract.getCreatorUsername(address)
    } catch (error: any) {
      console.error('Failed to get creator username:', error)
      throw new Error(error.message || 'Failed to get creator username')
    }
  }

  /**
   * Check if address is registered as a creator.
   * @param address Wallet address
   * @returns Whether registered
   */
  async isRegistered(address: string): Promise<boolean> {
    try {
      const username = await this.getCreatorUsername(address)
      return username !== ''
    } catch {
      return false
    }
  }

  /**
   * Get registration fee.
   * Queries the current fee required to register as a creator.
   * @returns Registration fee (FIL)
   */
  async getRegistrationFee(): Promise<string> {
    try {
      if (!this.contract) throw new Error('Contract not initialized')
      const fee = await this.contract.registrationFee()
      return ethers.formatEther(fee)
    } catch (error: any) {
      console.error('Failed to get registration fee:', error)
      throw new Error(error.message || 'Failed to get registration fee')
    }
  }

  // ==================== Work Management ====================

  /**
   * Claim work ownership.
   * Registers a work CID on-chain to claim ownership; CID is globally unique.
   * @param address Wallet address
   * @param password Wallet password
   * @param workCid Work CID (IPFS content identifier)
   * @param title Work title (≤64 characters)
   * @param description Work description (≤512 characters)
   * @param workType Work type (0=file, 1=video, 2=audio, 3=markdown, etc.)
   * @param imgCid Preview image CID
   * @returns Transaction result
   */
  async claimWork(
    address: string,

    password: string,
    workCid: string,
    title: string = '',
    description: string = '',
    workType: number = 0,
    imgCid: string = '',
  ): Promise<ContractTransactionResult> {
    try {
      if (!this.provider) throw new Error('Provider not initialized')
      const signer = await this.getSigner(address, password)
      const contract = new ethers.Contract(
        getContractAddress(),
        CreatorHubABI,
        signer,
      )
      const tx = await contract.claimWork(
        workCid,
        title,
        description,
        workType,
        imgCid,
      )
      console.log('Claim work tx sent:', tx.hash)
      const receipt = await waitForTransaction(tx, rpcConnectorInstance.getProvider())
      if (receipt && receipt.status === 1) {
        return { success: true, txHash: tx.hash }
      }
      return { success: false, error: 'Transaction failed' }
    } catch (error: any) {
      console.error('Failed to claim work:', error)
      return { success: false, error: error.message || 'Failed to claim work', rawError: error }
    }
  }

  /**
   * Batch claim works.
   * Claims multiple works at once to save gas; all succeed or all fail.
   * @param address Wallet address
   * @param password Wallet password
   * @param workCids Array of work CIDs
   * @param titles Array of titles
   * @param descriptions Array of descriptions
   * @param workTypes Array of work types
   * @param imgCids Array of preview image CIDs
   * @returns Transaction result
   */
  async batchClaimWorks(
    address: string,

    password: string,
    workCids: string[],
    titles: string[],
    descriptions: string[],
    workTypes: number[],
    imgCids: string[],
  ): Promise<ContractTransactionResult> {
    try {
      if (!this.provider) throw new Error('Provider not initialized')
      const signer = await this.getSigner(address, password)
      const contract = new ethers.Contract(
        getContractAddress(),
        CreatorHubABI,
        signer,
      )
      const tx = await contract.batchClaimWorks(
        workCids,
        titles,
        descriptions,
        workTypes,
        imgCids,
      )
      console.log('Batch claim works tx sent:', tx.hash)
      const receipt = await waitForTransaction(tx, rpcConnectorInstance.getProvider())
      if (receipt && receipt.status === 1) {
        return { success: true, txHash: tx.hash }
      }
      return { success: false, error: 'Transaction failed' }
    } catch (error: any) {
      console.error('Failed to batch claim works:', error)
      return { success: false, error: error.message || 'Failed to batch claim works', rawError: error }
    }
  }

  /**
   * Get work info.
   * Queries basic info for a work including owner, claim time, transfer count, etc.
   * @param workCid Work CID
   * @returns Detailed work info
   */
  async getWorkInfo(workCid: string): Promise<WorkInfo> {
    try {
      if (!this.contract) throw new Error('Contract not initialized')
      const w = await this.contract.getWorkInfo(workCid)
      return {
        ownerUsername: w.ownerUsername,
        workCid: w.workCid,
        claimedAt: Number(w.claimedAt),
        transferCount: Number(w.transferCount),
        workType: Number(w.workType),
      }
    } catch (error: any) {
      console.error('Failed to get work info:', error)
      throw new Error(error.message || 'Failed to get work info')
    }
  }

  /**
   * Get work tip statistics.
   * Queries total tips and ranking status for a work in the current jackpot epoch.
   * @param workCid Work CID
   * @param token Token address, defaults to Native FIL
   * @returns Tip statistics info
   */
  async getWorkTipStats(
    workCid: string,
    token: string = NATIVE_FIL,
  ): Promise<WorkTipStats> {
    try {
      if (!this.contract) throw new Error('Contract not initialized')
      const stats = await this.contract.getWorkTipStats(token, workCid)
      return {
        totalAmount: ethers.formatEther(stats.totalAmount),
        lastEpoch: Number(stats.lastEpoch),
        isLeader: stats.isLeader,
      }
    } catch (error: any) {
      console.error('Failed to get work stats:', error)
      throw new Error(error.message || 'Failed to get work stats')
    }
  }

  /**
   * Get work creator address.
   * Queries the wallet address of the current owner by work CID.
   * @param workCid Work CID
   * @returns Creator wallet address
   */
  async getWorkCreator(workCid: string): Promise<string> {
    try {
      if (!this.contract) throw new Error('Contract not initialized')
      return await this.contract.getWorkCreator(workCid)
    } catch (error: any) {
      console.error('Failed to get work creator:', error)
      throw new Error(error.message || 'Failed to get work creator')
    }
  }

  /**
   * Transfer work ownership.
   * Transfers a work to another registered creator.
   * @param address Wallet address
   * @param password Wallet password
   * @param workCid Work CID
   * @param newOwner New owner address (must be a registered creator)
   * @returns Transaction result
   */
  async transferWork(
    address: string,

    password: string,
    workCid: string,
    newOwner: string,
  ): Promise<ContractTransactionResult> {
    try {
      if (!this.provider) throw new Error('Provider not initialized')
      const signer = await this.getSigner(address, password)
      const contract = new ethers.Contract(
        getContractAddress(),
        CreatorHubABI,
        signer,
      )
      const tx = await contract.transferWork(workCid, newOwner)
      console.log('Transfer work tx sent:', tx.hash)
      const receipt = await waitForTransaction(tx, rpcConnectorInstance.getProvider())
      if (receipt && receipt.status === 1) {
        return { success: true, txHash: tx.hash }
      }
      return { success: false, error: 'Transaction failed' }
    } catch (error: any) {
      console.error('Failed to transfer work:', error)
      return { success: false, error: error.message || 'Failed to transfer work', rawError: error }
    }
  }

  /**
   * Delete work.
   * Deletes work record and related data from the chain; irreversible.
   * @param address Wallet address
   * @param password Wallet password
   * @param workCid Work CID
   * @returns Transaction result
   */
  async deleteWork(
    address: string,

    password: string,
    workCid: string,
  ): Promise<ContractTransactionResult> {
    try {
      if (!this.provider) throw new Error('Provider not initialized')
      const signer = await this.getSigner(address, password)
      const contract = new ethers.Contract(
        getContractAddress(),
        CreatorHubABI,
        signer,
      )
      const tx = await contract.deleteWork(workCid)
      console.log('Delete work tx sent:', tx.hash)
      const receipt = await waitForTransaction(tx, rpcConnectorInstance.getProvider())
      if (receipt && receipt.status === 1) {
        return { success: true, txHash: tx.hash }
      }
      return { success: false, error: 'Transaction failed' }
    } catch (error: any) {
      console.error('Failed to delete work:', error)
      return { success: false, error: error.message || 'Failed to delete work', rawError: error }
    }
  }

  /**
   * Update work metadata (lazy update)
   * Empty string means no update for string fields, type(uint256).max means no update for workType
   * @param address Wallet address
   * @param password Wallet password
   * @param workCid Work CID
   * @param title New title (empty string = no update)
   * @param description New description (empty string = no update)
   * @param workType New work type (pass max uint256 to skip update)
   * @param imgCid New preview image CID (empty string = no update)
   * @returns Transaction result
   */
  async updateWork(
    address: string,
    password: string,
    workCid: string,
    title: string = '',
    description: string = '',
    workType: bigint = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'),
    imgCid: string = '',
  ): Promise<ContractTransactionResult> {
    try {
      if (!this.provider) throw new Error('Provider not initialized')
      const signer = await this.getSigner(address, password)
      const contract = new ethers.Contract(
        getContractAddress(),
        CreatorHubABI,
        signer,
      )
      const tx = await contract.updateWork(
        workCid,
        title,
        description,
        workType,
        imgCid,
      )
      console.log('Update work tx sent:', tx.hash)
      const receipt = await waitForTransaction(tx, rpcConnectorInstance.getProvider())
      if (receipt && receipt.status === 1) {
        return { success: true, txHash: tx.hash }
      }
      return { success: false, error: 'Transaction failed' }
    } catch (error: any) {
      console.error('Failed to update work:', error)
      return { success: false, error: error.message || 'Failed to update work', rawError: error }
    }
  }

  /**
   * Check if work exists
   * Query whether a work CID has been claimed
   * @param workCid Work CID
   * @returns Whether it exists
   */
  async workExists(workCid: string): Promise<boolean> {
    try {
      if (!this.contract) throw new Error('Contract not initialized')
      return await this.contract.workExists(workCid)
    } catch (error: any) {
      console.error('Failed to check work existence:', error)
      return false
    }
  }

  // ==================== Tip Function ====================

  /**
   * Approve ERC20 token spending
   * Allows the CreatorHub contract to spend tokens on behalf of the user
   * @param address Wallet address
   * @param password Wallet password
   * @param tokenAddress ERC20 token contract address
   * @param amount Amount to approve (in ether units)
   * @returns Transaction result
   */
  async approveToken(
    address: string,
    password: string,
    tokenAddress: string,
    amount: string,
  ): Promise<ContractTransactionResult> {
    try {
      if (!this.provider) throw new Error('Provider not initialized')
      const signer = await this.getSigner(address, password)
      
      // ERC20 ABI for approve function
      const erc20ABI = [
        'function approve(address spender, uint256 amount) returns (bool)',
        'function allowance(address owner, address spender) view returns (uint256)',
      ]
      
      const tokenContract = new ethers.Contract(tokenAddress, erc20ABI, signer)
      const amountWei = ethers.parseEther(amount)
      
      console.log('Approving token spend:', { tokenAddress, amount, amountWei: amountWei.toString() })
      
      const tx = await tokenContract.approve(getContractAddress(), amountWei)
      console.log('Approval tx sent:', tx.hash)
      
      const receipt = await waitForTransaction(tx, rpcConnectorInstance.getProvider())
      if (receipt && receipt.status === 1) {
        return { success: true, txHash: tx.hash }
      }
      return { success: false, error: 'Approval transaction failed' }
    } catch (error: any) {
      console.error('Failed to approve token:', error)
      return { success: false, error: error.message || 'Failed to approve token', rawError: error }
    }
  }

  /**
   * Check ERC20 token allowance
   * Returns the amount of tokens the CreatorHub contract is allowed to spend
   * @param ownerAddress Token owner address
   * @param tokenAddress ERC20 token contract address
   * @returns Allowance amount in ether units
   */
  async checkAllowance(
    ownerAddress: string,
    tokenAddress: string,
  ): Promise<string> {
    try {
      if (!this.provider) throw new Error('Provider not initialized')
      
      const erc20ABI = [
        'function allowance(address owner, address spender) view returns (uint256)',
      ]
      
      const tokenContract = new ethers.Contract(tokenAddress, erc20ABI, this.provider)
      const allowance = await tokenContract.allowance(ownerAddress, getContractAddress())
      
      return ethers.formatEther(allowance)
    } catch (error: any) {
      console.error('Failed to check allowance:', error)
      return '0'
    }
  }

  /**
   * Tip a work.
   * Tips a work; automatically distributes: 80% to creator, 1% platform fee, 19% to jackpot pool.
   * May trigger jackpot leader change and epoch extension.
   * @param address Wallet address
   * @param password Wallet password
   * @param workCid Work CID
   * @param amount Tip amount (FIL or token)
   * @param token Token address, defaults to Native FIL
   * @returns Transaction result
   */
  async tipWork(
    address: string,

    password: string,
    workCid: string,
    amount: string,
    token: string = NATIVE_FIL,
    message: string = '',
  ): Promise<ContractTransactionResult> {
    try {
      if (!this.provider) throw new Error('Provider not initialized')
      
      // For ERC20 tokens, check and approve if needed
      // ERC20 tokens require approval before spending
      if (token !== NATIVE_FIL) {
        const allowance = await this.checkAllowance(address, token)
        const amountNeeded = parseFloat(amount)
        const currentAllowance = parseFloat(allowance)
        
        console.log('Token allowance check:', { currentAllowance, amountNeeded, token })
        
        if (currentAllowance < amountNeeded) {
          console.log('Insufficient allowance, requesting approval...')
          const approvalResult = await this.approveToken(address, password, token, amount)
          
          if (!approvalResult.success) {
            return {
              success: false,
              error: 'Token approval failed: ' + (approvalResult.error || 'Unknown error'),
              rawError: approvalResult.rawError,
            }
          }
          
          console.log('Token approval successful:', approvalResult.txHash)
        }
      }
      
      const signer = await this.getSigner(address, password)
      const contract = new ethers.Contract(
        getContractAddress(),
        CreatorHubABI,
        signer,
      )
      const amountWei = ethers.parseEther(amount)
      const tx = await contract.tip(workCid, token, amountWei, message, {
        value: token === NATIVE_FIL ? amountWei : 0n,
      })
      console.log('Tip tx sent:', tx.hash)
      const receipt = await waitForTransaction(tx, rpcConnectorInstance.getProvider())
      if (receipt && receipt.status === 1) {
        return { success: true, txHash: tx.hash }
      }
      return { success: false, error: 'Transaction failed' }
    } catch (error: any) {
      console.error('Failed to tip:', error)
      return { success: false, error: error.message || 'Failed to tip', rawError: error }
    }
  }

  /**
   * Get minimum tip amount.
   * Queries the minimum tip limit set by the contract.
   * @returns Minimum tip amount (FIL)
   */
  async getMinTipAmount(): Promise<string> {
    try {
      if (!this.contract) throw new Error('Contract not initialized')
      const amount = await this.contract.minTipAmount()
      return ethers.formatEther(amount)
    } catch (error: any) {
      console.error('Failed to get min tip amount:', error)
      throw new Error(error.message || 'Failed to get minimum tip amount')
    }
  }

  // ==================== Balance Management ====================

  /**
   * Get user balance.
   * Queries the user's withdrawable balance in the contract (from tip shares, jackpot prizes, etc.).
   * @param address User address
   * @param token Token address, defaults to Native FIL
   * @returns Balance (FIL or token)
   */
  async getBalance(
    address: string,
    token: string = NATIVE_FIL,
  ): Promise<string> {
    try {
      if (!this.contract) throw new Error('Contract not initialized')
      const balance = await this.contract.getBalance(address, token)
      return ethers.formatEther(balance)
    } catch (error: any) {
      console.error('Failed to get balance:', error)
      throw new Error(error.message || 'Failed to get balance')
    }
  }

  /**
   * Batch get user balances.
   * Queries the user's balance for multiple tokens at once.
   * @param address User address
   * @param tokens Array of token addresses
   * @returns Array of balances
   */
  async getBalances(address: string, tokens: string[]): Promise<string[]> {
    try {
      if (!this.contract) throw new Error('Contract not initialized')
      const balances = await this.contract.getBalances(address, tokens)
      return balances.map((b: bigint) => ethers.formatEther(b))
    } catch (error: any) {
      console.error('Failed to batch get balances:', error)
      throw new Error(error.message || 'Failed to batch get balances')
    }
  }

  /**
   * Withdraw balance.
   * Withdraws balance from the contract to the wallet; supports Native FIL and ERC20 tokens.
   * Can withdraw even when contract is paused.
   * @param address Wallet address
   * @param password Wallet password
   * @param token Token address, defaults to Native FIL
   * @returns Transaction result
   */
  async withdraw(
    address: string,

    password: string,
    token: string = NATIVE_FIL,
  ): Promise<ContractTransactionResult> {
    try {
      if (!this.provider) throw new Error('Provider not initialized')
      const signer = await this.getSigner(address, password)
      const contract = new ethers.Contract(
        getContractAddress(),
        CreatorHubABI,
        signer,
      )
      const tx = await contract.withdraw(token)
      console.log('Withdraw tx sent:', tx.hash)
      const receipt = await waitForTransaction(tx, rpcConnectorInstance.getProvider())
      if (receipt && receipt.status === 1) {
        return { success: true, txHash: tx.hash }
      }
      return { success: false, error: 'Transaction failed' }
    } catch (error: any) {
      console.error('Failed to withdraw:', error)
      return { success: false, error: error.message || 'Failed to withdraw', rawError: error }
    }
  }

  // ==================== Account Market Function ====================

  /**
   * Set minimum offer price.
   * Sets the minimum offer price for the account; 0 means not for sale.
   * @param address Wallet address
   * @param password Wallet password
   * @param minOfferPrice Minimum offer price (FIL); 0 means not for sale
   * @returns Transaction result
   */
  async setMinOfferPrice(
    address: string,

    password: string,
    minOfferPrice: string,
  ): Promise<ContractTransactionResult> {
    try {
      if (!this.provider) throw new Error('Provider not initialized')
      const signer = await this.getSigner(address, password)
      const contract = new ethers.Contract(
        getContractAddress(),
        CreatorHubABI,
        signer,
      )
      const tx = await contract.setMinOfferPrice(
        ethers.parseEther(minOfferPrice),
      )
      console.log('Set min offer tx sent:', tx.hash)
      const receipt = await waitForTransaction(tx, rpcConnectorInstance.getProvider())
      if (receipt && receipt.status === 1) {
        return { success: true, txHash: tx.hash }
      }
      return { success: false, error: 'Transaction failed' }
    } catch (error: any) {
      console.error('Failed to set min offer:', error)
      return { success: false, error: error.message || 'Failed to set minimum offer price', rawError: error }
    }
  }

  /**
   * Make an offer on an account.
   * Places a bid to buy the target account; FIL is locked in the contract; buyer must not already own an account.
   * @param address Wallet address
   * @param password Wallet password
   * @param username Target username
   * @param amount Bid amount (FIL)
   * @param message Message (≤128 characters)
   * @returns Transaction result
   */
  async makeOffer(
    address: string,

    password: string,
    username: string,
    amount: string,
    message: string = '',
  ): Promise<ContractTransactionResult> {
    try {
      if (!this.provider) throw new Error('Provider not initialized')
      const signer = await this.getSigner(address, password)
      const contract = new ethers.Contract(
        getContractAddress(),
        CreatorHubABI,
        signer,
      )
      const amountWei = ethers.parseEther(amount)
      const tx = await contract.makeOffer(username, message, {
        value: amountWei,
      })
      console.log('Bid tx sent:', tx.hash)
      const receipt = await waitForTransaction(tx, rpcConnectorInstance.getProvider())
      if (receipt && receipt.status === 1) {
        return { success: true, txHash: tx.hash }
      }
      return { success: false, error: 'Transaction failed' }
    } catch (error: any) {
      console.error('Failed to bid:', error)
      return { success: false, error: error.message || 'Failed to place bid', rawError: error }
    }
  }

  /**
   * Withdraw offer.
   * Withdraws the bid on an account; refunds FIL to wallet.
   * @param address Wallet address
   * @param password Wallet password
   * @param username Target username
   * @returns Transaction result
   */
  async withdrawOffer(
    address: string,

    password: string,
    username: string,
  ): Promise<ContractTransactionResult> {
    try {
      if (!this.provider) throw new Error('Provider not initialized')
      const signer = await this.getSigner(address, password)
      const contract = new ethers.Contract(
        getContractAddress(),
        CreatorHubABI,
        signer,
      )
      const tx = await contract.withdrawOffer(username)
      console.log('Withdraw bid tx sent:', tx.hash)
      const receipt = await waitForTransaction(tx, rpcConnectorInstance.getProvider())
      if (receipt && receipt.status === 1) {
        return { success: true, txHash: tx.hash }
      }
      return { success: false, error: 'Transaction failed' }
    } catch (error: any) {
      console.error('Failed to withdraw bid:', error)
      return { success: false, error: error.message || 'Failed to withdraw bid', rawError: error }
    }
  }

  /**
   * Accept offer.
   * Accepts a buyer's bid; transfers account ownership; bid amount is credited to original owner's balance.
   * @param address Wallet address
   * @param password Wallet password
   * @param buyer Buyer address
   * @returns Transaction result
   */
  async acceptOffer(
    address: string,

    password: string,
    buyer: string,
  ): Promise<ContractTransactionResult> {
    try {
      if (!this.provider) throw new Error('Provider not initialized')
      const signer = await this.getSigner(address, password)
      const contract = new ethers.Contract(
        getContractAddress(),
        CreatorHubABI,
        signer,
      )
      const tx = await contract.acceptOffer(buyer)
      console.log('Accept bid tx sent:', tx.hash)
      const receipt = await waitForTransaction(tx, rpcConnectorInstance.getProvider())
      if (receipt && receipt.status === 1) {
        return { success: true, txHash: tx.hash }
      }
      return { success: false, error: 'Transaction failed' }
    } catch (error: any) {
      console.error('Failed to accept bid:', error)
      return { success: false, error: error.message || 'Failed to accept bid', rawError: error }
    }
  }

  /**
   * Get account offer info.
   * Queries the bid details for a specified buyer on an account.
   * @param username Target username
   * @param buyer Buyer address
   * @returns Bid info
   */
  async getAccountOffer(
    username: string,
    buyer: string,
  ): Promise<AccountOffer> {
    try {
      if (!this.contract) throw new Error('Contract not initialized')
      const o = await this.contract.getAccountOffer(username, buyer)
      return {
        buyer: o.buyer,
        amount: ethers.formatEther(o.amount),
        timestamp: Number(o.timestamp),
        active: o.active,
      }
    } catch (error: any) {
      console.error('Failed to get bid info:', error)
      throw new Error(error.message || 'Failed to get bid info')
    }
  }

  /**
   * Check if there is an active offer.
   * Quickly checks if a buyer has an active bid on an account.
   * @param username Target username
   * @param buyer Buyer address
   * @returns Whether there is an active bid
   */
  async hasActiveOffer(username: string, buyer: string): Promise<boolean> {
    try {
      if (!this.contract) throw new Error('Contract not initialized')
      return await this.contract.hasActiveOffer(username, buyer)
    } catch (error: any) {
      console.error('Failed to check bid:', error)
      return false
    }
  }

  // ==================== Event Listening ====================

  /**
   * Listen to tipping events.
   * Listens to on-chain tipping transactions in real-time.
   * @param callback Event callback function
   */
  onTipped(callback: (event: any) => void): void {
    if (!this.contract) throw new Error('Contract not initialized')
    this.contract.on(
      'Tipped',
      (
        tipper,
        creator,
        workCid,
        token,
        amountSent,
        creatorShare,
        platformFee,
        jackpotFee,
        timestamp,
        event,
      ) => {
        callback({
          tipper,
          creator,
          workCid,
          token,
          amountSent: ethers.formatEther(amountSent),
          creatorShare: ethers.formatEther(creatorShare),
          platformFee: ethers.formatEther(platformFee),
          jackpotFee: ethers.formatEther(jackpotFee),
          timestamp: Number(timestamp),
          blockNumber: event.log.blockNumber,
          transactionHash: event.log.transactionHash,
        })
      },
    )
  }

  /**
   * Listen to jackpot extension events.
   * Listens to jackpot epoch extensions (anti-snipe mechanism triggered).
   * @param callback Event callback function
   */
  onJackpotExtended(callback: (event: any) => void): void {
    if (!this.contract) throw new Error('Contract not initialized')
    this.contract.on(
      'JackpotExtended',
      (
        token,
        oldEndTime,
        newEndTime,
        leaderWorkHash,
        extensionCount,
        event,
      ) => {
        callback({
          token,
          oldEndTime: Number(oldEndTime),
          newEndTime: Number(newEndTime),
          leaderWorkHash,
          extensionCount: Number(extensionCount),
          blockNumber: event.log.blockNumber,
          transactionHash: event.log.transactionHash,
        })
      },
    )
  }

  /**
   * Listen to jackpot settlement events.
   * Listens to jackpot epoch settlement and prize distribution.
   * @param callback Event callback function
   */
  onJackpotSettled(callback: (event: any) => void): void {
    if (!this.contract) throw new Error('Contract not initialized')
    this.contract.on(
      'JackpotSettled',
      (winner, token, amount, epoch, winnerWorkHash, timestamp, event) => {
        callback({
          winner,
          token,
          amount: ethers.formatEther(amount),
          epoch: Number(epoch),
          winnerWorkHash,
          timestamp: Number(timestamp),
          blockNumber: event.log.blockNumber,
          transactionHash: event.log.transactionHash,
        })
      },
    )
  }

  /**
   * Listen to jackpot leader change events.
   * Listens to changes in the jackpot leaderboard leader.
   * @param callback Event callback function
   */
  onJackpotLeaderChanged(callback: (event: any) => void): void {
    if (!this.contract) throw new Error('Contract not initialized')
    this.contract.on(
      'JackpotLeaderChanged',
      (token, workHash, creator, totalTips, epoch, event) => {
        callback({
          token,
          workHash,
          creator,
          totalTips: ethers.formatEther(totalTips),
          epoch: Number(epoch),
          blockNumber: event.log.blockNumber,
          transactionHash: event.log.transactionHash,
        })
      },
    )
  }

  /**
   * Listen to creator registration events.
   * Listens to new creator registrations.
   * @param callback Event callback function
   */
  onCreatorRegistered(callback: (event: any) => void): void {
    if (!this.contract) throw new Error('Contract not initialized')
    this.contract.on(
      'CreatorRegistered',
      (
        creatorAddress,
        username,
        avatarCid,
        backgroundCid,
        ipnsAddress,
        ipnsSignature,
        title,
        description,
        minOfferPrice,
        timestamp,
        event,
      ) => {
        callback({
          creatorAddress,
          username,
          avatarCid,
          backgroundCid,
          ipnsAddress,
          ipnsSignature,
          title,
          description,
          minOfferPrice: ethers.formatEther(minOfferPrice),
          timestamp: Number(timestamp),
          blockNumber: event.log.blockNumber,
          transactionHash: event.log.transactionHash,
        })
      },
    )
  }

  /**
   * Listen to work claim events.
   * Listens to new work claims.
   * @param callback Event callback function
   */
  onWorkClaimed(callback: (event: any) => void): void {
    if (!this.contract) throw new Error('Contract not initialized')
    this.contract.on(
      'WorkClaimed',
      (
        creatorAddress,
        workCid,
        ownerUsername,
        title,
        description,
        workType,
        imgCid,
        claimedAt,
        transferCount,
        event,
      ) => {
        callback({
          creatorAddress,
          workCid,
          ownerUsername,
          title,
          description,
          workType: Number(workType),
          imgCid,
          claimedAt: Number(claimedAt),
          transferCount: Number(transferCount),
          blockNumber: event.log.blockNumber,
          transactionHash: event.log.transactionHash,
        })
      },
    )
  }

  /**
   * Remove all event listeners.
   * Cleans up all registered event listeners.
   */
  removeAllListeners(): void {
    if (this.contract) {
      this.contract.removeAllListeners()
    }
  }

  // ==================== History Query ====================

  /**
   * Get recent tip records.
   * Queries recent tipping transaction history (queries up to the last 10000 blocks).
   * @param limit Limit on the number of records returned, defaults to 20
   * @returns Array of tip records
   */
  async getRecentTips(limit: number = 20): Promise<TipRecord[]> {
    try {
      if (!this.contract) throw new Error('Contract not initialized')
      const filter = this.contract.filters.Tipped()
      const currentBlock = await this.provider!.getBlockNumber()
      const fromBlock = Math.max(0, currentBlock - 10000)
      const events = await this.contract.queryFilter(
        filter,
        fromBlock,
        currentBlock,
      )
      const sortedEvents = events
        .sort((a, b) => b.blockNumber - a.blockNumber)
        .slice(0, limit)
      const records: TipRecord[] = []
      for (const event of sortedEvents) {
        const block = await this.provider!.getBlock(event.blockNumber)
        if ('args' in event) {
          const args = event.args as any
          records.push({
            tipper: args.tipper,
            creator: args.creator,
            workCid: args.workCid,
            token: args.token,
            amount: ethers.formatEther(args.amountSent),
            creatorShare: ethers.formatEther(args.creatorShare),
            platformFee: ethers.formatEther(args.platformFee),
            jackpotFee: ethers.formatEther(args.jackpotFee),
            timestamp: new Date((block?.timestamp || 0) * 1000).toISOString(),
            txHash: event.transactionHash,
          })
        }
      }
      return records
    } catch (error: any) {
      console.error('Failed to get recent tips:', error)
      return []
    }
  }

  // ==================== Contract Health and Constants ====================

  /**
   * Get contract health status.
   * Queries the contract's financial health, including actual balance, total liabilities, surplus, etc.
   * @param token Token address, defaults to Native FIL
   * @returns Contract health info
   */
  async getContractHealth(token: string = NATIVE_FIL): Promise<ContractHealth> {
    try {
      if (!this.contract) throw new Error('Contract not initialized')
      const health = await this.contract.getContractHealth(token)
      return {
        actualBalance: ethers.formatEther(health.actualBalance),
        totalLiabilitiesAmount: ethers.formatEther(
          health.totalLiabilitiesAmount,
        ),
        surplus: ethers.formatEther(health.surplus),
        isHealthy: health.isHealthy,
      }
    } catch (error: any) {
      console.error('Failed to get contract health:', error)
      throw new Error(error.message || 'Failed to get contract health status')
    }
  }

  /**
   * Get contract constants.
   * Queries the contract's core configuration constants, including fee rates, epoch times, etc.
   * @returns Contract constants configuration
   */
  async getContractConstants(): Promise<{
    bpsDenominator: number // basis point denominator (10000)
    platformFeeBps: number // platform fee rate (100 = 1%)
    jackpotFeeBps: number // jackpot fee rate (1900 = 19%)
    creatorShareBps: number // creator share (8000 = 80%)
    jackpotDuration: number // jackpot duration (7 days)
    snipeProtectionTime: number // anti-snipe protection time (30 minutes)
    minLeadIncreaseBps: number // minimum lead increase (500 = 5%)
    maxExtensions: number // maximum extensions (10)
  }> {
    try {
      if (!this.contract) throw new Error('Contract not initialized')
      const [
        bpsDenominator,
        platformFeeBps,
        jackpotFeeBps,
        creatorShareBps,
        jackpotDuration,
        snipeProtectionTime,
        minLeadIncreaseBps,
        maxExtensions,
      ] = await Promise.all([
        this.contract.BPS_DENOMINATOR(),
        this.contract.PLATFORM_FEE_BPS(),
        this.contract.JACKPOT_FEE_BPS(),
        this.contract.CREATOR_SHARE_BPS(),
        this.contract.JACKPOT_DURATION(),
        this.contract.SNIPE_PROTECTION_TIME(),
        this.contract.MIN_LEAD_INCREASE_BPS(),
        this.contract.MAX_EXTENSIONS(),
      ])
      return {
        bpsDenominator: Number(bpsDenominator),
        platformFeeBps: Number(platformFeeBps),
        jackpotFeeBps: Number(jackpotFeeBps),
        creatorShareBps: Number(creatorShareBps),
        jackpotDuration: Number(jackpotDuration),
        snipeProtectionTime: Number(snipeProtectionTime),
        minLeadIncreaseBps: Number(minLeadIncreaseBps),
        maxExtensions: Number(maxExtensions),
      }
    } catch (error: any) {
      console.error('Failed to get contract constants:', error)
      throw new Error(error.message || 'Failed to get contract constants')
    }
  }

  /**
   * Get contract version.
   * Queries the current contract version number.
   * @returns Version string
   */
  async getVersion(): Promise<string> {
    try {
      if (!this.contract) throw new Error('Contract not initialized')
      return await this.contract.version()
    } catch (error: any) {
      console.error('Failed to get contract version:', error)
      throw new Error(error.message || 'Failed to get contract version')
    }
  }
}

// Export singleton instance
export const creatorHubMgr = new CreatorHubManager()
export default creatorHubMgr
