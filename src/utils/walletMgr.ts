/**
 * Wallet Manager - Handles wallet creation, address conversion, and transaction signing
 *
 * Responsibility Separation:
 * - privateDataMgr.ts: Private key storage (encrypted)
 * - walletMgr.ts: Signing service (temporary key access)
 * - creatorHubMgr.ts/adsMgr.ts: Contract calls (no private key access)
 *
 * Security Principles:
 * 1. Private keys only accessed temporarily for signing
 * 2. Memory cleared immediately after signing
 * 3. Private keys never passed to other modules
 */

import { ethers } from 'ethers'
import {
  newDelegatedEthAddress,
  ethAddressFromDelegated,
} from '@glif/filecoin-address'
import { privateDataMgr } from './privateDataMgr'
import { rpcConnectorInstance } from './rpcConnector'

//==================== Type definitions ====================

// Wallet basic info (no private key)
export interface WalletInfo {
  ethAddress: string
  filAddress: string
  name: string
  createdAt: string
  address: string
}

// Backward compatible type (deprecated, should not be used)
/** @deprecated Use WalletInfo instead, should not expose private keys */
export interface FilecoinWalletInfo {
  ethAddress: string
  filAddress: string
  privateKey: string
  mnemonic?: string
  createdAt: string
  name: string
  address: string
}

// ==================== WalletManager class ====================

class WalletManager {
  // ========== Address conversion tools ==========

  /**
   * Convert Ethereum address to Filecoin address
   * @param ethAddress Ethereum address (0x...)
   * @returns Filecoin address (f410... or t410...)
   */
  ethToFilAddress(ethAddress: string): string {
    try {
      const currentNetwork = rpcConnectorInstance.getCurrentNetwork()
      const isTestnet = currentNetwork.chainId === 't'
      const networkPrefix = isTestnet ? 't' : 'f'
      // @ts-ignore - Type issue with @glif/filecoin-address library
      const filAddress = newDelegatedEthAddress(
        ethAddress as `0x${string}`,
        networkPrefix,
      )
      return filAddress.toString()
    } catch (error) {
      console.error('Error converting eth to fil address:', error)
      const currentNetwork = rpcConnectorInstance.getCurrentNetwork()
      const isTestnet = currentNetwork.chainId === 't'
      const prefix = isTestnet ? 't' : 'f'
      const addressWithoutPrefix = ethAddress.slice(2).toLowerCase()
      return `${prefix}410f${addressWithoutPrefix}`
    }
  }

  /**
   * Convert Filecoin address to Ethereum address
   * @param filAddress Filecoin address (f410... or t410...)
   * @returns Ethereum address (0x...)
   */
  filToEthAddress(filAddress: string): string {
    try {
      const ethAddress = ethAddressFromDelegated(filAddress)
      return ethAddress
    } catch (error) {
      console.error('Error converting fil to eth address:', error)
      throw new Error(`Invalid f410/t410 address: ${filAddress}`)
    }
  }

  /**
   * Verify if address is valid
   * @param address Address (supports 0x or f410/t410 format)
   * @returns Whether it is valid
   */
  isValidAddress(address: string): boolean {
    if (address.startsWith('0x')) {
      return ethers.isAddress(address)
    }
    if (address.match(/^[ft]410f/i)) {
      try {
        this.filToEthAddress(address)
        return true
      } catch {
        return false
      }
    }
    return false
  }

  /**
   * Normalize address format (unified conversion to 0x format)
   * Used for address processing before transactions, ensuring ethers.js can correctly recognize
   * @param address Address (supports 0x or f410/t410 format)
   * @returns Ethereum address in 0x format
   * @throws If address format is invalid
   */
  normalizeAddress(address: string): string {
    // If already in 0x format, verify and return directly
    if (address.startsWith('0x')) {
      if (!ethers.isAddress(address)) {
        throw new Error(`Invalid Ethereum address: ${address}`)
      }
      return address
    }
    
    // If Filecoin format (f410/t410), convert to 0x format
    if (address.match(/^[ft]410f/i)) {
      try {
        return this.filToEthAddress(address)
      } catch (error) {
        throw new Error(`Invalid Filecoin address: ${address}`)
      }
    }
    
    // Unsupported format
    throw new Error(`Unsupported address format: ${address}`)
  }

  // ========== Wallet generation ==========

