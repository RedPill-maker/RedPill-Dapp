import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ExclamationTriangleIcon, LightBulbIcon } from '@heroicons/react/24/outline'
import { ipfsConnector } from '../utils/ipfsConnector'
import { privateDataMgr } from '../utils/privateDataMgr'
import LoadingSpinner from './LoadingSpinner'
import IPFSSyncNotice from './IPFSSyncNotice'

interface IPFSSyncStatusProps {
  onSyncComplete?: (siteInfo: any) => void
}

const IPFSSyncStatus: React.FC<IPFSSyncStatusProps> = ({ onSyncComplete }) => {
  const { t } = useTranslation()
  const [syncing, setSyncing] = useState(true)
  const [syncAttempts, setSyncAttempts] = useState(0)
  const [lastError, setLastError] = useState<string | null>(null)
  const [siteInfo, setSiteInfo] = useState<any>(null)
  const [hasFailed, setHasFailed] = useState(false) // Track whether sync has failed / 同期が失敗したかどうかを追跡

  const maxAttempts = 10 // Max 10 attempts / 最大10回の試行

  useEffect(() => {
    // Only execute initial check once when component mounts / コンポーネントマウント時に初期チェックを1回だけ実行
    checkIPFSSync()
  }, []) // Empty dependency array, run once / 空の依存配列、1回実行

  const checkIPFSSync = async () => {
    try {
      const creatorIPNS = privateDataMgr.getCreatorIPNSInfo()
      if (!creatorIPNS) {
        setSyncing(false)
        setHasFailed(true)
        return
      }

      const currentAttempt = syncAttempts + 1
      setSyncAttempts(currentAttempt)
      setLastError(null)

      // Try to resolve IPNS and get site information / IPNSを解決してサイト情報を取得してみる
      const resolvedCID = await ipfsConnector.resolveIPNS(creatorIPNS.ipnsId)
      const files = await ipfsConnector.listFiles(resolvedCID)

      // Find site_info.json file / site_info.jsonファイルを検索
      const siteInfoFile = files.find((file) => file.name === 'site_info.json')

      if (siteInfoFile) {
        // Successfully found site info file, try to download / サイト情報ファイルが見つかりました、ダウンロードしてみます
        const loadedSiteInfo = await ipfsConnector.downloadFileAsJSON(
          siteInfoFile.hash,
        )
        setSiteInfo(loadedSiteInfo)
        setSyncing(false)
        setHasFailed(false)

        // Notify parent component that sync is complete / 親コンポーネントに同期完了を通知
        if (onSyncComplete) {
          onSyncComplete(loadedSiteInfo)
        }
      } else {
        throw new Error('Site info file not found')
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Sync check failed'
      setLastError(errorMessage)
      console.warn(
        `IPFS sync check failed (attempt ${syncAttempts + 1}/${maxAttempts}):`,
        errorMessage,
      )

      // If max attempts reached, stop sync check / 最大試行回数に達した場合は同期チェックを停止
      if (syncAttempts + 1 >= maxAttempts) {
        setSyncing(false)
        setHasFailed(true)
      }
    }
  }

  const handleManualRetry = () => {
    setSyncAttempts(0)
    setSyncing(true)
    setLastError(null)
    setHasFailed(false)
    checkIPFSSync()
  }

  if (!syncing && siteInfo) {
    // Sync complete, don't display anything / 同期完了、何も表示しない
    return null
  }

  if (hasFailed || (!syncing && syncAttempts >= maxAttempts)) {
    // Sync failed, show manual retry option / 同期失敗、手動再試行オプションを表示
    return (
      <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg p-6">
        <div className="flex items-start">
          <ExclamationTriangleIcon className="w-6 h-6 text-yellow-500 mr-3 mt-1 flex-shrink-0" />
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-yellow-900 dark:text-yellow-100 mb-2">
              {t('ipfsSyncStatus.timeout')}
            </h3>
            <p className="text-yellow-800 dark:text-yellow-200 mb-4">
              {t('ipfsSyncStatus.timeoutDesc')}
            </p>
            {lastError && (
              <p className="text-sm text-yellow-700 dark:text-yellow-300 mb-4">
                {t('ipfsSyncStatus.errorInfo')} {lastError}
              </p>
            )}
            <div className="space-y-2 mb-4 text-sm text-yellow-700 dark:text-yellow-300">
              <p className="flex items-center gap-1">
                <LightBulbIcon className="w-4 h-4 inline-block flex-shrink-0" />
                <strong>{t('ipfsSyncStatus.suggestion')}</strong>
              </p>
              <ul className="list-disc list-inside ml-4 space-y-1">
                <li>{t('ipfsSyncStatus.tip1')}</li>
                <li>{t('ipfsSyncStatus.tip2')}</li>
                <li>{t('ipfsSyncStatus.tip3')}</li>
                <li>{t('ipfsSyncStatus.tip4')}</li>
              </ul>
            </div>
            <div className="flex space-x-3">
              <button
                onClick={handleManualRetry}
                className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors"
              >
                {t('ipfsSyncStatus.manualRefresh')}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Syncing - only show status, don't auto retry / 同期中 - ステータスのみを表示、自動再試行しない
  return (
    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-6">
      <div className="flex items-start">
        <div className="mr-3 mt-1">
          <LoadingSpinner />
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-100 mb-2">
            {t('ipfsSyncStatus.checking')}
          </h3>
          <p className="text-blue-800 dark:text-blue-200 mb-4">
              {t('ipfsSyncStatus.creatorCreated')}
          </p>

          <div className="space-y-2 text-sm text-blue-700 dark:text-blue-300">
            <div className="flex items-center">
              <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
              {t('ipfsSyncStatus.creatorCreated')}
            </div>
            <div className="flex items-center">
              <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
              {t('ipfsSyncStatus.ipnsKeyGenerated')}
            </div>
            <div className="flex items-center">
              <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
              {t('ipfsSyncStatus.contentUploaded')}
            </div>
            <div className="flex items-center">
              <LoadingSpinner size="small" className="mr-2" />
              <span>{t('ipfsSyncStatus.checkingSync')}</span>
            </div>
          </div>

          {lastError && (
            <div className="mt-4 p-3 bg-blue-100 dark:bg-blue-800 rounded border border-blue-300 dark:border-blue-600">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                <strong>{t('ipfsSyncStatus.checkStatus')}</strong> {lastError}
              </p>
            </div>
          )}

          <IPFSSyncNotice
            type="info"
            message={t('ipfsSyncStatus.decentralizedNetworkMsg')}
            className="mt-4"
          />

          <div className="mt-4">
            <button
              onClick={handleManualRetry}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              {t('ipfsSyncStatus.manualRefresh')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default IPFSSyncStatus
