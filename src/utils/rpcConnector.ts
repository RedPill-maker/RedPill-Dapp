/**
 * RPC Connection Manager - Decentralized access using Synapse SDK / RPC 接続マネージャー - Synapse SDK を使用した分散アクセス
 * RPC Connector - Decentralized Access via Synapse SDK / RPC コネクタ - Synapse SDK 経由の分散アクセス
 *
 * Uses Filecoin Synapse SDK for decentralized RPC access and storage services / Filecoin Synapse SDK を使用して分散 RPC アクセスとストレージサービスを実装
 * Uses Filecoin Synapse SDK for decentralized RPC access and storage services / Filecoin Synapse SDK を使用して分散 RPC アクセスとストレージサービスを実装
 */

import { ethers } from 'ethers'
import { Synapse, calibration, mainnet } from '@filoz/synapse-sdk'
import { privateKeyToAccount } from 'viem/accounts'
import { http } from 'viem'
import {
  FILECOIN_NETWORKS,
  FilecoinNetworkConfig,
  APP_CONFIG,
  NETWORK_CONTRACTS,
  FILECOIN_RPC_ENDPOINTS,
  RPC_HEALTH_CHECK_TIMEOUT,
} from '../../config'
import { privateDataMgr } from './privateDataMgr'
import { notifyDbSyncNetworkSwitch } from './dbConnector'

// ==================== RPC Connector class / RPC コネクタークラス ====================

class rpcConnector {
  private currentNetwork: FilecoinNetworkConfig
  private provider: ethers.JsonRpcProvider
  private synapseInstance: Synapse | null = null
  // Resolves when the async RPC health check finishes (or immediately if skipped)
  private providerReady: Promise<void> = Promise.resolve()

  constructor() {
    this.currentNetwork = this.loadCurrentNetwork()
    this.provider = this.createProvider(this.currentNetwork)
    // Notify dbSync of the initial network once the server is ready
    this.notifyDbSyncWhenReady()
  }

  // Get Synapse chain object for current network
  private getSynapseChain() {
    return this.currentNetwork.chainId === 't' ? calibration : mainnet
  }

  // Get the candidate RPC URL list for a network
  private getRpcCandidates(network: FilecoinNetworkConfig): string[] {
    const networkId = network.chainId === 'f' ? 'mainnet' : network.chainId === 't' ? 'calibration' : 'localnet'
    return FILECOIN_RPC_ENDPOINTS[networkId] ?? []
  }

  // Get the primary RPC URL for a network (first candidate or SDK default)
  private getRpcUrl(network: FilecoinNetworkConfig): string {
    const candidates = this.getRpcCandidates(network)
    return candidates[0] ?? (network.chainId === 't' ? calibration : mainnet).rpcUrls.default.http[0]
  }