  /**
   * Generate random mnemonic
   * @returns 12-word mnemonic
   */
  generateMnemonic(): string {
    const wallet = ethers.Wallet.createRandom()
    return wallet.mnemonic!.phrase
  }

  /**
   * Create wallet from mnemonic (not saved)
   * @param mnemonic Mnemonic phrase
   * @returns Wallet information (contains private key, for internal use only)
   */
  private createWalletFromMnemonic(mnemonic: string): {
    ethAddress: string
    filAddress: string
    privateKey: string
    address: string
  } {
    const wallet = ethers.Wallet.fromPhrase(mnemonic)
    const ethAddress = wallet.address
    const filAddress = this.ethToFilAddress(ethAddress)
    return {
      ethAddress,
      filAddress,
      privateKey: wallet.privateKey,
      address: ethAddress,
    }
  }

  /**
   * Create wallet from private key (not saved)
   * @param privateKey Private key
   * @returns Wallet information (contains private key, for internal use only)
   */
  private createWalletFromPrivateKey(privateKey: string): {
    ethAddress: string
    filAddress: string
    address: string
  } {
    const wallet = new ethers.Wallet(privateKey)
    const ethAddress = wallet.address
    const filAddress = this.ethToFilAddress(ethAddress)
    return {
      ethAddress,
      filAddress,
      address: ethAddress,
    }
  }

  // ========== Wallet management ==========

  /**
   * Create new wallet
   * @param name Wallet name
   * @param password Encryption password
   * @returns Creation result (no private key)
   */
  async createWallet(
    name: string,
    password: string,
  ): Promise<{
    success: boolean
    wallet?: WalletInfo
    error?: string
  }> {
    try {
      if (!name.trim()) {
        return { success: false, error: 'Wallet name cannot be empty' }
      }
      if (!password || password.length < 6) {
        return { success: false, error: 'Password must be at least 6 characters' }
      }

      const existingWallets = await privateDataMgr.getWalletList()
      if (existingWallets.some((w) => w.name === name)) {
        return { success: false, error: 'Wallet name already exists' }
      }

      // Generate wallet
      const mnemonic = this.generateMnemonic()
      const { ethAddress, filAddress, privateKey } =
        this.createWalletFromMnemonic(mnemonic)

      // Save to privateDataMgr (encrypted storage)
      const saved = await privateDataMgr.saveWallet(
        ethAddress,
        filAddress,
        privateKey,
        password,
        name.trim(),
        mnemonic,
      )

      if (saved) {
        return {
          success: true,
          wallet: {
            ethAddress,
            filAddress,
            address: ethAddress,
            name: name.trim(),
            createdAt: new Date().toISOString(),
          },
        }
      } else {
        return { success: false, error: 'Failed to save wallet' }
      }
    } catch (error: any) {
      console.error('Error creating wallet:', error)
      return { success: false, error: error.message || 'Error creating wallet' }
    }
  }

  /**
   * Import wallet from mnemonic
   * @param name Wallet name
   * @param mnemonic Mnemonic phrase
   * @param password Encryption password
   * @returns Import result (no private key)
   */
  async importWalletFromMnemonic(
    name: string,
    mnemonic: string,
    password: string,
  ): Promise<{
    success: boolean
    wallet?: WalletInfo
    error?: string
  }> {
    try {
      if (!name.trim()) return { success: false, error: 'Wallet name cannot be empty' }
      if (!mnemonic.trim()) return { success: false, error: 'Mnemonic cannot be empty' }
      if (!password || password.length < 6)
        return { success: false, error: 'Password must be at least 6 characters' }

      const existingWallets = await privateDataMgr.getWalletList()
      if (existingWallets.some((w) => w.name === name)) {
        return { success: false, error: 'Wallet name already exists' }
      }

      const { ethAddress, filAddress, privateKey } =
        this.createWalletFromMnemonic(mnemonic.trim())

      if (
        existingWallets.some(
          (w) => w.ethAddress.toLowerCase() === ethAddress.toLowerCase(),
        )
      ) {
        return { success: false, error: 'Wallet with this mnemonic already exists' }
      }

      // Save to privateDataMgr
      const saved = await privateDataMgr.saveWallet(
        ethAddress,
        filAddress,
        privateKey,
        password,
        name.trim(),
        mnemonic.trim(),
      )

      if (saved) {
        return {
          success: true,
          wallet: {
            ethAddress,
            filAddress,
            address: ethAddress,
            name: name.trim(),
            createdAt: new Date().toISOString(),
          },
        }
      } else {
        return { success: false, error: 'Failed to save wallet' }
      }
    } catch (error: any) {
      console.error('Error importing wallet from mnemonic:', error)
      return { success: false, error: error.message || 'Error importing wallet' }
    }
  }

