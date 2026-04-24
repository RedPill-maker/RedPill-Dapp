/**
 * Ads Withdrawal Tab
 * Display all wallets with pending withdrawal balances in AdSpace contract
 */

import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ethers } from 'ethers'
import { getKnownTokens } from '../../../../config'
import AdSpaceManagerABI from '../../../../contract_info/AdSpaceManager_abi.json'
import { adsMgr } from '../../../utils/adsMgr'
import { rpcConnectorInstance, getAdsAddress } from '../../../utils/rpcConnector'
import WalletSelectorModal, {
  PaymentConfig,
  TransactionResult,
  GasEstimateCallback,
} from '../../../global_modal/WalletSelectorModal'

export interface AdsWalletBalance {
  ethAddress: string
  filAddress: string
  name: string
  pendingAmount: string
}

interface Props {
  walletBalances: AdsWalletBalance[]
  onWithdrawSuccess: () => void
}

const AdsWithdrawTab: React.FC<Props> = ({ walletBalances, onWithdrawSuccess }) => {
  const { t } = useTranslation()
  const [showModal, setShowModal] = useState(false)
  const [selectedAddress, setSelectedAddress] = useState('')

  const paymentConfig: PaymentConfig = {
    type: 'gas-only',
    token: getKnownTokens()[0].address,
    tokenSymbol: getKnownTokens()[0].symbol,
    description: t('withdraw.withdraw'),
  }

  const handleWithdraw = (address: string) => {
    setSelectedAddress(address)
    setShowModal(true)
  }

  const handleConfirm = async (
    address: string,
    password: string,
  ): Promise<TransactionResult> => {
    try {
      const result = await adsMgr.withdraw(address, password)
      if (result.success) {
        onWithdrawSuccess()
      }
      return { success: result.success, txHash: result.txHash, error: result.error }
    } catch (err: any) {
      return { success: false, error: err.message || t('withdraw.withdraw') + ' failed' }
    }
  }

  const handleGasEstimate: GasEstimateCallback = async (address: string) => {
    try {
      const contract = new ethers.Contract(getAdsAddress(), AdSpaceManagerABI, rpcConnectorInstance.getProvider())
      const data = contract.interface.encodeFunctionData('withdraw', [])
      return await rpcConnectorInstance.estimateContractGas(address, getAdsAddress(), data, 0n)
    } catch (err: any) {
      console.error('Failed to estimate gas for ads withdraw:', err)
      return { success: false, error: err.message }
    }
  }

  const walletsWithBalance = walletBalances.filter(
    (w) => parseFloat(w.pendingAmount) > 0,
  )

  if (walletsWithBalance.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500 dark:text-gray-400">
        {t('withdraw.noAdsBalance')}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {walletsWithBalance.map((wallet) => (
        <div
          key={wallet.ethAddress}
          className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4"
        >
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <div className="font-medium text-gray-900 dark:text-white">
                {wallet.name}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 font-mono mt-0.5">
                {wallet.ethAddress.slice(0, 10)}...{wallet.ethAddress.slice(-8)}
              </div>
              <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                <span className="font-semibold text-gray-900 dark:text-white">
                  {parseFloat(wallet.pendingAmount).toFixed(6)}
                </span>{' '}
                FIL
              </div>
            </div>
            <button
              onClick={() => handleWithdraw(wallet.ethAddress)}
              className="ml-4 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors flex-shrink-0"
            >
              {t('withdraw.withdraw')}
            </button>
          </div>
        </div>
      ))}

      <WalletSelectorModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        paymentConfig={paymentConfig}
        onConfirm={handleConfirm}
        onGasEstimate={handleGasEstimate}
        highlightAddress={selectedAddress}
        allowedAddresses={selectedAddress ? [selectedAddress] : undefined}
      />
    </div>
  )
}

export default AdsWithdrawTab
