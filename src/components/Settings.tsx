import React, { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppDispatch, useAppSelector } from '../hooks/redux'
import { toggleTheme } from '../store/slices/themeSlice'
import { setLanguage } from '../store/slices/languageSlice'
import { setFilecoinNetwork } from '../store/slices/filecoinNetworkSlice'
import { FILECOIN_NETWORKS, SUPPORTED_LANGUAGES, SupportedLanguage } from '../../config'
import { ipfsConnector } from '../utils/ipfsConnector'
import { privateDataMgr } from '../utils/privateDataMgr'
import { checkForUpdates, applyDistUpdate, downloadAppUpdate, showUpdateInFolder, type UpdateInfo } from '../utils/updateMgr'
import { APP_CONFIG } from '../../config'
import IPFSStatus from './IPFSStatus'
import LoadingSpinner from './LoadingSpinner'
import GesturePasswordModal from './GesturePasswordModal'
import GesturePassword from './GesturePassword'
import { QuestionMarkCircleIcon, XMarkIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'

// ─── DHT Tooltip ────────────────────────────────────────────────────────────
const DHTTooltip: React.FC = () => {
  const { t } = useTranslation()
  const [show, setShow] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setShow(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative inline-flex items-center ml-1">
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        className="text-gray-400 hover:text-blue-500 transition-colors focus:outline-none"
        aria-label={t('dhtTooltip.ariaLabel')}
      >
        <QuestionMarkCircleIcon className="w-4 h-4" />
      </button>
      {show && (
        <div className="absolute left-6 top-0 z-50 w-72 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg p-3 shadow-xl whitespace-pre-line">
          {t('dhtTooltip.content')}
          <div className="absolute left-0 top-2 -translate-x-1.5 w-2 h-2 bg-gray-900 dark:bg-gray-700 rotate-45" />
        </div>
      )}
    </div>
  )
}

// ─── Security Verify Helper ──────────────────────────────────────────────────
interface SecurityVerifyProps {
  isOpen: boolean
  onClose: () => void
  onVerified: (pattern: string) => void | Promise<void>
  title?: string
  description?: string
}

const SecurityVerifyModal: React.FC<SecurityVerifyProps> = ({
  isOpen,
  onClose,
  onVerified,
  title,
  description,
}) => {
  const { t } = useTranslation()
  const [error, setError] = useState<string | null>(null)
  const [gestureKey, setGestureKey] = useState(0)

  const handlePattern = async (pattern: string) => {
    if (!(await privateDataMgr.verifyPassword(pattern))) {
      setError(t('securityVerify.errorWrong'))
      setGestureKey((k) => k + 1)
      return
    }
    setError(null)
    try {
      await onVerified(pattern)
      setGestureKey((k) => k + 1)
    } catch (err: any) {
      setError(err.message || t('common.error'))
      setGestureKey((k) => k + 1)
    }
  }

  if (!isOpen) return null
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-sm mx-4 shadow-xl">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{title ?? t('securityVerify.defaultTitle')}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{description ?? t('securityVerify.defaultDesc')}</p>
        <div className="flex justify-center">
          <GesturePassword key={gestureKey} mode="verify" onComplete={handlePattern} error={error} />
        </div>
        <div className="mt-3 flex justify-center">
          <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-200">{t('securityVerify.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Data Management ─────────────────────────────────────────────────────────
// Export all data from privateDataMgr except wallets and passwords (jsonl format) / privateDataMgrからウォレットとパスワード以外のすべてのデータをエクスポート（jsonl形式）
function exportUserDataAsJsonl(): string {
  const data = privateDataMgr.exportAllData()
  const lines: object[] = []
  if (data.subscriptions?.length) {
    data.subscriptions.forEach((item: object) => lines.push({ type: 'subscription', data: item }))
  }
  if (data.favorites?.length) {
    data.favorites.forEach((item: object) => lines.push({ type: 'favorite', data: item }))
  }
  if (data.history?.length) {
    data.history.forEach((item: object) => lines.push({ type: 'history', data: item }))
  }
  // pending publish
  const pending = privateDataMgr.getAllPendingPublish()
  if (pending?.length) {
    pending.forEach((item: object) => lines.push({ type: 'pendingPublish', data: item }))
  }
  // creator info (non-sensitive)
  const creatorInfo = privateDataMgr.getCreatorInfo()
  if (creatorInfo) lines.push({ type: 'creatorInfo', data: creatorInfo })

  return lines.map((l) => JSON.stringify(l)).join('\n')
}

function importUserDataFromJsonl(jsonl: string, merge: boolean): { success: boolean; error?: string } {
  try {
    const lines = jsonl.split('\n').filter((l) => l.trim())
    const parsed = lines.map((l) => JSON.parse(l))

    const subscriptions = parsed.filter((l) => l.type === 'subscription').map((l) => l.data)
    const favorites = parsed.filter((l) => l.type === 'favorite').map((l) => l.data)
    const history = parsed.filter((l) => l.type === 'history').map((l) => l.data)
    const pendingPublish = parsed.filter((l) => l.type === 'pendingPublish').map((l) => l.data)
    const creatorInfoLine = parsed.find((l) => l.type === 'creatorInfo')

    privateDataMgr.importData({ subscriptions, favorites, history }, merge)

    if (!merge) {
      privateDataMgr.clearPendingPublish()
    }
    pendingPublish.forEach((item) => privateDataMgr.addPendingPublish(item))

    if (creatorInfoLine && !merge) {
      privateDataMgr.setCreatorInfo(creatorInfoLine.data)
    }

    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'Parse error' }
  }
}

function deleteAllUserData() {
  privateDataMgr.importData({ subscriptions: [], favorites: [], history: [] }, false)
  privateDataMgr.clearPendingPublish()
  privateDataMgr.clearCreatorInfo()
}

// ─── Main Settings Component ─────────────────────────────────────────────────
const Settings: React.FC = () => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const { isDark } = useAppSelector((state) => state.theme)
  const { current: currentLanguage } = useAppSelector((state) => state.language)
  const { current: currentFilecoinNetwork } = useAppSelector((state) => state.filecoinNetwork)
  const { stats } = useAppSelector((state) => state.ipfs)

  // Auto-update setting
  const [autoUpdate, setAutoUpdateState] = useState(privateDataMgr.getAutoUpdate())
  const [saveSearchHistoryEnabled, setSaveSearchHistoryEnabled] = useState(privateDataMgr.getSaveSearchHistory())
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [updateCheckResult, setUpdateCheckResult] = useState<string | null>(null)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [applyingUpdate, setApplyingUpdate] = useState(false)
  const [savedUpdatePath, setSavedUpdatePath] = useState<string | null>(null)

  // DHT
  const [dhtMode, setDhtMode] = useState<'dhtserver' | 'dhtclient'>('dhtclient')
  const [dhtLoading, setDhtLoading] = useState(false)
  const [dhtError, setDhtError] = useState<string | null>(null)
  const canChangeDHT = stats.isConnected && !dhtLoading

  // Security password modal / セキュリティパスワードモーダル
  const [showChangeGesture, setShowChangeGesture] = useState(false)

  // Security verification modal (generic) / セキュリティ検証モーダル（汎用）
  const [securityVerify, setSecurityVerify] = useState<{
    open: boolean
    title: string
    description: string
    onVerified: (pattern: string) => void | Promise<void>
  }>({ open: false, title: '', description: '', onVerified: () => {} })

  // IPNS key / IPNSキー
  const hasCreatorIPNS = privateDataMgr.hasCreatorIPNS()
  const creatorIPNS = privateDataMgr.getCreatorIPNSInfo()

  // Data management / データ管理
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [dataMsg, setDataMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => { loadDHTMode() }, [])

  const handleAutoUpdateChange = () => {
    const newValue = !autoUpdate
    setAutoUpdateState(newValue)
    privateDataMgr.setAutoUpdate(newValue)
  }

  const handleSaveSearchHistoryChange = () => {
    const newValue = !saveSearchHistoryEnabled
    setSaveSearchHistoryEnabled(newValue)
    privateDataMgr.setSaveSearchHistory(newValue)
    if (!newValue) privateDataMgr.clearSearchHistory()
  }

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true)
    setUpdateCheckResult(null)
    setUpdateInfo(null)
    setSavedUpdatePath(null)
    try {
      const info = await checkForUpdates()
      setUpdateInfo(info)
      if (info.hasUpdate) {
        if (info.updateType === 'dist') {
          setUpdateCheckResult(
            t('update.updateAvailable') + '\n' +
            t('update.currentVersion') + ': v' + info.currentVersion + '\n' +
            t('update.latestVersion') + ': v' + info.version + '\n\n' +
            t('update.patchUpdate')
          )
        } else if (info.updateType === 'app') {
          setUpdateCheckResult(
            t('update.updateAvailable') + '\n' +
            t('update.currentVersion') + ': v' + info.currentVersion + '\n' +
            t('update.latestVersion') + ': v' + info.version + '\n\n' +
            t('update.majorUpdate')
          )
        }
      } else {
        setUpdateCheckResult(
          t('update.currentVersion') + ': v' + info.currentVersion + '\n' +
          t('update.latestVersion') + ': v' + info.version + '\n\n' +
          t('update.noUpdate')
        )
      }
    } catch (err: any) {
      setUpdateCheckResult(t('update.updateFailed') + ': ' + (err.message || t('common.error')))
    } finally {
      setCheckingUpdate(false)
    }
  }

  const handleApplyDistUpdate = async () => {
    if (!updateInfo?.cid) return
    setApplyingUpdate(true)
    try {
      const success = await applyDistUpdate(updateInfo.cid)
      if (!success) setUpdateCheckResult(t('update.updateFailed'))
    } catch (err: any) {
      setUpdateCheckResult(t('update.updateFailed') + ': ' + (err.message || t('common.error')))
    } finally {
      setApplyingUpdate(false)
    }
  }

  const handleDownloadAppUpdate = async () => {
    if (!updateInfo?.cid || !updateInfo?.fileName) return
    setApplyingUpdate(true)
    try {
      const filePath = await downloadAppUpdate(updateInfo.cid, updateInfo.fileName)
      if (filePath) {
        setSavedUpdatePath(filePath)
        setUpdateCheckResult(t('update.downloadSuccess') + '\n' + filePath)
      } else {
        setUpdateCheckResult(t('update.downloadFailed'))
      }
    } catch (err: any) {
      setUpdateCheckResult(t('update.downloadFailed') + ': ' + (err.message || t('common.error')))
    } finally {
      setApplyingUpdate(false)
    }
  }

  const loadDHTMode = async () => {
    try {
      const mode = await ipfsConnector.getDHTMode()
      setDhtMode(mode as 'dhtserver' | 'dhtclient')
      setDhtError(null)
    } catch {
      setDhtError(t('settings.ipfs.dhtModeDescWaiting'))
    }
  }

  const handleDHTModeChange = async (newMode: 'dhtserver' | 'dhtclient') => {
    if (dhtLoading || newMode === dhtMode || !canChangeDHT) return
    setDhtLoading(true)
    setDhtError(null)
    try {
      await ipfsConnector.setDHTMode(newMode)
      await ipfsConnector.restartDaemon()
      setDhtMode(newMode)
      alert(
        `${newMode === 'dhtserver' ? t('settings.ipfs.dhtModeServer') : t('settings.ipfs.dhtModeClient')}\n\n${t('settings.ipfs.dhtModeWarning')}`
      )
    } catch (err) {
      setDhtError(err instanceof Error ? err.message : t('dhtModeConfirm.switchFailed'))
    } finally {
      setDhtLoading(false)
    }
  }

  const isElectron = () =>
    !!(typeof window !== 'undefined' &&
      (window.process?.type === 'renderer' ||
        window.process?.versions?.electron ||
        window.navigator?.userAgent?.includes('Electron') ||
        window.electronAPI))

  // ── IPNS Export / IPNS エクスポート ──
  const handleExportKey = () => {
    if (!hasCreatorIPNS) { alert(t('settings.creator.statusNotSet')); return }
    setSecurityVerify({
      open: true,
      title: t('securityVerify.defaultTitle'),
      description: t('securityVerify.verifyExportKey'),
      onVerified: async () => {
        const creatorInfo = privateDataMgr.getCreatorIPNSInfo()
        if (!creatorInfo) throw new Error(t('settings.creator.statusNotSet'))
        const electronDetected = isElectron()
        if (electronDetected && window.electronAPI) {
          const result = await window.electronAPI.exportIPNSKeyWithDialog(creatorInfo.keyName ?? '')
          if (result.success) {
            alert(`${t('common.success')}\n${result.filePath}`)
          } else {
            throw new Error(result.error || t('common.error'))
          }
        } else if (!electronDetected) {
          const cliCommand = `ipfs key export ${creatorInfo.keyName ?? ''}`
          const blob = new Blob([`IPFS Creator Key Export\n\nRun in terminal:\n${cliCommand}`], { type: 'text/plain;charset=utf-8' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url; a.download = `creator_key_${creatorInfo.keyName}.txt`
          document.body.appendChild(a); a.click(); document.body.removeChild(a)
          URL.revokeObjectURL(url)
        } else {
          throw new Error(t('common.error'))
        }
        setSecurityVerify((v) => ({ ...v, open: false }))
      },
    })
  }

  // ── IPNS Import / IPNS インポート ──
  const handleImportKey = () => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = '.key,.pem,.txt'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        const result = ev.target?.result
        if (!result) { alert(t('settings.dataManagement.importError')); return }
        let keyData: string
        if (result instanceof ArrayBuffer) {
          const arr = new Uint8Array(result)
          keyData = btoa(String.fromCharCode(...arr))
        } else {
          keyData = (result as string).trim()
        }
        setSecurityVerify({
          open: true,
          title: t('securityVerify.defaultTitle'),
          description: t('securityVerify.verifyImportKey'),
          onVerified: async () => {
            const keyName = `imported_creator_${Date.now()}`
            let importedKey: { name: string; id: string }
            if (isElectron() && window.electronAPI) {
              importedKey = await window.electronAPI.importIPNSKey(keyName, keyData)
            } else {
              importedKey = await ipfsConnector.importIPNSKey(keyName, keyData)
            }
            privateDataMgr.setCreatorIPNSInfo({
              ipnsId: importedKey.id,
              keyName: importedKey.name,
              createdAt: new Date().toISOString(),
              title: t('common.unnamed'),
              mode: 'ipns',
            })
            alert(`${t('common.success')}\n${importedKey.name}`)
            setSecurityVerify((v) => ({ ...v, open: false }))
          },
        })
      }
      reader.readAsArrayBuffer(file)
    }
    input.click()
  }

  // ── Data Export / データエクスポート ──
  const handleExportData = () => {
    setSecurityVerify({
      open: true,
      title: t('securityVerify.defaultTitle'),
      description: t('securityVerify.verifyExportData'),
      onVerified: async () => {
        const jsonl = exportUserDataAsJsonl()
        const blob = new Blob([jsonl], { type: 'application/jsonl;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `userdata_${new Date().toISOString().slice(0, 10)}.jsonl`
        document.body.appendChild(a); a.click(); document.body.removeChild(a)
        URL.revokeObjectURL(url)
        setDataMsg({ type: 'success', text: t('settings.dataManagement.exportSuccess') })
        setSecurityVerify((v) => ({ ...v, open: false }))
      },
    })
  }

  // ── Data Import / データインポート ──
  const handleImportData = () => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = '.jsonl,.json'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        const content = ev.target?.result as string
        if (!content) { setDataMsg({ type: 'error', text: t('settings.dataManagement.importError') }); return }
        setSecurityVerify({
          open: true,
          title: t('securityVerify.defaultTitle'),
          description: t('securityVerify.verifyImportData'),
          onVerified: async () => {
            const result = importUserDataFromJsonl(content, true)
            if (result.success) {
              setDataMsg({ type: 'success', text: t('settings.dataManagement.importSuccess') })
            } else {
              setDataMsg({ type: 'error', text: t('settings.dataManagement.importFailed', { error: result.error }) })
            }
            setSecurityVerify((v) => ({ ...v, open: false }))
          },
        })
      }
      reader.readAsText(file)
    }
    input.click()
  }

  // ── Data Delete / データ削除 ──
  const handleDeleteData = () => {
    setShowDeleteConfirm(true)
  }

  const handleConfirmDelete = () => {
    setShowDeleteConfirm(false)
    setSecurityVerify({
      open: true,
      title: t('securityVerify.defaultTitle'),
      description: t('securityVerify.verifyDeleteData'),
      onVerified: async () => {
        deleteAllUserData()
        setDataMsg({ type: 'success', text: t('settings.dataManagement.deleteSuccess') })
        setSecurityVerify((v) => ({ ...v, open: false }))
      },
    })
  }

  return (
    <>
      {/* Change gesture password modal / ジェスチャーパスワード変更モーダル */}
      <GesturePasswordModal
        isOpen={showChangeGesture}
        onClose={() => setShowChangeGesture(false)}
        mode="change"
        title={t('settings.security.changePassword')}
        description={t('gesturePasswordModal.stepOldDesc')}
        onVerifyOld={(pattern) => privateDataMgr.verifyPassword(pattern)}
        onComplete={async (pattern) => {
          await privateDataMgr.setPassword(pattern)
          setShowChangeGesture(false)
          alert(t('common.success'))
        }}
      />

      {/* Generic security verification modal / 汎用セキュリティ検証モーダル */}
      <SecurityVerifyModal
        isOpen={securityVerify.open}
        onClose={() => setSecurityVerify((v) => ({ ...v, open: false }))}
        onVerified={securityVerify.onVerified}
        title={securityVerify.title}
        description={securityVerify.description}
      />

      {/* Delete data confirmation modal / データ削除確認モーダル */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-sm mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-red-600 dark:text-red-400 mb-3 flex items-center gap-2">
                <ExclamationTriangleIcon className="w-5 h-5 shrink-0" />
                {t('settings.dataManagement.deleteConfirmTitle')}
              </h3>
            <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-lg p-3 mb-4">
              <p className="text-sm text-red-700 dark:text-red-300 whitespace-pre-line">{t('settings.dataManagement.deleteDataList')}</p>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">{t('settings.dataManagement.deleteConfirmDesc')}</p>
            <div className="flex justify-end space-x-3">
              <button onClick={() => setShowDeleteConfirm(false)} className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors">{t('common.cancel')}</button>
              <button onClick={handleConfirmDelete} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors">{t('common.confirm')}</button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{t('settings.title')}</h1>
          <p className="text-gray-600 dark:text-gray-400">{t('settings.description')}</p>
        </div>

        <div className="mb-8"><IPFSStatus /></div>

        {/* Data operation feedback / データ操作フィードバック */}
        {dataMsg && (
          <div className={`mb-4 p-3 rounded-lg text-sm ${dataMsg.type === 'success' ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300' : 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300'}`}>
            {dataMsg.text}
            <button onClick={() => setDataMsg(null)} className="ml-2 text-xs underline">{t('settings.dataManagement.closeMsg')}</button>
          </div>
        )}

        <div className="space-y-8">
          {/* ── Appearance ── */}
          <SettingSection title={t('settings.appearance.title')}>
            <SettingRow label={t('settings.appearance.theme')} description={t('settings.appearance.themeDesc')}>
              <Toggle value={isDark} onChange={() => dispatch(toggleTheme())} />
            </SettingRow>
            <SettingRow label={t('settings.appearance.language')} description={t('settings.appearance.languageDesc')}>
              <select
                value={currentLanguage}
                onChange={(e) => dispatch(setLanguage(e.target.value as SupportedLanguage))}
                className="block w-40 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:border-blue-500 focus:outline-none"
              >
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.nativeName}
                  </option>
                ))}
              </select>
            </SettingRow>
            <SettingRow label={t('settings.appearance.autoUpdate')} description={t('settings.appearance.autoUpdateDesc')}>
              <Toggle value={autoUpdate} onChange={handleAutoUpdateChange} />
            </SettingRow>
            <SettingRow 
              label={`${t('common.currentVersion')}: v${APP_CONFIG.VERSION}`} 
              description={updateCheckResult || t('update.checkDesc')}
            >
              <div className="flex flex-col items-end gap-2">
                {/* Not checked yet or checking - show check button / まだチェックされていない、またはチェック中 - チェックボタンを表示 */}
                {!updateInfo && (
                  <ActionButton onClick={handleCheckUpdate} disabled={checkingUpdate || applyingUpdate}>
                    {checkingUpdate ? t('update.checkingUpdate') : t('update.checkUpdate')}
                  </ActionButton>
                )}
                {/* After check: has dist update / チェック後：dist更新がある */}
                {updateInfo?.hasUpdate && updateInfo.updateType === 'dist' && !savedUpdatePath && (
                  <ActionButton onClick={handleApplyDistUpdate} disabled={applyingUpdate}>
                    {applyingUpdate ? t('update.installing') : t('update.updateNow')}
                  </ActionButton>
                )}
                {/* After check: has app update and has cid to download / チェック後：アプリ更新があり、ダウンロード可能なcidがある */}
                {updateInfo?.hasUpdate && updateInfo.updateType === 'app' && updateInfo.cid && !savedUpdatePath && (
                  <ActionButton onClick={handleDownloadAppUpdate} disabled={applyingUpdate}>
                    {applyingUpdate ? t('update.downloading') : t('update.downloadInstaller')}
                  </ActionButton>
                )}
                {/* After check: has app update but no cid (need manual download) / チェック後：アプリ更新があるが、cid がない（手動ダウンロードが必要） */}
                {updateInfo?.hasUpdate && updateInfo.updateType === 'app' && !updateInfo.cid && (
                  <span className="text-xs text-yellow-600 dark:text-yellow-400 text-right max-w-[160px]">
                    {t('update.manualUpdate')}
                  </span>
                )}
                {/* After check: already latest / チェック後：既に最新 */}
                {updateInfo && !updateInfo.hasUpdate && (
                  <ActionButton onClick={handleCheckUpdate} disabled={checkingUpdate}>
                    {t('update.checkUpdate')}
                  </ActionButton>
                )}
                {/* After download: show in folder / ダウンロード後：フォルダに表示 */}
                {savedUpdatePath && (
                  <ActionButton onClick={() => showUpdateInFolder(savedUpdatePath)}>
                    {t('update.showInFolder')}
                  </ActionButton>
                )}
              </div>
            </SettingRow>
          </SettingSection>

          {/* ── Network Settings / ネットワーク設定 ── */}
          <SettingSection title={t('settings.ipfs.title')}>
            <SettingRow
              label={
                <span className="flex items-center">
                  {t('settings.ipfs.dhtMode')}
                  <DHTTooltip />
                </span>
              }
              description={
                !stats.isConnected
                  ? t('settings.ipfs.dhtModeDescWaiting')
                  : dhtMode === 'dhtserver'
                    ? t('settings.ipfs.dhtModeDesc')
                    : t('settings.ipfs.dhtModeDescClient')
              }
            >
              <div className="flex items-center space-x-2">
                {dhtLoading && <LoadingSpinner />}
                <select
                  value={dhtMode}
                  onChange={(e) => handleDHTModeChange(e.target.value as 'dhtserver' | 'dhtclient')}
                  disabled={dhtLoading || !canChangeDHT}
                  className="block w-40 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:border-blue-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="dhtclient">{t('settings.ipfs.dhtModeClient')}</option>
                  <option value="dhtserver">{t('settings.ipfs.dhtModeServer')}</option>
                </select>
              </div>
              {dhtError && <p className="text-xs text-red-500 mt-1">{dhtError}</p>}
            </SettingRow>
            {/* <SettingRow label={t('settings.ipfs.filecoinNetwork')} description={t('settings.ipfs.filecoinNetworkDesc')}>
              <select
                value={currentFilecoinNetwork}
                onChange={(e) => dispatch(setFilecoinNetwork(e.target.value))}
                className="block w-48 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:border-blue-500 focus:outline-none"
              >
                {FILECOIN_NETWORKS.map((n) => (
                  <option key={n.name} value={n.name}>{n.name}{n.isTestnet ? ` ${t('settings.security.testnet')}` : ''}</option>
                ))}
              </select>
            </SettingRow> */}
          </SettingSection>

          {/* ── Creator Management / クリエイター管理 ── */}
          <SettingSection title={t('settings.creator.title')}>
            <SettingRow
              label={t('settings.creator.status')}
              description={hasCreatorIPNS ? `${t('settings.creator.statusSet')} (${creatorIPNS?.title || t('common.unnamed')})` : t('settings.creator.statusNotSet')}
            >
              <StatusBadge active={hasCreatorIPNS} />
            </SettingRow>
            <SettingRow label={t('settings.creator.exportKey')} description={t('settings.creator.exportKeyDesc')}>
              <ActionButton onClick={handleExportKey} disabled={!hasCreatorIPNS}>
                {t('common.export')}
              </ActionButton>
            </SettingRow>
            <SettingRow
              label={t('settings.creator.importKey')}
              description={isElectron() ? t('settings.creator.importKeyDescElectron') : t('settings.creator.importKeyDescWeb')}
            >
              <ActionButton onClick={handleImportKey}>
                {t('common.import')}
              </ActionButton>
            </SettingRow>
          </SettingSection>

          {/* ── Security Settings / セキュリティ設定 ── */}
          <SettingSection title={t('settings.security.title')}>
            <SettingRow label={t('settings.security.changePassword')} description={t('settings.security.changePasswordDesc')}>
              <ActionButton onClick={() => setShowChangeGesture(true)}>
                {t('settings.security.modify')}
              </ActionButton>
            </SettingRow>
          </SettingSection>

          {/* ── Data Management / データ管理 ── */}
          <SettingSection title={t('settings.dataManagement.title')}>
            <SettingRow label={t('settings.dataManagement.exportData')} description={t('settings.dataManagement.exportDataDesc')}>
              <ActionButton onClick={handleExportData}>{t('common.export')}</ActionButton>
            </SettingRow>
            <SettingRow label={t('settings.dataManagement.importData')} description={t('settings.dataManagement.importDataDesc')}>
              <ActionButton onClick={handleImportData}>{t('common.import')}</ActionButton>
            </SettingRow>
            <SettingRow label={t('settings.dataManagement.deleteData')} description={t('settings.dataManagement.deleteDataDesc')}>
              <ActionButton onClick={handleDeleteData} danger>{t('common.delete')}</ActionButton>
            </SettingRow>
          </SettingSection>

          {/* ── Privacy / プライバシー ── */}
          <SettingSection title={t('settings.privacy.title')}>
            <SettingRow label={t('settings.privacy.saveHistory')} description={t('settings.privacy.saveHistoryDesc')}>
              <Toggle value={true} onChange={() => {}} />
            </SettingRow>
            <SettingRow label={t('settings.privacy.saveSearchHistory')} description={t('settings.privacy.saveSearchHistoryDesc')}>
              <Toggle value={saveSearchHistoryEnabled} onChange={handleSaveSearchHistoryChange} />
            </SettingRow>
          </SettingSection>
        </div>
      </div>
    </>
  )
}