  /**
   * Import wallet from private key
   * @param name Wallet name
   * @param privateKey Private key
   * @param password Encryption password
   * @returns Import result (no private key)
   */
  async importWalletFromPrivateKey(
    name: string,
    privateKey: string,
    password: string,
  ): Promise<{
    success: boolean
    wallet?: WalletInfo
    error?: string
  }> {
    try {
      if (!name.trim()) return { success: false, error: 'Wallet name cannot be empty' }
      if (!privateKey.trim()) return { success: false, error: 'Private key cannot be empty' }
      if (!password || password.length < 6)
        return { success: false, error: 'Password must be at least 6 characters' }

      const existingWallets = await privateDataMgr.getWalletList()
      if (existingWallets.some((w) => w.name === name)) {
        return { success: false, error: 'Wallet name already exists' }
      }

      const { ethAddress, filAddress } = this.createWalletFromPrivateKey(
        privateKey.trim(),
      )

      if (
        existingWallets.some(
          (w) => w.ethAddress.toLowerCase() === ethAddress.toLowerCase(),
        )
      ) {
        return { success: false, error: 'Wallet with this private key already exists' }
      }

      // Save to privateDataMgr (no mnemonic)
      const saved = await privateDataMgr.saveWallet(
        ethAddress,
        filAddress,
        privateKey.trim(),
        password,
        name.trim(),
      )

      if (saved) {
        return {
          success: true,
          wallet: {
            ethAddress,
            filAddress,
            address: ethAddress,
            name: name.trim(),
            createdAt: new Date().toISOString(),
          },
        }
      } else {
        return { success: false, error: 'Failed to save wallet' }
      }
    } catch (error: any) {
      console.error('Error importing wallet from private key:', error)
      return { success: false, error: error.message || 'Error importing wallet' }
    }
  }

  /**
   * Get wallet list (no private key)
   * @returns Array of basic wallet information
   */
  async getWalletList(): Promise<WalletInfo[]> {
    return privateDataMgr.getWalletList()
  }

  /**
   * Get wallet information by address (excluding private key)
   * @param address wallet address
   * @returns Basic wallet information, return undefined if not found
   */
  async getWalletByAddress(address: string): Promise<WalletInfo | undefined> {
    const wallet = await privateDataMgr.getWalletByAddress(address)
    if (!wallet) return undefined

    return {
      ethAddress: wallet.ethAddress,
      filAddress: wallet.filAddress,
      address: wallet.ethAddress,
      name: wallet.name,
      createdAt: wallet.createdAt,
    }
  }

  /**
   * delete wallet
   * @param address wallet address
   * @returns dose delete success
   */
  async deleteWallet(address: string): Promise<boolean> {
    return privateDataMgr.deleteWallet(address)
  }

  /**
   * rename wallet
   * @param address 
   * @param newName 
   * @returns whether renaming is success
   */
  async updateWalletName(address: string, newName: string): Promise<boolean> {
    return privateDataMgr.renameWallet(address, newName)
  }

  /**
   * Verify whether the password is correct
   * @param address
   * @param password
   * @returns whether the pwd is correct
   */
  async verifyPassword(address: string, password: string): Promise<boolean> {
    return privateDataMgr.verifyWalletPassword(address, password)
  }

  /**
   * Unlock wallet (verify password and return wallet info)
   * @param address Wallet address
   * @param password Password
   * @returns Unlock result
   */
  async unlockWallet(
    address: string,
    password: string,
  ): Promise<{
    success: boolean
    wallet?: WalletInfo
    error?: string
  }> {
    try {
      // Verify password
      const decrypted = await privateDataMgr.decryptWallet(address, password)
      if (!decrypted) {
        return { success: false, error: 'Wrong password or wallet not found' }
      }

      const walletInfo = await privateDataMgr.getWalletByAddress(address)
      if (!walletInfo) {
        return { success: false, error: 'Wallet not found' }
      }

      return {
        success: true,
        wallet: {
          ethAddress: walletInfo.ethAddress,
          filAddress: walletInfo.filAddress,
          address: walletInfo.ethAddress,
          name: walletInfo.name,
          createdAt: walletInfo.createdAt,
        },
      }
    } catch (error: any) {
      console.error('Error unlocking wallet:', error)
      return { success: false, error: error.message || 'Error unlocking wallet' }
    }
  }

