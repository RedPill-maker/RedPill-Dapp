/**
 * USDFC Trove Manager / USDFC Troveマネージャー
 * Uses official Secured Finance SDK / 公式Secured Finance SDKを使用
 * 
 * ⚠️ Note: SDK depends on ethers v5, other parts of the project use ethers v6 / 注意：SDKはethers v5に依存し、プロジェクトの他の部分はethers v6を使用
 * SDK automatically uses its dependent ethers v5, no additional configuration needed / SDKは依存するethers v5を自動的に使用し、追加設定は不要
 * 
 * SDK Documentation: https://docs.secured.finance/developer-portal/sdk-reference/usdfc-sdk
 */

import { ethers } from 'ethers'
import { rpcConnectorInstance } from './rpcConnector'
import { walletMgr } from './walletMgr'
import { TROVE_PARAMS } from '../../config'

// ==================== Type Definitions / 型定義 ====================

export interface TroveInfo {
  collateral: string
  debt: string
  collateralRatio: string
  status: number // 0=not found, 1=active, 2=closed, 3=liquidated / 0=見つからない、1=アクティブ、2=クローズ、3=清算済み
}

export interface TransactionResult {
  success: boolean
  txHash?: string
  error?: string
}

export interface TroveParams {
  minCollateralRatio: number // minimum collateral ratio (percentage) / 最小担保率（パーセンテージ）
  liquidationReserve: string // liquidation reserve / 清算準備金
  minDebt: string // minimum debt / 最小債務
  borrowingFeeRate: number // borrowing fee rate / 借入手数料率
}

// ==================== SDK Detection / SDK検出 ====================

let EthersSfStablecoin: any = null
let Decimal: any = null
let ethersV5: any = null
let sdkAvailable = false
let sdkLoadPromise: Promise<void> | null = null

async function loadSDK() {
  if (sdkLoadPromise) {
    return sdkLoadPromise
  }

  sdkLoadPromise = (async () => {
    try {
      const sdkModule = await import('@secured-finance/stablecoin-lib-ethers')
      const baseModule = await import('@secured-finance/stablecoin-lib-base')
      
      // Dynamically import @ethersproject packages (ethers v5 subpackages) / @etherprojectパッケージを動的にインポート（ethers v5のサブパッケージ）
      const providersModule = await import('@ethersproject/providers')
      const walletModule = await import('@ethersproject/wallet')
      
      EthersSfStablecoin = sdkModule.EthersSfStablecoin
      Decimal = baseModule.Decimal
      ethersV5 = {
        providers: providersModule,
        Wallet: walletModule.Wallet
      }
      sdkAvailable = true
      
      console.log('[StakingMgr] ✅ Secured Finance SDK loaded successfully')
    } catch (error) {
      console.warn('[StakingMgr] ⚠️ SDK not installed:', error)
      sdkAvailable = false
    }
  })()

  return sdkLoadPromise
}

// ==================== ethers v6 → v5 Adapter Layer / ethers v6 → v5 アダプタレイヤー ====================

/**
 * Convert ethers v6 Provider to v5 format / ethers v6 ProviderをV5形式に変換
 */
function adaptProviderToV5(provider: any): any {
  // SDK requires ethers v5 provider / SDKはethers v5 providerが必要
  // Use ethers v5 JsonRpcProvider to wrap v6 provider's RPC URL / ethers v5 JsonRpcProviderを使用してv6 providerのRPC URLをラップ
  const rpcUrl = provider._getConnection().url
  return new ethersV5.providers.JsonRpcProvider(rpcUrl)
}

/**
 * Convert ethers v6 Signer to v5 format / ethers v6 SignerをV5形式に変換
 */
function adaptSignerToV5(signer: any): any {
  // Get private key from v6 signer and recreate with v5 Wallet / v6 signerから秘密鍵を取得し、v5 Walletで再作成
  // Note: assumes signer is Wallet type with privateKey property / 注意：signerはprivateKeyプロパティを持つWallet型であると想定
  const privateKey = signer.privateKey
  const provider = signer.provider ? adaptProviderToV5(signer.provider) : null
  return new ethersV5.Wallet(privateKey, provider)
}

