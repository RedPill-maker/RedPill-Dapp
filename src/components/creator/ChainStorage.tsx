/**
 * ChainStorage - On-chain storage management component
 *
 * Features:
 * 1. Query all user CIDs' Filecoin storage status
 * 2. Display FilecoinPay contract balance and deposit entry
 * 3. Batch select unstored CIDs for storage transactions
 * 4. Subscribe to fileStoreMgr singleton for cross-page progress tracking
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppDispatch } from '../../hooks/redux'
import { fetchUnstoredCount } from '../../store/slices/chainStorageSlice'
import { IPFS_CONFIG, FILECOIN_STORAGE_PRICING, getKnownTokens, ITEM_TYPE } from '../../../config'
import { privateDataMgr, CreatorInfo } from '../../utils/privateDataMgr'
import {
  fileStoreMgr,
  StorageProgressInfo,
  StorageProgressState,
  OnchainVerifyResult,
} from '../../utils/fileStoreMgr'
import { getWorksByCreator, getCreatorByWallet, Work } from '../../utils/dbConnector'
import WalletSelectorModal, {
  PaymentConfig,
  TransactionResult,
} from '../../global_modal/WalletSelectorModal'
import PasswordInput from '../PasswordInput'
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationCircleIcon,
  BanknotesIcon,
  CloudArrowUpIcon,
  LockClosedIcon,
  CurrencyDollarIcon,
  MagnifyingGlassIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'

// ==================== Type Definitions ====================

export type CidStorageStatus = 'stored' | 'pending' | 'overdue' | 'unstored'

export interface CidItem {
  cid: string
  source: string
  isImage: boolean
  status: CidStorageStatus
  pieceCid?: string
  retrievalUrl?: string
  fileType?: string
  providerName?: string
  providerServiceURL?: string
}

interface ChainStorageProps {
  creatorInfo: CreatorInfo
  unstoredCount: number
  onUnstoredCountChange: (count: number) => void
}

const PAGE_SIZE = 10

// ==================== Helpers ====================

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

// ==================== Component ====================

const ChainStorage: React.FC<ChainStorageProps> = ({
  creatorInfo,
  unstoredCount,
  onUnstoredCountChange,
}) => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const [filecoinPayEnabled, setFilecoinPayEnabled] = useState(creatorInfo.filecoinPayEnabled || false)

  // Unlocked = Synapse instance cached for this wallet
  const walletAddress = creatorInfo.walletAddress || ''
  const [unlocked, setUnlocked] = useState(() => fileStoreMgr.hasSynapse(walletAddress))
  const [showPasswordInput, setShowPasswordInput] = useState(false)
  const [unlockLoading, setUnlockLoading] = useState(false)
  const [unlockError, setUnlockError] = useState<string | null>(null)

  // Balance
  const [contractBalance, setContractBalance] = useState<string | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(false)

  // CID list
  const [cidItems, setCidItems] = useState<CidItem[]>([])
  const [cidLoading, setCidLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)

  // Selection
  const [selectedCids, setSelectedCids] = useState<Set<string>>(new Set())

  // Store transaction
  const [showStoreWallet, setShowStoreWallet] = useState(false)
  const [storing, setStoring] = useState(false)

  // Progress from singleton (survives page navigation)
  const [storeProgress, setStoreProgress] = useState<StorageProgressInfo | null>(null)
  const [uploadSpeed, setUploadSpeed] = useState<number>(0)
  const [cidProgressMap, setCidProgressMap] = useState<Map<string, StorageProgressInfo>>(new Map())
  const speedRef = useRef<{ lastBytes: number; lastTime: number }>({ lastBytes: 0, lastTime: 0 })

  // Deposit
  const [showDepositWallet, setShowDepositWallet] = useState(false)

  // On-chain verification
  const [verifying, setVerifying] = useState(false)
  const [verifyProgress, setVerifyProgress] = useState<{ checked: number; total: number } | null>(null)
  const [showVerifyPassword, setShowVerifyPassword] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)

  // ==================== Subscribe to singleton progress ====================
  // (ref and subscription defined after loadCidList — see below)

  // ==================== File type helper ====================

  const getFileTypeLabel = (isImage: boolean, source: string): string => {
    if (isImage) return ITEM_TYPE[0].label
    if (source.includes(t('chainStorage.workContent'))) return ITEM_TYPE[4].label
    return ITEM_TYPE[4].label
  }

  // ==================== Data Loading ====================

  const collectUserCids = useCallback(async (): Promise<CidItem[]> => {
    const items: CidItem[] = []
    const addedCids = new Set<string>()

    const addCid = (cid: string, source: string, isImage: boolean) => {
      if (cid && !addedCids.has(cid)) {
        addedCids.add(cid)
        items.push({ cid, source, isImage, status: 'unstored', fileType: getFileTypeLabel(isImage, source) })
      }
    }

    if (creatorInfo.avatarCid) addCid(creatorInfo.avatarCid, t('chainStorage.userAvatar'), true)
    if (creatorInfo.backgroundCid) addCid(creatorInfo.backgroundCid, t('chainStorage.pageBackground'), true)

    if (walletAddress) {
      const onchainCreator = await getCreatorByWallet(walletAddress)
      if (onchainCreator) {
        if (onchainCreator.avatar_cid) addCid(onchainCreator.avatar_cid, t('chainStorage.userAvatar'), true)
        if (onchainCreator.background_cid) addCid(onchainCreator.background_cid, t('chainStorage.pageBackground'), true)
      }
    }

    if (creatorInfo.username) {
      let page = 1
      let hasMore = true
      while (hasMore) {
        const works: Work[] = await getWorksByCreator(creatorInfo.username, page, 100)
        if (works.length === 0) { hasMore = false; break }
        for (const work of works) {
          addCid(work.cid, `${t('chainStorage.workContent')}「${work.title}」`, false)
          if (work.img_cid) addCid(work.img_cid, `${t('chainStorage.workThumbnail')}「${work.title}」`, true)
        }
        if (works.length < 100) hasMore = false
        else page++
      }
    }

    return items
  }, [creatorInfo, walletAddress])

  const applyStorageStatus = useCallback((items: CidItem[]): CidItem[] => {
    const username = creatorInfo.username
    const storedCids = username ? privateDataMgr.getStoredCids(username) : {}
    return items.map(item => {
      const entry = storedCids[item.cid]
      return {
        ...item,
        status: (entry ? 'stored' : 'unstored') as CidStorageStatus,
        retrievalUrl: entry?.retrievalUrl,
        providerName: entry?.providerName,
        providerServiceURL: entry?.providerServiceURL,
      }
    })
  }, [creatorInfo.username])

  const loadCidList = useCallback(async () => {
    setCidLoading(true)
    try {
      const items = await collectUserCids()
      const withStatus = applyStorageStatus(items)
      withStatus.sort((a, b) => {
        const order: Record<CidStorageStatus, number> = { unstored: 0, overdue: 1, pending: 2, stored: 3 }
        return order[a.status] - order[b.status]
      })
      setCidItems(withStatus)
      onUnstoredCountChange(withStatus.filter(i => i.status === 'unstored').length)
    } catch (err) {
      console.error('Failed to load CID list:', err)
    } finally {
      setCidLoading(false)
    }
  }, [collectUserCids, applyStorageStatus, onUnstoredCountChange])

  // Load balance using cached Synapse (no password needed if already unlocked)
  const loadContractBalance = useCallback(async (address: string, password: string) => {
    setBalanceLoading(true)
    try {
      const result = await fileStoreMgr.getPaymentBalance(address, password)
      if (result.success) {
        const balance = result.balance || '0'
        setContractBalance(balance)
        if (parseFloat(balance) > 0) {
          privateDataMgr.setFilecoinPayEnabled(true)
          setFilecoinPayEnabled(true)
        }
      }
    } catch (err) {
      console.error('Failed to load contract balance:', err)
    } finally {
      setBalanceLoading(false)
    }
  }, [])

  // Initial load
  useEffect(() => {
    loadCidList()
  }, [loadCidList])

  // Subscribe to singleton progress (must be after loadCidList definition)
  const loadCidListRef = useRef(loadCidList)
  useEffect(() => { loadCidListRef.current = loadCidList }, [loadCidList])

  useEffect(() => {
    const listener = (state: StorageProgressState) => {
      setCidProgressMap(state.cidProgress)
      setStoreProgress(state.summary)

      if (state.summary?.phase === 'uploading' && state.summary.bytesUploaded != null) {
        const now = state.summary.timestamp || Date.now()
        const { lastBytes, lastTime } = speedRef.current
        if (lastTime > 0 && now > lastTime) {
          const dt = (now - lastTime) / 1000
          const db = state.summary.bytesUploaded - lastBytes
          if (dt > 0 && db >= 0) setUploadSpeed(db / dt)
        }
        speedRef.current = { lastBytes: state.summary.bytesUploaded, lastTime: now }
      }

      // When all uploads finish and progress is cleared, refresh list
      if (!state.isUploading && !state.summary) {
        loadCidListRef.current()
      }
    }
    fileStoreMgr.subscribe(listener)
    return () => { fileStoreMgr.unsubscribe(listener) }
  }, [])

  // If Synapse is already cached on mount, auto-load balance
  useEffect(() => {
    if (unlocked && walletAddress) {
      // Password is empty string since Synapse is already cached — getOrCreateSynapse will reuse it
      loadContractBalance(walletAddress, '')
    }
  }, [unlocked, walletAddress, loadContractBalance])

  // ==================== Unlock via PasswordInput ====================

  const handleUnlock = async (password: string) => {
    if (!walletAddress) {
      setUnlockError(t('chainStorage.walletNotFound'))
      return
    }

    setUnlockLoading(true)
    setUnlockError(null)

    // Initialize Synapse instance (caches it in singleton)
    const ok = await fileStoreMgr.initSynapse(walletAddress, password)
    if (!ok) {
      setUnlockError(t('walletSelector.passwordError'))
      setUnlockLoading(false)
      return
    }

    setUnlocked(true)
    setShowPasswordInput(false)

    // Load balance and refresh list
    await Promise.all([
      loadContractBalance(walletAddress, password),
      loadCidList(),
    ])

    setUnlockLoading(false)
  }

  const handleRefreshBalance = async () => {
    if (unlocked && walletAddress) {
      await loadContractBalance(walletAddress, '')
    }
  }

  // ==================== Pagination ====================

  const totalPages = Math.max(1, Math.ceil(cidItems.length / PAGE_SIZE))
  const pagedItems = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return cidItems.slice(start, start + PAGE_SIZE)
  }, [cidItems, currentPage])

  // ==================== Selection ====================

  const unstoredItems = useMemo(
    () => cidItems.filter(i => i.status === 'unstored' || i.status === 'overdue'),
    [cidItems],
  )

  const toggleSelect = (cid: string) => {
    setSelectedCids(prev => {
      const next = new Set(prev)
      if (next.has(cid)) next.delete(cid)
      else next.add(cid)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedCids.size === unstoredItems.length) {
      setSelectedCids(new Set())
    } else {
      setSelectedCids(new Set(unstoredItems.map(i => i.cid)))
    }
  }

  // ==================== Store Transaction ====================

  const knownTokens = getKnownTokens()

  const storePaymentConfig: PaymentConfig = {
    type: 'gas-only',
    token: knownTokens[0].address,
    tokenSymbol: knownTokens[0].symbol,
    description: `${t('chainStorage.storeFilesDesc', { count: selectedCids.size })}`,
  }

  const handleStoreConfirm = async (
    address: string,
    password: string,
  ): Promise<TransactionResult> => {
    try {
      setStoring(true)
      speedRef.current = { lastBytes: 0, lastTime: 0 }
      const cidsToStore = Array.from(selectedCids)

      // Ensure Synapse is initialized (may already be cached)
      if (!fileStoreMgr.hasSynapse(address)) {
        await fileStoreMgr.initSynapse(address, password)
      }

      const results = await fileStoreMgr.storeContent(cidsToStore, address, password)
      const resultArray = Array.isArray(results) ? results : [results]
      const successCount = resultArray.filter(r => r.success).length

      // Save successful mappings locally
      if (creatorInfo.username) {
        for (const r of resultArray) {
          if (r.success && r.pieceCid) {
            privateDataMgr.addStoredCid(creatorInfo.username, r.cid, r.pieceCid, undefined, r.dataSetId, r.providerName, r.providerServiceURL)
          }
        }
        dispatch(fetchUnstoredCount())
      }

      if (successCount > 0) {
        setSelectedCids(new Set())
        await loadCidList()
        if (unlocked) {
          await loadContractBalance(walletAddress, password)
        }
      }

      return {
        success: successCount > 0,
        error: successCount === 0 ? t('chainStorage.allStoreFailed') : undefined,
      }
    } catch (err: any) {
      return { success: false, error: err.message || t('chainStorage.storeFailed') }
    } finally {
      setStoring(false)
    }
  }

  // ==================== Deposit ====================

  const depositPaymentConfig: PaymentConfig = {
    type: 'range',
    minAmount: FILECOIN_STORAGE_PRICING.MIN_DEPOSIT_USDFC,
    maxAmount: '999999',
    token: knownTokens.find(tk => tk.symbol === 'USDFC')?.address || knownTokens[0].address,
    tokenSymbol: 'USDFC',
    description: t('chainStorage.depositDesc'),
  }

  const handleDepositConfirm = async (
    address: string,
    password: string,
    amount?: string,
  ): Promise<TransactionResult> => {
    if (!amount || parseFloat(amount) <= 0) {
      return { success: false, error: t('chainStorage.invalidDepositAmount') }
    }
    // Ensure Synapse is initialized
    if (!fileStoreMgr.hasSynapse(address)) {
      await fileStoreMgr.initSynapse(address, password)
      setUnlocked(true)
    }
    const result = await fileStoreMgr.depositUSDFC(address, password, amount)
    if (result.success) {
      privateDataMgr.setFilecoinPayEnabled(true)
      setFilecoinPayEnabled(true)
      await loadContractBalance(walletAddress, password)
    }
    return { success: result.success, txHash: result.txHash, error: result.error }
  }

  // ==================== On-chain Verification ====================

  const runVerify = async (address: string, password: string) => {
    if (!address) return

    setVerifying(true)
    setVerifyProgress(null)

    try {
      const username = creatorInfo.username
      if (!username) return

      const storedCids = privateDataMgr.getStoredCids(username)
      const entries = Object.values(storedCids).map(e => ({ pieceCid: e.pieceCid, dataSetId: e.dataSetId }))

      const result = await fileStoreMgr.verifyOnchainStorage(
        address,
        password,
        entries,
        (checked, total) => setVerifyProgress({ checked, total }),
      )

      if (!result.success) return

      const verifyResults = result.results || []
      const pieceStatusMap = new Map<string, OnchainVerifyResult>(
        verifyResults.map(r => [r.pieceCid, r])
      )

      setCidItems(prev => prev.map(item => {
        const entry = storedCids[item.cid]
        if (!entry) return item
        const pieceCid = entry.pieceCid
        const vr = pieceStatusMap.get(pieceCid)
        if (!vr) return item
        if (vr.retrievalUrl && vr.retrievalUrl !== entry.retrievalUrl) {
          privateDataMgr.updateStoredCidRetrievalUrl(username, item.cid, vr.retrievalUrl)
        }
        let newStatus: CidStorageStatus
        switch (vr.status) {
          case 'verified': newStatus = 'stored'; break
          case 'pending':  newStatus = 'pending'; break
          case 'overdue':  newStatus = 'overdue'; break
          default:         newStatus = 'unstored'
        }
        return { ...item, status: newStatus, pieceCid, retrievalUrl: vr.retrievalUrl }
      }))

      dispatch(fetchUnstoredCount())
    } catch (err: any) {
      console.error('Verification failed:', err)
    } finally {
      setVerifying(false)
      setVerifyProgress(null)
    }
  }

  const handleVerifyPassword = async (password: string) => {
    if (!walletAddress) return

    // Ensure Synapse is initialized
    if (!fileStoreMgr.hasSynapse(walletAddress)) {
      const ok = await fileStoreMgr.initSynapse(walletAddress, password)
      if (!ok) {
        setVerifyError(t('walletSelector.passwordError'))
        return
      }
      setUnlocked(true)
    }
    setShowVerifyPassword(false)
    await runVerify(walletAddress, password)
  }

  const handleVerifyClick = () => {
    if (verifying) return
    if (fileStoreMgr.hasSynapse(walletAddress)) {
      runVerify(walletAddress, '')
    } else {
      setVerifyError(null)
      setShowVerifyPassword(true)
    }
  }

  // ==================== Status Icons ====================

  const StatusIcon: React.FC<{ status: CidStorageStatus }> = ({ status }) => {
    switch (status) {
      case 'stored':
        return <CheckCircleIcon className="w-5 h-5 text-green-500" />
      case 'pending':
        return <ClockIcon className="w-5 h-5 text-yellow-500" />
      case 'overdue':
        return <ExclamationTriangleIcon className="w-5 h-5 text-orange-500" />
      case 'unstored':
        return <ExclamationCircleIcon className="w-5 h-5 text-red-400" />
    }
  }

  const statusLabel: Record<CidStorageStatus, string> = {
    stored: t('chainStorage.stored'),
    pending: t('chainStorage.storing'),
    overdue: t('chainStorage.overdue'),
    unstored: t('chainStorage.unstored'),
  }

  // ==================== Render ====================

  return (
    <div className="space-y-6">
      {/* FilecoinPay not enabled — onboarding UI */}
      {!filecoinPayEnabled ? (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-6">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-blue-100 dark:bg-blue-800 rounded-full">
              <CurrencyDollarIcon className="w-8 h-8 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                {t('chainStorage.enableFilecoinPay')}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                {t('chainStorage.enableFilecoinPayDesc')}
                <a
                  href="https://docs.filecoin.cloud/cookbooks/payments-and-storage/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {t('chainStorage.pricingLink')}
                </a>
              </p>

              {unlocked && contractBalance !== null && (
                <div className="flex items-center gap-2 mb-4">
                  <BanknotesIcon className="w-5 h-5 text-blue-500" />
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{t('chainStorage.contractBalance')}</p>
                    <p className="text-lg font-semibold text-gray-900 dark:text-white">
                      {parseFloat(contractBalance).toFixed(4)} USDFC
                    </p>
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setShowDepositWallet(true)}
                  className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
                >
                  <BanknotesIcon className="w-5 h-5" />
                  {t('chainStorage.depositToEnable')}
                </button>
                <button
                  onClick={() => setShowPasswordInput(true)}
                  disabled={unlockLoading || unlocked}
                  className="px-6 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors flex items-center gap-2 disabled:opacity-50"
                >
                  <LockClosedIcon className="w-4 h-4" />
                  {unlockLoading ? t('chainStorage.querying') : t('chainStorage.queryBalance')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* FilecoinPay balance area */
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <BanknotesIcon className="w-6 h-6 text-blue-500" />
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">{t('chainStorage.contractBalance')}</p>
                {unlocked ? (
                  <p className="text-xl font-semibold text-gray-900 dark:text-white">
                    {balanceLoading ? '...' : contractBalance !== null ? `${parseFloat(contractBalance).toFixed(4)} USDFC` : '--'}
                  </p>
                ) : (
                  <p className="text-sm text-gray-400 dark:text-gray-500">{t('chainStorage.needUnlock')}</p>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              {unlocked ? (
                <>
                  <button
                    onClick={handleRefreshBalance}
                    className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    title={t('chainStorage.refreshBalance')}
                  >
                    <ArrowPathIcon className={`w-5 h-5 ${balanceLoading ? 'animate-spin' : ''}`} />
                  </button>
                  <button
                    onClick={() => setShowDepositWallet(true)}
                    className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    {t('chainStorage.recharge')}
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setShowPasswordInput(true)}
                  disabled={unlockLoading}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  <LockClosedIcon className="w-4 h-4" />
                  {unlockLoading ? t('chainStorage.unlocking') : t('chainStorage.unlockToView')}
                </button>
              )}
            </div>
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
            <p>Filecoin {t('chainStorage.prepaidMechanism')}</p>
            <p>{t('chainStorage.minDeposit', { amount: FILECOIN_STORAGE_PRICING.MIN_DEPOSIT_USDFC })} {t('chainStorage.refPrice', { price: FILECOIN_STORAGE_PRICING.PRICE_PER_TIB_PER_MONTH_USDFC })}</p>
          </div>
        </div>
      )}

      {/* Action bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-600 dark:text-gray-400">
            <input
              type="checkbox"
              checked={unstoredItems.length > 0 && selectedCids.size === unstoredItems.length}
              onChange={toggleSelectAll}
              disabled={unstoredItems.length === 0 || !filecoinPayEnabled}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            {t('chainStorage.selectAllUnstored')} ({unstoredItems.length})
          </label>
          <button
            onClick={loadCidList}
            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            title={t('chainStorage.refreshList')}
          >
            <ArrowPathIcon className={`w-4 h-4 ${cidLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {filecoinPayEnabled && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleVerifyClick}
              disabled={verifying || storing}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <MagnifyingGlassIcon className="w-4 h-4" />
              {verifying
                ? verifyProgress
                  ? `${t('chainStorage.verifying')} ${verifyProgress.checked}/${verifyProgress.total}`
                  : t('chainStorage.verifyFetching')
                : t('chainStorage.verifyOnchain')}
            </button>
            <button
              onClick={() => setShowStoreWallet(true)}
              disabled={selectedCids.size === 0 || storing}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                selectedCids.size > 0
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
              }`}
            >
              <CloudArrowUpIcon className="w-4 h-4" />
              {t('chainStorage.storeOnchain')} {selectedCids.size > 0 && `(${selectedCids.size})`}
            </button>
          </div>
        )}
      </div>

      {/* Upload progress (from singleton — persists across page navigation) */}
      {storeProgress && (() => {
        const uploaded = storeProgress.bytesUploaded ?? 0
        const total = storeProgress.totalBytes ?? 0
        const pct = total > 0 ? Math.min(100, (uploaded / total) * 100) : 0
        const isUploading = storeProgress.phase === 'uploading'
        return (
          <div className="relative overflow-hidden bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-3">
            {isUploading && total > 0 && (
              <div
                className="absolute inset-0 bg-blue-200/40 dark:bg-blue-700/30 transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            )}
            <div className="relative flex items-center gap-2 text-sm text-blue-700 dark:text-blue-300">
              <ArrowPathIcon className="w-4 h-4 animate-spin flex-shrink-0" />
              <span className="flex-1 min-w-0">
                {storeProgress.phase === 'fetching' && t('chainStorage.fetchingFromIpfs')}
                {isUploading && (
                  <>
                    {t('chainStorage.uploadingToFilecoin')}
                    {total > 0
                      ? ` ${formatBytes(uploaded)} / ${formatBytes(total)}`
                      : uploaded > 0 ? ` ${formatBytes(uploaded)}` : ''}
                    {uploadSpeed > 0 && (
                      <span className="ml-2 text-blue-500 dark:text-blue-400 text-xs">
                        {formatBytes(uploadSpeed)}/s
                      </span>
                    )}
                  </>
                )}
                {storeProgress.phase === 'done' && t('chainStorage.uploadComplete')}
                {storeProgress.phase === 'error' && `${t('chainStorage.uploadFailed')} ${storeProgress.error}`}
              </span>
              <span className="text-xs text-blue-500 dark:text-blue-400 flex-shrink-0">
                {isUploading && total > 0 && `${pct.toFixed(0)}%  `}
                {storeProgress.completedFiles}/{storeProgress.totalFiles}
              </span>
            </div>
          </div>
        )
      })()}

      {/* CID list */}
      {cidLoading ? (
        <div className="text-center py-12 text-gray-400">
          <ArrowPathIcon className="w-8 h-8 animate-spin mx-auto mb-2" />
          <p className="text-sm">{t('chainStorage.loadingCidData')}</p>
        </div>
      ) : cidItems.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-sm">{t('chainStorage.noCidData')}</p>
        </div>
      ) : (
        <>
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <div className="grid grid-cols-[40px_1fr_160px_60px_100px_80px] gap-2 px-4 py-2.5 bg-gray-100 dark:bg-gray-700 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
              <div></div>
              <div>{t('chainStorage.cid')}</div>
              <div>{t('chainStorage.source')}</div>
              <div>{t('chainStorage.thumbnail')}</div>
              <div>{t('chainStorage.provider')}</div>
              <div>{t('chainStorage.status')}</div>
            </div>
            {pagedItems.map(item => (
              <div
                key={item.cid}
                className="grid grid-cols-[40px_1fr_160px_60px_100px_80px] gap-2 px-4 py-2.5 border-t border-gray-100 dark:border-gray-700/50 items-center hover:bg-gray-50 dark:hover:bg-gray-800/50"
              >
                <div>
                  {(item.status === 'unstored' || item.status === 'overdue') && filecoinPayEnabled ? (
                    <input
                      type="checkbox"
                      checked={selectedCids.has(item.cid)}
                      onChange={() => toggleSelect(item.cid)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                  ) : (
                    <div className="w-4 h-4" />
                  )}
                </div>
                <div className="text-xs font-mono text-gray-700 dark:text-gray-300 truncate" title={item.cid}>
                  {item.cid}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate" title={item.source}>
                  {item.source}
                </div>
                <div className="flex items-center justify-center">
                  {item.isImage ? (
                    <img
                      src={`${IPFS_CONFIG.GATEWAY_URL}/ipfs/${item.cid}`}
                      alt=""
                      className="w-9 h-9 rounded object-cover bg-gray-200 dark:bg-gray-600"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                    />
                  ) : (
                    <div className="w-9 h-9 rounded bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-400 text-xs">
                      --
                    </div>
                  )}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate min-w-0">
                  {item.providerName ? (
                    item.providerServiceURL ? (
                      <a
                        href={`${item.providerServiceURL}/piece/${item.pieceCid || ''}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                        title={`${item.providerName} — ${t('chainStorage.viewOnSP')}`}
                      >
                        {item.providerName}
                      </a>
                    ) : (
                      <span title={item.providerName}>{item.providerName}</span>
                    )
                  ) : (
                    <span className="text-gray-300 dark:text-gray-600">--</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 min-w-0">
                  {(() => {
                    const cidProg = cidProgressMap.get(item.cid)
                    if (cidProg && (cidProg.phase === 'fetching' || cidProg.phase === 'uploading')) {
                      const uploaded = cidProg.bytesUploaded ?? 0
                      const total = cidProg.totalBytes ?? 0
                      const pct = total > 0 ? Math.min(100, (uploaded / total) * 100) : null
                      return (
                        <div className="flex flex-col gap-0.5 w-full">
                          <div className="flex items-center gap-1">
                            <ArrowPathIcon className="w-3.5 h-3.5 text-blue-500 animate-spin flex-shrink-0" />
                            <span className="text-xs text-blue-500 dark:text-blue-400 truncate">
                              {cidProg.phase === 'fetching' ? t('common.loading') : (
                                pct !== null ? `${pct.toFixed(0)}%` : formatBytes(uploaded)
                              )}
                            </span>
                          </div>
                          {cidProg.phase === 'uploading' && uploadSpeed > 0 && (
                            <span className="text-xs text-blue-400 dark:text-blue-500 truncate">
                              {formatBytes(uploadSpeed)}/s
                            </span>
                          )}
                        </div>
                      )
                    }
                    return (
                      <>
                        <StatusIcon status={item.status} />
                        {item.status === 'stored' ? (() => {
                          const url = item.retrievalUrl || `${IPFS_CONFIG.GATEWAY_URL}/ipfs/${item.cid}`
                          return (
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-green-600 dark:text-green-400 hover:underline cursor-pointer"
                              title={item.retrievalUrl ? t('chainStorage.viewOnSP') : t('chainStorage.viewOnGateway')}
                            >
                              {statusLabel[item.status]}
                            </a>
                          )
                        })() : (
                          <span className={`text-xs ${
                            item.status === 'pending' ? 'text-yellow-600 dark:text-yellow-400' :
                            item.status === 'overdue' ? 'text-orange-500 dark:text-orange-400' :
                            'text-red-500 dark:text-red-400'
                          }`}>
                            {statusLabel[item.status]}
                          </span>
                        )}
                      </>
                    )
                  })()}
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40"
              >
                {t('common.prevPage')}
              </button>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {currentPage} / {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40"
              >
                {t('common.nextPage')}
              </button>
            </div>
          )}
        </>
      )}

      {/* Unlock password modal (initializes Synapse instance) */}
      <PasswordInput
        isOpen={showPasswordInput}
        onClose={() => { setShowPasswordInput(false); setUnlockError(null) }}
        onConfirm={handleUnlock}
        title={t('chainStorage.unlockWallet')}
        description={t('chainStorage.unlockDesc')}
        confirmText={t('chainStorage.unlock')}
        isLoading={unlockLoading}
        error={unlockError}
        walletAddress={walletAddress}
      />

      {/* Store wallet modal */}
      <WalletSelectorModal
        isOpen={showStoreWallet}
        onClose={() => setShowStoreWallet(false)}
        paymentConfig={storePaymentConfig}
        onConfirm={handleStoreConfirm}
        highlightAddress={walletAddress}
        allowedAddresses={walletAddress ? [walletAddress] : []}
        allowBackground
        onBackgroundStart={() => {/* progress stays visible via singleton */}}
      />

      {/* Deposit wallet modal */}
      <WalletSelectorModal
        isOpen={showDepositWallet}
        onClose={() => setShowDepositWallet(false)}
        paymentConfig={depositPaymentConfig}
        onConfirm={handleDepositConfirm}
        highlightAddress={walletAddress}
        allowedAddresses={walletAddress ? [walletAddress] : []}
      />

      {/* Verify on-chain status password modal */}
      <PasswordInput
        isOpen={showVerifyPassword}
        onClose={() => { setShowVerifyPassword(false); setVerifyError(null) }}
        onConfirm={handleVerifyPassword}
        title={t('chainStorage.verifyOnchain')}
        description={t('chainStorage.verifyDesc')}
        confirmText={t('chainStorage.verifyOnchain')}
        isLoading={verifying}
        error={verifyError}
        walletAddress={walletAddress}
      />
    </div>
  )
}

export default ChainStorage
