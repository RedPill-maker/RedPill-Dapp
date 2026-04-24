/**
 * Wallet selector modal component
 * Generic wallet selection and transaction execution component
 *
 * Responsibilities:
 * 1. Display transaction info (provided by caller)
 * 2. Select wallet and verify password
 * 3. Execute transaction and return result
 *
 * Contains no business logic; all business logic is handled by the caller
 */

import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { privateDataMgr } from '../utils/privateDataMgr'
import { notify, NotificationHandle } from './ToastNotification'
import { rpcConnectorInstance } from '../utils/rpcConnector'
import { getContractErrorMessage } from '../utils/contractErrorParser'
import { addTransaction } from '../utils/dbConnector'
import { BLOCK_RENEW_TIME } from '../../config'

// Payment type config
export interface PaymentConfig {
  type: 'fixed' | 'range' | 'gas-only' | 'custom' // fixed amount | range | gas only | custom
  amount?: string // fixed amount
  minAmount?: string // minimum amount
  maxAmount?: string // maximum amount
  token: string // token address (0x0...0 = FIL)
  tokenSymbol: string // token symbol (e.g. FIL, USDFC)
  description: string // transaction description
}

// Single transaction in a batch
export interface BatchTransactionItem {
  id: string // unique identifier
  name: string // transaction name (e.g. "Approve token", "Execute transaction")
  description: string // transaction description
  paymentConfig: PaymentConfig // payment config
  execute: (address: string, password: string, amount?: string) => Promise<TransactionResult>
}

// Batch transaction config
export interface BatchPaymentConfig {
  transactions: BatchTransactionItem[]
  totalDescription: string // overall description
}

// Transaction result
export interface TransactionResult {
  success: boolean
  txHash?: string
  error?: string
  rawError?: any // raw error object for contract error parsing (contains data, transaction, etc.)
}

// Gas estimate callback
export type GasEstimateCallback = (address: string) => Promise<{
  success: boolean
  gasEstimate?: string
  error?: string
}>

// Batch transaction result
export interface BatchTransactionResult {
  success: boolean // true only if all transactions succeed
  results: Array<{
    id: string
    name: string
    success: boolean
    txHash?: string
    error?: string
  }>
}

// Preflight result (storage cost estimate, etc.)
export interface PreflightResult {
  success: boolean
  estimatedCostPerDay?: string
  estimatedCostPerMonth?: string
  currency?: string
  message?: string
  error?: string
}

// Transaction metadata for recording
export interface TransactionMetadata {
  method: string // contract method name (e.g. 'tipWork', 'registerCreator', 'withdraw')
  counterpartyAddress?: string // optional: counterparty address (e.g. creator address for tips)
}

interface WalletSelectorModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void // optional: callback after successful transaction (replaces onClose when distinguishing success/cancel)
  paymentConfig?: PaymentConfig // single transaction config (mutually exclusive with batchConfig)
  batchConfig?: BatchPaymentConfig // batch transaction config (mutually exclusive with paymentConfig)
  onConfirm?: (
    address: string,
    password: string,
    amount?: string,
    customParams?: Record<string, any>,
  ) => Promise<TransactionResult> // single transaction callback
  onBatchComplete?: (result: BatchTransactionResult) => void // batch transaction complete callback
  highlightAddress?: string // optional: highlight a specific address (recommended wallet)
  allowedAddresses?: string[] // optional: restrict selectable addresses
  customParams?: Record<string, any> // optional: custom params from caller, passed through to onConfirm
  allowBackground?: boolean // optional: allow background processing (non-critical transactions like tips)
  onBackgroundStart?: () => void // optional: callback when entering background processing
  onPreflight?: (address: string, password: string) => Promise<PreflightResult> // optional: preflight callback (e.g. storage cost estimate)
  // optional: custom result override, returns { success, message } to override default success/failure
  // used for "error counts as success" scenarios (e.g. settleJackpot already triggered by someone else)
  onResultOverride?: (result: TransactionResult) => { success: boolean; message?: string } | null
  // optional: gas estimate callback, called for each wallet to estimate gas cost
  onGasEstimate?: GasEstimateCallback
  // optional: transaction metadata for recording (method name and counterparty address)
  transactionMetadata?: TransactionMetadata
}