  // Probe a single RPC endpoint with a timeout; resolves with the URL on success, rejects on failure
  private probeRpc(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), RPC_HEALTH_CHECK_TIMEOUT)
      const probe = new ethers.JsonRpcProvider(url)
      probe
        .send('eth_chainId', [])
        .then(() => {
          clearTimeout(timer)
          resolve(url)
        })
        .catch((err) => {
          clearTimeout(timer)
          reject(err)
        })
    })
  }

  // Create provider using the SDK default immediately, then async swap to the fastest healthy endpoint
  private createProvider(network: FilecoinNetworkConfig): ethers.JsonRpcProvider {
    const candidates = this.getRpcCandidates(network)
    const defaultUrl = candidates[0] ?? (network.chainId === 't' ? calibration : mainnet).rpcUrls.default.http[0]

    // Race all candidates; swap provider once the fastest healthy one responds
    if (candidates.length > 1) {
      this.providerReady = Promise.any(candidates.map((url) => this.probeRpc(url)))
        .then((bestUrl) => {
          if (bestUrl !== defaultUrl) {
            console.log(`Switching to faster healthy RPC endpoint: ${bestUrl}`)
            this.provider = new ethers.JsonRpcProvider(bestUrl)
          }
        })
        .catch(() => {
          console.warn('All RPC endpoints failed health check, keeping default')
        })
    } else {
      this.providerReady = Promise.resolve()
    }

    console.log(`Initializing RPC provider with: ${defaultUrl}`)
    return new ethers.JsonRpcProvider(defaultUrl)
  }

  /**
   * Wait for the async RPC health check to finish before using the provider.
   * Call this before any balance/transaction query to avoid race conditions.
   */
  async ensureProvider(): Promise<void> {
    await this.providerReady
  }

  // Get or create Synapse instance (for advanced features like storage)
  getSynapseInstance(privateKey: string): Synapse {
    const chain = this.getSynapseChain()
    const account = privateKeyToAccount(privateKey as `0x${string}`)

    const synapse = Synapse.create({
      account,
      chain,
      transport: http(chain.rpcUrls.default.http[0]),
      source: APP_CONFIG.NAME,  // DataSet namespace isolation, required for 0.39.0+
    })

    this.synapseInstance = synapse
    return synapse
  }

  // ==================== Network management ====================

  private loadCurrentNetwork(): FilecoinNetworkConfig {
    return privateDataMgr.getCurrentNetwork() || FILECOIN_NETWORKS[0]
  }

  setCurrentNetwork(network: FilecoinNetworkConfig): boolean {
    const success = privateDataMgr.setCurrentNetwork(network)
    if (success) {
      this.currentNetwork = network
      this.provider = this.createProvider(network)
      this.synapseInstance = null
      // Notify dbSync to switch network
      this.notifyDbSync(network)
    }
    return success
  }

  private notifyDbSync(network: FilecoinNetworkConfig): void {
    const networkId = network.chainId === 'f' ? 'mainnet'
      : network.chainId === 't' ? 'calibration'
      : 'localnet'
    const rpcUrl = this.getRpcUrl(network)
    const contracts = NETWORK_CONTRACTS[networkId]
    if (!contracts) return

    notifyDbSyncNetworkSwitch({
      networkId,
      rpcUrl,
      chainId: network.chainId === 'f' ? 314 : network.chainId === 't' ? 314159 : 31415926,
      contractAddress: contracts.creator_hub,
      adsAddress: contracts.ads,
      deployBlock: contracts.deploy_block,
    }).catch((err) => console.warn('Failed to notify dbSync of network switch:', err))
  }

  /**
   * On startup, retry sending the initial network config until dbSync is reachable.
   */
  private notifyDbSyncWhenReady(attempt = 0): void {
    const delays = [1000, 3000, 6000, 12000, 20000, 30000, 45000, 60000]
    const delay = delays[Math.min(attempt, delays.length - 1)]
    setTimeout(() => {
      const networkId = this.currentNetwork.chainId === 'f' ? 'mainnet'
        : this.currentNetwork.chainId === 't' ? 'calibration'
        : 'localnet'
      const rpcUrl = this.getRpcUrl(this.currentNetwork)
      const contracts = NETWORK_CONTRACTS[networkId]
      if (!contracts) return

      notifyDbSyncNetworkSwitch({
        networkId,
        rpcUrl,
        chainId: this.currentNetwork.chainId === 'f' ? 314 : this.currentNetwork.chainId === 't' ? 314159 : 31415926,
        contractAddress: contracts.creator_hub,
        adsAddress: contracts.ads,
        deployBlock: contracts.deploy_block,
      }).then(() => {
        console.log(`dbSync notified of initial network: ${networkId}`)
      }).catch(() => {
        // dbSync not ready yet, retry
        if (attempt < delays.length - 1) {
          this.notifyDbSyncWhenReady(attempt + 1)
        } else {
          console.error('Failed to notify dbSync after all retries. dbSync may not be running.')
        }
      })
    }, delay)
  }

  getCurrentNetwork(): FilecoinNetworkConfig {
    return this.currentNetwork
  }

  getNetworkByName(name: string): FilecoinNetworkConfig | undefined {
    return FILECOIN_NETWORKS.find((n) => n.name === name)
  }

  getAvailableNetworks(): FilecoinNetworkConfig[] {
    return FILECOIN_NETWORKS
  }

  async getNetworkInfo() {
    try {
      const blockNumber = await this.provider.getBlockNumber()
      const feeData = await this.provider.getFeeData()
      const rpcUrl = this.getRpcUrl(this.currentNetwork)

      return {
        name: this.currentNetwork.name,
        chainId: this.currentNetwork.chainId,
        blockNumber,
        gasPrice: ethers.formatUnits(feeData.gasPrice || 0n, 'gwei') + ' Gwei',
        rpcUrl,
        decentralized: true,
      }
    } catch (error) {
      console.error('Error getting network info:', error)
      throw error
    }
  }

  // ==================== Balance query ====================

  async getWalletBalance(address: string): Promise<{
    success: boolean
    balance?: string
    error?: string
    isRealData?: boolean
  }> {
    try {
      await this.ensureProvider()
      console.log(
        `Getting balance for address: ${address} on network: ${this.currentNetwork.name}`,
      )

      const balance = await this.provider.getBalance(address)
      const balanceInFil = ethers.formatEther(balance)

      console.log(`Balance: ${balanceInFil} FIL`)

      return {
        success: true,
        balance: balanceInFil,
        isRealData: true,
      }
    } catch (error: any) {
      console.error('Error getting balance:', error)

      if (
        error.message?.includes('actor not found') ||
        error.message?.includes('not found')
      ) {
        return {
          success: true,
          balance: '0',
          isRealData: true,
        }
      }

      return {
        success: false,
        error: error.message || 'Failed to get balance',
      }
    }
  }

  // ERC20 Token ABI (only need balanceOf method)
  private readonly ERC20_ABI = [
    'function balanceOf(address owner) view returns (uint256)',
  ]

  async getTokenBalance(
    walletAddress: string,
    tokenAddress: string,
  ): Promise<{ success: boolean; balance?: string; error?: string }> {
    try {
      await this.ensureProvider()
      // If native FIL (address is 0x0000...), use getWalletBalance
      if (tokenAddress === '0x0000000000000000000000000000000000000000') {
        return await this.getWalletBalance(walletAddress)
      }

      // Create ERC20 contract instance
      const contract = new ethers.Contract(
        tokenAddress,
        this.ERC20_ABI,
        this.provider,
      )

      // Get token balance
      const balance = await contract.balanceOf(walletAddress)
      const balanceFormatted = ethers.formatEther(balance)

      return {
        success: true,
        balance: balanceFormatted,
      }
    } catch (error: any) {
      console.error(`Error getting token balance for ${tokenAddress}:`, error)

      // If contract doesn't exist, address is invalid, or data cannot be decoded, return 0
      if (
        error.message?.includes('actor not found') ||
        error.message?.includes('not found') ||
        error.message?.includes('invalid address') ||
        error.message?.includes('could not decode result data') ||
        error.code === 'BAD_DATA'
      ) {
        return {
          success: true,
          balance: '0',
        }
      }

      return {
        success: false,
        error: error.message || 'Failed to get token balance',
      }
    }
  }

  // ==================== Transaction sending ====================

  async sendTransaction(
    fromAddress: string,
    toAddress: string,
    amount: string,
    privateKey: string,
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      console.log(`Sending transaction on ${this.currentNetwork.name}:`, {
        from: fromAddress,
        to: toAddress,
        amount: amount + ' FIL',
      })

      const amountFloat = parseFloat(amount)
      if (isNaN(amountFloat) || amountFloat <= 0) {
        return { success: false, error: 'Invalid transfer amount' }
      }

      const wallet = new ethers.Wallet(privateKey, this.provider)

      if (wallet.address.toLowerCase() !== fromAddress.toLowerCase()) {
        return {
          success: false,
          error: `Private key does not match sender address. Generated: ${wallet.address}, expected: ${fromAddress}`,
        }
      }

      const tx = await wallet.sendTransaction({
        to: toAddress,
        value: ethers.parseEther(amount),
      })

      console.log('Transaction sent:', tx.hash)

      const receipt = await waitForTransaction(tx, this.provider)

      if (receipt && receipt.status === 1) {
        console.log('Transaction confirmed in block:', receipt.blockNumber)
        return { success: true, txHash: tx.hash }
      } else {
        return { success: false, error: 'Transaction failed' }
      }
    } catch (error: any) {
      console.error('Error sending transaction:', error)
      return { success: false, error: error.message || 'Failed to send transaction' }
    }
  }

  // ==================== Gas estimation ====================

  async estimateGas(
    fromAddress: string,
    toAddress: string,
    amount: string,
  ): Promise<{ success: boolean; gasEstimate?: string; error?: string }> {
    try {
      const gasLimit = await this.provider.estimateGas({
        from: fromAddress,
        to: toAddress,
        value: ethers.parseEther(amount),
      })

      const feeData = await this.provider.getFeeData()
      const gasPrice = feeData.gasPrice || 0n
      const totalCost = gasLimit * gasPrice
      const totalCostInFil = ethers.formatEther(totalCost)

      return {
        success: true,
        gasEstimate: totalCostInFil,
      }
    } catch (error: any) {
      console.error('Error estimating gas:', error)
      return {
        success: true,
        gasEstimate: '0.001',
      }
    }
  }

  /**
   * Estimate gas for contract call
   * @param fromAddress - Sender address
   * @param contractAddress - Contract address
   * @param data - Encoded contract call data
   * @param value - Optional value to send (in wei, default 0)
   * @returns Gas estimate in FIL
   */
  async estimateContractGas(
    fromAddress: string,
    contractAddress: string,
    data: string,
    value?: bigint,
  ): Promise<{ success: boolean; gasEstimate?: string; gasLimit?: string; error?: string }> {
    try {
      const gasLimit = await this.provider.estimateGas({
        from: fromAddress,
        to: contractAddress,
        data: data,
        value: value || 0n,
      })

      const feeData = await this.provider.getFeeData()
      const gasPrice = feeData.gasPrice || 0n
      const totalCost = gasLimit * gasPrice
      const totalCostInFil = ethers.formatEther(totalCost)

      return {
        success: true,
        gasEstimate: totalCostInFil,
        gasLimit: gasLimit.toString(),
      }
    } catch (error: any) {
      // Don't log execution revert errors (they're expected when estimating)
      if (!error.message?.includes('execution reverted')) {
        console.error('Error estimating contract gas:', error)
      }
      // Return default estimate on error
      return {
        success: true,
        gasEstimate: '0.001',
        error: error.message,
      }
    }
  }

  // ==================== Network status ====================

  async getNetworkStatus(): Promise<{
    success: boolean
    status?: any
    error?: string
  }> {
    try {
      const network = await this.provider.getNetwork()
      const blockNumber = await this.provider.getBlockNumber()

      return {
        success: true,
        status: {
          network: this.currentNetwork.name,
          chainId: network.chainId.toString(),
          height: blockNumber,
          connected: true,
        },
      }
    } catch (error: any) {
      console.error('Error getting network status:', error)
      return {
        success: false,
        error: error.message || 'Failed to get network status',
      }
    }
  }

  // ==================== Helper methods ====================

  getExplorerUrl(txHash: string): string {
    const baseUrl =
      this.currentNetwork.chainId === 't'
        ? 'https://calibration.filfox.info'
        : 'https://filfox.info'
    return `${baseUrl}/en/message/${txHash}`
  }

  getAddressExplorerUrl(address: string): string {
    const baseUrl =
      this.currentNetwork.chainId === 't'
        ? 'https://calibration.filfox.info'
        : 'https://filfox.info'
    return `${baseUrl}/en/address/${address}`
  }

  getProvider(): ethers.JsonRpcProvider {
    return this.provider
  }
}