// ─── Small reusable sub-components ───────────────────────────────────────────
const SettingSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="bg-white dark:bg-rp-gray-800 rounded-lg border border-gray-200 dark:border-rp-gray-700 overflow-hidden">
    <div className="px-6 py-4 border-b border-gray-200 dark:border-rp-gray-700">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>
    </div>
    <div className="divide-y divide-gray-200 dark:divide-rp-gray-700">{children}</div>
  </div>
)

const SettingRow: React.FC<{
  label: React.ReactNode
  description?: string
  children?: React.ReactNode
}> = ({ label, description, children }) => (
  <div className="px-6 py-4 flex items-center justify-between">
    <div className="flex-1 mr-4">
      <div className="text-sm font-medium text-gray-900 dark:text-white flex items-center">{label}</div>
      {description && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{description}</p>}
    </div>
    <div className="flex-shrink-0">{children}</div>
  </div>
)

const Toggle: React.FC<{ value: boolean; onChange: () => void }> = ({ value, onChange }) => (
  <button
    onClick={onChange}
    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${value ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-600'}`}
  >
    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${value ? 'translate-x-6' : 'translate-x-1'}`} />
  </button>
)

const StatusBadge: React.FC<{ active: boolean }> = ({ active }) => {
  const { t } = useTranslation()
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${active ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'}`}>
      {active ? t('settings.status.set') : t('settings.status.notSet')}
    </span>
  )
}

const ActionButton: React.FC<{
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  children: React.ReactNode
}> = ({ onClick, disabled, danger, children }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`px-4 py-2 text-sm rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
      danger
        ? 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50'
        : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
    }`}
  >
    {children}
  </button>
)

export default Settings