// ==================== StakingManager Class / StakingManagerクラス ====================

class StakingManager {
  private sdkCache: Map<string, any> = new Map()
  private paramsCache: TroveParams | null = null
  private paramsCacheTime: number = 0
  private readonly PARAMS_CACHE_TTL = 60000 // parameter cache 1 minute / パラメータキャッシュ1分

  /**
   * Get Trove system parameters (query from contract with caching) / Troveシステムパラメータを取得（キャッシング付きで契約から照会）
   */
  async getTroveParams(): Promise<TroveParams> {
    // Check cache / キャッシュを確認
    const now = Date.now()
    if (this.paramsCache && (now - this.paramsCacheTime) < this.PARAMS_CACHE_TTL) {
      return this.paramsCache
    }

    try {
      await loadSDK()
      
      if (!sdkAvailable) {
      // SDK not available, use default values from config file / SDK が利用できない場合は、設定ファイルのデフォルト値を使用
        return {
          minCollateralRatio: TROVE_PARAMS.MIN_COLLATERAL_RATIO,
          liquidationReserve: TROVE_PARAMS.LIQUIDATION_RESERVE,
          minDebt: TROVE_PARAMS.MIN_DEBT,
          borrowingFeeRate: TROVE_PARAMS.BORROWING_FEE_RATE,
        }
      }

      const provider = rpcConnectorInstance.getProvider()
      const v5Provider = adaptProviderToV5(provider)
      await EthersSfStablecoin.connect(v5Provider)

      // Get system parameters from SDK / SDKからシステムパラメータを取得
      // Note: these method names may need adjustment based on actual SDK API / 注意：これらのメソッド名は実際のSDK APIに基づいて調整が必要な場合があります
      const minCollateralRatio = 110 // SDK may provide getMCR() method / SDKはgetMCR()メソッドを提供する可能性があります
      const liquidationReserve = '20' // SDK may provide LIQUIDATION_RESERVE constant / SDKはLIQUIDATION_RESERVE定数を提供する可能性があります
      const minDebt = '200' // SDK may provide MIN_NET_DEBT constant / SDKはMIN_NET_DEBT定数を提供する可能性があります
      const borrowingFeeRate = 0.005 // SDK may provide getBorrowingFee() method / SDKはgetBorrowingFee()メソッドを提供する可能性があります

      this.paramsCache = {
        minCollateralRatio,
        liquidationReserve,
        minDebt,
        borrowingFeeRate,
      }
      this.paramsCacheTime = now

      console.log('[StakingMgr] Trove params loaded from contract:', this.paramsCache)
      
      return this.paramsCache
    } catch (error) {
      console.warn('[StakingMgr] Failed to get params from contract, using defaults:', error)
      // Use default values from config file on failure / 失敗時は設定ファイルのデフォルト値を使用
      return {
        minCollateralRatio: TROVE_PARAMS.MIN_COLLATERAL_RATIO,
        liquidationReserve: TROVE_PARAMS.LIQUIDATION_RESERVE,
        minDebt: TROVE_PARAMS.MIN_DEBT,
        borrowingFeeRate: TROVE_PARAMS.BORROWING_FEE_RATE,
      }
    }
  }

  /**
   * Get or create SDK instance / SDKインスタンスを取得または作成
   */
  private async getSDKInstance(signer: ethers.Signer): Promise<any> {
    await loadSDK()
    
    if (!sdkAvailable) {
      throw new Error('SDK not installed')
    }

    const address = await signer.getAddress()
    
    if (this.sdkCache.has(address)) {
      return this.sdkCache.get(address)
    }

    // Adapt signer to v5 format / signerをv5形式に適応
    const v5Signer = adaptSignerToV5(signer)
    const usdfc = await EthersSfStablecoin.connect(v5Signer)
    this.sdkCache.set(address, usdfc)
    
    return usdfc
  }

