import React, { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppDispatch } from '../../hooks/redux'
import { setItemPage, setCreatorPageByUsername } from '../../store/slices/pageSlice'
import { ipfsConnector } from '../../utils/ipfsConnector'
import { getWorkTipStats, WorkTipStat } from '../../utils/dbConnector'
import { getKnownTokens } from '../../../config'
import BoringAvatar from '../BoringAvatar'
import WorkCacheControl from './WorkCacheControl'
import AdSpacePurchase from './AdSpacePurchase'
import { useBlacklist } from '../../hooks/useBlacklist'
import {
  DocumentIcon,
  VideoCameraIcon,
  MusicalNoteIcon,
  DocumentTextIcon,
  CheckCircleIcon,
  ArrowPathIcon,
  NoSymbolIcon,
} from '@heroicons/react/24/outline'
import { HeartIcon } from '@heroicons/react/24/solid'

export interface EpochRankInfo {
  token: string   // e.g. 'FIL' or 'USDFC'
  rank: number    // 1-based rank in current epoch
  amount: string  // wei string of tips in current epoch
}

export interface ItemCardData {
  id: string
  title: string
  desc: string
  type: number // 0:file, 1:video, 2:audio, 3:markdown
  img_cid: string
  cid: string
  source_ipns?: string
  creator_name?: string
  creator_avatar_cid?: string
  published_at?: string
  isPending?: boolean
  isPinned?: boolean // whether pin is complete (passed from LocalDownload)
  adStatus?: 'normal' | 'my-bid' | 'won' // ad mode: bidding status relative to user's wallets
  adWinnerAddress?: string // ad mode: the wallet address that won (for locking in AdModal)
  epochRanks?: EpochRankInfo[] // current jackpot epoch ranking info
}

type ItemCardMode = 'default' | 'editable' | 'ad' | 'preview'

interface ItemCardProps {
  item: ItemCardData
  mode?: ItemCardMode
  selected?: boolean
  onEdit?: (item: ItemCardData) => void
  onDelete?: (item: ItemCardData) => void
  onSelect?: (item: ItemCardData, selected: boolean) => void
  onAdPurchase?: (item: ItemCardData) => void
  onCreatorClick?: (ipns: string) => void
  onCacheStatusChange?: (cid: string, isDownloaded: boolean) => void
  className?: string
}

// File type background color configuration / ファイルタイプの背景色設定
const TYPE_COLORS: Record<number, string> = {
  0: 'bg-gray-600',    // file
  1: 'bg-red-600',     // video
  2: 'bg-purple-600',  // audio
  3: 'bg-blue-600',    // document
}

