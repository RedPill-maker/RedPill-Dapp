import React, { useState } from 'react'
import { ethers } from 'ethers'
import { useTranslation } from 'react-i18next'
import { getKnownTokens } from '../../../config'
import { walletMgr } from '../../utils/walletMgr'
import { rpcConnectorInstance, waitForTransaction } from '../../utils/rpcConnector'
import WalletSelectorModal, {
  PaymentConfig,
  TransactionResult,
  GasEstimateCallback,
} from '../../global_modal/WalletSelectorModal'

interface SendTransactionModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  walletAddress: string
  balance: string
}

const SendTransactionModal: React.FC<SendTransactionModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  walletAddress,
  balance,
}) => {
  const { t } = useTranslation()
  const [toAddress, setToAddress] = useState('')
  const [amount, setAmount] = useState('')
  const [selectedToken, setSelectedToken] = useState(getKnownTokens()[0]) // Default to FIL
  const [error, setError] = useState<string | null>(null)
  const [showWalletSelector, setShowWalletSelector] = useState(false)

  const handleSend = () => {
    if (!toAddress || !amount) {
      setError(t('sendTransaction.fillInComplete'))
      return
    }

    const amountNum = parseFloat(amount)
    if (isNaN(amountNum) || amountNum <= 0) {
      setError(t('sendTransaction.invalidAmount'))
      return
    }

    setError(null)
    setShowWalletSelector(true)
  }

  const handleTransaction = async (
    address: string,
    password: string,
  ): Promise<TransactionResult> => {
    try {
      const signer = await walletMgr.getSigner(address, password)
      
      // Normalize recipient address (convert f410/t410 to 0x format)
      let normalizedToAddress: string
      try {
        normalizedToAddress = walletMgr.normalizeAddress(toAddress)
      } catch (error: any) {
        return {
          success: false,
          error: error.message || t('sendTransaction.invalidAddress'),
        }
      }
      
      // For native FIL (address 0x0...0), use sendTransaction
      if (selectedToken.address === '0x0000000000000000000000000000000000000000') {
        const tx = await signer.sendTransaction({
          to: normalizedToAddress,
          value: ethers.parseEther(amount),
        })
        const receipt = await waitForTransaction(tx, rpcConnectorInstance.getProvider())

        return {
          success: receipt?.status === 1,
          txHash: tx.hash,
          error: receipt?.status !== 1 ? t('sendTransaction.txFailed') : undefined,
        }
      } else {
        // For ERC20 tokens (like USDFC), use contract transfer
        const tokenContract = new ethers.Contract(
          selectedToken.address,
          ['function transfer(address to, uint256 amount) returns (bool)'],
          signer,
        )
        const tx = await tokenContract.transfer(normalizedToAddress, ethers.parseEther(amount))
        const receipt = await waitForTransaction(tx, rpcConnectorInstance.getProvider())

        return {
          success: receipt?.status === 1,
          txHash: tx.hash,
          error: receipt?.status !== 1 ? t('sendTransaction.txFailed') : undefined,
        }
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message || t('sendTransaction.sendError'),
        rawError: error,
      }
    }
  }

  const handleGasEstimate: GasEstimateCallback = async (address: string) => {
    try {
      let normalizedToAddress: string
      try {
        normalizedToAddress = walletMgr.normalizeAddress(toAddress)
      } catch (error: any) {
        return { success: false, error: error.message }
      }

      // For native FIL, use simple transfer estimation
      if (selectedToken.address === '0x0000000000000000000000000000000000000000') {
        return await rpcConnectorInstance.estimateGas(address, normalizedToAddress, amount)
      } else {
        // For ERC20 tokens, estimate contract call
        const tokenContract = new ethers.Contract(
          selectedToken.address,
          ['function transfer(address to, uint256 amount) returns (bool)'],
          rpcConnectorInstance.getProvider()
        )
        const data = tokenContract.interface.encodeFunctionData('transfer', [
          normalizedToAddress,
          ethers.parseEther(amount)
        ])
        return await rpcConnectorInstance.estimateContractGas(
          address,
          selectedToken.address,
          data,
          0n
        )
      }
    } catch (err: any) {
      console.error('Failed to estimate gas for send:', err)
      return { success: false, error: err.message }
    }
  }

  const handleClose = () => {
    setToAddress('')
    setAmount('')
    setSelectedToken(getKnownTokens()[0])
    setError(null)
    setShowWalletSelector(false)
    onClose()
  }

  const handleWalletSelectorSuccess = () => {
    setShowWalletSelector(false)
    handleClose()
    onSuccess()
  }

  const paymentConfig: PaymentConfig = {
    type: 'fixed',
    amount: amount,
    token: selectedToken.address,
    tokenSymbol: selectedToken.symbol,
    description: t('sendTransaction.sendTo', { address: toAddress }),
  }

  if (!isOpen) return null

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4">
          <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
            {t('sendTransaction.title')}
          </h3>

          <div className="space-y-4">
            {/* Token Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('sendTransaction.selectToken')}
              </label>
              <div className="grid grid-cols-2 gap-2">
                {getKnownTokens().map((token) => (
                  <button
                    key={token.address}
                    onClick={() => setSelectedToken(token)}
                    className={`p-3 border rounded-lg transition-colors ${
                      selectedToken.address === token.address
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-300 dark:border-gray-600 hover:border-blue-300 dark:hover:border-blue-700'
                    }`}
                  >
                    <div className="font-medium text-gray-900 dark:text-white">
                      {token.symbol}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {token.name}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('sendTransaction.recipientAddress')}
              </label>
              <input
                type="text"
                value={toAddress}
                onChange={(e) => setToAddress(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                placeholder={t('sendTransaction.recipientPlaceholder')}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('sendTransaction.amount')}
              </label>
              <input
                type="number"
                step="0.000001"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                placeholder={t('sendTransaction.amountPlaceholder')}
              />
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {t('sendTransaction.availableBalance')} {balance || '--'} {selectedToken.symbol}
              </div>
            </div>
          </div>

          {error && (
            <div className="mt-4 p-3 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-300 rounded">
              {error}
            </div>
          )}

          <div className="flex justify-end space-x-3 mt-6">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
            >
              {t('sendTransaction.cancel')}
            </button>
            <button
              onClick={handleSend}
              disabled={!toAddress || !amount || parseFloat(amount) <= 0}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('sendTransaction.send')}
            </button>
          </div>
        </div>
      </div>

      {/* WalletSelectorModal for transaction execution */}
      <WalletSelectorModal
        isOpen={showWalletSelector}
        onClose={() => setShowWalletSelector(false)}
        onSuccess={handleWalletSelectorSuccess}
        paymentConfig={paymentConfig}
        onConfirm={handleTransaction}
        onGasEstimate={handleGasEstimate}
        highlightAddress={walletAddress}
        allowedAddresses={[walletAddress]}
      />
    </>
  )
}

export default SendTransactionModal
