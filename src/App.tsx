import React, { useEffect, useRef, useState } from 'react'
import { useAppSelector, useAppDispatch } from './hooks/redux'
import {
  setCurrentPage,
  setItemPageByCid,
  PageType,
} from './store/slices/pageSlice'
import { fetchWithdrawBalances } from './store/slices/withdrawSlice'
import { fetchTipsBadge } from './store/slices/myHomeSlice'
import { fetchUnstoredCount } from './store/slices/chainStorageSlice'
import './i18n/i18n' // import i18n config
import i18n from './i18n/i18n'
import Header from './components/header_search/Header'
import Sidebar from './components/Sidebar'
import MainContent from './components/MainContent'
import ToastNotification from './global_modal/ToastNotification'
import { notify, type NotificationHandle } from './global_modal/ToastNotification'
import { getServiceStatus, type ServiceStatus } from './utils/dbConnector'
import { ipfsConnector } from './utils/ipfsConnector'
import { privateDataMgr } from './utils/privateDataMgr'
import SetupSecurityModal from './components/SetupSecurityModal'
import { checkForUpdates, applyDistUpdate, downloadAppUpdate, showUpdateInFolder } from './utils/updateMgr'

const App: React.FC = () => {
  const dispatch = useAppDispatch()
  const { isDark } = useAppSelector((state) => state.theme)
  const pageState = useAppSelector((state) => state.page)
  const [showSetupSecurity, setShowSetupSecurity] = useState(false)

  // Use ref to track current page state for hashchange callback (avoid stale closure) / ref を使用して現在のページ状態を追跡し、hashchange コールバック用（古いクロージャを回避）
  const pageStateRef = React.useRef(pageState)
  pageStateRef.current = pageState

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [isDark])

  // Listen for hash changes (only handle manual URL changes or browser back/forward, skip internal program-triggered changes) / ハッシュ変更をリッスン（手動 URL 変更またはブラウザ戻る/進むのみを処理、プログラム内部トリガーをスキップ）
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1)
      const { currentPage, itemCid } = pageStateRef.current
      const validPages: PageType[] = [
        'home',
        'settings',
        'trending',
        'subscriptions',
        'library',
        'history',
        'watchLater',
        'liked',
        'purchased',
        'myHome',
        'contentPublish',
        'search',
        'creator',
        'item',
        'filecoinWallet',
        'withdraw',
      ]

      // Parse item/{cid} format / item/{cid} 形式を解析
      if (hash.startsWith('item/')) {
        const cid = hash.slice(5)
        if (cid) {
          // Already on this item, means internal program trigger, skip / 既にこのアイテムにいる場合、プログラム内部トリガーを意味するため、スキップ
          if (currentPage === 'item' && itemCid === cid) return
          dispatch(setItemPageByCid(cid))
          return
        }
      }

      // Compatible with old rewards hash / 古い rewards ハッシュと互換性
      if (hash === 'rewards') {
        dispatch(setCurrentPage('withdraw'))
        return
      }

      if (hash && validPages.includes(hash as PageType)) {
        // Already on this page, means internal program trigger, skip / 既にこのページにいる場合、プログラム内部トリガーを意味するため、スキップ
        if (currentPage === hash) return
        dispatch(setCurrentPage(hash as PageType))
      } else if (!hash) {
        window.location.hash = 'home'
      }
    }

    // Listen for hash change events / ハッシュ変更イベントをリッスン
    window.addEventListener('hashchange', handleHashChange)

    // Check hash on initialization / 初期化時にハッシュを確認
    if (!window.location.hash) {
      window.location.hash = 'home'
    }

    return () => {
      window.removeEventListener('hashchange', handleHashChange)
    }
  }, [dispatch])

  // Check if security password needs to be set / セキュリティパスワードを設定する必要があるかを確認
  useEffect(() => {
    const checkPassword = async () => {
      if (!(await privateDataMgr.hasPassword())) {
        setShowSetupSecurity(true)
      }
    }
    checkPassword()
  }, [])

  // Preload withdrawal balance on app launch (display as badge)
  useEffect(() => {
    dispatch(fetchWithdrawBalances(false))
    dispatch(fetchTipsBadge(false))
    dispatch(fetchUnstoredCount())
    // Pre-initialize IPFS Gateway URL cache to ensure dynamic ports take effect
    ipfsConnector.initGatewayUrl().catch(() => {})
  }, [dispatch])
  
  // Handle update available / 利用可能な更新を処理
  const handleUpdateAvailable = (updateInfo: any) => {
    const t = i18n.t.bind(i18n)
    if (updateInfo.updateType === 'dist') {
      const msg = t('update.updateAvailable') + ` v${updateInfo.version} - ` + t('update.patchUpdate')
      const handle = notify(msg)
      handle.success(msg)
      handle.setAction({
        label: t('update.updateNow'),
        onClick: async () => {
          handle.setAction(undefined)
          handle.update(t('update.downloading'))
          try {
            const success = await applyDistUpdate(updateInfo.cid)
            if (success) {
              handle.success(t('update.updateSuccess'))
            } else {
              handle.error(t('update.updateFailed'))
            }
          } catch (err: any) {
            handle.error(t('update.updateFailed') + ': ' + (err.message || t('common.error')))
          }
        },
      })
    } else if (updateInfo.updateType === 'app') {
      const msg = t('update.updateAvailable') + ` v${updateInfo.version} - ` + t('update.majorUpdate')
      const handle = notify(msg)
      handle.success(msg)
      if (updateInfo.cid) {
        handle.setAction({
          label: t('update.downloadInstaller'),
          onClick: async () => {
            handle.setAction(undefined)
            handle.update(t('update.downloading'))
            try {
              const filePath = await downloadAppUpdate(updateInfo.cid, updateInfo.fileName)
              if (filePath) {
                handle.success(t('update.downloadSuccess'))
                handle.setAction({
                  label: t('update.showInFolder'),
                  onClick: () => showUpdateInFolder(filePath),
                })
              } else {
                handle.error(t('update.downloadFailed'))
              }
            } catch (err: any) {
              handle.error(t('update.downloadFailed') + ': ' + (err.message || t('common.error')))
            }
          },
        })
      }
    }
  }

  // dbSync service status polling / dbSync サービスステータスポーリング
  const syncNotifyRef = useRef<NotificationHandle | null>(null)
  const syncPollingRef = useRef(false)
  
  // Update check status / 更新チェックステータス
  const updateCheckedRef = useRef(false)

  useEffect(() => {
    if (syncPollingRef.current) return
    syncPollingRef.current = true

    const formatStatusMessage = (status: ServiceStatus): string => {
      const t = i18n.t.bind(i18n)
      switch (status.phase) {
        case 'starting':
          // Show live status_message from dbSync if available, otherwise fallback
          return status.status_message || t('dbSync.starting')
        case 'ipfs_download':
          return status.status_message
            ? `${t('dbSync.ipfsDownload', { downloaded: status.ipfs_downloaded_shards, total: status.ipfs_total_shards })} — ${status.status_message}`
            : t('dbSync.ipfsDownload', { downloaded: status.ipfs_downloaded_shards, total: status.ipfs_total_shards })
        case 'db_building':
          return t('dbSync.dbBuilding', { progress: status.sync_progress, current: status.sync_current_block, target: status.sync_target_block })
        case 'error':
          return t('dbSync.error', { error: status.error || t('common.error') })
        case 'ready':
          return t('dbSync.ready')
        default:
          return t('dbSync.unknown')
      }
    }

    let timer: ReturnType<typeof setTimeout> | null = null

    const poll = async () => {
      const status = await getServiceStatus()

      // Service not responding (may not have started yet) / サービスが応答していない（まだ起動していない可能性があります）
      if (!status) {
        if (!syncNotifyRef.current) {
          syncNotifyRef.current = notify(i18n.t('dbSync.connecting'))
        } else {
          syncNotifyRef.current.update(i18n.t('dbSync.connecting'))
        }
        timer = setTimeout(poll, 1000)
        return
      }

      // Service available, end polling / サービス利用可能、ポーリング終了
      if (status.available) {
        if (syncNotifyRef.current) {
          syncNotifyRef.current.success(i18n.t('dbSync.ready'))
          syncNotifyRef.current.close(3)
          syncNotifyRef.current = null
        }

        // Notify home page components to reload data
        window.dispatchEvent(new CustomEvent('dbsync-ready'))
        
        // Check for updates (only once, and requires auto-update enabled) / 更新をチェック（1回のみ、自動更新が有効である必要があります）
        if (!updateCheckedRef.current) {
          updateCheckedRef.current = true
          const autoUpdateEnabled = privateDataMgr.getAutoUpdate()
          if (autoUpdateEnabled) {
            checkForUpdates().then(updateInfo => {
              if (updateInfo.hasUpdate) {
                handleUpdateAvailable(updateInfo)
              }
            }).catch(err => {
              console.error('[Update] Failed to check for updates:', err)
            })
          }
        }
        
        return
      }

      // Service unavailable, update notification / サービス利用不可、通知を更新
      const msg = formatStatusMessage(status)
      if (!syncNotifyRef.current) {
        syncNotifyRef.current = notify(msg)
      } else {
        syncNotifyRef.current.update(msg)
      }

      // Error state also marked as error style / エラー状態もエラースタイルとしてマーク
      if (status.phase === 'error' && syncNotifyRef.current) {
        syncNotifyRef.current.error(msg)
      }

      timer = setTimeout(poll, 1000)
    }

    poll()

    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [])

  return (
    <div className="min-h-screen bg-white dark:bg-rp-gray-900 transition-colors duration-200">
      <Header />
      <Sidebar />
      <MainContent />
      <ToastNotification />
      <SetupSecurityModal
        isOpen={showSetupSecurity}
        onComplete={() => setShowSetupSecurity(false)}
      />
    </div>
  )
}

export default App