// Format number display (YouTube style) / 数字表示をフォーマット（YouTube スタイル）
const formatNumber = (num: number): string => {
  if (num < 1000) return num.toString()
  if (num < 1000000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K'
  return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M'
}

// Format tip amount from wei string with compact notation.
// Accepts both integer wei strings and scientific notation (e.g. "1.0e+18") from SQLite aggregates.
const formatTipAmount = (wei: string): string => {
  try {
    // Try exact BigInt path first (integer wei strings from event records)
    let num: number
    if (wei.includes('.') || wei.toLowerCase().includes('e')) {
      // Scientific notation or float from SQLite SUM — parse directly as float wei
      num = parseFloat(wei) / 1e18
    } else {
      num = Number(BigInt(wei)) / 1e18
    }
    if (!isFinite(num) || num <= 0) return '0'
    if (num < 0.0001) return '<0.0001'
    if (num < 1000) return num.toFixed(1).replace(/\.0$/, '')
    if (num < 1000000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K'
    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M'
  } catch {
    return '0'
  }
}

const ItemCard: React.FC<ItemCardProps> = ({
  item,
  mode = 'default',
  selected = false,
  onEdit,
  onDelete,
  onSelect,
  onAdPurchase,
  onCacheStatusChange,
  className = '',
}) => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [imageLoading, setImageLoading] = useState(true)
  const [imageError, setImageError] = useState(false)
  const [avatarError, setAvatarError] = useState(false)
  const [tipStats, setTipStats] = useState<WorkTipStat[]>([])
  const [imageUrl, setImageUrl] = useState<string>('')
  const [avatarUrl, setAvatarUrl] = useState<string>('')
  const [showBlockMenu, setShowBlockMenu] = useState(false)
  const blockMenuRef = useRef<HTMLDivElement>(null)
  const { blockWork, blockCreator, unblockWork, unblockCreator, isWorkBlacklisted, isCreatorBlacklisted } = useBlacklist()

  // Local blocked state — initialized from persisted data, updated immediately on user action
  const [isBlocked, setIsBlocked] = useState(() =>
    isWorkBlacklisted(item.cid) || !!(item.creator_name && isCreatorBlacklisted(item.creator_name))
  )
  // Track whether the block was by creator (so unblock targets the right entity)
  const [blockedByCreator, setBlockedByCreator] = useState(() =>
    !!(item.creator_name && isCreatorBlacklisted(item.creator_name))
  )

  // Get image URL / 画像 URL を取得
  useEffect(() => {
    if (item.img_cid) {
      setImageUrl(ipfsConnector.getGatewayUrl(item.img_cid))
    }
  }, [item.img_cid])

  // Get avatar URL / アバター URL を取得
  useEffect(() => {
    if (item.creator_avatar_cid) {
      setAvatarUrl(ipfsConnector.getGatewayUrl(item.creator_avatar_cid))
    }
  }, [item.creator_avatar_cid])

  useEffect(() => {
    if (mode === 'default') {
      loadTipStats()
    }
  }, [item.cid, mode])

  const loadTipStats = async () => {
    try {
      const stats = await getWorkTipStats(item.cid)
      setTipStats(stats)
    } catch (error) {
      console.error('Failed to load tip stats:', error)
    }
  }

  const getItemTypeIcon = (type: number): React.ReactNode => {
    const iconClass = 'w-4 h-4'
    switch (type) {
      case 0:
        return <DocumentIcon className={iconClass} />
      case 1:
        return <VideoCameraIcon className={iconClass} />
      case 2:
        return <MusicalNoteIcon className={iconClass} />
      case 3:
        return <DocumentTextIcon className={iconClass} />
      default:
        return <DocumentIcon className={iconClass} />
    }
  }

  const getItemTypeName = (type: number): string => {
    switch (type) {
      case 0:
        return t('common.contentTypes.file')
      case 1:
        return t('common.contentTypes.video')
      case 2:
        return t('common.contentTypes.audio')
      case 3:
        return t('common.contentTypes.document')
      default:
        return t('common.contentTypes.file')
    }
  }

  const handleItemClick = () => {
    // Preview mode and blocked cards are not clickable
    if (mode === 'preview' || isBlocked) return
    
    if (mode === 'editable' && onSelect) {
      onSelect(item, !selected)
    } else {
      dispatch(setItemPage(item))
    }
  }

  const handleCreatorClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (item.creator_name) {
      dispatch(setCreatorPageByUsername(item.creator_name))
    }
  }

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onEdit) onEdit(item)
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onDelete) onDelete(item)
  }

  const handleAdPurchase = () => {
    if (onAdPurchase) onAdPurchase(item)
  }

  const handleBlockWork = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowBlockMenu(false)
    blockWork(item.cid, item.title)
    setBlockedByCreator(false)
    setIsBlocked(true)
  }

  const handleBlockCreator = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowBlockMenu(false)
    if (item.creator_name) blockCreator(item.creator_name)
    setBlockedByCreator(true)
    setIsBlocked(true)
  }

  const handleUnblock = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (blockedByCreator && item.creator_name) {
      unblockCreator(item.creator_name)
    } else {
      unblockWork(item.cid)
    }
    setIsBlocked(false)
  }

  // Close block menu when clicking outside
  useEffect(() => {
    if (!showBlockMenu) return
    const handleClickOutside = (e: MouseEvent) => {
      if (blockMenuRef.current && !blockMenuRef.current.contains(e.target as Node)) {
        setShowBlockMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showBlockMenu])

  // Calculate tip statistics
  const getTipStatistics = () => {
    const filToken = getKnownTokens().find(t => t.symbol === 'FIL')
    const usdfcToken = getKnownTokens().find(t => t.symbol === 'USDFC')
    
    const filStats = tipStats.find(s => s.token_address.toLowerCase() === filToken?.address.toLowerCase())
    const usdfcStats = tipStats.find(s => s.token_address.toLowerCase() === usdfcToken?.address.toLowerCase())
    
    const totalTips = tipStats.reduce((sum, s) => sum + s.tip_count, 0)
    const totalFil = filStats ? formatTipAmount(filStats.total_amount) : '0'
    const totalUsdfc = usdfcStats ? formatTipAmount(usdfcStats.total_amount) : '0'
    
    return { totalTips, totalFil, totalUsdfc }
  }

  const { totalTips, totalFil, totalUsdfc } = getTipStatistics()

  return (
    <div
      className={`bg-white dark:bg-gray-800 rounded-lg shadow-md hover:shadow-lg transition-all duration-300 ${
        mode === 'preview' ? '' : 'cursor-pointer'
      } overflow-hidden ${
        selected ? 'ring-2 ring-blue-500' : ''
      } ${className}`}
      onClick={handleItemClick}
    >
      {/* Thumbnail */}
      <div className="relative aspect-video bg-gray-200 dark:bg-gray-700 overflow-hidden">
        {item.img_cid && !imageError && imageUrl ? (
          <>
            {imageLoading && (
              <div className="absolute inset-0">
                <BoringAvatar hash={item.cid} variant="marble" />
              </div>
            )}
            <img
              src={imageUrl}
              alt={item.title}
              className={`w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 ${
                imageLoading ? 'opacity-0' : 'opacity-100'
              } ${isBlocked ? 'blur-xl scale-110' : ''}`}
              onLoad={() => setImageLoading(false)}
              onError={() => {
                setImageLoading(false)
                setImageError(true)
              }}
            />
          </>
        ) : (
          <div className={`w-full h-full ${isBlocked ? 'blur-xl scale-110' : ''}`}>
            <BoringAvatar hash={item.cid} variant="marble" />
          </div>
        )}

        {/* Blocked overlay */}
        {isBlocked && (
          <div className="absolute inset-0 bg-black/30 flex flex-col items-center justify-center gap-1.5">
            <NoSymbolIcon className="w-8 h-8 text-white/80" />
          </div>
        )}

        {/* Pending overlay */}
        {!isBlocked && item.isPending && (
          <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-1.5">
            <ArrowPathIcon className="animate-spin h-8 w-8 text-white" />
            <span className="text-white text-xs font-medium">{t('itemCard.waitingIpfsConfirm')}</span>
          </div>
        )}

        {/* Type badge - top left */}
        <div className={`absolute top-2 left-2 ${TYPE_COLORS[item.type] || TYPE_COLORS[0]} text-white text-xs px-2 py-1 rounded flex items-center gap-1`}>
          {getItemTypeIcon(item.type)}
          {getItemTypeName(item.type)}
        </div>

        {/* Editable mode checkbox */}
        {mode === 'editable' && (
          <div className="absolute top-2 right-2">
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
                selected
                  ? 'bg-blue-600 text-white'
                  : 'bg-white/80 text-gray-400 hover:bg-white'
              }`}
            >
              <CheckCircleIcon className="w-5 h-5" />
            </div>
          </div>
        )}

        {/* Epoch rank badges — medal + amount pill, top right */}
        {mode === 'default' && item.epochRanks && item.epochRanks.length > 0 && (
          <div className="absolute top-0 right-2 flex flex-col gap-1.5 items-end">
            {item.epochRanks.map((r) => {
              const c =
                r.rank === 1 ? { medal: '#FBBF24', medalInner: '#FDE68A', num: '#78350F', ribbon: '#D97706', pill: 'bg-yellow-500/85' } :
                               { medal: '#94A3B8', medalInner: '#CBD5E1', num: '#1E293B', ribbon: '#64748B', pill: 'bg-slate-500/85'  }
              return (
                <div key={r.token} className="flex items-center">
                  {/* Medal SVG: circle + two side ribbons */}
                  <div className="relative z-10 flex-shrink-0" style={{ margin: '0 -20px 0 0' }}>
                    <svg width="44" height="46" viewBox="0 0 44 46" fill="none" xmlns="http://www.w3.org/2000/svg">
                      {/* Left ribbon */}
                      <path d="M13 26 L5 42 L14 37 L18 42 L21 26Z" fill={c.ribbon} />
                      {/* Right ribbon */}
                      <path d="M31 26 L39 42 L30 37 L26 42 L23 26Z" fill={c.ribbon} />
                      {/* Outer circle */}
                      <circle cx="22" cy="20" r="16" fill={c.medal} />
                      {/* Inner circle */}
                      <circle cx="22" cy="20" r="12" fill={c.medalInner} />
                      {/* Rank number */}
                      <text x="22" y="25" textAnchor="middle" fontSize="13" fontWeight="900" fill={c.num} fontFamily="system-ui, sans-serif">{r.rank}</text>
                    </svg>
                  </div>
                  {/* Amount pill */}
                  <div className={`${c.pill} backdrop-blur-sm rounded-full pl-5 pr-3 py-1.5 shadow-md flex items-center gap-1`} style={{ margin: '-4px 0 0 0' }}>
                    <span className="text-xs font-bold text-white leading-none">{formatTipAmount(r.amount)}</span>
                    <span className="text-[11px] text-white/80 leading-none">{r.token}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-3">
        {/* Title */}
        <h3 className="font-semibold text-gray-900 dark:text-white mb-2 line-clamp-1 text-sm">
          {isBlocked
            ? '•'.repeat(Math.min(item.title.length, 16))
            : item.title}
        </h3>

        {/* Creator info */}
        {item.creator_name && mode !== 'preview' && (
          <div
            className={`flex items-center gap-2 mb-3 rounded p-1 -m-1 transition-colors h-10 ${
              isBlocked ? 'pointer-events-none' : 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50'
            }`}
            onClick={isBlocked ? undefined : handleCreatorClick}
          >
            <div className={`w-6 h-6 rounded-full overflow-hidden flex-shrink-0 ${isBlocked ? 'blur-sm' : ''}`}>
              {item.creator_avatar_cid && !avatarError && avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={item.creator_name}
                  className="w-full h-full object-cover"
                  onError={() => setAvatarError(true)}
                />
              ) : (
                <BoringAvatar hash={item.creator_name} variant="beam" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className={`text-xs truncate ${isBlocked ? 'text-transparent bg-gray-300 dark:bg-gray-600 rounded select-none' : 'text-gray-700 dark:text-gray-300'}`}>
                {isBlocked ? '••••••••' : item.creator_name}
              </div>
              {isBlocked ? (
                <div className="text-xs text-transparent bg-gray-200 dark:bg-gray-700 rounded w-16 mt-0.5">&nbsp;</div>
              ) : item.published_at && (() => {
                try {
                  const date = new Date(item.published_at)
                  if (isNaN(date.getTime())) return null
                  return (
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {date.toLocaleDateString()}
                    </div>
                  )
                } catch {
                  return null
                }
              })()}
            </div>
          </div>
        )}

        {/* Default mode - tip statistics / デフォルトモード - チップ統計 */}
        {mode === 'default' && (
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="bg-gray-50 dark:bg-gray-700 rounded px-2 py-2 flex items-center justify-center gap-1">
              <HeartIcon className="w-3.5 h-3.5 text-pink-500 flex-shrink-0" />
              <span className="text-xs font-medium text-gray-900 dark:text-white truncate">
                {formatNumber(totalTips)}
              </span>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700 rounded px-2 py-2 flex items-center justify-center">
              <span className="text-xs font-medium text-gray-900 dark:text-white truncate">
                {totalFil}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400 ml-0.5 flex-shrink-0">
                <span className="hidden sm:inline">FIL</span>
                <span className="inline sm:hidden">F</span>
              </span>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700 rounded px-2 py-2 flex items-center justify-center">
              <span className="text-xs font-medium text-gray-900 dark:text-white truncate">
                {totalUsdfc}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400 ml-0.5 flex-shrink-0">
                <span className="hidden sm:inline">USDFC</span>
                <span className="inline sm:hidden">U</span>
              </span>
            </div>
          </div>
        )}

        {/* Bottom area */}
        {mode === 'default' && (
          isBlocked ? (
            <button
              onClick={handleUnblock}
              className="w-full px-3 py-3 text-xs bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 rounded-lg transition-colors flex items-center justify-center gap-1.5"
            >
              <NoSymbolIcon className="w-3.5 h-3.5" />
              {t('itemCard.unblock')}
            </button>
          ) : (
            <div className="flex gap-2 items-stretch">
              <div className="flex-1">
                <WorkCacheControl cid={item.cid} title={item.title} onStatusChange={onCacheStatusChange} />
              </div>
              {/* Block button */}
              <div className="relative flex-shrink-0" ref={blockMenuRef}>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowBlockMenu((v) => !v) }}
                  className="h-full px-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-500 text-gray-500 dark:text-gray-400 rounded-lg transition-colors flex items-center justify-center"
                  title={t('itemCard.block')}
                >
                  <NoSymbolIcon className="w-4 h-4" />
                </button>
                {showBlockMenu && (
                  <div className="absolute bottom-full right-0 mb-1 z-50 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-600 py-1 min-w-[160px]">
                    <button
                      onClick={handleBlockWork}
                      className="w-full px-4 py-2.5 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                    >
                      {t('itemCard.blockWork')}
                    </button>
                    {item.creator_name && (
                      <button
                        onClick={handleBlockCreator}
                        className="w-full px-4 py-2.5 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                      >
                        {t('itemCard.blockCreator')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        )}

        {mode === 'editable' && (
          <div className="flex gap-2">
            <button
              onClick={handleEdit}
              className="flex-1 px-3 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            >
              {t('common.edit')}
            </button>
            <button
              onClick={handleDelete}
              className="flex-1 px-3 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
            >
              {t('common.delete')}
            </button>
          </div>
        )}

        {mode === 'ad' && (
          <AdSpacePurchase
            workCid={item.cid}
            adSpaceId={item.id ? parseInt(item.id, 10) : undefined}
            adStatus={item.adStatus}
            adWinnerAddress={item.adWinnerAddress}
            onPurchaseClick={handleAdPurchase}
          />
        )}

        {/* Preview mode - no bottom controls */}
      </div>
    </div>
  )
}

export default ItemCard