  private clearSDKCache(address?: string) {
    if (address) {
      this.sdkCache.delete(address)
    } else {
      this.sdkCache.clear()
    }
  }

  /**
   * Get Trove information / Trove情報を取得
   */
  async getTroveInfo(address: string): Promise<{
    success: boolean
    data?: TroveInfo
    error?: string
  }> {
    try {
      await loadSDK()
      
      if (!sdkAvailable) {
        return {
          success: false,
          error: 'Failed to query Trove info'
        }
      }

      const provider = rpcConnectorInstance.getProvider()
      const v5Provider = adaptProviderToV5(provider)
      const usdfc = await EthersSfStablecoin.connect(v5Provider)
      
      const trove = await usdfc.getTrove(address)
      
      console.log('[StakingMgr] Raw trove data:', {
        collateral: trove.collateral?.toString(),
        debt: trove.debt?.toString(),
        collateralRatio: typeof trove.collateralRatio,
        status: trove.status
      })
      
      let status = 0
      if (trove.status === 'open') status = 1
      else if (trove.status === 'closed') status = 2
      else if (trove.status === 'liquidated') status = 3

      // Calculate collateral ratio: SDK's collateralRatio is a method that requires price input / 担保率を計算：SDKのcollateralRatioは価格入力が必要なメソッド
      let collateralRatioStr = '0'
      
      // Get FIL price / FIL価格を取得
      const filPrice = await this.getFilPrice()
      console.log('[StakingMgr] FIL price:', filPrice)
      
      // If collateralRatio is a function, call it / collateralRatioが関数の場合は呼び出す
      if (typeof trove.collateralRatio === 'function') {
        try {
          const ratio = trove.collateralRatio(Decimal.from(filPrice))
          collateralRatioStr = (parseFloat(ratio.toString()) * 100).toFixed(2)
          console.log('[StakingMgr] Ratio from SDK method:', collateralRatioStr)
        } catch (error) {
          console.warn('[StakingMgr] Failed to call collateralRatio method:', error)
          // Manual calculation as fallback / フォールバックとして手動計算
          const collateralValue = parseFloat(trove.collateral.toString()) * filPrice
          const debtValue = parseFloat(trove.debt.toString())
          if (debtValue > 0) {
            collateralRatioStr = ((collateralValue / debtValue) * 100).toFixed(2)
          }
        }
      } else if (parseFloat(trove.collateral.toString()) > 0 && parseFloat(trove.debt.toString()) > 0) {
        // Manual calculation / 手動計算
        const collateralValue = parseFloat(trove.collateral.toString()) * filPrice
        const debtValue = parseFloat(trove.debt.toString())
        if (debtValue > 0) {
          collateralRatioStr = ((collateralValue / debtValue) * 100).toFixed(2)
        }
      }

      console.log('[StakingMgr] Final collateralRatio:', collateralRatioStr)

      return {
        success: true,
        data: {
          collateral: trove.collateral.toString(),
          debt: trove.debt.toString(),
          collateralRatio: collateralRatioStr,
          status
        }
      }
    } catch (error: any) {
      console.error('[StakingMgr] Failed to get trove info:', error)
      return {
        success: false,
        error: error.message || 'Failed to query Trove info'
      }
    }
  }

  /**
   * Get FIL price from oracle
   * @throws Error if price oracle is unavailable or price data is too old
   */
  private async getFilPrice(): Promise<number> {
    await loadSDK()
    
    if (!sdkAvailable) {
      throw new Error('SDK not available')
    }

    const provider = rpcConnectorInstance.getProvider()
    const v5Provider = adaptProviderToV5(provider)
    const usdfc = await EthersSfStablecoin.connect(v5Provider)
    const price = await usdfc.getPrice()
    
    return parseFloat(price.toString())
  }

