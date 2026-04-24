import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NoSymbolIcon, TrashIcon, LockClosedIcon } from '@heroicons/react/24/outline'
import { useBlacklist } from '../hooks/useBlacklist'
import { privateDataMgr } from '../utils/privateDataMgr'
import GesturePassword from './GesturePassword'

const Blacklist: React.FC = () => {
  const { t } = useTranslation()
  const { blacklistedWorks, blacklistedCreators, unblockWork, unblockCreator } = useBlacklist()
  const [tab, setTab] = useState<'works' | 'creators'>('works')
  const [unlocked, setUnlocked] = useState(false)
  const [gestureError, setGestureError] = useState<string | null>(null)
  const [gestureKey, setGestureKey] = useState(0)

  const handleGestureComplete = async (pattern: string) => {
    if (await privateDataMgr.verifyPassword(pattern)) {
      setUnlocked(true)
    } else {
      setGestureError(t('blacklist.wrongPassword'))
      setGestureKey((k) => k + 1)
    }
  }

  const isEmpty = blacklistedWorks.length === 0 && blacklistedCreators.length === 0

  if (!unlocked) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <LockClosedIcon className="w-14 h-14 text-gray-400 dark:text-gray-500 mb-4" />
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-1">
          {t('blacklist.locked')}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          {t('blacklist.lockedDesc')}
        </p>
        <GesturePassword
          key={gestureKey}
          mode="verify"
          onComplete={handleGestureComplete}
          error={gestureError}
        />
      </div>
    )
  }

  return (
    <div className="mb-8">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
        {t('blacklist.title')}
      </h1>
      <p className="text-gray-600 dark:text-gray-400 mb-6">
        {t('blacklist.description')}
      </p>

      {isEmpty ? (
        <div className="flex flex-col items-center justify-center py-20">
          <NoSymbolIcon className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4" />
          <p className="text-gray-500 dark:text-gray-400 text-lg">
            {t('blacklist.empty')}
          </p>
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="flex gap-2 mb-6 border-b border-gray-200 dark:border-gray-700">
            <button
              onClick={() => setTab('works')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === 'works'
                  ? 'border-red-500 text-red-600 dark:text-red-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {t('blacklist.works')} ({blacklistedWorks.length})
            </button>
            <button
              onClick={() => setTab('creators')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === 'creators'
                  ? 'border-red-500 text-red-600 dark:text-red-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {t('blacklist.creators')} ({blacklistedCreators.length})
            </button>
          </div>

          {/* Works tab */}
          {tab === 'works' && (
            <div className="space-y-2">
              {blacklistedWorks.length === 0 ? (
                <p className="text-gray-500 dark:text-gray-400 py-8 text-center">{t('blacklist.emptyWorks')}</p>
              ) : (
                blacklistedWorks.map((w) => (
                  <div
                    key={w.cid}
                    className="flex items-center justify-between p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{w.title}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{w.cid}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        {t('blacklist.blockedAt')}: {new Date(w.blockedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      onClick={() => unblockWork(w.cid)}
                      className="ml-4 flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors flex-shrink-0"
                    >
                      <TrashIcon className="w-3.5 h-3.5" />
                      {t('blacklist.unblock')}
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Creators tab */}
          {tab === 'creators' && (
            <div className="space-y-2">
              {blacklistedCreators.length === 0 ? (
                <p className="text-gray-500 dark:text-gray-400 py-8 text-center">{t('blacklist.emptyCreators')}</p>
              ) : (
                blacklistedCreators.map((c) => (
                  <div
                    key={c.username}
                    className="flex items-center justify-between p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">@{c.username}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        {t('blacklist.blockedAt')}: {new Date(c.blockedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      onClick={() => unblockCreator(c.username)}
                      className="ml-4 flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors flex-shrink-0"
                    >
                      <TrashIcon className="w-3.5 h-3.5" />
                      {t('blacklist.unblock')}
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default Blacklist