export { rpcConnector }
export const rpcConnectorInstance = new rpcConnector()
export default rpcConnectorInstance

/** Returns the CreatorHub contract address for the currently active network. */
export function getCreatorHubAddress(): string {
  const network = rpcConnectorInstance.getCurrentNetwork()
  const networkId = network.chainId === 'f' ? 'mainnet' : network.chainId === 't' ? 'calibration' : 'localnet'
  return NETWORK_CONTRACTS[networkId]?.creator_hub ?? '0x0000000000000000000000000000000000000000'
}

/** Returns the Ads contract address for the currently active network. */
export function getAdsAddress(): string {
  const network = rpcConnectorInstance.getCurrentNetwork()
  const networkId = network.chainId === 'f' ? 'mainnet' : network.chainId === 't' ? 'calibration' : 'localnet'
  return NETWORK_CONTRACTS[networkId]?.ads ?? '0x0000000000000000000000000000000000000000'
}

/**
 * Waits for a transaction to be confirmed, with fallback for Filecoin RPC nodes
 * that return non-standard `from` address formats causing ethers.js to throw
 * "Invalid from address" when parsing the tx response from eth_getTransactionByHash.
 *
 * If tx.wait() throws that specific error, we fall back to polling
 * provider.getTransactionReceipt() directly, which avoids the problematic parsing.
 */
export async function waitForTransaction(
  tx: { hash: string; wait: () => Promise<ethers.TransactionReceipt | null> },
  provider: ethers.JsonRpcProvider,
  maxAttempts = 30,
  intervalMs = 2000,
): Promise<ethers.TransactionReceipt | null> {
  try {
    return await tx.wait()
  } catch (err: any) {
    // Filecoin RPC nodes sometimes return a non-standard `from` address format
    // that ethers.js v6 fails to parse. If we already have the txHash, fall back
    // to polling getTransactionReceipt directly.
    const isFromAddressError =
      err?.message?.includes('Invalid from address') ||
      err?.message?.includes('could not coalesce error')

    if (!isFromAddressError) {
      throw err
    }

    console.warn('tx.wait() failed with Filecoin address format issue, falling back to receipt polling:', tx.hash)

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
      const receipt = await provider.getTransactionReceipt(tx.hash)
      if (receipt !== null) {
        return receipt
      }
    }

    // Timed out waiting for receipt
    return null
  }
}