  /**
   * Export wallet sensitive data (for backup/export scenarios only)
   * @param address Wallet address
   * @param password Password
   * @returns Private key and mnemonic
   */
  async exportWalletSecrets(
    address: string,
    password: string,
  ): Promise<{
    success: boolean
    privateKey?: string
    mnemonic?: string
    error?: string
  }> {
    try {
      const decrypted = await privateDataMgr.decryptWallet(address, password)
      if (!decrypted) {
        return { success: false, error: 'Wrong password or wallet not found' }
      }
      return { success: true, privateKey: decrypted.privateKey, mnemonic: decrypted.mnemonic }
    } catch (error: any) {
      return { success: false, error: error.message || 'Export failed' }
    }
  }

  // ========== Signing service ==========

  /**
   * Sign transaction with wallet
   * Note: Private key is only temporarily accessed for signing, cleared immediately after signing
   * @param address Wallet address
   * @param password Password
   * @param transaction Transaction object
   * @returns Signed transaction
   */
  async signTransaction(
    address: string,
    password: string,
    transaction: ethers.TransactionRequest,
  ): Promise<string> {
    // Temporarily get private key
    const decrypted = await privateDataMgr.decryptWallet(address, password)
    if (!decrypted) {
      throw new Error('Wrong password or wallet not found')
    }

    try {
      // Create temporary wallet for signing
      const provider = rpcConnectorInstance.getProvider()
      const wallet = new ethers.Wallet(decrypted.privateKey, provider)

      // Sign transaction
      const signedTx = await wallet.signTransaction(transaction)

      return signedTx
    } finally {
      // Clear private key (although JS cannot truly clear memory, at least clear references)
      decrypted.privateKey = ''
      if (decrypted.mnemonic) decrypted.mnemonic = ''
    }
  }

  /**
   * Sign message with wallet
   * @param address Wallet address
   * @param password Password
   * @param message Message to sign
   * @returns Signature result
   */
  async signMessage(
    address: string,
    password: string,
    message: string,
  ): Promise<string> {
    // Temporarily get private key
    const decrypted = await privateDataMgr.decryptWallet(address, password)
    if (!decrypted) {
      throw new Error('Wrong password or wallet not found')
    }

    try {
      // Create temporary wallet for signing
      const wallet = new ethers.Wallet(decrypted.privateKey)

      // Sign message
      const signature = await wallet.signMessage(message)

      return signature
    } finally {
      // Clear private key
      decrypted.privateKey = ''
      if (decrypted.mnemonic) decrypted.mnemonic = ''
    }
  }

  /**
   * Get signer (for contract calls)
   * Note: The returned Signer object will hold the private key, should be released as soon as possible after use
   * @param address Wallet address
   * @param password Password
   * @returns ethers.Signer object
   */
  async getSigner(address: string, password: string): Promise<ethers.Wallet> {
    // Temporarily get private key
    const decrypted = await privateDataMgr.decryptWallet(address, password)
    if (!decrypted) {
      throw new Error('Wrong password or wallet not found')
    }

    // Create wallet object
    const provider = rpcConnectorInstance.getProvider()
    const wallet = new ethers.Wallet(decrypted.privateKey, provider)

    // Note: Caller is responsible for clearing after use
    return wallet
  }

  // ========== Session management ==========

  /**
   * Check if a password has been set in the session
   * @returns Whether it has been set
   */
  hasPasswordInSession(): boolean {
    return sessionStorage.getItem('filecoin_password_set_session') === 'true'
  }

  /**
   * Password has been set in the conversation
   */
  setPasswordInSession(): void {
    sessionStorage.setItem('filecoin_password_set_session', 'true')
  }

  /**
   * Clear password markers in the conversation
   */
  clearPasswordSession(): void {
    sessionStorage.removeItem('filecoin_password_set_session')
  }
}

// Export singleton instance
export const walletMgr = new WalletManager()
export default walletMgr
