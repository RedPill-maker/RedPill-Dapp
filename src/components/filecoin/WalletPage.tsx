import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExclamationTriangleIcon, CheckCircleIcon } from '@heroicons/react/24/solid'
import { useAppSelector } from '../../hooks/redux'
import { WalletInfo } from '../../utils/walletMgr'
import WalletList from './WalletList'
import WalletDetail from './WalletDetail'

const WalletPage: React.FC = () => {
  const { t } = useTranslation()
  const [selectedWallet, setSelectedWallet] =
    useState<WalletInfo | null>(null)
  const { current: currentNetwork } = useAppSelector(
    (state) => state.filecoinNetwork,
  )

  const handleWalletSelect = (wallet: WalletInfo) => {
    setSelectedWallet(wallet)
  }

  const handleBack = () => {
    setSelectedWallet(null)
  }

  // Check if current network is testnet
  const isTestnet =
    currentNetwork.toLowerCase().includes('calibration') ||
    currentNetwork.toLowerCase().includes('test')

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Network status banner */}
      <div
        className={`${
          isTestnet
            ? 'bg-yellow-100 dark:bg-yellow-900/30 border-yellow-300 dark:border-yellow-700'
            : 'bg-green-100 dark:bg-green-900/30 border-green-300 dark:border-green-700'
        } border-b px-4 py-3`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div
              className={`w-2.5 h-2.5 rounded-full ${
                isTestnet ? 'bg-yellow-500' : 'bg-green-500'
              }`}
            ></div>
            <span
              className={`text-sm font-medium ${
                isTestnet
                  ? 'text-yellow-800 dark:text-yellow-200'
                  : 'text-green-800 dark:text-green-200'
              }`}
            >
              {t('walletPage.currentNetwork')} {currentNetwork}
            </span>
          </div>
          <span
            className={`text-xs ${
              isTestnet
                ? 'text-yellow-600 dark:text-yellow-400'
                : 'text-green-600 dark:text-green-400'
            }`}
          >
            {isTestnet ? (
              <span className="flex items-center gap-1">
                <ExclamationTriangleIcon className="w-3.5 h-3.5" />
                {t('walletPage.testnet')}
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <CheckCircleIcon className="w-3.5 h-3.5" />
                {t('walletPage.mainnet')}
              </span>
            )}
          </span>
        </div>
      </div>

      {/* Wallet content */}
      {selectedWallet ? (
        <WalletDetail wallet={selectedWallet} onBack={handleBack} />
      ) : (
        <WalletList onWalletSelect={handleWalletSelect} />
      )}
    </div>
  )
}

export default WalletPage
