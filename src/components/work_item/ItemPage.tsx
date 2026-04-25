import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppSelector, useAppDispatch } from '../../hooks/redux'
import { goBack } from '../../store/slices/pageSlice'
import { SidebarState } from '../../store/slices/sidebarSlice'
import { ipfsConnector } from '../../utils/ipfsConnector'
import { privateDataMgr } from '../../utils/privateDataMgr'
import { creatorHubMgr } from '../../utils/creatorHubMgr'
import { rpcConnectorInstance, getCreatorHubAddress } from '../../utils/rpcConnector'
import { ethers } from 'ethers'
import {
  getWorkByCid, getWorkTipStats, getTipsByWork, getCreatorByUsername, getCreatorByWallet, getRepliesByTip,
  getWorksByCreator, WorkDetail, WorkTipStat, TipRecord, Creator, Work,
} from '../../utils/dbConnector'
import { getKnownTokens, APP_CONFIG } from '../../../config'
import CreatorHubABI from '../../../contract_info/CreatorHub_abi.json'
import WalletSelectorModal, { PaymentConfig, TransactionResult, GasEstimateCallback } from '../../global_modal/WalletSelectorModal'
import { notify } from '../../global_modal/ToastNotification'
import { useBlacklist } from '../../hooks/useBlacklist'
import {
  XCircleIcon, DocumentIcon, FilmIcon, MusicalNoteIcon, DocumentTextIcon,
  ArrowDownTrayIcon, ArrowLeftIcon, ShareIcon, ChevronRightIcon,
  ClipboardDocumentIcon, FaceSmileIcon, NoSymbolIcon, ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'
import { StarIcon as StarIconSolid, HeartIcon as HeartIconSolid } from '@heroicons/react/24/solid'
import { StarIcon } from '@heroicons/react/24/outline'
import LoadingSpinner from '../LoadingSpinner'
import MarkdownRenderer from '../MarkdownRenderer'
import BoringAvatar from '../BoringAvatar'
import VideoPlayer from './VideoPlayer'
import AudioPlayer from './AudioPlayer'
import ItemCard, { ItemCardData } from './ItemCard'
import SidebarAds from '../ads/SidebarAds'
import { adsMgr } from '../../utils/adsMgr'

const MAX_COMMENT_LENGTH = 128
// Reply prefix: @rp:<64-char-txhash>| = 4 + 64 + 1 = 69 chars (using full tx_hash without 0x prefix = 64 hex chars)
// tx_hash is stored as 0x + 64 hex = 66 chars total, so prefix = "@rp:" + 66 + "|" = 71 chars
const REPLY_PREFIX_LEN = 71
const MAX_REPLY_LENGTH = MAX_COMMENT_LENGTH - REPLY_PREFIX_LEN // 57 chars
const THEME_COLOR = `#${APP_CONFIG.THEME_COLOR}`
const SIDEBAR_PAGE_SIZE = 5
const EMOJI_LIST = ['😀','😂','🤣','😍','🥰','😎','🤩','🥳','👍','👏','🙌','💪','🔥','❤️','💯','🎉','✨','🌟','⭐','🏆','💎','🚀','🎵','🎶','👀','💬','💡','��','😊','🤗','😘','🫡']

interface ItemPageProps { item?: ItemCardData; itemCid?: string; onBack: () => void }

const getTokenSymbol = (addr: string): string => {
  const t = getKnownTokens().find((tk) => tk.address.toLowerCase() === addr.toLowerCase())
  return t?.symbol || addr.slice(0, 8) + '...'
}
const formatTipAmount = (wei: string): string => {
  try { const num = Number(BigInt(wei)) / 1e18; return num < 0.0001 ? '<0.0001' : num.toFixed(4) } catch { return '0' }
}
const formatRelativeTime = (ts: number, t: (key: string, opts?: any) => string): string => {
  const d = Date.now() / 1000 - ts
  if (d < 60) return t('itemPage.timeAgo.justNow')
  if (d < 3600) return t('itemPage.timeAgo.minutesAgo', { count: Math.floor(d / 60) })
  if (d < 86400) return t('itemPage.timeAgo.hoursAgo', { count: Math.floor(d / 3600) })
  if (d < 2592000) return t('itemPage.timeAgo.daysAgo', { count: Math.floor(d / 86400) })
  if (d < 31536000) return t('itemPage.timeAgo.monthsAgo', { count: Math.floor(d / 2592000) })
  return t('itemPage.timeAgo.yearsAgo', { count: Math.floor(d / 31536000) })
}
const workToCardData = (w: Work, name: string): ItemCardData => ({
  id: w.cid, title: w.title, desc: w.description || '', type: w.content_type,
  img_cid: w.img_cid || '', cid: w.cid, creator_name: name, published_at: w.created_at,
})

const ItemPage: React.FC<ItemPageProps> = ({ item, itemCid }) => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const sidebarState = useAppSelector((state) => state.sidebar) as SidebarState
  const { isOpen } = sidebarState
  const cid = item?.cid || itemCid || ''
  const [title, setTitle] = useState(item?.title || '')
  const [desc, setDesc] = useState(item?.desc || '')
  const [type, setType] = useState(item?.type ?? 0)
  const [imgCid, setImgCid] = useState(item?.img_cid || '')
  const [creatorName, setCreatorName] = useState(item?.creator_name || '')
  const [publishedAt, setPublishedAt] = useState(item?.published_at || '')
  const [sourceIpns, setSourceIpns] = useState(item?.source_ipns || '')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [isFavorited, setIsFavorited] = useState(() => item ? privateDataMgr.isFavorited(item.id) : false)
  const [dbWork, setDbWork] = useState<WorkDetail | null>(null)
  const [dbCreator, setDbCreator] = useState<Creator | null>(null)
  const [tipStats, setTipStats] = useState<WorkTipStat[]>([])
  const [tipRecords, setTipRecords] = useState<TipRecord[]>([])
  const [tipPage, setTipPage] = useState(0)
  const [tipHasMore, setTipHasMore] = useState(true)
  const [tipLoading, setTipLoading] = useState(false)
  const [tipperCreators, setTipperCreators] = useState<Record<string, Creator | null>>({})
  const [tipperAvatarErrors, setTipperAvatarErrors] = useState<Record<string, boolean>>({})
  const [replyingTo, setReplyingTo] = useState<TipRecord | null>(null)
  const [replyText, setReplyText] = useState('')
  const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({})
  const [repliesMap, setRepliesMap] = useState<Record<string, TipRecord[]>>({})
  const TIP_PAGE_SIZE = 10
  const [dbLoaded, setDbLoaded] = useState(false)
  const [showTipSetup, setShowTipSetup] = useState(false)
  const [showTipModal, setShowTipModal] = useState(false)
  const [selectedTipToken, setSelectedTipToken] = useState(getKnownTokens()[0])
  const [minTipAmount, setMinTipAmount] = useState('0.01')
  const [commentText, setCommentText] = useState('')
  const [commentSort, setCommentSort] = useState<string>('time')
  const [showTechInfo, setShowTechInfo] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const emojiPickerRef = useRef<HTMLDivElement>(null)
  const [isSubscribedState, setIsSubscribedState] = useState(false)
  const [creatorAvatarError, setCreatorAvatarError] = useState(false)
  const [creatorWorks, setCreatorWorks] = useState<ItemCardData[]>([])
  const [cwPage, setCwPage] = useState(1)
  const [cwHasMore, setCwHasMore] = useState(true)
  const [cwLoading, setCwLoading] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [creatorHasAdGroup, setCreatorHasAdGroup] = useState(false)
  const [creatorAdAddress, setCreatorAdAddress] = useState('')
  const { blockWork, blockCreator, unblockWork, unblockCreator, isWorkBlacklisted, isCreatorBlacklisted } = useBlacklist()
  const [isBlocked, setIsBlocked] = useState(() => isWorkBlacklisted(cid) || !!(item?.creator_name && isCreatorBlacklisted(item.creator_name)))
  const [blockedByCreator, setBlockedByCreator] = useState(() => !!(item?.creator_name && isCreatorBlacklisted(item.creator_name)))
  const [showBlockMenu, setShowBlockMenu] = useState(false)
  const blockMenuRef = useRef<HTMLDivElement>(null)

  // Effects
  useEffect(() => {
    if (item) privateDataMgr.addHistory({ id: item.id, title: item.title, desc: item.desc, type: item.type, img_cid: item.img_cid, cid: item.cid, source_ipns: item.source_ipns, creator_name: item.creator_name })
  }, [item])
  useEffect(() => { loadContent() }, [cid, type])
  useEffect(() => { if (cid) loadFromDb() }, [cid])
  useEffect(() => { creatorHubMgr.getMinTipAmount().then((a) => setMinTipAmount(a)).catch(() => {}) }, [])
  useEffect(() => {
    const h = (e: MouseEvent) => { if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) setShowEmojiPicker(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])
  useEffect(() => {
    if (creatorName || sourceIpns) setIsSubscribedState(privateDataMgr.isSubscribedByUsernameOrIpns(creatorName || undefined, sourceIpns || undefined))
  }, [creatorName, sourceIpns])

  // Reset avatar error when creator changes
  useEffect(() => {
    setCreatorAvatarError(false)
  }, [creatorName])

  const loadCreatorWorks = useCallback(async (username: string, page: number, reset = false) => {
    if (reset) {
      setCwLoading(true)
    } else {
      setIsLoadingMore(true)
    }
    try {
      const works = await getWorksByCreator(username, page, SIDEBAR_PAGE_SIZE)
      const cards = works.filter((w) => w.cid !== cid).map((w) => workToCardData(w, username))
      if (reset) setCreatorWorks(cards); else setCreatorWorks((prev) => [...prev, ...cards])
      setCwHasMore(works.length === SIDEBAR_PAGE_SIZE)
    } catch { setCwHasMore(false) } finally { 
      setCwLoading(false)
      setIsLoadingMore(false)
    }
  }, [cid])

  useEffect(() => { if (creatorName && dbLoaded) { setCwPage(1); loadCreatorWorks(creatorName, 1, true) } }, [creatorName, dbLoaded])

  // Page scroll handler for loading more creator works
  useEffect(() => {
    const handlePageScroll = () => {
      if (!isLoadingMore && cwHasMore && creatorName && dbLoaded) {
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop
        const scrollHeight = document.documentElement.scrollHeight
        const clientHeight = window.innerHeight
        
        // Load more when user scrolls to bottom 200px
        if (scrollTop + clientHeight >= scrollHeight - 200) {
          const nextPage = cwPage + 1
          setCwPage(nextPage)
          loadCreatorWorks(creatorName, nextPage)
        }
      }
    }

    window.addEventListener('scroll', handlePageScroll)
    return () => window.removeEventListener('scroll', handlePageScroll)
  }, [isLoadingMore, cwHasMore, creatorName, dbLoaded, cwPage, loadCreatorWorks])

  const loadFromDb = async () => {
    try {
      const work = await getWorkByCid(cid)
      if (!work) { setDbLoaded(true); return }
      setDbWork(work); setTitle(work.title)
      if (work.description) setDesc(work.description)
      setType(work.content_type)
      if (work.img_cid) setImgCid(work.img_cid)
      setCreatorName(work.creator_username); setPublishedAt(work.created_at)
      const creator = await getCreatorByUsername(work.creator_username)
      if (creator) { setDbCreator(creator); if (creator.ipns_address) setSourceIpns(creator.ipns_address) }
      setTipStats(await getWorkTipStats(cid))
      const firstPage = await getTipsByWork(cid, TIP_PAGE_SIZE, 0)
      setTipRecords(firstPage)
      setTipPage(1)
      setTipHasMore(firstPage.length === TIP_PAGE_SIZE)
      lookupTipperCreators(firstPage)
    } catch (err) { console.error('Failed to load work from db:', err) } finally { setDbLoaded(true) }
  }

  const lookupTipperCreators = async (tips: TipRecord[]) => {
    const newAddresses = tips
      .map((t) => t.tipper_address)
      .filter((addr, i, arr) => arr.indexOf(addr) === i)
    if (newAddresses.length === 0) return
    const results = await Promise.all(
      newAddresses.map(async (addr) => ({ addr, creator: await getCreatorByWallet(addr).catch(() => null) }))
    )
    setTipperCreators((prev) => {
      const next = { ...prev }
      results.forEach(({ addr, creator }) => { next[addr.toLowerCase()] = creator })
      return next
    })
  }

  const loadMoreTips = async () => {
    if (tipLoading || !tipHasMore) return
    setTipLoading(true)
    try {
      const nextBatch = await getTipsByWork(cid, TIP_PAGE_SIZE, tipPage * TIP_PAGE_SIZE)
      setTipRecords((prev) => [...prev, ...nextBatch])
      setTipPage((p) => p + 1)
      setTipHasMore(nextBatch.length === TIP_PAGE_SIZE)
      lookupTipperCreators(nextBatch)
    } catch (err) { console.error('Failed to load more tips:', err) } finally { setTipLoading(false) }
  }

  // Check if creator has enabled ads / クリエイターが広告を有効にしているかを確認
  useEffect(() => {
    if (!dbCreator?.wallet_address) return
    const checkAdGroup = async () => {
      try {
        const has = await adsMgr.hasAdGroup(dbCreator.wallet_address)
        setCreatorHasAdGroup(has)
        if (has) setCreatorAdAddress(dbCreator.wallet_address)
      } catch {}
    }
    checkAdGroup()
  }, [dbCreator])

  const loadContent = async () => {
    if (!cid) return
    try { setLoading(true); setError(null); if (type === 3) setContent(await ipfsConnector.downloadFileAsText(cid)) }
    catch (err) { setError(err instanceof Error ? err.message : t('itemPage.loadFailed')) } finally { setLoading(false) }
  }

  const FileTypeIcons = [DocumentIcon, FilmIcon, MusicalNoteIcon, DocumentTextIcon]
  const getFileTypeIcon = (t: number, size = 'w-16 h-16') => { const I = FileTypeIcons[t] || DocumentIcon; return <I className={`${size} text-gray-400 dark:text-gray-500`} /> }
  const getFileTypeName = (t2: number) => [t('common.contentTypes.file'), t('common.contentTypes.video'), t('common.contentTypes.audio'), t('common.contentTypes.document')][t2] || t('common.contentTypes.file')
  const handleBack = () => dispatch(goBack())
  const handleDownload = async () => {
    const baseName = title || cid
    const extFromName = (name: string) => { const m = name.match(/\.([a-zA-Z0-9]+)$/); return m ? m[1].toLowerCase() : '' }
    const mimeToExt: Record<string, string> = {
      'application/pdf': 'pdf', 'application/zip': 'zip', 'application/x-zip-compressed': 'zip',
      'application/x-tar': 'tar', 'application/gzip': 'gz', 'application/x-gzip': 'gz',
      'application/x-7z-compressed': '7z', 'application/x-rar-compressed': 'rar',
      'application/x-apple-diskimage': 'dmg', 'application/x-msdownload': 'exe',
      'application/vnd.microsoft.portable-executable': 'exe',
      'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
      'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
      'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/flac': 'flac',
      'text/plain': 'txt', 'text/markdown': 'md', 'application/json': 'json',
    }
    let ext = extFromName(baseName)
    try {
      const headUrl = `${ipfsConnector.getGatewayUrl(cid)}?filename=${encodeURIComponent(baseName)}`
      const res = await fetch(headUrl, { method: 'HEAD' })
      const ct = res.headers.get('content-type')?.split(';')[0].trim() || ''
      const detectedExt = mimeToExt[ct] || ''
      if (detectedExt) ext = detectedExt
    } catch { /* proceed with whatever ext we have */ }
    const fileName = ext ? `${baseName.replace(/\.[^/.]+$/, '')}.${ext}` : baseName
    const url = `${ipfsConnector.getGatewayUrl(cid)}?filename=${encodeURIComponent(fileName)}&download=true`
    const l = document.createElement('a'); l.href = url; l.click()
  }
  const handleFavoriteToggle = () => {
    const id = item?.id || cid
    if (isFavorited) { if (privateDataMgr.removeFavorite(id)) setIsFavorited(false) }
    else { if (privateDataMgr.addFavorite({ id, title, desc, type, img_cid: imgCid, cid, source_ipns: sourceIpns, creator_name: creatorName })) setIsFavorited(true) }
  }
  const handleShare = async () => { try { await navigator.clipboard.writeText(cid); alert(t('itemPage.cidCopied')) } catch {} }
  const copyToClipboard = async (text: string) => { try { await navigator.clipboard.writeText(text); alert(t('common.copySuccess')) } catch {} }

  const handleSubscribeToggle = () => {
    if (isSubscribedState) {
      if (privateDataMgr.removeSubscriptionByUsernameOrIpns(creatorName || undefined, sourceIpns || undefined)) setIsSubscribedState(false)
    } else {
      if (privateDataMgr.addSubscriptionEx({ ipns: sourceIpns || undefined, username: creatorName || undefined, title: creatorName || dbCreator?.title || undefined, desc: dbCreator?.description || undefined })) setIsSubscribedState(true)
    }
  }

  const handleEmojiSelect = (emoji: string) => { if (commentText.length + emoji.length <= MAX_COMMENT_LENGTH) setCommentText((p) => p + emoji); setShowEmojiPicker(false) }

  const handleBlockWork = (e: React.MouseEvent) => {
    e.stopPropagation(); setShowBlockMenu(false)
    blockWork(cid, title); setBlockedByCreator(false); setIsBlocked(true)
  }
  const handleBlockCreator = (e: React.MouseEvent) => {
    e.stopPropagation(); setShowBlockMenu(false)
    if (creatorName) blockCreator(creatorName); setBlockedByCreator(true); setIsBlocked(true)
  }
  const handleUnblock = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (blockedByCreator && creatorName) unblockCreator(creatorName); else unblockWork(cid)
    setIsBlocked(false)
  }
  useEffect(() => {
    if (!showBlockMenu) return
    const handler = (e: MouseEvent) => { if (blockMenuRef.current && !blockMenuRef.current.contains(e.target as Node)) setShowBlockMenu(false) }
    document.addEventListener('mousedown', handler); return () => document.removeEventListener('mousedown', handler)
  }, [showBlockMenu])

  const sortedComments = useMemo(() => {
    const wm = tipRecords.filter((t) => t.message && t.message.trim())
    if (commentSort === 'time') return [...wm].sort((a, b) => b.timestamp - a.timestamp)
    const st = getKnownTokens().find((t) => t.symbol === commentSort)
    if (st) {
      const ta = st.address.toLowerCase()
      return [...wm].sort((a, b) => {
        const am = a.token_address.toLowerCase() === ta, bm = b.token_address.toLowerCase() === ta
        if (am && !bm) return -1; if (!am && bm) return 1
        if (am && bm) { const diff = BigInt(b.amount_sent) - BigInt(a.amount_sent); return diff > 0n ? 1 : diff < 0n ? -1 : b.timestamp - a.timestamp }
        return b.timestamp - a.timestamp
      })
    }
    return wm
  }, [tipRecords, commentSort])

  const totalComments = useMemo(() => tipRecords.filter((t) => t.message && t.message.trim()).length, [tipRecords])

  const tipPaymentConfig: PaymentConfig = {
    type: 'range', minAmount: minTipAmount, maxAmount: '10000',
    token: selectedTipToken.address, tokenSymbol: selectedTipToken.symbol, description: t('itemPage.tipWork') + ' ' + title,
  }

  const handleOpenTipModal = () => {
    if (commentText.trim().length > MAX_COMMENT_LENGTH) { alert(t('itemPage.commentTooLong', { max: MAX_COMMENT_LENGTH })); return }
    setShowTipSetup(true)
  }

  const handleOpenReplyModal = (tip: TipRecord) => {
    setReplyingTo(tip)
    setReplyText('')
  }

  const handleSendReply = () => {
    if (!replyText.trim()) return
    if (replyText.trim().length > MAX_REPLY_LENGTH) { alert(t('itemPage.commentTooLong', { max: MAX_REPLY_LENGTH })); return }
    setShowTipSetup(true)
  }

  const handleTipSetupConfirm = () => {
    setShowTipSetup(false)
    setShowTipModal(true)
  }

  const handleTip = async (address: string, password: string, amount?: string, customParams?: Record<string, any>): Promise<TransactionResult> => {
    try {
      const isReply = !!replyingTo
      const rawText = isReply ? (customParams?.message || '') : (customParams?.message || '')
      // Encode reply prefix into message if replying
      const message = isReply
        ? `@rp:${replyingTo!.tx_hash}|${rawText}`
        : rawText
      const result = await creatorHubMgr.tipWork(address, password, cid, amount!, selectedTipToken.address, message)
      if (result.success) {
        if (isReply) {
          setReplyText('')
          // Reload replies for the parent
          const updatedReplies = await getRepliesByTip(replyingTo!.tx_hash)
          setRepliesMap((prev) => ({ ...prev, [replyingTo!.tx_hash]: updatedReplies }))
          setExpandedReplies((prev) => ({ ...prev, [replyingTo!.tx_hash]: true }))
          lookupTipperCreators(updatedReplies)
          // Update reply_count in tipRecords
          setTipRecords((prev) => prev.map((t) =>
            t.tx_hash === replyingTo!.tx_hash ? { ...t, reply_count: updatedReplies.length } : t
          ))
        } else {
          setCommentText('')
        }
        setReplyingTo(null)
        setTipStats(await getWorkTipStats(cid))
        if (!isReply) {
          const firstPage = await getTipsByWork(cid, TIP_PAGE_SIZE, 0)
          setTipRecords(firstPage)
          setTipPage(1)
          setTipHasMore(firstPage.length === TIP_PAGE_SIZE)
          lookupTipperCreators(firstPage)
        }
        // Notify user that comment will appear after network sync
        if (rawText) {
          notify(t('itemPage.tipSuccessWithComment')).success(t('itemPage.commentSyncPending'))
        }
      }
      return { success: result.success, txHash: result.txHash, error: result.error, rawError: result.rawError }
    } catch (err: any) { return { success: false, error: err.message || t('itemPage.tipFailed'), rawError: err } }
  }

  const loadReplies = async (txHash: string) => {
    const replies = await getRepliesByTip(txHash)
    setRepliesMap((prev) => ({ ...prev, [txHash]: replies }))
    lookupTipperCreators(replies)
  }

  const toggleReplies = (txHash: string) => {
    const nowExpanded = !expandedReplies[txHash]
    setExpandedReplies((prev) => ({ ...prev, [txHash]: nowExpanded }))
    if (nowExpanded && !repliesMap[txHash]) loadReplies(txHash)
  }

  const handleTipGasEstimate: GasEstimateCallback = async (address: string) => {
    try {
      const contract = new ethers.Contract(getCreatorHubAddress(), CreatorHubABI, rpcConnectorInstance.getProvider())
      const data = contract.interface.encodeFunctionData('tip', [
        cid,
        selectedTipToken.address,
        ethers.parseEther(minTipAmount),
        ''
      ])
      const result = await rpcConnectorInstance.estimateContractGas(address, getCreatorHubAddress(), data, 0n)
      // If estimation fails, return default value without logging error
      if (!result.success) {
        return { success: true, gasEstimate: '0.001' }
      }
      return result
    } catch (err: any) {
      // Silently return default value on any error
      return { success: true, gasEstimate: '0.001' }
    }
  }

  const renderContent = () => {
    // For video and audio, render the player immediately (no loading gate)
    // so the player UI is always visible regardless of IPFS load speed
    const gw = ipfsConnector.getGatewayUrl(cid)
    switch (type) {
      case 1:
        return (
          <VideoPlayer
            src={gw}
            poster={imgCid ? ipfsConnector.getGatewayUrl(imgCid) : undefined}
          />
        )
      case 2:
        return (
          <AudioPlayer
            src={gw}
            imgUrl={imgCid ? ipfsConnector.getGatewayUrl(imgCid) : undefined}
            fallbackHash={cid}
            title={title}
          />
        )
      case 3:
        if (loading) return <div className="flex items-center justify-center py-12"><LoadingSpinner /><span className="ml-3 text-gray-600 dark:text-gray-400">{t('common.loading')}</span></div>
        if (error) return <div className="text-center py-12"><XCircleIcon className="w-16 h-16 text-red-500 mx-auto mb-4" /><p className="text-gray-600 dark:text-gray-400 mb-4">{error}</p><button onClick={loadContent} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">{t('common.retry')}</button></div>
        return <div className="prose dark:prose-invert max-w-none p-4"><MarkdownRenderer content={content || ''} /></div>
      default:
        return (
          <div className="text-center py-12">
            <div className="mb-6 flex justify-center">{getFileTypeIcon(type)}</div>
            <div className="mb-6 mx-auto max-w-md rounded-lg border border-yellow-300 bg-yellow-50 dark:border-yellow-700 dark:bg-yellow-900/20 px-4 py-3 flex gap-3 text-left">
              <ExclamationTriangleIcon className="w-5 h-5 flex-shrink-0 text-yellow-500 mt-0.5" />
              <p className="text-sm text-yellow-800 dark:text-yellow-300">{t('itemPage.clickDownload')}</p>
            </div>
            <button onClick={handleDownload} className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center mx-auto">
              <ArrowDownTrayIcon className="w-5 h-5 mr-2" />{t('itemPage.downloadFile')}
            </button>
          </div>
        )
    }
  }

  return (
    <div className={`min-h-screen bg-gray-50 dark:bg-gray-900 pt-16 transition-all duration-300 ${isOpen ? 'lg:ml-60' : 'ml-0'}`}>
      <div className="max-w-[1600px] mx-auto px-3 sm:px-4 lg:px-6 xl:px-8 py-4 sm:py-6">
        <button onClick={handleBack} className="inline-flex items-center text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors mb-3">
          <ArrowLeftIcon className="w-4 h-4 mr-1" /><span>{t('common.back')}</span>
        </button>
        <div className="flex flex-col xl:flex-row gap-6">
          {/* ====== Left main content area ====== / ====== 左側メインコンテンツエリア ====== */}
          <div className="flex-1 min-w-0">
            <div className={`rounded-xl overflow-hidden mb-4 ${type === 1 || type === 2 ? 'bg-black' : ''}`}>{renderContent()}</div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white mb-2 leading-tight">{title || t('common.loading')}</h1>
            {/* Meta info + action buttons / メタ情報 + アクションボタン */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-400">
                {creatorName && (<div className="flex items-center gap-1.5"><div className="w-6 h-6 rounded-full overflow-hidden flex-shrink-0"><BoringAvatar hash={creatorName} variant="beam" /></div><span className="font-medium text-gray-900 dark:text-white">{creatorName}</span></div>)}
                {publishedAt && (() => { try { const d = new Date(publishedAt); return isNaN(d.getTime()) ? null : <span>{d.toLocaleDateString()}</span> } catch { return null } })()}
                <span className="flex items-center gap-1">{getFileTypeIcon(type, 'w-4 h-4')} {getFileTypeName(type)}</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={handleFavoriteToggle} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors ${isFavorited ? 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-600 dark:text-yellow-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
                  {isFavorited ? <StarIconSolid className="w-4 h-4" /> : <StarIcon className="w-4 h-4" />}<span>{t('itemPage.favorite')}</span>
                </button>
                <button onClick={handleShare} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"><ShareIcon className="w-4 h-4" /><span>{t('itemPage.share')}</span></button>
                <button onClick={handleDownload} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"><ArrowDownTrayIcon className="w-4 h-4" /><span>{t('itemPage.download')}</span></button>
                {/* Block button */}
                <div className="relative" ref={blockMenuRef}>
                  {isBlocked ? (
                    <button onClick={handleUnblock} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors">
                      <NoSymbolIcon className="w-4 h-4" /><span>{t('itemCard.unblock')}</span>
                    </button>
                  ) : (
                    <button onClick={(e) => { e.stopPropagation(); setShowBlockMenu((v) => !v) }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-500 transition-colors">
                      <NoSymbolIcon className="w-4 h-4" /><span>{t('itemCard.block')}</span>
                    </button>
                  )}
                  {showBlockMenu && (
                    <div className="absolute top-full right-0 mt-1 z-50 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-600 py-1 min-w-[160px]">
                      <button onClick={handleBlockWork} className="w-full px-4 py-2.5 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 transition-colors">{t('itemCard.blockWork')}</button>
                      {creatorName && <button onClick={handleBlockCreator} className="w-full px-4 py-2.5 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 transition-colors">{t('itemCard.blockCreator')}</button>}
                    </div>
                  )}
                </div>
              </div>
            </div>
            {desc && (<div className="bg-gray-100 dark:bg-gray-800 rounded-xl p-3 mb-4"><p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">{desc}</p></div>)}
            {/* Technical info / 技術情報 */}
            <div className="mb-6">
              <button onClick={() => setShowTechInfo(!showTechInfo)} className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
                <ChevronRightIcon className={`w-3 h-3 transition-transform ${showTechInfo ? 'rotate-90' : ''}`} /><span>{t('itemPage.techInfo')}</span>
              </button>
              {showTechInfo && (
                <div className="mt-2 bg-gray-100 dark:bg-gray-800 rounded-xl p-4 space-y-3">
                  <div><label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t('itemPage.contentCid')}</label><div className="flex items-center gap-2"><code className="text-xs bg-gray-200 dark:bg-gray-700 px-2 py-1 rounded flex-1 break-all font-mono">{cid}</code><button onClick={() => copyToClipboard(cid)} className="text-blue-500 hover:text-blue-600 flex-shrink-0"><ClipboardDocumentIcon className="w-4 h-4" /></button></div></div>
                  {imgCid && <div><label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t('itemPage.thumbnailCid')}</label><div className="flex items-center gap-2"><code className="text-xs bg-gray-200 dark:bg-gray-700 px-2 py-1 rounded flex-1 break-all font-mono">{imgCid}</code><button onClick={() => copyToClipboard(imgCid)} className="text-blue-500 hover:text-blue-600 flex-shrink-0"><ClipboardDocumentIcon className="w-4 h-4" /></button></div></div>}
                  {sourceIpns && <div><label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t('itemPage.sourceIpns')}</label><div className="flex items-center gap-2"><code className="text-xs bg-gray-200 dark:bg-gray-700 px-2 py-1 rounded flex-1 break-all font-mono">{sourceIpns}</code><button onClick={() => copyToClipboard(sourceIpns)} className="text-blue-500 hover:text-blue-600 flex-shrink-0"><ClipboardDocumentIcon className="w-4 h-4" /></button></div></div>}
                </div>
              )}
            </div>
            {/* Tip revenue statistics / チップ収益統計 */}
            {tipStats.length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-xl p-4 mb-4">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">{t('itemPage.tipRevenue')}</h3>
                <div className="flex flex-wrap gap-4">
                  {tipStats.map((stat) => (
                    <div key={stat.token_address} className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 dark:text-gray-400">{getTokenSymbol(stat.token_address)}</span>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">{formatTipAmount(stat.total_amount)}</span>
                      <span className="text-xs text-gray-400 dark:text-gray-500">({stat.tip_count}x)</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Comments section / コメントセクション */}
            <div>
              <div className="flex items-center gap-3 mb-4">
                <span className="text-base font-semibold text-gray-900 dark:text-white">{totalComments} {t('itemPage.comments')}</span>
                <div className="flex items-center gap-1 ml-auto">
                  <button onClick={() => setCommentSort('time')} className={`px-2.5 py-1 text-xs rounded-full transition-colors ${commentSort === 'time' ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>{t('itemPage.latest')}</button>
                  {getKnownTokens().map((tk) => (
                    <button key={tk.symbol} onClick={() => setCommentSort(tk.symbol)} className={`px-2.5 py-1 text-xs rounded-full transition-colors ${commentSort === tk.symbol ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>{tk.symbol}</button>
                  ))}
                </div>
              </div>
              {/* Comment input / コメント入力 */}
              {dbLoaded && dbWork && (
                <div className="flex items-start gap-3 mb-6">
                  <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 mt-1"><BoringAvatar hash="me" variant="beam" /></div>
                  <div className="flex-1">
                    {/* Emoji picker area / 絵文字ピッカーエリア */}
                    <div className="relative mb-2" ref={emojiPickerRef}>
                      <button onClick={() => setShowEmojiPicker(!showEmojiPicker)} className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors">
                        <FaceSmileIcon className="w-4 h-4" /><span>{t('itemPage.emoji')}</span>
                      </button>
                      {showEmojiPicker && (
                        <div className="absolute top-8 left-0 z-10 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-2 grid grid-cols-8 gap-1 w-72">
                          {EMOJI_LIST.map((e) => (
                            <button key={e} onClick={() => handleEmojiSelect(e)} className="w-8 h-8 flex items-center justify-center text-lg hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors">{e}</button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="relative">
                      <input type="text" value={commentText} onChange={(e) => setCommentText(e.target.value.slice(0, MAX_COMMENT_LENGTH))}
                        placeholder={t('itemPage.addComment')}
                        className="w-full bg-transparent border-b-2 outline-none py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 transition-colors"
                        style={{ borderBottomColor: THEME_COLOR }}
                      />
                      <span className="absolute right-0 bottom-2.5 text-xs text-gray-400">{commentText.length}/{MAX_COMMENT_LENGTH}</span>
                    </div>
                    <div className="flex items-center justify-end mt-2">
                      <button onClick={handleOpenTipModal}
                        className="px-4 py-1.5 text-sm bg-gradient-to-r from-pink-500 to-purple-600 text-white rounded-full hover:from-pink-600 hover:to-purple-700 transition-all font-medium">
                        <HeartIconSolid className="w-4 h-4 inline mr-1" />{t('itemPage.tipAndComment')}
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {/* Comment list */}
              {sortedComments.length > 0 ? (
                <div className="space-y-4">
                  {sortedComments.map((tip) => {
                    const tipperCreator = tipperCreators[tip.tipper_address.toLowerCase()]
                    const avatarUrl = tipperCreator?.avatar_cid ? ipfsConnector.getGatewayUrl(tipperCreator.avatar_cid) : null
                    const avatarError = tipperAvatarErrors[tip.tipper_address.toLowerCase()]
                    const tipReplies = repliesMap[tip.tx_hash] || []
                    const isExpanded = expandedReplies[tip.tx_hash]
                    const replyCount = tip.reply_count || 0
                    return (
                      <div key={tip.id}>
                        {/* Top-level comment */}
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0">
                            {avatarUrl && !avatarError ? (
                              <img src={avatarUrl} alt={tipperCreator!.username} className="w-full h-full object-cover"
                                onError={() => setTipperAvatarErrors((prev) => ({ ...prev, [tip.tipper_address.toLowerCase()]: true }))} />
                            ) : (
                              <BoringAvatar hash={tipperCreator ? tipperCreator.username : tip.tipper_address} variant="beam" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              {tipperCreator ? (
                                <span className="text-xs font-medium text-gray-900 dark:text-white">{tipperCreator.username}</span>
                              ) : (
                                <span className="text-xs font-medium text-gray-900 dark:text-white font-mono">{tip.tipper_address.slice(0, 6)}...{tip.tipper_address.slice(-4)}</span>
                              )}
                              {dbCreator?.wallet_address && tip.tipper_address.toLowerCase() === dbCreator.wallet_address.toLowerCase() && (
                                <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400">{t('itemPage.authorBadge')}</span>
                              )}
                              <span className="text-xs text-gray-500 dark:text-gray-400">{formatRelativeTime(tip.timestamp, t)}</span>
                            </div>
                            <p className="text-sm text-gray-800 dark:text-gray-200 break-words mb-1">{tip.message}</p>
                            <div className="flex items-center gap-3">
                              <span className="inline-flex items-center gap-1 text-xs text-pink-500 dark:text-pink-400">
                                <HeartIconSolid className="w-3 h-3 inline" /> {formatTipAmount(tip.amount_sent)} {getTokenSymbol(tip.token_address)}
                              </span>
                              <button onClick={() => handleOpenReplyModal(tip)}
                                className="text-xs text-gray-400 dark:text-gray-500 hover:text-purple-500 dark:hover:text-purple-400 underline underline-offset-2 transition-colors">
                                {t('itemPage.reply')}
                              </button>
                              {replyCount > 0 && (
                                <button onClick={() => toggleReplies(tip.tx_hash)}
                                  className="text-xs text-gray-400 dark:text-gray-500 hover:text-blue-500 dark:hover:text-blue-400 transition-colors">
                                  {isExpanded ? t('itemPage.hideReplies') : t('itemPage.showReplies', { count: replyCount })}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                        {/* Reply input inline */}
                        {replyingTo?.tx_hash === tip.tx_hash && (
                          <div className="ml-11 mt-2 flex items-start gap-2">
                            <div className="w-6 h-6 rounded-full overflow-hidden flex-shrink-0 mt-1"><BoringAvatar hash="me" variant="beam" /></div>
                            <div className="flex-1">
                              <div className="relative">
                                <input type="text" value={replyText}
                                  onChange={(e) => setReplyText(e.target.value.slice(0, MAX_REPLY_LENGTH))}
                                  placeholder={t('itemPage.addReply')}
                                  autoFocus
                                  className="w-full bg-transparent border-b outline-none py-1 text-xs text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 transition-colors"
                                  style={{ borderBottomColor: THEME_COLOR }}
                                />
                                <span className="absolute right-0 bottom-1.5 text-xs text-gray-400">{replyText.length}/{MAX_REPLY_LENGTH}</span>
                              </div>
                              <div className="flex items-center justify-end gap-2 mt-1">
                                <button onClick={() => { setReplyingTo(null); setReplyText('') }}
                                  className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                                  {t('common.cancel')}
                                </button>
                                <button onClick={handleSendReply}
                                  className="px-3 py-1 text-xs bg-gradient-to-r from-pink-500 to-purple-600 text-white rounded-full hover:from-pink-600 hover:to-purple-700 transition-all">
                                  <HeartIconSolid className="w-3 h-3 inline mr-1" />{t('itemPage.tipAndComment')}
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                        {/* Nested replies */}
                        {isExpanded && tipReplies.length > 0 && (
                          <div className="ml-11 mt-2 space-y-3 border-l-2 border-gray-100 dark:border-gray-700 pl-3">
                            {tipReplies.map((reply) => {
                              const replyCreator = tipperCreators[reply.tipper_address.toLowerCase()]
                              const replyAvatarUrl = replyCreator?.avatar_cid ? ipfsConnector.getGatewayUrl(replyCreator.avatar_cid) : null
                              const replyAvatarError = tipperAvatarErrors[reply.tipper_address.toLowerCase()]
                              return (
                                <div key={reply.id} className="flex items-start gap-2">
                                  <div className="w-6 h-6 rounded-full overflow-hidden flex-shrink-0">
                                    {replyAvatarUrl && !replyAvatarError ? (
                                      <img src={replyAvatarUrl} alt={replyCreator!.username} className="w-full h-full object-cover"
                                        onError={() => setTipperAvatarErrors((prev) => ({ ...prev, [reply.tipper_address.toLowerCase()]: true }))} />
                                    ) : (
                                      <BoringAvatar hash={replyCreator ? replyCreator.username : reply.tipper_address} variant="beam" />
                                    )}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-0.5">
                                      {replyCreator ? (
                                        <span className="text-xs font-medium text-gray-900 dark:text-white">{replyCreator.username}</span>
                                      ) : (
                                        <span className="text-xs font-medium text-gray-900 dark:text-white font-mono">{reply.tipper_address.slice(0, 6)}...{reply.tipper_address.slice(-4)}</span>
                                      )}
                                      {dbCreator?.wallet_address && reply.tipper_address.toLowerCase() === dbCreator.wallet_address.toLowerCase() && (
                                        <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400">{t('itemPage.authorBadge')}</span>
                                      )}
                                      <span className="text-xs text-gray-500 dark:text-gray-400">{formatRelativeTime(reply.timestamp, t)}</span>
                                    </div>
                                    <p className="text-xs text-gray-800 dark:text-gray-200 break-words mb-1">{reply.message}</p>
                                    <span className="inline-flex items-center gap-1 text-xs text-pink-500 dark:text-pink-400">
                                      <HeartIconSolid className="w-3 h-3 inline" /> {formatTipAmount(reply.amount_sent)} {getTokenSymbol(reply.token_address)}
                                    </span>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {/* Load more */}
                  {tipHasMore && (
                    <div className="flex justify-center pt-2">
                      <button onClick={loadMoreTips} disabled={tipLoading}
                        className="px-4 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-full transition-colors disabled:opacity-50">
                        {tipLoading ? <LoadingSpinner /> : t('itemPage.loadMoreComments')}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">{t('itemPage.noComments')}</p>
              )}
            </div>
          </div>
          {/* ====== Right sidebar ====== / ====== 右側サイドバー ====== */}
          {dbLoaded && dbWork && (
            <div className="xl:w-[360px] flex-shrink-0 space-y-4">
              {/* Creator info card + subscribe button / クリエイター情報カード + サブスクライブボタン */}
              {dbCreator && (
                <div className="bg-white dark:bg-gray-800 rounded-xl p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0">
                      {dbCreator.avatar_cid && !creatorAvatarError ? (
                        <img 
                          src={ipfsConnector.getGatewayUrl(dbCreator.avatar_cid)} 
                          alt={creatorName} 
                          className="w-full h-full object-cover"
                          onError={() => setCreatorAvatarError(true)}
                        />
                      ) : (
                        <BoringAvatar hash={creatorName} variant="beam" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900 dark:text-white text-sm truncate">{creatorName}</div>
                      {dbCreator.title && <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{dbCreator.title}</div>}
                    </div>
                  </div>
                  {dbCreator.description && <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-3 mb-3">{dbCreator.description}</p>}
                  <button onClick={handleSubscribeToggle}
                    className={`w-full px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isSubscribedState
                        ? 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                        : 'text-white hover:opacity-90'
                    }`}
                    style={!isSubscribedState ? { backgroundColor: THEME_COLOR } : undefined}
                  >
                    {isSubscribedState ? t('itemPage.subscribed') : t('itemPage.subscribeAuthor')}
                  </button>
                </div>
              )}
              {/*The creator’s latest work or advertisement */}
              {creatorHasAdGroup ? (
                <SidebarAds creatorAddress={creatorAdAddress} />
              ) : (
              <div className="bg-white dark:bg-gray-800 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
                  {t('itemPage.worksOf', { name: creatorName })}
                </h3>
                <div className="space-y-3">
                  {creatorWorks.length > 0 ? (
                    <>
                      {creatorWorks.map((w) => (
                        <ItemCard key={w.id} item={w} className="!shadow-none !border-0" />
                      ))}
                      {isLoadingMore && (
                        <div className="flex justify-center py-4">
                          <LoadingSpinner />
                        </div>
                      )}
                      {!cwHasMore && creatorWorks.length > 0 && (
                        <p className="text-xs text-gray-400 text-center py-2">{t('itemPage.noMoreWorks')}</p>
                      )}
                    </>
                  ) : cwLoading ? (
                    <div className="flex justify-center py-4"><LoadingSpinner /></div>
                  ) : (
                    <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-4">{t('itemPage.noOtherWorks')}</p>
                  )}
                </div>
              </div>
              )}
            </div>
          )}
        </div>
      </div>
      {/* Tip setup modal - token selection */}
      {showTipSetup && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              <HeartIconSolid className="w-5 h-5 inline mr-2 text-pink-500" />{t('itemPage.tipAndComment')}
            </h3>

            {/* Message preview */}
            {replyingTo ? (
              <div className="mb-4">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('itemPage.replyingTo')}</p>
                <div className="p-2 bg-gray-100 dark:bg-gray-700 rounded-lg border-l-2 border-purple-400 mb-2">
                  <p className="text-xs text-gray-600 dark:text-gray-300 line-clamp-2">{replyingTo.message}</p>
                </div>
                {replyText.trim() && (
                  <div className="p-3 bg-gray-100 dark:bg-gray-700 rounded-lg">
                    <p className="text-sm text-gray-700 dark:text-gray-300 break-words">{replyText.trim()}</p>
                  </div>
                )}
              </div>
            ) : (
              commentText.trim() && (
                <div className="mb-4 p-3 bg-gray-100 dark:bg-gray-700 rounded-lg">
                  <p className="text-sm text-gray-700 dark:text-gray-300 break-words">{commentText.trim()}</p>
                </div>
              )
            )}

            {/* Token selection */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('itemPage.selectTipToken')}
              </label>
              <div className="grid grid-cols-2 gap-2">
                {getKnownTokens().map((token) => (
                  <button key={token.address} onClick={() => setSelectedTipToken(token)}
                    className={`p-3 border rounded-lg transition-colors ${
                      selectedTipToken.address === token.address
                        ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20'
                        : 'border-gray-300 dark:border-gray-600 hover:border-purple-300 dark:hover:border-purple-700'
                    }`}>
                    <div className="font-medium text-gray-900 dark:text-white">{token.symbol}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{token.name}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Tip amount info */}
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              {t('itemPage.tipAmountRange', { min: minTipAmount, max: '10000' })} {selectedTipToken.symbol}
            </p>

            <div className="flex justify-end space-x-3">
              <button onClick={() => { setShowTipSetup(false); setReplyingTo(null) }}
                className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors">
                {t('common.cancel')}
              </button>
              <button onClick={handleTipSetupConfirm}
                className="px-4 py-2 bg-gradient-to-r from-pink-500 to-purple-600 text-white rounded-lg hover:from-pink-600 hover:to-purple-700 transition-all font-medium">
                {t('itemPage.next')}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* WalletSelectorModal for tip transaction */}
      <WalletSelectorModal isOpen={showTipModal} onClose={() => { setShowTipModal(false); setReplyingTo(null) }}
        paymentConfig={tipPaymentConfig} onConfirm={handleTip}
        customParams={{ message: replyingTo ? replyText.trim() : commentText.trim() }}
        allowBackground onBackgroundStart={() => { if (replyingTo) setReplyText(''); else setCommentText('') }}
        onGasEstimate={handleTipGasEstimate} />
    </div>
  )
}

export default ItemPage