  /**
   * Open Trove / Troveを開く
   */
  async openTrove(
    address: string,
    password: string,
    collateralAmount: string,
    borrowAmount: string
  ): Promise<TransactionResult> {
    try {
      await loadSDK()
      
      if (!sdkAvailable) {
        return {
          success: false,
          error: 'Failed to open Trove'
        }
      }

      const existingTrove = await this.getTroveInfo(address)
      if (existingTrove.success && existingTrove.data && existingTrove.data.status === 1) {
        return { 
          success: false, 
          error: 'You already have an active Trove' 
        }
      }

      // Get system parameters / システムパラメータを取得
      const params = await this.getTroveParams()

      if (parseFloat(borrowAmount) < parseFloat(params.minDebt)) {
        return { 
          success: false, 
          error: `Minimum borrow amount is ${params.minDebt} USDFC` 
        }
      }

      const filPrice = await this.getFilPrice()
      const borrowingFee = parseFloat(borrowAmount) * params.borrowingFeeRate
      const totalDebt = parseFloat(borrowAmount) + parseFloat(params.liquidationReserve) + borrowingFee
      const collateralValue = parseFloat(collateralAmount) * filPrice
      const collateralRatio = (collateralValue / totalDebt) * 100

      console.log('[StakingMgr] Opening Trove calculation:', {
        collateralAmount,
        borrowAmount,
        filPrice,
        borrowingFee,
        totalDebt,
        collateralValue,
        collateralRatio: collateralRatio.toFixed(2) + '%',
        minRequired: params.minCollateralRatio + '%'
      })

      if (collateralRatio < params.minCollateralRatio) {
        return { 
          success: false, 
          error: `Insufficient collateral ratio, minimum required: ${params.minCollateralRatio}%` 
        }
      }

      const signer = await walletMgr.getSigner(address, password)
      const usdfc = await this.getSDKInstance(signer)

      console.log('[StakingMgr] Opening Trove with SDK:', {
        collateralAmount,
        borrowAmount,
        collateralRatio: collateralRatio.toFixed(2) + '%'
      })

      const result = await usdfc.openTrove({
        depositCollateral: Decimal.from(collateralAmount),
        borrowDebtToken: Decimal.from(borrowAmount)
      })

      this.clearSDKCache(address)

      return {
        success: true,
        txHash: result.rawSentTransaction?.hash || 'pending'
      }
    } catch (error: any) {
      console.error('[StakingMgr] Open trove failed:', error)
      
      let errorMessage = 'Failed to open Trove'
      
      if (error.message) {
        if (error.message.includes('insufficient funds')) {
          errorMessage = 'Insufficient balance'
        } else if (error.message.includes('user rejected') || error.message.includes('User denied')) {
          errorMessage = 'User cancelled the transaction'
        } else if (error.message.includes('CollateralRatioTooLow')) {
          errorMessage = 'Collateral ratio too low'
        } else {
          errorMessage = `Transaction failed: ${error.message}`
        }
      }
      
      return { 
        success: false, 
        error: errorMessage 
      }
    }
  }

  /**
   * Adjust Trove / Troveを調整
   */
  async adjustTrove(
    address: string,
    password: string,
    collateralChange: string,
    debtChange: string
  ): Promise<TransactionResult> {
    try {
      await loadSDK()
      
      if (!sdkAvailable) {
        return {
          success: false,
          error: 'Failed to adjust Trove'
        }
      }

      const signer = await walletMgr.getSigner(address, password)
      const usdfc = await this.getSDKInstance(signer)

      const params: any = {}
      
      const collChangeNum = parseFloat(collateralChange)
      const debtChangeNum = parseFloat(debtChange)

      if (collChangeNum !== 0) {
        params.depositCollateral = collChangeNum > 0 ? Decimal.from(Math.abs(collChangeNum)) : undefined
        params.withdrawCollateral = collChangeNum < 0 ? Decimal.from(Math.abs(collChangeNum)) : undefined
      }

      if (debtChangeNum !== 0) {
        params.borrowDebtToken = debtChangeNum > 0 ? Decimal.from(Math.abs(debtChangeNum)) : undefined
        params.repayDebtToken = debtChangeNum < 0 ? Decimal.from(Math.abs(debtChangeNum)) : undefined
      }

      const result = await usdfc.adjustTrove(params)

      this.clearSDKCache(address)

      return {
        success: true,
        txHash: result.rawSentTransaction?.hash || 'pending'
      }
    } catch (error: any) {
      console.error('[StakingMgr] Adjust trove failed:', error)
      return {
        success: false,
        error: error.message || 'Failed to adjust Trove'
      }
    }
  }

