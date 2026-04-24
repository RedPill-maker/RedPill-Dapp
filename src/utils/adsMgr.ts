/**
 * Ads Manager
 *
 * Wraps AdSpaceManager contract calls (v3 multi-ad-group architecture)
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
import AdSpaceManagerABI from '../../contract_info/AdSpaceManager_abi.json'
import { NETWORK_CONTRACTS } from '../../config'

// ==================== Interface Definition ====================

export interface AdGroup {
  adGroupId: number
  creator: string
  adSpaceCount: number
  exists: boolean
}

export interface AdSpace {
  id: number
  owner: string
  targetCID: string // content CID (targetCID field in contract)
  protectionExpiry: bigint // dual purpose: display protection & auction deadline
  originalPrice: bigint
  bidder: string
  bidAmount: bigint
  adGroupId: number
}

export interface ContractTransactionResult {
  success: boolean
  txHash?: string
  error?: string
  rawError?: any
}

// ==================== AdsMgr Class ====================

class AdsMgr {
  private contract: ethers.Contract | null = null
  private provider: ethers.JsonRpcProvider | null = null

  constructor() {
    this.initializeProvider()
  }

  private initializeProvider(): void {
    const network = rpcConnectorInstance.getCurrentNetwork()
    const rpcUrl = network.isTestnet
      ? calibration.rpcUrls.default.http[0]
      : mainnet.rpcUrls.default.http[0]
    this.provider = new ethers.JsonRpcProvider(rpcUrl)
    const adsAddress = this.getContractAddress()
    this.contract = new ethers.Contract(adsAddress, AdSpaceManagerABI, this.provider)
  }

  refreshProvider(): void {
    this.initializeProvider()
  }

  private getContractAddress(): string {
    const network = rpcConnectorInstance.getCurrentNetwork()
    const networkId = network.chainId === 'f' ? 'mainnet' : network.chainId === 't' ? 'calibration' : 'localnet'
    return NETWORK_CONTRACTS[networkId]?.ads ?? '0x0000000000000000000000000000000000000000'
  }

  private async getSignedContract(address: string, password: string): Promise<ethers.Contract> {
    if (!this.provider) throw new Error('Provider not initialized')
    const signer = await walletMgr.getSigner(address, password)
    return new ethers.Contract(this.getContractAddress(), AdSpaceManagerABI, signer)
  }

  private ensureContract(): ethers.Contract {
    if (!this.contract) throw new Error('Contract not initialized')
    return this.contract
  }

  // ==================== AdGroup Query ====================

  async getAdGroupByCreator(creatorAddress: string): Promise<AdGroup | null> {
    try {
      const c = this.ensureContract()
      const result = await c.getAdGroupByCreator(creatorAddress)
      return {
        adGroupId: Number(result.adGroupId),
        creator: result.creator,
        adSpaceCount: Number(result.adSpaceCount),
        exists: result.exists,
      }
    } catch {
      return null
    }
  }

  async hasAdGroup(address: string): Promise<boolean> {
    try {
      const c = this.ensureContract()
      return await c.hasAdGroup(address)
    } catch {
      return false
    }
  }

  async getAdGroupInfo(adGroupId: number): Promise<{ creator: string; adSpaceCount: number; exists: boolean } | null> {
    try {
      const c = this.ensureContract()
      const result = await c.getAdGroupInfo(adGroupId)
      return { creator: result.creator, adSpaceCount: Number(result.adSpaceCount), exists: result.exists }
    } catch {
      return null
    }
  }

  async getAdGroupCreationFee(): Promise<string> {
    try {
      const c = this.ensureContract()
      const fee = await c.adGroupCreationFee()
      return ethers.formatEther(fee)
    } catch {
      return '0'
    }
  }

  async getAdGroupAdSpaceIds(adGroupId: number): Promise<number[]> {
    try {
      const c = this.ensureContract()
      const ids: bigint[] = await c.getAdGroupAdSpaceIds(adGroupId)
      return ids.map((id) => Number(id))
    } catch {
      return []
    }
  }

  // ==================== AdSpace Query ====================

  async getAdSpaceCount(): Promise<number> {
    try {
      const c = this.ensureContract()
      return Number(await c.getAdSpaceCount())
    } catch (error: any) {
      console.error('Failed to get ad space count:', error)
      throw new Error(error.message || 'Failed to get ad space count')
    }
  }

  async getAdSpace(id: number): Promise<AdSpace> {
    const c = this.ensureContract()
    const ad = await c.getAdSpace(id)
    return {
      id,
      owner: ad.owner,
      targetCID: ad.targetCID,
      protectionExpiry: ad.protectionExpiry,
      originalPrice: ad.originalPrice,
      bidder: ad.bidder,
      bidAmount: ad.bidAmount,
      adGroupId: Number(ad.adGroupId),
    }
  }

  async getAdSpacesByGroup(adGroupId: number): Promise<AdSpace[]> {
    const ids = await this.getAdGroupAdSpaceIds(adGroupId)
    const spaces: AdSpace[] = []
    for (const id of ids) {
      try {
        spaces.push(await this.getAdSpace(id))
      } catch (err) {
        console.error(`Failed to get ad space ${id}:`, err)
      }
    }
    return spaces
  }

  async getCurrentValue(id: number): Promise<string> {
    const c = this.ensureContract()
    const value = await c.getCurrentValue(id)
    return ethers.formatEther(value)
  }

  async getPendingWithdrawal(address: string): Promise<string> {
    const c = this.ensureContract()
    const amount = await c.pendingWithdrawals(address)
    return ethers.formatEther(amount)
  }

  // ==================== Write Methods ====================

  async createAdGroup(
    address: string,
    password: string,
    value: string,
  ): Promise<ContractTransactionResult> {
    try {
      const contract = await this.getSignedContract(address, password)
      const tx = await contract.createAdGroup({ value: ethers.parseEther(value) })
      const receipt = await waitForTransaction(tx, rpcConnectorInstance.getProvider())
      if (receipt && receipt.status === 1) {
        return { success: true, txHash: tx.hash }
      }
      return { success: false, error: 'Transaction failed' }
    } catch (error: any) {
      console.error('Failed to create ad group:', error)
      return { success: false, error: error.message || 'Failed to create ad group', rawError: error }
    }
  }

  async createAdSpace(
    address: string,
    password: string,
    adGroupId: number,
    targetCID: string,
    value: string,
  ): Promise<ContractTransactionResult> {
    try {
      const contract = await this.getSignedContract(address, password)
      const tx = await contract.createAdSpace(adGroupId, targetCID, {
        value: ethers.parseEther(value),
      })
      const receipt = await waitForTransaction(tx, rpcConnectorInstance.getProvider())
      if (receipt && receipt.status === 1) {
        return { success: true, txHash: tx.hash }
      }
      return { success: false, error: 'Transaction failed' }
    } catch (error: any) {
      console.error('Failed to create ad space:', error)
      return { success: false, error: error.message || 'Failed to create ad space', rawError: error }
    }
  }

  async bidAdSpace(
    address: string,
    password: string,
    id: number,
    bidAmount: string,
  ): Promise<ContractTransactionResult> {
    try {
      const contract = await this.getSignedContract(address, password)
      const tx = await contract.bid(id, { value: ethers.parseEther(bidAmount) })
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

  async updateAdContent(
    address: string,
    password: string,
    id: number,
    targetCID: string,
  ): Promise<ContractTransactionResult> {
    try {
      const contract = await this.getSignedContract(address, password)
      const tx = await contract.updateAdContent(id, targetCID)
      const receipt = await waitForTransaction(tx, rpcConnectorInstance.getProvider())
      if (receipt && receipt.status === 1) {
        return { success: true, txHash: tx.hash }
      }
      return { success: false, error: 'Transaction failed' }
    } catch (error: any) {
      console.error('Failed to update ad content:', error)
      return { success: false, error: error.message || 'Failed to update ad content', rawError: error }
    }
  }

  async settle(
    address: string,
    password: string,
    id: number,
  ): Promise<ContractTransactionResult> {
    try {
      const contract = await this.getSignedContract(address, password)
      const tx = await contract.settle(id)
      const receipt = await waitForTransaction(tx, rpcConnectorInstance.getProvider())
      if (receipt && receipt.status === 1) {
        return { success: true, txHash: tx.hash }
      }
      return { success: false, error: 'Transaction failed' }
    } catch (error: any) {
      console.error('Settlement failed:', error)
      return { success: false, error: error.message || 'Settlement failed', rawError: error }
    }
  }

  async withdraw(
    address: string,
    password: string,
  ): Promise<ContractTransactionResult> {
    try {
      const contract = await this.getSignedContract(address, password)
      const tx = await contract.withdraw()
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

  async transferAdGroup(
    address: string,
    password: string,
    toAddress: string,
  ): Promise<ContractTransactionResult> {
    try {
      const contract = await this.getSignedContract(address, password)
      const tx = await contract.transferAdGroup(toAddress)
      const receipt = await waitForTransaction(tx, rpcConnectorInstance.getProvider())
      if (receipt && receipt.status === 1) {
        return { success: true, txHash: tx.hash }
      }
      return { success: false, error: 'Transaction failed' }
    } catch (error: any) {
      console.error('Failed to transfer ad group:', error)
      return { success: false, error: error.message || 'Failed to transfer ad group', rawError: error }
    }
  }

  // ==================== Contract Constants ====================

  async getContractConstants(): Promise<{
    minPrice: string
    protectionPeriod: number
    antiSnipeWindow: number
    settlementWindow: number
    discountCycle: number
    maxDiscountCycles: number
    minBidRatioBps: number
    bidIncrementBps: number
    penaltyBps: number
    creatorProfitShareBps: number
    profitWallet: string
  }> {
    const c = this.ensureContract()
    const [
      minPrice,
      protectionPeriod,
      antiSnipeWindow,
      settlementWindow,
      discountCycle,
      maxDiscountCycles,
      minBidRatioBps,
      bidIncrementBps,
      penaltyBps,
      creatorProfitShareBps,
      profitWallet,
    ] = await Promise.all([
      c.MIN_PRICE(),
      c.PROTECTION_PERIOD(),
      c.ANTI_SNIPE_WINDOW(),
      c.SETTLEMENT_WINDOW(),
      c.DISCOUNT_CYCLE(),
      c.MAX_DISCOUNT_CYCLES(),
      c.MIN_BID_RATIO_BPS(),
      c.BID_INCREMENT_BPS(),
      c.PENALTY_BPS(),
      c.CREATOR_PROFIT_SHARE_BPS(),
      c.PROFIT_WALLET(),
    ])
    return {
      minPrice: ethers.formatEther(minPrice),
      protectionPeriod: Number(protectionPeriod),
      antiSnipeWindow: Number(antiSnipeWindow),
      settlementWindow: Number(settlementWindow),
      discountCycle: Number(discountCycle),
      maxDiscountCycles: Number(maxDiscountCycles),
      minBidRatioBps: Number(minBidRatioBps),
      bidIncrementBps: Number(bidIncrementBps),
      penaltyBps: Number(penaltyBps),
      creatorProfitShareBps: Number(creatorProfitShareBps),
      profitWallet,
    }
  }
}

export const adsMgr = new AdsMgr()
export default adsMgr