const WalletSelectorModal: React.FC<WalletSelectorModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  paymentConfig,
  batchConfig,
  onConfirm,
  onBatchComplete,
  highlightAddress,
  allowedAddresses,
  customParams,
  allowBackground,
  onBackgroundStart,
  onPreflight,
  onResultOverride,
  onGasEstimate,
  transactionMetadata,
}) => {
  const { t } = useTranslation()
  const isBatchMode = !!batchConfig
  const effectivePaymentConfig = paymentConfig || (batchConfig ? batchConfig.transactions[0]?.paymentConfig : null)
  
  const [step, setStep] = useState<
    'txInfo' | 'selectWallet' | 'password' | 'preflight' | 'processing' | 'success' | 'error'
  >('txInfo')
  const [preflightData, setPreflightData] = useState<PreflightResult | null>(null)
  const [preflightLoading, setPreflightLoading] = useState(false)
  const [wallets, setWallets] = useState<
    Array<{ ethAddress: string; filAddress: string; name: string }>
  >([])
  const [walletBalances, setWalletBalances] = useState<Record<string, string>>({})
  const [walletGasEstimates, setWalletGasEstimates] = useState<Record<string, string>>({})
  const [loadingBalances, setLoadingBalances] = useState(false)
  const [loadingGasEstimates, setLoadingGasEstimates] = useState(false)
  const [selectedWallet, setSelectedWallet] = useState<string>('')
  const [password, setPassword] = useState('')
  const [customAmount, setCustomAmount] = useState('')
  const [error, setError] = useState('')
  const [txHash, setTxHash] = useState('')
  const backgroundRef = useRef(false)
  const notifyHandleRef = useRef<NotificationHandle | null>(null)
  
  // Random chars displayed in blocks when highlighted
  const BLOCK_CHARS = ['#', '$', '%', '&', '@', '!', '*', '~', '^', '0', '1', 'A', 'B', 'F', 'X']
  const [blockChars, setBlockChars] = useState<string[]>(['#', '#', '#', '#'])
  const blockCharsRef = useRef<string[]>(['#', '#', '#', '#'])
  
  // Progress bar state (30 seconds based on BLOCK_RENEW_TIME)
  const [progress, setProgress] = useState(0)
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (step !== 'processing') return
    // Cycle random chars every 500ms to match highlight animation
    const interval = setInterval(() => {
      const next = blockCharsRef.current.map(() =>
        BLOCK_CHARS[Math.floor(Math.random() * BLOCK_CHARS.length)]
      )
      blockCharsRef.current = next
      setBlockChars([...next])
    }, 500)
    return () => clearInterval(interval)
  }, [step])

  // Progress bar effect (runs during processing)
  useEffect(() => {
    if (step === 'processing') {
      setProgress(0)
      const duration = BLOCK_RENEW_TIME + 20000 // 30000ms (30 seconds)
      const intervalTime = 100 // Update every 100ms
      const increment = (intervalTime / duration) * 100 // Percentage increment per interval
      
      progressIntervalRef.current = setInterval(() => {
        setProgress((prev) => {
          const next = prev + increment
          // Cap at 95% to avoid reaching 100% before transaction completes
          return next >= 95 ? 95 : next
        })
      }, intervalTime)
      
      return () => {
        if (progressIntervalRef.current) {
          clearInterval(progressIntervalRef.current)
          progressIntervalRef.current = null
        }
      }
    } else {
      // Reset progress when leaving processing state
      setProgress(0)
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current)
        progressIntervalRef.current = null
      }
    }
  }, [step])

  // Batch transaction state / バッチ交易状態
  const [batchProgress, setBatchProgress] = useState<{
    currentIndex: number
    results: Array<{
      id: string
      name: string
      success: boolean
      txHash?: string
      error?: string
    }>
  }>({ currentIndex: 0, results: [] })

  useEffect(() => {
    if (isOpen) {
      resetState()
      loadWallets()
    }
  }, [isOpen])

  const resetState = () => {
    setStep('txInfo')
    setSelectedWallet('')
    setPassword('')
    setCustomAmount(effectivePaymentConfig?.amount || '')
    setError('')
    setTxHash('')
    setPreflightData(null)
    setPreflightLoading(false)
    setWalletBalances({})
    setWalletGasEstimates({})
    setLoadingBalances(false)
    setLoadingGasEstimates(false)
    backgroundRef.current = false
    notifyHandleRef.current = null
    setBatchProgress({ currentIndex: 0, results: [] })
    setProgress(0)
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current)
      progressIntervalRef.current = null
    }
  }

  const loadWallets = async () => {
    const walletList = await privateDataMgr.getWalletList()
    // Filter by allowedAddresses if specified
    const filtered = allowedAddresses && allowedAddresses.length > 0
      ? walletList.filter((w) =>
          allowedAddresses.some((a) => a.toLowerCase() === w.ethAddress.toLowerCase())
        )
      : walletList
    setWallets(filtered)

    // Load wallet balances (using first transaction's token)
    const tokenForBalance = effectivePaymentConfig?.token
    if (walletList.length > 0 && tokenForBalance) {
      setLoadingBalances(true)
      const balances: Record<string, string> = {}
      
      try {
        await Promise.all(
          walletList.map(async (wallet) => {
            try {
              const result = await rpcConnectorInstance.getTokenBalance(
                wallet.ethAddress,
                tokenForBalance
              )
              if (result.success && result.balance) {
                balances[wallet.ethAddress] = result.balance
              } else {
                balances[wallet.ethAddress] = '0'
              }
            } catch (err) {
              console.error(`Failed to get balance for ${wallet.ethAddress}:`, err)
              balances[wallet.ethAddress] = '0'
            }
          })
        )
      } catch (err) {
        console.error('Failed to load wallet balances:', err)
      } finally {
        setWalletBalances(balances)
        setLoadingBalances(false)
      }
    }

    // Load gas estimates if callback provided
    if (walletList.length > 0 && onGasEstimate) {
      setLoadingGasEstimates(true)
      const gasEstimates: Record<string, string> = {}
      
      try {
        await Promise.all(
          walletList.map(async (wallet) => {
            try {
              const result = await onGasEstimate(wallet.ethAddress)
              if (result.success && result.gasEstimate) {
                gasEstimates[wallet.ethAddress] = result.gasEstimate
              } else {
                gasEstimates[wallet.ethAddress] = '~0.001'
              }
            } catch (err) {
              console.error(`Failed to estimate gas for ${wallet.ethAddress}:`, err)
              gasEstimates[wallet.ethAddress] = '~0.001'
            }
          })
        )
      } catch (err) {
        console.error('Failed to load gas estimates:', err)
      } finally {
        setWalletGasEstimates(gasEstimates)
        setLoadingGasEstimates(false)
      }
    }

    // Auto-select recommended wallet or first wallet
    if (walletList.length > 0) {
      if (highlightAddress) {
        const found = walletList.find(
          (w) => w.ethAddress.toLowerCase() === highlightAddress.toLowerCase(),
        )
        if (found) {
          setSelectedWallet(found.ethAddress)
          return
        }
      }
      setSelectedWallet(walletList[0].ethAddress)
    }
  }

  const handleSelectWallet = (address: string) => {
    setSelectedWallet(address)
    setError('')
  }

  // Check if wallet balance is sufficient / ウォレット残高が十分かチェック
  const isBalanceSufficient = (address: string): boolean => {
    const balance = walletBalances[address]
    if (!balance) return false

    const balanceNum = parseFloat(balance)
    if (isNaN(balanceNum)) return false

    // Get the amount to be paid / 支払う金額を取得
    let requiredAmount = 0
    
    if (isBatchMode && batchConfig) {
      // Batch mode: calculate total amount for all transactions / バッチモード：すべてのトランザクションの合計金額を計算
      for (const tx of batchConfig.transactions) {
        const cfg = tx.paymentConfig
        if (cfg.type === 'fixed' && cfg.amount) {
          requiredAmount += parseFloat(cfg.amount)
        }
        // range/custom types not supported for estimation in batch mode / バッチモードではrange/customタイプの推定はサポートされていません
      }
    } else if (effectivePaymentConfig) {
      if (effectivePaymentConfig.type === 'fixed' && effectivePaymentConfig.amount) {
        requiredAmount = parseFloat(effectivePaymentConfig.amount)
      } else if (effectivePaymentConfig.type === 'range' && customAmount) {
        requiredAmount = parseFloat(customAmount)
      } else if (effectivePaymentConfig.type === 'custom' && customAmount) {
        requiredAmount = parseFloat(customAmount)
      }
    }
    // gas-only type doesn't need balance check (only needs minimal gas) / gas-onlyタイプは残高チェックが不要（最小限のガスのみ必要）

    return balanceNum >= requiredAmount
  }

  const handleNextFromTxInfo = () => {
    // Validate amount for custom/range types before proceeding
    if (!isBatchMode && effectivePaymentConfig && (effectivePaymentConfig.type === 'custom' || effectivePaymentConfig.type === 'range')) {
      const amount = parseFloat(customAmount)
      if (isNaN(amount) || amount <= 0) {
        setError(t('walletSelector.invalidAmount'))
        return
      }
      if (effectivePaymentConfig.type === 'range') {
        const min = parseFloat(effectivePaymentConfig.minAmount || '0')
        const max = parseFloat(effectivePaymentConfig.maxAmount || '999999999')
        if (amount < min || amount > max) {
          setError(
            t('walletSelector.amountRange', { min, max, symbol: effectivePaymentConfig.tokenSymbol }),
          )
          return
        }
      }
    }
    setError('')
    // Skip wallet selection when only one wallet is allowed — it's already auto-selected
    if (allowedAddresses && allowedAddresses.length === 1) {
      setStep('password')
    } else {
      setStep('selectWallet')
    }
  }

  const handleNextToPassword = () => {
    if (!selectedWallet) {
      setError(t('walletSelector.selectWalletError'))
      return
    }

    setError('')
    setStep('password')
  }

  const handleConfirmWithPassword = async () => {
    if (!password) {
      setError(t('walletSelector.enterPasswordError'))
      return
    }

    // Verify password / パスワードを検証
    const isValid = await privateDataMgr.verifyWalletPassword(
      selectedWallet,
      password,
    )
    if (!isValid) {
      setError(t('walletSelector.passwordError'))
      return
    }

    setError('')
    
    // If there's a preflight callback, execute it first / プリフライトコールバックがある場合は、最初に実行
    if (onPreflight) {
      setStep('preflight')
      await runPreflight()
      // After preflight completes, don't automatically proceed to next step, wait for user to click "Continue Transaction" / プリフライト完了後、自動的に次のステップに進まず、ユーザーが「トランザクション続行」をクリックするのを待つ
      return
    }
    
    // No preflight, execute transaction directly / プリフライトなし、トランザクションを直接実行
    await handleConfirmTransaction()
  }

  const runPreflight = async () => {
    setPreflightLoading(true)
    setPreflightData(null)
    try {
      const result = await onPreflight!(selectedWallet, password)
      setPreflightData(result)
    } catch (err: any) {
      setPreflightData({
        success: false,
        error: err.message || t('walletSelector.costEstimateFailed'),
      })
    } finally {
      setPreflightLoading(false)
    }
  }

  const handleConfirmTransaction = async () => {
    setStep('processing')
    setError('')
    backgroundRef.current = false

    // Batch transaction mode / バッチトランザクションモード
    if (isBatchMode && batchConfig) {
      const results: typeof batchProgress.results = []
      
      for (let i = 0; i < batchConfig.transactions.length; i++) {
        const tx = batchConfig.transactions[i]
        setBatchProgress({ currentIndex: i, results: [...results] })
        
        try {
          const amount = tx.paymentConfig.type === 'fixed' ? tx.paymentConfig.amount : undefined
          const result = await tx.execute(selectedWallet, password, amount)
          
          results.push({
            id: tx.id,
            name: tx.name,
            success: result.success,
            txHash: result.txHash,
            error: result.error ? getContractErrorMessage(result.rawError || result.error, t) : undefined
          })
          
          // If a transaction fails, stop subsequent transactions / トランザクションが失敗した場合、後続のトランザクションを停止
          if (!result.success) {
            setBatchProgress({ currentIndex: i, results })
            const batchResult: BatchTransactionResult = {
              success: false,
              results
            }
            onBatchComplete?.(batchResult)
            setError(`${tx.name} ${t('common.error')}: ${results[i].error}`)
            setStep('error')
            return
          }
        } catch (err: any) {
          const errorMsg = getContractErrorMessage(err, t)
          results.push({
            id: tx.id,
            name: tx.name,
            success: false,
            error: errorMsg
          })
          setBatchProgress({ currentIndex: i, results })
          const batchResult: BatchTransactionResult = {
            success: false,
            results
          }
          onBatchComplete?.(batchResult)
          setError(`${tx.name} ${t('common.error')}: ${errorMsg}`)
          setStep('error')
          return
        }
      }
      
      // All transactions successful / すべてのトランザクション成功
      setBatchProgress({ currentIndex: batchConfig.transactions.length, results })
      const batchResult: BatchTransactionResult = {
        success: true,
        results
      }
      onBatchComplete?.(batchResult)
      setTxHash(results[results.length - 1]?.txHash || '')
      setStep('success')
      setTimeout(() => { (onSuccess ?? onClose)() }, 3000)
      return
    }

    // Single transaction mode / 単一トランザクションモード
    if (!onConfirm) return
    
    try {
      const amount =
        effectivePaymentConfig?.type === 'custom' || effectivePaymentConfig?.type === 'range'
          ? customAmount
          : effectivePaymentConfig?.amount

      const resultPromise = onConfirm(selectedWallet, password, amount, customParams)

      const result = await resultPromise

      // Record transaction if successful and metadata provided
      if (result.success && result.txHash && transactionMetadata) {
        try {
          // Get transaction receipt to calculate actual gas fee and block timestamp
          const provider = rpcConnectorInstance.getProvider()
          const receipt = await provider.getTransactionReceipt(result.txHash)
          
          let actualGasFee = '0'
          let txTimestamp = Math.floor(Date.now() / 1000)
          if (receipt) {
            // Calculate gas fee: gasUsed * effectiveGasPrice
            const gasUsed = receipt.gasUsed
            const effectiveGasPrice = receipt.gasPrice || receipt.effectiveGasPrice || 0n
            const gasFeeWei = gasUsed * effectiveGasPrice
            // Convert to FIL (divide by 10^18)
            actualGasFee = (Number(gasFeeWei) / 1e18).toFixed(6)
            // Use block timestamp so outgoing and incoming records sort consistently
            const block = await provider.getBlock(receipt.blockNumber)
            if (block) txTimestamp = block.timestamp
          }

          // Record the transaction
          await addTransaction({
            wallet_address: selectedWallet,
            token_address: effectivePaymentConfig?.token || '0x0000000000000000000000000000000000000000',
            amount: amount || '0',
            gas_fee: actualGasFee,
            contract_method: transactionMetadata.method,
            is_outgoing: 1, // Outgoing transaction
            counterparty_address: transactionMetadata.counterpartyAddress,
            tx_hash: result.txHash,
            timestamp: txTimestamp,
            source: 'app',
          })
        } catch (err) {
          console.error('Failed to record transaction:', err)
          // Don't fail the transaction if recording fails
        }
      } else if (result.success && result.txHash && effectivePaymentConfig) {
        // Fallback: record transaction using description as method name
        try {
          const provider = rpcConnectorInstance.getProvider()
          const receipt = await provider.getTransactionReceipt(result.txHash)
          
          let actualGasFee = '0'
          let txTimestamp = Math.floor(Date.now() / 1000)
          if (receipt) {
            const gasUsed = receipt.gasUsed
            const effectiveGasPrice = receipt.gasPrice || receipt.effectiveGasPrice || 0n
            const gasFeeWei = gasUsed * effectiveGasPrice
            actualGasFee = (Number(gasFeeWei) / 1e18).toFixed(6)
            const block = await provider.getBlock(receipt.blockNumber)
            if (block) txTimestamp = block.timestamp
          }

          // Use description as method name (simplified)
          const methodName = effectivePaymentConfig.description || 'transaction'

          await addTransaction({
            wallet_address: selectedWallet,
            token_address: effectivePaymentConfig.token,
            amount: amount || '0',
            gas_fee: actualGasFee,
            contract_method: methodName,
            is_outgoing: 1,
            counterparty_address: undefined,
            tx_hash: result.txHash,
            timestamp: txTimestamp,
            source: 'app',
          })
        } catch (err) {
          console.error('Failed to record transaction:', err)
        }
      }

      // If already switched to background mode, display result via notification / 既にバックグラウンドモードに切り替わっている場合、通知で結果を表示
      if (backgroundRef.current) {
        const handle = notifyHandleRef.current
        if (handle) {
          if (result.success) {
            handle.success(`${effectivePaymentConfig?.description} - ${t('common.success')}`, result.txHash)
            handle.close(5)
          } else {
            const errorMsg = result.error ? getContractErrorMessage(result.rawError || result.error, t) : t('contractErrors.unknown')
            handle.error(`${effectivePaymentConfig?.description} - ${t('common.error')}: ${errorMsg}`)
            handle.close(8)
          }
        }
        return
      }

      // Foreground mode, display result normally / フォアグラウンドモード、通常に結果を表示
      if (result.success) {
        setTxHash(result.txHash || '')
        setStep('success')
        setTimeout(() => { (onSuccess ?? onClose)() }, 3000)
      } else {
        // Check if there's a custom result override (e.g., settleJackpot already triggered by someone else, treat as success) / カスタム結果オーバーライドがあるかチェック（例：settleJackpotが既に他の人によってトリガーされた場合、成功として扱う）
        const override = onResultOverride?.(result)
        if (override) {
          if (override.success) {
            setTxHash('')
            setStep('success')
            setTimeout(() => { (onSuccess ?? onClose)() }, 3000)
          } else {
            const errorMsg = override.message || (result.error ? getContractErrorMessage(result.rawError || result.error, t) : t('contractErrors.unknown'))
            setError(errorMsg)
            setStep('error')
          }
        } else {
          const errorMsg = result.error ? getContractErrorMessage(result.rawError || result.error, t) : t('contractErrors.unknown')
          setError(errorMsg)
          setStep('error')
        }
      }
    } catch (err: any) {
      if (backgroundRef.current) {
        const handle = notifyHandleRef.current
        if (handle) {
          const errorMsg = getContractErrorMessage(err, t)
          handle.error(`${effectivePaymentConfig?.description} - ${t('common.error')}: ${errorMsg}`)
          handle.close(8)
        }
        return
      }
      const errorMsg = getContractErrorMessage(err, t)
      setError(errorMsg)
      setStep('error')
    }
  }

  const handleGoBackground = () => {
    backgroundRef.current = true
    const desc = isBatchMode ? batchConfig?.totalDescription : effectivePaymentConfig?.description
    notifyHandleRef.current = notify(`${desc} - ${t('common.processing')}`)
    onBackgroundStart?.()
    onClose()
  }

  const handleBack = () => {
    if (step === 'selectWallet') {
      setStep('txInfo')
      setError('')
    } else if (step === 'password') {
      setStep('selectWallet')
      setPassword('')
      setError('')
    } else if (step === 'preflight') {
      setStep('password')
      setPreflightData(null)
      setError('')
    } else if (step === 'error') {
      setStep('password')
      setError('')
      setBatchProgress({ currentIndex: 0, results: [] })
    }
  }

  const handleCancel = () => {
    onClose()
  }

  if (!isOpen) return null

  const getPaymentDisplay = (config?: PaymentConfig | null) => {
    if (!config) return ''
    switch (config.type) {
      case 'fixed':
        return `${config.amount} ${config.tokenSymbol}`
      case 'range':
        return `${config.minAmount} - ${config.maxAmount} ${config.tokenSymbol}`
      case 'gas-only':
        return t('walletSelector.gasOnly')
      case 'custom':
        return `${t('walletSelector.customAmount')} (${config.tokenSymbol})`
      default:
        return ''
    }
  }

  return createPortal(
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4">
        {/* Header / ヘッダー */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            {step === 'txInfo' && t('walletSelector.transactionInfo')}
            {step === 'selectWallet' && t('walletSelector.selectWallet')}
            {step === 'password' && t('walletSelector.enterPasswordAndConfirm')}
            {step === 'preflight' && t('walletSelector.costEstimate')}
            {step === 'processing' && t('walletSelector.processingTitle')}
            {step === 'success' && t('walletSelector.successTitle')}
            {step === 'error' && t('walletSelector.errorTitle')}
          </h2>
          {!(step === 'processing' && !allowBackground) && (
            <button
              onClick={step === 'processing' && allowBackground ? handleGoBackground : handleCancel}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>

        {/* Content Area / コンテンツエリア */}
        <div className="p-6">
          {/* Transaction Info Display Step / トランザクション情報表示ステップ */}
          {step === 'txInfo' && (
            <div className="space-y-4">
              {/* Batch Transaction Details / バッチトランザクション詳細 */}
              {isBatchMode && batchConfig ? (
                <div className="space-y-3">
                  {batchConfig.transactions.map((tx, index) => (
                    <div key={tx.id} className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-700">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-gray-900 dark:text-white">
                          {index + 1}. {tx.name}
                        </span>
                      </div>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-600 dark:text-gray-400">{t('walletSelector.paymentAmount')}</span>
                          <span className="text-gray-900 dark:text-white font-medium">
                            {getPaymentDisplay(tx.paymentConfig)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600 dark:text-gray-400">Gas</span>
                          <span className="text-gray-500 dark:text-gray-400 text-xs">{t('walletSelector.loadingBalance')}</span>
                        </div>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                        {tx.description}
                      </p>
                    </div>
                  ))}
                  <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                    <p className="text-sm text-gray-700 dark:text-gray-300">
                      {batchConfig.totalDescription}
                    </p>
                  </div>
                </div>
              ) : (
                /* Single transaction details */
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-700">
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">{t('walletSelector.paymentAmount')}</span>
                      <span className="text-gray-900 dark:text-white font-medium">
                        {getPaymentDisplay(effectivePaymentConfig)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Gas</span>
                      <span className="text-gray-500 dark:text-gray-400 text-xs">
                        {loadingGasEstimates 
                          ? t('walletSelector.loadingBalance')
                          : onGasEstimate 
                            ? `~${walletGasEstimates[selectedWallet] || '0.001'} FIL`
                            : t('walletSelector.loadingBalance')
                        }
                      </span>
                    </div>
                    <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                      <p className="text-gray-700 dark:text-gray-300">
                        {effectivePaymentConfig?.description}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Amount input for custom/range types — shown on txInfo step so user enters amount first */}
              {!isBatchMode && effectivePaymentConfig && (effectivePaymentConfig.type === 'custom' || effectivePaymentConfig.type === 'range') && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {effectivePaymentConfig.type === 'range'
                      ? `${t('walletSelector.enterAmount')} (${effectivePaymentConfig.minAmount} - ${effectivePaymentConfig.maxAmount} ${effectivePaymentConfig.tokenSymbol})`
                      : `${t('walletSelector.enterAmount')} (${effectivePaymentConfig.tokenSymbol})`}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min={effectivePaymentConfig.minAmount || '0'}
                    max={effectivePaymentConfig.maxAmount}
                    value={customAmount}
                    onChange={(e) => { setCustomAmount(e.target.value); setError('') }}
                    placeholder={t('walletSelector.enterAmount')}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    autoFocus
                  />
                </div>
              )}

              {error && (
                <div className="text-sm text-red-600 dark:text-red-400">
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Select Wallet Step / ウォレット選択ステップ */}
          {step === 'selectWallet' && (
            <div className="space-y-4">
              {/* Wallet Selection / ウォレット選択 */}
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t('walletSelector.selectWalletHint')}
              </p>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {wallets.length === 0 ? (
                  <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                    {t('walletSelector.noWallet')}
                  </div>
                ) : (
                  wallets.map((wallet) => {
                    const isHighlighted =
                      highlightAddress &&
                      wallet.ethAddress.toLowerCase() ===
                        highlightAddress.toLowerCase()
                    const balance = walletBalances[wallet.ethAddress]
                    const hasSufficientBalance = isBalanceSufficient(wallet.ethAddress)
                    const isDisabled = !loadingBalances && balance !== undefined && !hasSufficientBalance

                    return (
                      <div
                        key={wallet.ethAddress}
                        onClick={() => !isDisabled && handleSelectWallet(wallet.ethAddress)}
                        className={`p-4 border rounded-lg transition-colors ${
                          isDisabled
                            ? 'opacity-50 cursor-not-allowed bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-600'
                            : selectedWallet === wallet.ethAddress
                              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 cursor-pointer'
                              : isHighlighted
                                ? 'border-green-500 bg-green-50 dark:bg-green-900/20 cursor-pointer'
                                : 'border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-700 cursor-pointer'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="font-medium text-gray-900 dark:text-white">
                              {wallet.name}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 font-mono">
                              {wallet.ethAddress.slice(0, 10)}...
                              {wallet.ethAddress.slice(-8)}
                            </div>
                            {/* Display Balance / 残高を表示 */}
                            <div className="text-xs mt-2">
                              {loadingBalances ? (
                                <span className="text-gray-400 dark:text-gray-500">
                                  {t('walletSelector.loadingBalance')}
                                </span>
                              ) : balance !== undefined ? (
                                <span
                                  className={
                                    hasSufficientBalance
                                      ? 'text-green-600 dark:text-green-400'
                                      : 'text-red-600 dark:text-red-400'
                                  }
                                >
                                  {t('walletSelector.balance')}: {parseFloat(balance).toFixed(4)} {effectivePaymentConfig?.tokenSymbol}
                                  {!hasSufficientBalance && ` (${t('walletSelector.insufficientBalance')})`}
                                </span>
                              ) : (
                                <span className="text-gray-400 dark:text-gray-500">
                                  {t('walletSelector.balanceLoadFailed')}
                                </span>
                              )}
                            </div>
                          </div>
                          {isHighlighted && !isDisabled && (
                            <div className="ml-2">
                              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                                {t('walletSelector.recommended')}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {/* Batch Transaction Preview / バッチトランザクションプレビュー */}
              {isBatchMode && batchConfig && (
                <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                    {t('walletSelector.batchTransactionPreview')}
                  </h4>
                  <div className="space-y-2">
                    {batchConfig.transactions.map((tx, index) => (
                      <div key={tx.id} className="flex items-center justify-between text-sm">
                        <span className="text-gray-600 dark:text-gray-400">
                          {index + 1}. {tx.name}
                        </span>
                        <span className="text-gray-900 dark:text-white">
                          {getPaymentDisplay(tx.paymentConfig)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {error && (
                <div className="text-sm text-red-600 dark:text-red-400">
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Enter Password Step / パスワード入力ステップ */}
          {step === 'password' && (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                  {t('walletSelector.selectedWallet')}
                </p>
                <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <div className="font-medium text-gray-900 dark:text-white">
                    {wallets.find((w) => w.ethAddress === selectedWallet)?.name}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 font-mono">
                    {selectedWallet.slice(0, 10)}...{selectedWallet.slice(-8)}
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('walletSelector.walletPassword')}
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleConfirmWithPassword()}
                  placeholder={t('walletSelector.walletPasswordPlaceholder')}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  autoFocus
                />
              </div>
              {error && (
                <div className="text-sm text-red-600 dark:text-red-400">
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Preflight Step (cost estimate) / プリフライトステップ（費用推定） */}
          {step === 'preflight' && (
            <div className="space-y-4">
              {preflightLoading ? (
                <div className="text-center py-8">
                  <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
                  <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
                    {t('walletSelector.queryingPrice')}
                  </p>
                </div>
              ) : preflightData?.success ? (
                <div className="space-y-4">
                  <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-700">
                    <h3 className="font-medium text-green-800 dark:text-green-300 mb-3">
                      {t('walletSelector.realTimeCostEstimate')}
                    </h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">{t('walletSelector.dailyCost')}</span>
                        <span className="text-gray-900 dark:text-white font-medium">
                          {preflightData.estimatedCostPerDay} {preflightData.currency}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">{t('walletSelector.monthlyCost')}</span>
                        <span className="text-gray-900 dark:text-white font-medium">
                          {preflightData.estimatedCostPerMonth} {preflightData.currency}
                        </span>
                      </div>
                    </div>
                  </div>
                  {preflightData.message && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {preflightData.message}
                    </p>
                  )}
                </div>
              ) : (
                <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-700">
                  <p className="text-sm text-red-700 dark:text-red-300">
                    {preflightData?.error || t('walletSelector.costEstimateFailed')}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Processing Step / 処理中ステップ */}
          {step === 'processing' && (
            <div className="text-center py-8">
              {/* Blockchain Packing Animation / ブロックチェーンパッキングアニメーション */}
              <div className="flex flex-col items-center gap-3 mb-2">
                {/* Miner Icon + Mining Particles (above grid) / マイナーアイコン + マイニング粒子（グリッドの上） */}
                <div className="relative flex items-center justify-center w-16 h-10">
                  <span className="text-2xl" style={{ animation: 'minerBob 0.8s ease-in-out infinite alternate' }}>⛏️</span>
                  {[0, 1, 2].map(i => (
                    <span
                      key={i}
                      className="absolute text-yellow-400 text-xs font-bold"
                      style={{
                        left: `${20 + i * 18}px`,
                        top: '-4px',
                        animation: `sparkle 1.2s ease-in-out ${i * 0.4}s infinite`,
                        opacity: 0
                      }}
                    >
                      ✦
                    </span>
                  ))}
                </div>
                {/* Chain + block animation (highlight left to right) */}
                <div className="flex items-center gap-1">
                  {[0, 1, 2, 3].map(i => (
                    <div key={i} className="flex items-center gap-1">
                      <div
                        className="w-8 h-8 rounded bg-blue-500 dark:bg-blue-600 flex items-center justify-center text-white text-xs font-bold shadow"
                        style={{ animation: `blockHighlight 2s ease-in-out ${i * 0.5}s infinite` }}
                      >
                        {blockChars[i]}
                      </div>
                      <div className="w-3 h-0.5 bg-blue-400 dark:bg-blue-500" />
                    </div>
                  ))}
                  {/* TX block being packed */}
                  <div
                    className="w-8 h-8 rounded bg-blue-600 dark:bg-blue-500 flex items-center justify-center text-white text-xs font-bold shadow-lg border-2 border-blue-300 dark:border-blue-300"
                    style={{ animation: 'blockHighlight 2s ease-in-out 2s infinite' }}
                  >
                    TX
                  </div>
                </div>
              </div>
              <style>{`
                @keyframes blockHighlight {
                  0%, 100% { transform: scale(1); opacity: 0.5; box-shadow: none; }
                  20% { transform: scale(1.35); opacity: 1; box-shadow: 0 0 10px rgba(59,130,246,0.7); }
                  40%, 99% { transform: scale(1); opacity: 0.5; box-shadow: none; }
                }
                @keyframes minerBob {
                  from { transform: translateY(0) rotate(-10deg); }
                  to { transform: translateY(-4px) rotate(10deg); }
                }
                @keyframes sparkle {
                  0% { opacity: 0; transform: translateY(0); }
                  50% { opacity: 1; transform: translateY(-8px); }
                  100% { opacity: 0; transform: translateY(-16px); }
                }
              `}</style>

              {/* Progress bar (30 seconds) */}
              <div className="mt-6 mb-4 px-8">
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-blue-600 dark:from-blue-400 dark:to-blue-500 rounded-full transition-all duration-100 ease-linear"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  {t('walletSelector.estimatedTime')}: ~{Math.ceil((BLOCK_RENEW_TIME / 1000) * (1 - progress / 100))}s
                </p>
              </div>

              {/* Batch Transaction Progress / バッチトランザクション進度 */}
              {isBatchMode && batchConfig ? (
                <div className="mt-4">
                  <p className="text-gray-600 dark:text-gray-400 mb-4">
                    {t('walletSelector.batchProcessing', { 
                      current: batchProgress.currentIndex + 1, 
                      total: batchConfig.transactions.length 
                    })}
                  </p>
                  <div className="space-y-2 text-left max-w-xs mx-auto">
                    {batchConfig.transactions.map((tx, index) => {
                      const result = batchProgress.results.find(r => r.id === tx.id)
                      const isCurrent = index === batchProgress.currentIndex
                      const isPending = index > batchProgress.currentIndex
                      
                      return (
                        <div key={tx.id} className="flex items-center gap-2 text-sm">
                          {result?.success ? (
                            <span className="text-green-500">✓</span>
                          ) : result && !result.success ? (
                            <span className="text-red-500">✗</span>
                          ) : isCurrent ? (
                            <span className="inline-block w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></span>
                          ) : (
                            <span className="text-gray-400">○</span>
                          )}
                          <span className={
                            result?.success ? 'text-green-600 dark:text-green-400' :
                            result && !result.success ? 'text-red-600 dark:text-red-400' :
                            isCurrent ? 'text-blue-600 dark:text-blue-400 font-medium' :
                            'text-gray-400 dark:text-gray-500'
                          }>
                            {tx.name}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-gray-600 dark:text-gray-400">
                  {t('walletSelector.transactionProcessing')}
                </p>
              )}
              
              {allowBackground && !isBatchMode && (
                <button
                  onClick={handleGoBackground}
                  className="mt-4 px-4 py-2 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                >
                  {t('walletSelector.backgroundProcess')}
                </button>
              )}
            </div>
          )}

          {/* Success Step / 成功ステップ */}
          {step === 'success' && (
            <div className="text-center py-8">
              <div className="text-6xl mb-4">✅</div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                {t('walletSelector.successTitle')}
              </h3>
              
              {/* Batch Transaction Results / バッチトランザクション結果 */}
              {isBatchMode && batchProgress.results.length > 0 ? (
                <div className="mt-4 space-y-2 text-left max-w-xs mx-auto">
                  {batchProgress.results.map((result) => (
                    <div key={result.id} className="flex items-center gap-2 text-sm">
                      <span className="text-green-500">✓</span>
                      <span className="text-gray-600 dark:text-gray-400">{result.name}</span>
                    </div>
                  ))}
                </div>
              ) : txHash && (
                <p className="text-sm text-gray-600 dark:text-gray-400 font-mono break-all">
                  {t('walletSelector.txHash')} {txHash}
                </p>
              )}
              
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-4">
                {t('walletSelector.autoCloseHint')}
              </p>
            </div>
          )}

          {/* Error Step / エラーステップ */}
          {step === 'error' && (
            <div className="text-center py-8">
              <div className="text-6xl mb-4">❌</div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                {t('walletSelector.errorTitle')}
              </h3>
              <p className="text-sm text-red-600 dark:text-red-400 mt-2">
                {error}
              </p>
            </div>
          )}
        </div>

        {/* Bottom Buttons / 下部ボタン */}
        {step !== 'processing' && step !== 'success' && (
          <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200 dark:border-gray-700">
            {(step === 'selectWallet' ||
              step === 'password' ||
              step === 'preflight' ||
              step === 'error') && (
              <button
                onClick={handleBack}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                {t('common.back')}
              </button>
            )}
            <button
              onClick={handleCancel}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              {t('common.cancel')}
            </button>
            {step === 'txInfo' && (
              <button
                onClick={handleNextFromTxInfo}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                {t('common.nextStep')}
              </button>
            )}
            {step === 'selectWallet' && (
              <button
                onClick={handleNextToPassword}
                disabled={!selectedWallet}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {t('common.nextStep')}
              </button>
            )}
            {step === 'password' && (
              <button
                onClick={handleConfirmWithPassword}
                disabled={!password}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {t('walletSelector.confirmTransaction')}
              </button>
            )}
            {step === 'preflight' && !preflightLoading && preflightData?.success && (
              <button
                onClick={handleConfirmTransaction}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                {t('walletSelector.continueTransaction')}
              </button>
            )}
            {step === 'preflight' && !preflightLoading && !preflightData?.success && (
              <button
                onClick={runPreflight}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                {t('common.retry')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

export default WalletSelectorModal
