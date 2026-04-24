/**
 * USDFC Trove Management Component - Simplified Version
 * 
 * Two operation modes:
 * 1. Exchange USDFC: User inputs desired USDFC amount and collateral ratio, system calculates required FIL
 * 2. Redeem FIL: User inputs desired FIL amount to redeem, system calculates required USDFC repayment
 */

import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LockClosedIcon, InformationCircleIcon, ChevronDownIcon, CheckIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline'
import { stakingMgr, TroveInfo, TroveParams } from '../../utils/stakingMgr'
import { rpcConnectorInstance } from '../../utils/rpcConnector'
import { getKnownTokens } from '../../../config'
import WalletSelectorModal, {
  PaymentConfig,
  TransactionResult,
} from '../../global_modal/WalletSelectorModal'

interface WalletListItem {
  ethAddress: string
  filAddress: string
  name: string
  createdAt: string
}

interface USDFCExchangeProps {
  wallets: WalletListItem[]
}

type OperationMode = 'borrow' | 'redeem'

const USDFCExchange: React.FC<USDFCExchangeProps> = ({ wallets }) => {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [troveInfo, setTroveInfo] = useState<TroveInfo | null>(null)
  const [filBalance, setFilBalance] = useState('0')
  const [usdfcBalance, setUsdfcBalance] = useState('0')
  const [showWalletModal, setShowWalletModal] = useState(false)
  const [selectedWalletAddress, setSelectedWalletAddress] = useState<string>('')
  const [showWalletDropdown, setShowWalletDropdown] = useState(false)
  const [filPrice, setFilPrice] = useState<number | null>(null)
  const [priceError, setPriceError] = useState<string | null>(null)
  const [troveParams, setTroveParams] = useState<TroveParams | null>(null)
  
  // Operation mode
  const [mode, setMode] = useState<OperationMode>('borrow')
  
  // Exchange USDFC mode state
  const [borrowUsdfc, setBorrowUsdfc] = useState('') // amount of USDFC user wants to borrow (incremental)
  const [borrowRatio, setBorrowRatio] = useState(150) // collateral ratio
  
  // Redeem FIL mode state
  const [redeemFil, setRedeemFil] = useState('') // amount of FIL user wants to redeem
  const [redeemRatio, setRedeemRatio] = useState(150) // collateral ratio

  // Initialize select first wallet
  useEffect(() => {
    if (wallets.length > 0 && !selectedWalletAddress) {
      setSelectedWalletAddress(wallets[0].ethAddress)
    }
  }, [wallets, selectedWalletAddress])

  // Load Trove system parameters
  useEffect(() => {
    const loadParams = async () => {
      const params = await stakingMgr.getTroveParamsForUI()
      setTroveParams(params)
    }
    loadParams()
  }, [])

  // When selected wallet changes, reload data
  useEffect(() => {
    if (selectedWalletAddress) {
      loadData()
    }
  }, [selectedWalletAddress])

  const selectedWallet = wallets.find(w => w.ethAddress === selectedWalletAddress)
  const hasTrove = troveInfo && troveInfo.status === 1
  const currentCollateral = parseFloat(troveInfo?.collateral || '0')
  const currentDebt = parseFloat(troveInfo?.debt || '0')

  const loadData = async () => {
    if (!selectedWalletAddress) return

    setLoading(true)
    try {
      // Try to get FIL price from oracle
      try {
        const price = await stakingMgr.getFilPriceForUI()
        setFilPrice(price)
        setPriceError(null)
      } catch (error: any) {
        console.error('[USDFCExchange] Failed to get FIL price:', error)
        setFilPrice(null)
        
        // Set user-friendly error message
        if (error.message?.includes('too old')) {
          setPriceError(t('usdfcExchange.priceOracleUnavailable'))
        } else if (error.message?.includes('SDK not available')) {
          setPriceError(t('usdfcExchange.sdkNotAvailable'))
        } else {
          setPriceError(t('usdfcExchange.priceServiceError'))
        }
      }

      const result = await stakingMgr.getTroveInfo(selectedWalletAddress)
      if (result.success && result.data) {
        setTroveInfo(result.data)
      } else {
        setTroveInfo(null)
      }

      const filToken = getKnownTokens().find(t => t.symbol === 'FIL')
      const filBalanceResult = await rpcConnectorInstance.getTokenBalance(
        selectedWalletAddress,
        filToken?.address || ''
      )
      if (filBalanceResult.success && filBalanceResult.balance) {
        setFilBalance(filBalanceResult.balance)
      }

      const usdfcToken = getKnownTokens().find(t => t.symbol === 'USDFC')
      const usdfcBalanceResult = await rpcConnectorInstance.getTokenBalance(
        selectedWalletAddress,
        usdfcToken?.address || ''
      )
      if (usdfcBalanceResult.success && usdfcBalanceResult.balance) {
        setUsdfcBalance(usdfcBalanceResult.balance)
      }
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally {
      setLoading(false)
    }
  }


  // ==================== Exchange USDFC Mode Calculation ====================
  
  // Calculate required FIL to stake (incremental)
  const calculateRequiredFil = (): number => {
    if (!borrowUsdfc || !troveParams || !filPrice) return 0
    const borrowNum = parseFloat(borrowUsdfc)
    if (isNaN(borrowNum) || borrowNum <= 0) return 0
    
    // Total debt = borrow + borrowing fee + liquidation reserve
    const borrowingFee = borrowNum * troveParams.borrowingFeeRate
    const totalNewDebt = borrowNum + borrowingFee + parseFloat(troveParams.liquidationReserve)
    
    // Required collateral value = total debt × collateral ratio
    const requiredCollateralValue = totalNewDebt * (borrowRatio / 100)
    
    // Required FIL amount = collateral value / FIL price
    return requiredCollateralValue / filPrice
  }

  const requiredFilIncrement = calculateRequiredFil()
  const totalFilAfterBorrow = currentCollateral + requiredFilIncrement
  const totalDebtAfterBorrow = currentDebt + parseFloat(borrowUsdfc || '0')
  
  // Liquidation reserve (for debt details display in redeem mode)
  const liquidationReserve = parseFloat(troveParams?.liquidationReserve || '0')

  // ==================== Redeem FIL Mode Calculation ====================
  
  // Calculate required USDFC to repay
  const calculateRequiredUsdfc = (): number => {
    if (!redeemFil || !troveParams || !filPrice) return 0
    const redeemNum = parseFloat(redeemFil)
    if (isNaN(redeemNum) || redeemNum <= 0) return 0
    
    // Full redemption
    if (redeemNum >= currentCollateral) {
      return currentDebt
    }
    
    // Partial redemption
    const remainingCollateral = currentCollateral - redeemNum
    const remainingCollateralValue = remainingCollateral * filPrice
    
    // Max debt after redemption = remaining collateral value / collateral ratio
    const maxDebtAfterRedeem = remainingCollateralValue / (redeemRatio / 100)
    
    // Required USDFC repayment = current debt - max debt after redemption
    const requiredRepay = currentDebt - maxDebtAfterRedeem
    
    return Math.max(0, requiredRepay)
  }

  const requiredUsdfcRepay = calculateRequiredUsdfc()
  const isFullRedeem = parseFloat(redeemFil || '0') >= currentCollateral
  const totalFilAfterRedeem = currentCollateral - parseFloat(redeemFil || '0')
  const totalDebtAfterRedeem = currentDebt - requiredUsdfcRepay


  // ==================== Transaction Processing ====================
  
  const handleConfirmTransaction = () => {
    setShowWalletModal(true)
  }

  const executeTransaction = async (
    address: string,
    password: string
  ): Promise<TransactionResult> => {
    if (mode === 'borrow') {
      // Exchange USDFC mode
      if (!hasTrove) {
        // Open Trove
        return await stakingMgr.openTrove(
          address,
          password,
          requiredFilIncrement.toFixed(4),
          borrowUsdfc
        )
      } else {
        // Adjust Trove (increase collateral and borrow)
        return await stakingMgr.adjustTrove(
          address,
          password,
          requiredFilIncrement.toFixed(4),
          borrowUsdfc
        )
      }
    } else {
      // Redeem FIL mode
      if (isFullRedeem) {
        // Full redemption = close Trove
        return await stakingMgr.closeTrove(address, password)
      } else {
        // Partial redemption = adjust Trove
        const filChange = -parseFloat(redeemFil)
        const usdfcChange = -requiredUsdfcRepay
        return await stakingMgr.adjustTrove(
          address,
          password,
          filChange.toFixed(4),
          usdfcChange.toFixed(2)
        )
      }
    }
  }

  const handleTransactionSuccess = () => {
    setBorrowUsdfc('')
    setRedeemFil('')
    setBorrowRatio(150)
    setRedeemRatio(150)
    setShowWalletModal(false)
    setTimeout(() => {
      loadData()
    }, 2000)
  }

  // ==================== Validation Logic ====================
  
  const canSubmit = (): boolean => {
    // Price must be available to submit transaction
    if (!troveParams || !filPrice) return false
    
    if (mode === 'borrow') {
      const borrowNum = parseFloat(borrowUsdfc || '0')
      if (borrowNum <= 0) return false
      
      // Check minimum debt limit
      if (!hasTrove) {
        // Opening new Trove: borrow amount must be ≥ minDebt
        if (borrowNum < parseFloat(troveParams.minDebt)) return false
      } else {
        // Adjusting existing Trove: total debt after adjustment must be ≥ minDebt
        if (totalDebtAfterBorrow < parseFloat(troveParams.minDebt)) return false
      }
      
      if (requiredFilIncrement > parseFloat(filBalance)) return false
      if (borrowRatio <= troveParams.minCollateralRatio) return false // must be > 110%, cannot equal 110%
      return true
    } else {
      const redeemNum = parseFloat(redeemFil || '0')
      if (redeemNum <= 0) return false
      if (redeemNum > currentCollateral) return false
      if (!isFullRedeem && requiredUsdfcRepay > parseFloat(usdfcBalance)) return false
      if (isFullRedeem && currentDebt > parseFloat(usdfcBalance)) return false
      return true
    }
  }

  // ==================== PaymentConfig ====================
  
  const getPaymentConfig = (): PaymentConfig => {
    if (mode === 'borrow') {
      return {
        type: 'fixed',
        amount: requiredFilIncrement.toFixed(4),
        token: getKnownTokens()[0].address,
        tokenSymbol: 'FIL',
        description: hasTrove ? t('usdfcExchange.borrowMore') : t('usdfcExchange.openTrove'),
      }
    } else {
      return {
        type: 'fixed',
        amount: isFullRedeem ? currentDebt.toFixed(2) : requiredUsdfcRepay.toFixed(2),
        token: getKnownTokens().find(t => t.symbol === 'USDFC')?.address || getKnownTokens()[1].address,
        tokenSymbol: 'USDFC',
        description: isFullRedeem ? t('usdfcExchange.closeTrove') : t('usdfcExchange.redeemFil'),
      }
    }
  }


  // ==================== Rendering ====================
  
  if (wallets.length === 0) {
    return (
      <div className="p-8 text-center">
        <LockClosedIcon className="w-16 h-16 mx-auto mb-4 text-gray-400 dark:text-gray-600" />
        <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
          {t('usdfcExchange.noWallet')}
        </h3>
        <p className="text-gray-600 dark:text-gray-400">
          {t('usdfcExchange.noWalletDesc')}
        </p>
      </div>
    )
  }

  if (!troveParams) {
    return (
      <div className="p-8 text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600 dark:text-gray-400">{t('common.loading')}</p>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Wallet selection dropdown */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          {t('usdfcExchange.selectWallet')}
        </label>
        <div className="relative">
          <button
            onClick={() => setShowWalletDropdown(!showWalletDropdown)}
            className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 flex items-center justify-between hover:border-blue-500 dark:hover:border-blue-400 transition-colors"
          >
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-semibold text-sm">
                {selectedWallet?.name.charAt(0).toUpperCase()}
              </div>
              <div className="text-left">
                <div className="font-medium text-gray-900 dark:text-white">
                  {selectedWallet?.name}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                  {selectedWallet?.ethAddress.substring(0, 10)}...{selectedWallet?.ethAddress.substring(38)}
                </div>
              </div>
            </div>
            <ChevronDownIcon className={`w-5 h-5 text-gray-400 transition-transform ${showWalletDropdown ? 'rotate-180' : ''}`} />
          </button>

          {showWalletDropdown && (
            <div className="absolute z-10 w-full mt-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-y-auto">
              {wallets.map((wallet) => (
                <button
                  key={wallet.ethAddress}
                  onClick={() => {
                    setSelectedWalletAddress(wallet.ethAddress)
                    setShowWalletDropdown(false)
                  }}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-semibold text-sm">
                      {wallet.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="text-left">
                      <div className="font-medium text-gray-900 dark:text-white">
                        {wallet.name}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                        {wallet.ethAddress.substring(0, 10)}...{wallet.ethAddress.substring(38)}
                      </div>
                    </div>
                  </div>
                  {wallet.ethAddress === selectedWalletAddress && (
                    <CheckIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Balance cards */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
          <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">
            FIL {t('usdfcExchange.balance')}
          </div>
          <div className="text-xl font-bold text-gray-900 dark:text-white">
            {loading ? '...' : parseFloat(filBalance).toFixed(4)} FIL
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
          <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">
            USDFC {t('usdfcExchange.balance')}
          </div>
          <div className="text-xl font-bold text-blue-600 dark:text-blue-400">
            {loading ? '...' : parseFloat(usdfcBalance).toFixed(2)} USDFC
          </div>
        </div>
      </div>

      {/* FIL Price Display */}
      <div className={`mb-6 rounded-lg p-4 border ${
        priceError 
          ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700'
          : 'bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 border-blue-200 dark:border-blue-700'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <InformationCircleIcon className={`w-5 h-5 ${
              priceError ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'
            }`} />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('usdfcExchange.currentFilPrice')}:
            </span>
          </div>
          {loading ? (
            <div className="text-lg font-bold text-gray-400">Loading...</div>
          ) : filPrice !== null ? (
            <div className="text-lg font-bold text-blue-600 dark:text-blue-400">
              ${filPrice.toFixed(2)} USD
            </div>
          ) : (
            <div className="text-lg font-bold text-red-600 dark:text-red-400">
              {t('usdfcExchange.unavailable')}
            </div>
          )}
        </div>
        {priceError && (
          <div className="mt-3 pt-3 border-t border-red-200 dark:border-red-700">
            <div className="text-sm text-red-800 dark:text-red-300 mb-1">
              ⚠️ {priceError}
            </div>
            <div className="text-sm font-medium text-red-900 dark:text-red-200">
              {t('usdfcExchange.transactionDisabled')}
            </div>
          </div>
        )}
      </div>


      {/* Mode switch buttons */}
      <div className="flex gap-4 mb-6">
        <button
          onClick={() => setMode('borrow')}
          className={`flex-1 py-3 px-4 rounded-lg font-medium transition-colors ${
            mode === 'borrow'
              ? 'bg-blue-600 text-white'
              : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:border-blue-500'
          }`}
        >
          {t('usdfcExchange.modeBorrow')}
        </button>
        <button
          onClick={() => setMode('redeem')}
          className={`flex-1 py-3 px-4 rounded-lg font-medium transition-colors ${
            mode === 'redeem'
              ? 'bg-blue-600 text-white'
              : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:border-blue-500'
          }`}
        >
          {t('usdfcExchange.modeRedeem')}
        </button>
      </div>

      {/* Operation area */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        {mode === 'borrow' ? (
          // Exchange USDFC mode
          <div className="space-y-4">
            {/* Staked FIL */}
            <div>
              <div className="flex items-center gap-3 mb-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('usdfcExchange.pledged')}: {currentCollateral.toFixed(4)} FIL
                </label>
                <span className="text-gray-500">+</span>
                <span className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {requiredFilIncrement.toFixed(4)} FIL
                </span>
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400">
                {t('usdfcExchange.totalAfter')}: {totalFilAfterBorrow.toFixed(4)} FIL
              </div>
            </div>

            {/* Borrowed USDFC */}
            <div>
              <div className="flex items-center gap-3 mb-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('usdfcExchange.borrowed')}: {currentDebt.toFixed(2)} USDFC
                </label>
                <span className="text-gray-500">+</span>
                <div className="flex-1 relative">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={borrowUsdfc}
                    onChange={(e) => setBorrowUsdfc(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-4 py-2 pr-20 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white text-lg"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400">
                    USDFC
                  </span>
                </div>
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400">
                {t('usdfcExchange.totalAfter')}: {totalDebtAfterBorrow.toFixed(2)} USDFC
              </div>
            </div>

            {/* Collateral ratio slider */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('usdfcExchange.collateralRatio')}
                </label>
                <span className={`text-lg font-semibold ${
                  borrowRatio >= 150
                    ? 'text-green-600 dark:text-green-400'
                    : borrowRatio >= troveParams.minCollateralRatio
                    ? 'text-yellow-600 dark:text-yellow-400'
                    : 'text-red-600 dark:text-red-400'
                }`}>
                  {borrowRatio}%
                </span>
              </div>
              <input
                type="range"
                min={troveParams.minCollateralRatio + 1}
                max="300"
                step="1"
                value={borrowRatio}
                onChange={(e) => setBorrowRatio(parseInt(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
              />
              <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
                <span>{troveParams.minCollateralRatio + 1}% ({t('usdfcExchange.minimum')})</span>
                <span>300%</span>
              </div>
              {borrowRatio < 150 && (
                <div className="mt-2 text-xs text-yellow-600 dark:text-yellow-400">
                  {t('usdfcExchange.ratioWarning')}
                </div>
              )}
            </div>

            {/* Fee details */}
            {borrowUsdfc && parseFloat(borrowUsdfc) > 0 && (
              <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">{t('usdfcExchange.borrowingFee')}</span>
                  <span className="font-semibold text-gray-900 dark:text-white">
                    {(parseFloat(borrowUsdfc) * troveParams.borrowingFeeRate).toFixed(2)} USDFC
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">{t('usdfcExchange.liquidationReserve')}</span>
                  <span className="font-semibold text-gray-900 dark:text-white">
                    {troveParams.liquidationReserve} USDFC
                  </span>
                </div>
                <div className="flex justify-between text-sm border-t border-gray-200 dark:border-gray-600 pt-2">
                  <span className="text-gray-700 dark:text-gray-300 font-medium">{t('usdfcExchange.totalBorrow')}</span>
                  <span className="font-bold text-blue-600 dark:text-blue-400">
                    {borrowUsdfc} USDFC
                  </span>
                </div>
              </div>
            )}

            {/* Confirm button */}
            <button
              onClick={handleConfirmTransaction}
              disabled={!canSubmit()}
              className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium"
            >
              {t('usdfcExchange.confirmTransaction')} {t('usdfcExchange.needPay')}: {requiredFilIncrement.toFixed(4)} FIL
            </button>

            {borrowUsdfc && parseFloat(borrowUsdfc) > 0 && !canSubmit() && (
              <div className="text-sm text-red-600 dark:text-red-400 text-center">
                {!hasTrove && parseFloat(borrowUsdfc) < parseFloat(troveParams.minDebt)
                  ? `${t('usdfcExchange.minDebt')}: ${troveParams.minDebt} USDFC`
                  : hasTrove && totalDebtAfterBorrow < parseFloat(troveParams.minDebt)
                  ? `${t('usdfcExchange.totalDebtAfterMustBeAtLeast')}: ${troveParams.minDebt} USDFC`
                  : requiredFilIncrement > parseFloat(filBalance)
                  ? t('usdfcExchange.insufficientBalance')
                  : t('usdfcExchange.invalidInput')
                }
              </div>
            )}
          </div>
        ) : (
          // Redeem FIL mode
          <div className="space-y-4">
            {/* Staked FIL */}
            <div>
              <div className="flex items-center gap-3 mb-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('usdfcExchange.pledged')}: {currentCollateral.toFixed(4)} FIL
                </label>
                <span className="text-gray-500">-</span>
                <div className="flex-1 relative">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max={currentCollateral}
                    value={redeemFil}
                    onChange={(e) => setRedeemFil(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-4 py-2 pr-20 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white text-lg"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400">
                    FIL
                  </span>
                </div>
                <button
                  onClick={() => setRedeemFil(currentCollateral.toString())}
                  className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors text-sm whitespace-nowrap"
                >
                  {t('usdfcExchange.redeemAll')}
                </button>
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400">
                {t('usdfcExchange.remainingAfter')}: {totalFilAfterRedeem.toFixed(4)} FIL
              </div>
            </div>

            {/* Borrowed USDFC */}
            <div>
              <div className="flex items-center gap-3 mb-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('usdfcExchange.borrowed')}: {currentDebt.toFixed(2)} USDFC
                </label>
                <span className="text-gray-500">-</span>
                <span className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                  {requiredUsdfcRepay.toFixed(2)} USDFC
                </span>
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400">
                {t('usdfcExchange.remainingAfter')}: {totalDebtAfterRedeem.toFixed(2)} USDFC
              </div>
            </div>

            {/* Collateral ratio slider */}
            {!isFullRedeem && (
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t('usdfcExchange.collateralRatio')}
                  </label>
                  <span className={`text-lg font-semibold ${
                    redeemRatio >= 150
                      ? 'text-green-600 dark:text-green-400'
                      : redeemRatio >= troveParams.minCollateralRatio
                      ? 'text-yellow-600 dark:text-yellow-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}>
                    {redeemRatio}%
                  </span>
                </div>
                <input
                  type="range"
                  min={troveParams.minCollateralRatio + 1}
                  max={parseFloat(troveInfo?.collateralRatio || '150')}
                  step="1"
                  value={redeemRatio}
                  onChange={(e) => setRedeemRatio(parseInt(e.target.value))}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                />
                <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
                  <span>{troveParams.minCollateralRatio + 1}% ({t('usdfcExchange.minimum')})</span>
                  <span>{parseFloat(troveInfo?.collateralRatio || '150').toFixed(0)}% ({t('usdfcExchange.current')})</span>
                </div>
              </div>
            )}

            {isFullRedeem && (
              <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-700">
                <div className="flex items-start gap-2">
                  <InformationCircleIcon className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-yellow-900 dark:text-yellow-200">
                    {t('usdfcExchange.fullRedeemNote')}
                  </div>
                </div>
              </div>
            )}

            {/* Fee details */}
            {redeemFil && parseFloat(redeemFil) > 0 && (
              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-700 space-y-2">
                <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('usdfcExchange.transactionSummary')}
                </div>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between text-gray-600 dark:text-gray-400">
                    <span>{t('usdfcExchange.redeemFil')}:</span>
                    <span className="font-medium">{parseFloat(redeemFil).toFixed(4)} FIL</span>
                  </div>
                  <div className="flex justify-between text-gray-600 dark:text-gray-400">
                    <span>{t('usdfcExchange.needRepayUsdfc')}:</span>
                    <span className="font-medium text-orange-600 dark:text-orange-400">{(isFullRedeem ? currentDebt : requiredUsdfcRepay).toFixed(2)} USDFC</span>
                  </div>
                  {isFullRedeem && (
                    <>
                      <div className="pt-1.5 border-t border-blue-200 dark:border-blue-700 text-xs text-gray-500 dark:text-gray-400 space-y-1">
                        <div>{t('usdfcExchange.debtBreakdown')}:</div>
                        <div className="pl-2">
                          • {t('usdfcExchange.borrowedAmount')}: {(currentDebt - liquidationReserve).toFixed(2)} USDFC
                        </div>
                        <div className="pl-2">
                          • {t('usdfcExchange.liquidationReserve')}: {liquidationReserve.toFixed(2)} USDFC
                        </div>
                      </div>
                      <div className="pt-1.5 border-t border-blue-200 dark:border-blue-700 text-yellow-700 dark:text-yellow-300 font-medium">
                        {t('usdfcExchange.closeTroveNote')}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Confirm button */}
            <button
              onClick={handleConfirmTransaction}
              disabled={!canSubmit()}
              className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium"
            >
              {t('usdfcExchange.confirmTransaction')} {t('usdfcExchange.needPay')}: {(isFullRedeem ? currentDebt : requiredUsdfcRepay).toFixed(2)} USDFC
            </button>

            {redeemFil && parseFloat(redeemFil) > 0 && !canSubmit() && (
              <div className="text-sm text-red-600 dark:text-red-400 text-center">
                {parseFloat(redeemFil) > currentCollateral
                  ? t('usdfcExchange.exceedsCollateral')
                  : (isFullRedeem ? currentDebt : requiredUsdfcRepay) > parseFloat(usdfcBalance)
                  ? t('usdfcExchange.insufficientUsdfc')
                  : t('usdfcExchange.invalidInput')
                }
              </div>
            )}
          </div>
        )}

        {/* Collateral rules explanation and get USDFC */}
        <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between gap-4">
            {/* Left side: Collateral rules explanation */}
            <a
              href="https://docs.secured.finance/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
            >
              {t('usdfcExchange.viewRules')}
              <ArrowTopRightOnSquareIcon className="w-4 h-4" />
            </a>
            
            {/* Right side: DEX links */}
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600 dark:text-gray-400">{t('usdfcExchange.getUsdfcFrom')}:</span>
              <a
                href="https://www.sushi.com/filecoin/swap"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
              >
                SushiSwap
                <ArrowTopRightOnSquareIcon className="w-4 h-4" />
              </a>
              <a
                href="https://app.uniswap.org/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
              >
                Uniswap
                <ArrowTopRightOnSquareIcon className="w-4 h-4" />
              </a>
              <a
                href="https://app.usdfc.net"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
              >
                USDFC Website
                <ArrowTopRightOnSquareIcon className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Wallet selection modal */}
      <WalletSelectorModal
        isOpen={showWalletModal}
        onClose={() => setShowWalletModal(false)}
        onSuccess={handleTransactionSuccess}
        paymentConfig={getPaymentConfig()}
        onConfirm={executeTransaction}
        highlightAddress={selectedWalletAddress}
        allowedAddresses={[selectedWalletAddress]}
      />
    </div>
  )
}

export default USDFCExchange
