/**
 * Withdrawal page component
 * Aggregates all wallet withdrawal balances in CreatorHub and AdSpace contracts
 * Data is cached via Redux withdrawSlice to avoid duplicate queries
 */

import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppDispatch, useAppSelector } from '../../hooks/redux'
import { setCurrentPage } from '../../store/slices/pageSlice'
import { fetchWithdrawBalances } from '../../store/slices/withdrawSlice'
import { privateDataMgr } from '../../utils/privateDataMgr'
import { getKnownTokens } from '../../../config'
import FilecoinIcon from '../FilecoinIcon'
import CreatorWithdrawTab from './withdraw/CreatorWithdrawTab'
import AdsWithdrawTab from './withdraw/AdsWithdrawTab'

type TabType = 'creator' | 'ads'

const Withdraw: React.FC = () => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const { creatorBalances, adsBalances, loading, lastFetchedAt } = useAppSelector(
    (state) => state.withdraw,
  )

  const [activeTab, setActiveTab] = useState<TabType>('creator')

  const [wallets, setWallets] = useState<Array<{ ethAddress: string; filAddress: string; address: string; name: string; createdAt: string }>>([])

  useEffect(() => {
    privateDataMgr.getWalletList().then(setWallets)
  }, [])

  // Fetch on mount; thunk handles cache (skips if within TTL)
  useEffect(() => {
    dispatch(fetchWithdrawBalances(false))
  }, [dispatch])

  // Force refresh after successful withdrawal
  const handleWithdrawSuccess = () => {
    setTimeout(() => dispatch(fetchWithdrawBalances(true)), 2000)
  }

  // Count withdrawable items for tab badges
  const creatorWithdrawableCount = creatorBalances.reduce((sum, w) => {
    return sum + getKnownTokens().filter((tk) => parseFloat(w.balances[tk.address] || '0') > 0).length
  }, 0)

  const adsWithdrawableCount = adsBalances.filter(
    (w) => parseFloat(w.pendingAmount || '0') > 0,
  ).length

  // Calculate total pending amounts for summary display
  const tokenTotals: Record<string, number> = {}
  getKnownTokens().forEach((tk) => {
    tokenTotals[tk.address] = creatorBalances.reduce(
      (sum, w) => sum + parseFloat(w.balances[tk.address] || '0'),
      0,
    )
  })
  const adsTotalFil = adsBalances.reduce(
    (sum, w) => sum + parseFloat(w.pendingAmount || '0'),
    0,
  )
  const filTotal = (tokenTotals[getKnownTokens()[0].address] || 0) + adsTotalFil

  if (loading && !lastFetchedAt) {
    return (
      <div className="max-w-7xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-28 bg-gray-200 dark:bg-gray-700 rounded-lg" />
          <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded-lg" />
        </div>
      </div>
    )
  }

  if (wallets.length === 0) {
    return (
      <div className="max-w-7xl mx-auto">
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-12 text-center">
          <div className="text-5xl mb-4"><FilecoinIcon size={48} /></div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
            {t('withdraw.noWallet')}
          </h2>
          <p className="text-gray-500 dark:text-gray-400 mb-6">
            {t('withdraw.noWalletDesc')}
          </p>
          <button
            onClick={() => dispatch(setCurrentPage('filecoinWallet'))}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            {t('withdraw.createWallet')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      {/* Total pending amounts summary */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">
          {t('withdraw.totalPending')}
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {t('withdraw.totalPendingDesc')}
        </p>
        <div className="mt-3 space-y-1">
          <div className="text-sm text-gray-700 dark:text-gray-300">
            <span className="text-xl font-bold text-blue-600 dark:text-blue-400">
              {filTotal.toFixed(6)}
            </span>{' '}
            FIL
          </div>
          {getKnownTokens().slice(1).map((tk) => {
            const total = tokenTotals[tk.address] || 0
            if (total <= 0) return null
            return (
              <div key={tk.address} className="text-sm text-gray-700 dark:text-gray-300">
                <span className="text-lg font-bold text-blue-600 dark:text-blue-400">
                  {total.toFixed(6)}
                </span>{' '}
                {tk.symbol}
              </div>
            )
          })}
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
        <div className="flex border-b border-gray-200 dark:border-gray-700">
          {(['creator', 'ads'] as TabType[]).map((tab) => {
            const badgeCount = tab === 'creator' ? creatorWithdrawableCount : adsWithdrawableCount
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-1.5 ${
                  activeTab === tab
                    ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                {tab === 'creator' ? t('withdraw.tabCreator') : t('withdraw.tabAds')}
                {badgeCount > 0 && (
                  <span className="min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-xs rounded-full flex items-center justify-center leading-none">
                    {badgeCount > 99 ? '99+' : badgeCount}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <div className="p-4">
          {activeTab === 'creator' ? (
            <CreatorWithdrawTab
              walletBalances={creatorBalances}
              onWithdrawSuccess={handleWithdrawSuccess}
            />
          ) : (
            <AdsWithdrawTab
              walletBalances={adsBalances}
              onWithdrawSuccess={handleWithdrawSuccess}
            />
          )}
        </div>
      </div>

    </div>
  )
}

export default Withdraw
