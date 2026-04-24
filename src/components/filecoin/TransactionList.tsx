import React from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpRightIcon, ArrowDownLeftIcon, CheckCircleIcon, DocumentTextIcon } from '@heroicons/react/24/outline'
import { type WalletTransaction } from '../../utils/dbConnector'
import LoadingSpinner from '../LoadingSpinner'
import { getKnownTokens } from '../../../config'

interface TransactionListProps {
  transactions: WalletTransaction[]
  loading: boolean
  page: number
  total: number
  pageSize?: number
  onPageChange: (page: number) => void
}

const TransactionList: React.FC<TransactionListProps> = ({
  transactions,
  loading,
  page,
  total,
  pageSize = 20,
  onPageChange,
}) => {
  const { t } = useTranslation()
  const totalPages = Math.ceil(total / pageSize)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <LoadingSpinner />
        <span className="ml-2 text-gray-600 dark:text-gray-400">
          {t('transactionList.loading')}
        </span>
      </div>
    )
  }

  if (transactions.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="text-4xl mb-4">
          <DocumentTextIcon className="w-10 h-10 mx-auto text-gray-400 dark:text-gray-500" />
        </div>
        <p className="text-gray-600 dark:text-gray-400 mb-2">{t('transactionList.empty')}</p>
        <p className="text-sm text-gray-500 dark:text-gray-500">
          {t('transactionList.emptyDesc')}
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="space-y-4">
        {transactions.map((tx) => {
          const isOutgoing = tx.is_outgoing === 1
          const amountFormatted = parseFloat(tx.amount).toFixed(6)
          const gasFee = parseFloat(tx.gas_fee).toFixed(6)
          const tokenSymbol = getKnownTokens().find(
            (t) => t.address.toLowerCase() === tx.token_address?.toLowerCase()
          )?.symbol ?? 'FIL'

          return (
            <div
              key={tx.id}
              className="flex items-center justify-between p-4 rounded-lg bg-gray-50 dark:bg-gray-700"
            >
              <div className="flex items-center space-x-4">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    isOutgoing
                      ? 'bg-red-100 dark:bg-red-900'
                      : 'bg-green-100 dark:bg-green-900'
                  }`}
                >
                  {isOutgoing
                    ? <ArrowUpRightIcon className="w-5 h-5 text-red-600 dark:text-red-400" />
                    : <ArrowDownLeftIcon className="w-5 h-5 text-green-600 dark:text-green-400" />
                  }
                </div>
                <div>
                  <div className="font-medium text-gray-900 dark:text-white">
                    {tx.contract_method}
                  </div>
                  {tx.counterparty_address && (
                    <div className="text-sm text-gray-600 dark:text-gray-400 font-mono">
                      {isOutgoing ? t('transactionList.to') : t('transactionList.from')}{' '}
                      {tx.counterparty_address.slice(0, 10)}...
                      {tx.counterparty_address.slice(-8)}
                    </div>
                  )}
                  <div className="text-xs text-gray-500 dark:text-gray-500">
                    {new Date(tx.timestamp * 1000).toLocaleString()}
                  </div>
                  <div className="text-xs text-blue-600 dark:text-blue-400 font-mono">
                    {tx.tx_hash.slice(0, 10)}...{tx.tx_hash.slice(-8)}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div
                  className={`font-semibold ${
                    isOutgoing
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-green-600 dark:text-green-400'
                  }`}
                >
                  {isOutgoing ? '-' : '+'}
                  {amountFormatted} {tokenSymbol}
                </div>
                {isOutgoing && parseFloat(gasFee) > 0 && (
                  <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                  {t('transactionList.gasFee')}: {gasFee} FIL
                  </div>
                )}
                <div className="text-xs text-gray-500 dark:text-gray-500 flex items-center justify-end gap-1 mt-1">
                  <CheckCircleIcon className="w-3.5 h-3.5 text-green-500" />
                  {t('transactionList.confirmed')}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center space-x-2 mt-6">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page === 1 || loading}
            className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('common.prevPage')}
          </button>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {t('transactionList.pageInfo', { current: page, total: totalPages })}
          </span>
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages || loading}
            className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('common.nextPage')}
          </button>
        </div>
      )}
    </div>
  )
}

export default TransactionList
