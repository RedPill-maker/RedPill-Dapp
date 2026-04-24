import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppDispatch, useAppSelector } from '../hooks/redux'
import {
  fetchIPFSStats,
  clearError,
} from '../store/slices/ipfsSlice'
import { ipfsConnector } from '../utils/ipfsConnector'
import { privateDataMgr } from '../utils/privateDataMgr'
import { getWorksByCreator, getWorkByCid } from '../utils/dbConnector'
import { APP_CONFIG } from '../../config'

// Storage statistics interface / ストレージ統計インターフェース
interface StorageStats {
  repoSize: number
  storageMax: number
  storageMaxStr: string
  gcWatermark: number
  numObjects: number
}

const IPFSStatus: React.FC = () => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const { stats, isLoading, error } = useAppSelector((state) => state.ipfs)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  // Storage management state / ストレージ管理状態
  const [storageStats, setStorageStats] = useState<StorageStats>({
    repoSize: 0,
    storageMax: 0,
    storageMaxStr: '40GB',
    gcWatermark: 90,
    numObjects: 0,
  })
  const [isLoadingStorage, setIsLoadingStorage] = useState(false)
  const [isGCRunning, setIsGCRunning] = useState(false)
  const [gcStatusText, setGcStatusText] = useState('')
  const [storageError, setStorageError] = useState<string | null>(null)

  // Advanced settings expanded state / 高度な設定の展開状態
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false)

  // Input field state (only stores numeric part) / 入力フィールド状態（数値部分のみを保存）
  const [tempStorageMax, setTempStorageMax] = useState('10')
  const [tempGCWatermark, setTempGCWatermark] = useState('90')

  // Format time / 時間をフォーマット
  const formatTime = (timestamp: number) => {
    if (!timestamp) return t('ipfsStatus.neverUpdated')
    const date = new Date(timestamp)
    return date.toLocaleTimeString('zh-CN')
  }

  // Format node ID (display first 8 and last 8 characters) / ノードIDをフォーマット（最初の8文字と最後の8文字を表示）
  const formatNodeId = (nodeId: string | null) => {
    if (!nodeId) return t('ipfsStatus.unknown')
    if (nodeId.length <= 16) return nodeId
    return `${nodeId.slice(0, 8)}...${nodeId.slice(-8)}`
  }

  // Get connection status color / 接続ステータスの色を取得
  const getStatusColor = () => {
    if (isLoading) return 'text-yellow-500'
    if (error) return 'text-red-500'
    if (stats.isConnected) return 'text-green-500'
    return 'text-gray-500'
  }

  // Get connection status text / 接続ステータステキストを取得
  const getStatusText = () => {
    if (isLoading) return t('ipfsStatus.connecting')
    if (error) return t('ipfsStatus.connectFailed')
    if (stats.isConnected) return t('ipfsStatus.connected')
    return t('ipfsStatus.disconnected')
  }

  // Manual refresh (refresh both node status and storage info) / 手動更新（ノードステータスとストレージ情報の両方を更新）
  const handleRefresh = () => {
    dispatch(clearError())
    dispatch(fetchIPFSStats())
    if (stats.isConnected) {
      loadStorageInfo()
    }
  }

  // Load storage information / ストレージ情報を読み込む
  const loadStorageInfo = async () => {
    if (!stats.isConnected) return

    setIsLoadingStorage(true)
    setStorageError(null)
    try {
      // First try to get configuration / まず設定を取得してみる
      let config = await ipfsConnector.getStorageConfig()
      
      // Check if StorageMax is valid (detect duplicate units) / StorageMaxが有効かどうかを確認（重複ユニットを検出）
      const invalidPattern = /(gb|mb|tb|kb)(gb|mb|tb|kb)/i
      if (invalidPattern.test(config.storageMax)) {
        console.warn('Invalid StorageMax config detected:', config.storageMax)
        // Extract numeric part and reset / 数値部分を抽出してリセット
        const numMatch = config.storageMax.match(/^(\d+(?:\.\d+)?)/)
        if (numMatch) {
          const fixedValue = `${numMatch[1]}GB`
          console.log('Attempting to fix to:', fixedValue)
          await ipfsConnector.setStorageMax(fixedValue)
          console.log('StorageMax config fixed')
          // Reload configuration / 設定を再読み込み
          config = await ipfsConnector.getStorageConfig()
        }
      }

      // Get repository statistics / リポジトリ統計を取得
      const repoStats = await ipfsConnector.getRepoStats()

      setStorageStats({
        repoSize: repoStats.repoSize,
        storageMax: repoStats.storageMax,
        storageMaxStr: config.storageMax,
        gcWatermark: config.storageGCWatermark,
        numObjects: repoStats.numObjects,
      })

      // Sync update input field values (only extract numeric part) / 入力フィールド値を同期更新（数値部分のみを抽出）
      const maxMatch = config.storageMax.match(/^(\d+(?:\.\d+)?)/)
      if (maxMatch) {
        setTempStorageMax(maxMatch[1])
      }
      setTempGCWatermark(config.storageGCWatermark.toString())
    } catch (err) {
      console.error('Failed to load storage info:', err)
      setStorageError(
        err instanceof Error ? err.message : t('ipfsStatus.loadStorageFailed'),
      )
    } finally {
      setIsLoadingStorage(false)
    }
  }

  // Update storage limit (refresh storage info after success) / ストレージ上限を更新（成功後にストレージ情報を更新）
  const handleUpdateStorageMax = async () => {
    const trimmedValue = tempStorageMax.trim()
    
    // Extract numeric part of current configuration for comparison / 比較用に現在の設定の数値部分を抽出
    const currentMaxMatch = storageStats.storageMaxStr.match(/^(\d+(?:\.\d+)?)/)
    const currentMaxNum = currentMaxMatch ? currentMaxMatch[1] : '10'
    
    // If value hasn't changed, don't execute update / 値が変わっていない場合は更新を実行しない
    if (trimmedValue === currentMaxNum) {
      return
    }

    // Validate input is a valid number / 入力が有効な数値であることを確認
    const numValue = parseFloat(trimmedValue)
    if (!trimmedValue || isNaN(numValue) || numValue <= 0) {
      alert(t('ipfsStatus.storageMaxInvalid'))
      // Restore original value / 元の値を復元
      setTempStorageMax(currentMaxNum)
      return
    }

    try {
      // Automatically add GB unit when calling API (note: unit must be uppercase) / API呼び出し時にGB単位を自動的に追加（注意：単位は大文字である必要があります）
      const newValue = `${trimmedValue}GB`
      console.log('Setting StorageMax to:', newValue)
      await ipfsConnector.setStorageMax(newValue)
      alert(t('ipfsStatus.storageMaxUpdated'))
      // Refresh storage info after configuration change / 設定変更後にストレージ情報を更新
      await loadStorageInfo()
    } catch (err) {
      console.error('Failed to update StorageMax:', err)
      alert(
        `${t('ipfsStatus.storageMaxUpdateFailed')}: ${err instanceof Error ? err.message : ''}`,
      )
      // Restore original value / 元の値を復元
      setTempStorageMax(currentMaxNum)
    }
  }

  // Update GC trigger point (refresh storage info after success) / GCトリガーポイントを更新（成功後にストレージ情報を更新）
  const handleUpdateGCWatermark = async () => {
    const value = parseInt(tempGCWatermark)
    
    // If value hasn't changed, don't execute update / 値が変わっていない場合は更新を実行しない
    if (value === storageStats.gcWatermark) {
      return
    }

    if (isNaN(value) || value < 0 || value > 100) {
      alert(t('ipfsStatus.gcWatermarkInvalid'))
      // Restore original value / 元の値を復元
      setTempGCWatermark(storageStats.gcWatermark.toString())
      return
    }

    try {
      await ipfsConnector.setStorageGCWatermark(value)
      alert(t('ipfsStatus.gcWatermarkUpdated'))
      // Refresh storage info after configuration change / 設定変更後にストレージ情報を更新
      await loadStorageInfo()
    } catch (err) {
      alert(
        `${t('ipfsStatus.gcWatermarkUpdateFailed')}: ${err instanceof Error ? err.message : ''}`,
      )
      // Restore original value / 元の値を復元
      setTempGCWatermark(storageStats.gcWatermark.toString())
    }
  }

  // Manual cache cleanup (refresh storage info after success) / 手動キャッシュクリーンアップ（成功後にストレージ情報を更新）
  const handleGarbageCollection = async () => {
    if (!confirm(t('ipfsStatus.gcConfirm'))) {
      return
    }

    setIsGCRunning(true)
    try {
      // ── Phase 1: Collect protected CID set ──────────────────────────
      setGcStatusText(t('ipfsStatus.gcStatusCollecting'))
      const protectedCids = new Set<string>()

      const addCid = (cid: string | null | undefined) => {
        if (cid && cid.trim()) protectedCids.add(cid.trim())
      }

      // ── Phase 2: IPNS mode site data ─────────────────────────────────
      const ipnsInfo = privateDataMgr.getIPNSInfo()
      if (ipnsInfo) {
        // Protect site background image / サイト背景画像を保護
        addCid(ipnsInfo.backgroundCid)

        // Parse IPNS site JSON, protect site directory CID and its contents / IPNS サイト JSON を解析し、サイトディレクトリ CID とその内容を保護
        setGcStatusText(t('ipfsStatus.gcStatusFetchingIPNS'))
        try {
          const dirCid = await ipfsConnector.resolveIPNS(ipnsInfo.ipnsId)
          if (dirCid) {
            addCid(dirCid)
            const dirFiles = await ipfsConnector.listFiles(dirCid)
            // Protect all files in directory (including site_info.json itself) / ディレクトリ内のすべてのファイルを保護（site_info.json 自体を含む）
            for (const f of dirFiles) {
              addCid(f.hash)
            }
            // Parse site_info.json to get work list / site_info.json を解析して作品リストを取得
            const siteFile = dirFiles.find((f) => f.name === APP_CONFIG.SITE_FILE_NAME)
            if (siteFile) {
              const siteData = await ipfsConnector.downloadFileAsJSON<{
                bg_cid?: string
                works?: Array<{ cid?: string; img_cid?: string }>
              }>(siteFile.hash)
              addCid(siteData.bg_cid)
              for (const work of siteData.works || []) {
                addCid(work.cid)
                addCid(work.img_cid)
              }
            }
          }
        } catch (e) {
          console.warn('GC: Failed to parse IPNS site, skipping', e)
        }
      }

      // ── Phase 3: FVM mode creator data ────────────────────────────────
      const allCreators = privateDataMgr.getAllCreators()
      for (let i = 0; i < allCreators.length; i++) {
        const creator = allCreators[i]
        setGcStatusText(
          t('ipfsStatus.gcStatusFetchingCreatorWorks', {
            current: i + 1,
            total: allCreators.length,
          }),
        )
        // Avatar, background image / アバター、背景画像
        addCid(creator.avatarCid)
        addCid(creator.backgroundCid)
        // All works and thumbnails under creator / クリエイターの下のすべての作品とサムネイル
        try {
          const works = await getWorksByCreator(creator.username, 1, 9999)
          for (const work of works) {
            addCid(work.cid)
            addCid(work.img_cid)
          }
        } catch (e) {
          console.warn(`GC: Failed to query works for creator ${creator.username}, skipping`, e)
        }
      }

      // ── Phase 4: Downloaded works ────────────────────────────────────────
      setGcStatusText(t('ipfsStatus.gcStatusFetchingDownloads'))
      const downloaded = privateDataMgr.getAllDownloaded()
      for (const item of downloaded) {
        addCid(item.cid)
        // Query corresponding thumbnail via database / データベース経由で対応するサムネイルをクエリ
        try {
          const workDetail = await getWorkByCid(item.cid)
          if (workDetail) addCid(workDetail.img_cid)
        } catch (e) {
          console.warn(`GC: Failed to query downloaded work ${item.cid} details, skipping`, e)
        }
      }

      // ── Phase 5: Get pin list, filter and unpin (concurrent batch processing)────────────
      setGcStatusText(t('ipfsStatus.gcStatusFetchingPinList'))
      // Only take recursive and direct, indirect are sub-blocks that cannot be unpinned directly / recursive と direct のみを取得、indirect はサブブロックで直接 unpin できません
      const [recursivePins, directPins] = await Promise.all([
        ipfsConnector.listPinnedFiles('recursive'),
        ipfsConnector.listPinnedFiles('direct'),
      ])
      const toUnpin = [...recursivePins, ...directPins].filter(
        (cid) => !protectedCids.has(cid),
      )

      const UNPIN_BATCH_SIZE = 10
      let unpinned = 0
      for (let i = 0; i < toUnpin.length; i += UNPIN_BATCH_SIZE) {
        const batch = toUnpin.slice(i, i + UNPIN_BATCH_SIZE)
        await Promise.allSettled(
          batch.map((cid) =>
            ipfsConnector.unpinFile(cid).catch((e) =>
              console.warn(`GC: unpin ${cid} failed, skipping`, e),
            ),
          ),
        )
        unpinned += batch.length
        setGcStatusText(
          t('ipfsStatus.gcStatusUnpinning', {
            current: Math.min(unpinned, toUnpin.length),
            total: toUnpin.length,
          }),
        )
      }

      // ── Phase 6: Run GC ───────────────────────────────────────────
      setGcStatusText(t('ipfsStatus.gcStatusRunningGC'))
      const result = await ipfsConnector.runGarbageCollection()
      alert(t('ipfsStatus.gcSuccess', { count: result.removedObjects }))
      await loadStorageInfo()
    } catch (err) {
      alert(
        `${t('ipfsStatus.gcFailed')}: ${err instanceof Error ? err.message : ''}`,
      )
    } finally {
      setIsGCRunning(false)
      setGcStatusText('')
    }
  }

  // Set timer - auto refresh every 5 seconds by default (only refresh node status, not storage info) / タイマーを設定 - デフォルトで5秒ごとに自動更新（ノードステータスのみを更新、ストレージ情報は更新しない）
  useEffect(() => {
    // Auto refresh node status every 5 seconds / 5秒ごとにノードステータスを自動更新
    intervalRef.current = setInterval(() => {
      dispatch(fetchIPFSStats())
      // Note: storage info does not need frequent refresh, only refresh after initialization and data changes / 注意：ストレージ情報は頻繁に更新する必要がなく、初期化とデータ変更後にのみ更新します
    }, 5000)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [dispatch])

  // Get initial data when component mounts / コンポーネントマウント時に初期データを取得
  useEffect(() => {
    dispatch(fetchIPFSStats())
  }, [dispatch])

  // Load storage info after connection succeeds / 接続成功後にストレージ情報を読み込む
  useEffect(() => {
    if (stats.isConnected) {
      loadStorageInfo()
    }
  }, [stats.isConnected])

  // Format file size / ファイルサイズをフォーマット
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
  }

  // Calculate usage percentage / 使用率を計算
  const usagePercent =
    storageStats.storageMax > 0
      ? (storageStats.repoSize / storageStats.storageMax) * 100
      : 0

  // Calculate GC trigger point position / GC トリガーポイント位置を計算
  const gcTriggerPercent = storageStats.gcWatermark

  return (
    <div className="bg-white dark:bg-rp-gray-800 rounded-lg border border-gray-200 dark:border-rp-gray-700 overflow-hidden">
      {/* Title bar / タイトルバー */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-rp-gray-700 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">IPFS</span>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {t('ipfsStatus.title')}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t('ipfsStatus.description')}
            </p>
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isLoading}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-rp-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg
            className={`w-5 h-5 text-gray-600 dark:text-gray-400 ${isLoading ? 'animate-spin' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
      </div>

      {/* Statue info */}
      <div className="p-6 space-y-4">
        {/* Connection info */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('ipfsStatus.connectionStatus')}
          </span>
          <div className="flex items-center space-x-2">
            <div
              className={`w-2 h-2 rounded-full ${stats.isConnected ? 'bg-green-500' : 'bg-red-500'}`}
            />
            <span className={`text-sm font-medium ${getStatusColor()}`}>
              {getStatusText()}
            </span>
          </div>
        </div>

        {/* Connection count */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('ipfsStatus.connectedPeers')}
          </span>
          <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">
            {stats.peerCount}
          </span>
        </div>

        {/* Error info */}
        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <div className="flex items-center space-x-2">
              <svg
                className="w-4 h-4 text-red-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span className="text-sm text-red-700 dark:text-red-400">
                {error}
              </span>
            </div>
          </div>
        )}

        {/* Storage management */}
        {stats.isConnected && (
          <div className="pt-4 border-t border-gray-200 dark:border-rp-gray-700">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
              {t('ipfsStatus.storageManagement')}
            </h3>

            {storageError && (
              <div className="mb-3 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-xs text-red-700 dark:text-red-400">
                {storageError}
              </div>
            )}

            {/* Storage statue progress */}
            <div className="mb-3">
              {/* progress bar */}
              <div className="relative h-6 bg-gray-200 dark:bg-gray-700 rounded-lg overflow-hidden">
                {/* used pard */}
                <div
                  className="absolute left-0 top-0 h-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-300"
                  style={{ width: `${Math.min(usagePercent, 100)}%` }}
                />
                {/* GC trigger line */}
                <div
                  className="absolute top-0 h-full w-0.5 bg-red-500 z-10"
                  style={{ left: `${gcTriggerPercent}%` }}
                />
                {/* context display */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xs font-medium text-gray-900 dark:text-white mix-blend-difference">
                    {formatBytes(storageStats.repoSize)} / {formatBytes(storageStats.storageMax)}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between mt-1 text-xs text-gray-500 dark:text-gray-400">
                <span>
                  {t('ipfsStatus.currentUsage')}: {usagePercent.toFixed(1)}%
                </span>
                <span>
                  {t('ipfsStatus.gcTriggerPoint')}: {gcTriggerPercent}%
                </span>
              </div>
            </div>

            {/* cache clear button */}
            <button
              onClick={handleGarbageCollection}
              disabled={isGCRunning || isLoadingStorage}
              className="w-full px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed rounded-lg transition-colors mb-3"
            >
              {isGCRunning
                ? (gcStatusText || t('ipfsStatus.gcRunning'))
                : t('ipfsStatus.garbageCollection')}
            </button>

            {/* more settings button */}
            <button
              onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
              className="w-full px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors flex items-center justify-center space-x-2"
            >
              <span>{t('ipfsStatus.advancedSettings')}</span>
              <svg
                className={`w-4 h-4 transition-transform ${showAdvancedSettings ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>

            {/* Expanded advanced settings content */}
            {showAdvancedSettings && (
              <div className="mt-4 space-y-3 pt-3 border-t border-gray-200 dark:border-rp-gray-700">
                {/* Node ID */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t('ipfsStatus.nodeId')}
                  </span>
                  <span className="text-sm text-gray-600 dark:text-gray-400 font-mono">
                    {formatNodeId(stats.nodeId)}
                  </span>
                </div>

                {/* Version */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t('ipfsStatus.version')}
                  </span>
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {stats.version || t('ipfsStatus.unknown')}
                  </span>
                </div>

                {/* Last update time */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t('ipfsStatus.lastUpdate')}
                  </span>
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {formatTime(stats.lastUpdated)}
                  </span>
                </div>

                {/* StorageMax settings */}
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t('ipfsStatus.storageMax')}
                  </label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={tempStorageMax}
                      onChange={(e) => setTempStorageMax(e.target.value)}
                      onBlur={handleUpdateStorageMax}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleUpdateStorageMax()
                        }
                      }}
                      placeholder="40"
                      className="w-24 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-600 dark:text-gray-400">GB</span>
                  </div>
                </div>

                {/* StorageGCWatermark settings */}
                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {t('ipfsStatus.storageGCWatermark')}
                    </label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={tempGCWatermark}
                        onChange={(e) => setTempGCWatermark(e.target.value)}
                        onBlur={handleUpdateGCWatermark}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleUpdateGCWatermark()
                          }
                        }}
                        className="w-20 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-600 dark:text-gray-400">%</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {t('ipfsStatus.storageGCWatermarkDesc')}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default IPFSStatus