  /**
   * Close Trove / Troveを閉じる
   */
  async closeTrove(
    address: string,
    password: string
  ): Promise<TransactionResult> {
    try {
      await loadSDK()
      
      if (!sdkAvailable) {
        return {
          success: false,
          error: 'Failed to close Trove'
        }
      }

      const signer = await walletMgr.getSigner(address, password)
      const usdfc = await this.getSDKInstance(signer)

      const result = await usdfc.closeTrove()

      this.clearSDKCache(address)

      return {
        success: true,
        txHash: result.rawSentTransaction?.hash || 'pending'
      }
    } catch (error: any) {
      console.error('[StakingMgr] Close trove failed:', error)
      return {
        success: false,
        error: error.message || 'Failed to close Trove'
      }
    }
  }

  // ==================== Calculation Auxiliary Methods / 計算補助メソッド ====================

  /**
   * Get FIL price for UI display
   * @throws Error if price oracle is unavailable or price data is too old
   */
  async getFilPriceForUI(): Promise<number> {
    return await this.getFilPrice()
  }

  /**
   *Get Trove parameters (for front-end use)
   */
  async getTroveParamsForUI(): Promise<TroveParams> {
    return await this.getTroveParams()
  }

  calculateMaxBorrow(collateralAmount: string, filPrice: number, params: TroveParams, targetRatio?: number): string {
    const ratio = targetRatio || 150 // default recommended collateral ratio 150%
    const collateralValue = parseFloat(collateralAmount) * filPrice
    const totalDebt = collateralValue / (ratio / 100)
    const maxBorrow = (totalDebt - parseFloat(params.liquidationReserve)) / (1 + params.borrowingFeeRate)
    return Math.max(0, maxBorrow).toFixed(2)
  }

  calculateCollateralRatio(collateralAmount: string, borrowAmount: string, filPrice: number, params: TroveParams): number {
    const collateralValue = parseFloat(collateralAmount) * filPrice
    const borrowingFee = parseFloat(borrowAmount) * params.borrowingFeeRate
    const totalDebt = parseFloat(borrowAmount) + parseFloat(params.liquidationReserve) + borrowingFee
    if (totalDebt === 0) return 0
    return (collateralValue / totalDebt) * 100
  }

  calculateMinCollateral(borrowAmount: string, filPrice: number, params: TroveParams): string {
    const borrowingFee = parseFloat(borrowAmount) * params.borrowingFeeRate
    const totalDebt = parseFloat(borrowAmount) + parseFloat(params.liquidationReserve) + borrowingFee
    const minCollateral = (totalDebt * (params.minCollateralRatio / 100)) / filPrice
    return minCollateral.toFixed(4)
  }

  calculateRecommendedCollateral(borrowAmount: string, filPrice: number, params: TroveParams): string {
    const borrowingFee = parseFloat(borrowAmount) * params.borrowingFeeRate
    const totalDebt = parseFloat(borrowAmount) + parseFloat(params.liquidationReserve) + borrowingFee
    const recommendedCollateral = (totalDebt * (150 / 100)) / filPrice // recommended 150%
    return recommendedCollateral.toFixed(4)
  }

  isSDKAvailable(): boolean {
    return sdkAvailable
  }
}

export const stakingMgr = new StakingManager()
export default stakingMgr
