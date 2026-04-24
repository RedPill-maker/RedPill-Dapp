import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronLeftIcon,
  EllipsisVerticalIcon,
  KeyIcon,
  DocumentTextIcon,
  TrashIcon,
  CurrencyDollarIcon,
} from '@heroicons/react/24/outline'
import { useAppSelector } from '../../hooks/redux'
import { rpcConnectorInstance } from '../../utils/rpcConnector'
import { WalletInfo } from '../../utils/walletMgr'
import {
  getWalletTransactions,
  type WalletTransaction,
} from '../../utils/dbConnector'
import { BLOCK_RENEW_TIME, getKnownTokens } from '../../../config'
import LoadingSpinner from '../LoadingSpinner'
import FilecoinIcon from '../FilecoinIcon'
import AddressDisplay from './AddressDisplay'
import CreatorAvatar, { useCreatorInfo } from './CreatorAvatar'
import TransactionList from './TransactionList'
import SendTransactionModal from './SendTransactionModal'
import WalletExportModal from './WalletExportModal'
import DeleteWalletModal from './DeleteWalletModal'

interface WalletDetailProps {
  wallet: WalletInfo
  onBack: () => void
}

const WalletDetail: React.FC<WalletDetailProps> = ({ wallet, onBack }) => {
  const { creator } = useCreatorInfo(wallet.address)
  const { t } = useTranslation()
  const { current: currentNetwork } = useAppSelector(
    (state) => state.filecoinNetwork,
  )
  const [balance, setBalance] = useState<string>('')
  const [tokenBalances, setTokenBalances] = useState<{
    [address: string]: string
  }>({})
  const [transactions, setTransactions] = useState<WalletTransaction[]>([])
  const [transactionPage, setTransactionPage] = useState(1)
  const [transactionTotal, setTransactionTotal] = useState(0)
  const [loadingBalance, setLoadingBalance] = useState(false)
  const [loadingTransactions, setLoadingTransactions] = useState(false)

  const [showSendTransaction, setShowSendTransaction] = useState(false)
  const [showExportPrivateKey, setShowExportPrivateKey] = useState(false)
  const [showExportMnemonic, setShowExportMnemonic] = useState(false)
  const [showDeleteWallet, setShowDeleteWallet] = useState(false)
  const [showMenu, setShowMenu] = useState(false)

  // Reload data when network switches
  useEffect(() => {
    loadWalletData()
  }, [wallet.address, currentNetwork])

  useEffect(() => {
    const refreshInterval = setInterval(() => {
      loadTransactions(transactionPage)
    }, BLOCK_RENEW_TIME)
    return () => clearInterval(refreshInterval)
  }, [transactionPage])

  const loadWalletData = async () => {
    setLoadingBalance(true)

    // Load all token balances
    const balances: { [address: string]: string } = {}
    const tokens = getKnownTokens()
    console.log('[WalletDetail] loadWalletData called, address:', wallet.address)
    console.log('[WalletDetail] getKnownTokens() returned:', JSON.stringify(tokens))

    for (const token of tokens) {
      console.log(`[WalletDetail] Querying balance for token: ${token.symbol} (${token.address})`)
      const balanceResult = await rpcConnectorInstance.getTokenBalance(
        wallet.address,
        token.address,
      )
      console.log(`[WalletDetail] Result for ${token.symbol}:`, JSON.stringify(balanceResult))
      if (balanceResult.success) {
        balances[token.address] = balanceResult.balance || '0'
      } else {
        balances[token.address] = '0'
      }
    }

    console.log('[WalletDetail] Final balances map:', JSON.stringify(balances))
    setTokenBalances(balances)

    // Set FIL balance (backward compatibility)
    const filToken = getKnownTokens().find((t) => t.symbol === 'FIL')
    if (filToken) {
      setBalance(balances[filToken.address] || '0')
    }

    setLoadingBalance(false)

    await loadTransactions(1)
  }

  const loadTransactions = async (page: number = 1) => {
    setLoadingTransactions(true)
    const result = await getWalletTransactions(wallet.address, page, 20)
    if (result) {
      setTransactions(result.transactions)
      setTransactionTotal(result.total)
      setTransactionPage(page)
    } else {
      setTransactions([])
      setTransactionTotal(0)
    }
    setLoadingTransactions(false)
  }

  return (
    <div className="p-4">
      <div>
        {/* Header */}
        <div className="flex justify-between items-start mb-8">
          <div className="flex items-center space-x-4">
            <button
              onClick={onBack}
              className="text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
            >
              <ChevronLeftIcon className="w-6 h-6" />
            </button>

            <CreatorAvatar walletAddress={wallet.address} size="lg" />

            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-1">
                {wallet.name}
              </h1>
              {creator && (
                <div className="text-lg text-blue-600 dark:text-blue-400 mb-2">
                  @{creator.username}
                </div>
              )}
              <AddressDisplay
                ethAddress={wallet.ethAddress}
                filAddress={wallet.filAddress}
              />
            </div>
          </div>

          {/* Menu button */}
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              <EllipsisVerticalIcon className="w-6 h-6" />
            </button>

            {showMenu && (
              <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-10">
                <button
                  onClick={() => {
                    setShowMenu(false)
                    setShowExportPrivateKey(true)
                  }}
                  className="w-full text-left px-4 py-3 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center space-x-3"
                >
                  <KeyIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                  <div>
                    <div className="font-medium text-gray-900 dark:text-white">
                      {t('walletDetail.exportPrivateKey')}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {t('walletDetail.exportPrivateKeyDesc')}
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => {
                    setShowMenu(false)
                    setShowExportMnemonic(true)
                  }}
                  className="w-full text-left px-4 py-3 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center space-x-3"
                >
                  <DocumentTextIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                  <div>
                    <div className="font-medium text-gray-900 dark:text-white">
                      {t('walletDetail.exportMnemonic')}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {t('walletDetail.exportMnemonicDesc')}
                    </div>
                  </div>
                </button>

                <div className="border-t border-gray-200 dark:border-gray-700"></div>

                <button
                  onClick={() => {
                    setShowMenu(false)
                    setShowDeleteWallet(true)
                  }}
                  className="w-full text-left px-4 py-3 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex items-center space-x-3 text-red-600 dark:text-red-400"
                >
                  <TrashIcon className="w-5 h-5" />
                  <div>
                    <div className="font-medium">{t('walletDetail.deleteWallet')}</div>
                    <div className="text-xs">{t('walletDetail.deleteWalletDesc')}</div>
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Balance card */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700 mb-8">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
            {t('walletDetail.walletBalance')}
          </h3>
          <p className="text-xs text-amber-500 dark:text-amber-400 mb-4">
            {t('walletDetail.coldWalletTip')}
          </p>

          {loadingBalance ? (
            <div className="flex items-center">
              <LoadingSpinner />
              <span className="ml-2 text-gray-600 dark:text-gray-400">
                {t('common.loading')}
              </span>
            </div>
          ) : (
            <div className="space-y-4">
              {getKnownTokens().map((token) => {
                const tokenBalance = tokenBalances[token.address] || '0'
                const hasBalance = parseFloat(tokenBalance) > 0

                return (
                  <div
                    key={token.address}
                    className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 flex items-center justify-center">
                        {token.symbol === 'FIL' ? <FilecoinIcon size={32} /> : <CurrencyDollarIcon className="w-8 h-8 text-green-500" />}
                      </div>
                      <div>
                        <div className="font-semibold text-gray-900 dark:text-white">
                          {token.name}
                        </div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          {token.symbol}
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-xl font-bold text-gray-900 dark:text-white">
                        {tokenBalance} {token.symbol}
                      </div>
                      {!hasBalance && (
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {t('walletDetail.noBalance')}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}

              {/* Send button */}
              <div className="pt-2">
                <button
                  onClick={() => setShowSendTransaction(true)}
                  disabled={
                    loadingBalance ||
                    !balance ||
                    parseFloat(balance || '0') <= 0
                  }
                  className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                >
                  {t('walletDetail.sendTransaction')}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Transaction history */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="p-6 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                {t('walletDetail.transactionHistory')}
              </h3>
              <div className="flex items-center space-x-2">
                {transactionTotal > 0 && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {t('walletDetail.totalRecords', { count: transactionTotal })}
                  </span>
                )}
                <span className="text-xs text-gray-500 dark:text-gray-400 bg-blue-100 dark:bg-blue-900 px-2 py-1 rounded">
                  {t('walletDetail.contractData')}
                </span>
              </div>
            </div>
          </div>

          <div className="p-6">
            <TransactionList
              transactions={transactions}
              loading={loadingTransactions}
              page={transactionPage}
              total={transactionTotal}
              onPageChange={loadTransactions}
            />
          </div>
        </div>

        {/* Modals */}
        <SendTransactionModal
          isOpen={showSendTransaction}
          onClose={() => setShowSendTransaction(false)}
          onSuccess={loadWalletData}
          walletAddress={wallet.address}
          balance={balance}
        />

        <WalletExportModal
          isOpen={showExportPrivateKey}
          onClose={() => setShowExportPrivateKey(false)}
          walletAddress={wallet.address}
          exportType="privateKey"
        />

        <WalletExportModal
          isOpen={showExportMnemonic}
          onClose={() => setShowExportMnemonic(false)}
          walletAddress={wallet.address}
          exportType="mnemonic"
        />

        <DeleteWalletModal
          isOpen={showDeleteWallet}
          onClose={() => setShowDeleteWallet(false)}
          onSuccess={onBack}
          walletAddress={wallet.address}
        />
      </div>
    </div>
  )
}

export default WalletDetail
