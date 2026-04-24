import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { privateDataMgr, SubscriptionItem } from '../utils/privateDataMgr'
import { useAppDispatch } from '../hooks/redux'
import { setCreatorPage } from '../store/slices/pageSlice'
import { ipfsConnector } from '../utils/ipfsConnector'
import { getWorksByCreators, getCreatorByUsername, Work, Creator } from '../utils/dbConnector'
import { APP_CONFIG, ITEM_TYPE, DEVELOPER_ACCOUNT } from '../../config'
import LoadingSpinner from './LoadingSpinner'
import ItemCard, { ItemCardData } from './work_item/ItemCard'
import BoringAvatar from './BoringAvatar'
import Logo from './Logo'
import { useBlacklist } from '../hooks/useBlacklist'
import {
  FolderIcon,
  VideoCameraIcon,
  MusicalNoteIcon,
  DocumentTextIcon,
  DocumentIcon,
  EllipsisVerticalIcon,
} from '@heroicons/react/24/outline'

// Convert Work (DB) to ItemCardData / Work (DB) を ItemCardData に変換
function workToCard(work: Work): ItemCardData {
  return {
    id: work.cid,
    title: work.title,
    desc: work.description || '',
    type: work.content_type,
    img_cid: work.img_cid || '',
    cid: work.cid,
    creator_name: work.creator_username,
    published_at: work.created_at,
  }
}

const PAGE_SIZE = 20

const MySubscribe: React.FC = () => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [subscriptions, setSubscriptions] = useState<SubscriptionItem[]>([])
  const { filterItems } = useBlacklist()

  // Categorize: with username vs IPNS only / 分類：ユーザー名ありと IPNS のみ
  const [usernameSubs, setUsernameSubs] = useState<SubscriptionItem[]>([])
  const [ipnsOnlySubs, setIpnsOnlySubs] = useState<SubscriptionItem[]>([])

  // Creator info and avatar error state / クリエイター情報とアバターエラー状態
  const [creatorsInfo, setCreatorsInfo] = useState<Map<string, Creator>>(new Map())
  const [avatarErrors, setAvatarErrors] = useState<Set<string>>(new Set())

  // Content state / コンテンツ状態
  const [contents, setContents] = useState<ItemCardData[]>([])
  const [selectedType, setSelectedType] = useState<number | null>(null)
  const [contentLoading, setContentLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Pagination / ページネーション
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  // Current view mode: 'all' = all username subscriptions, 'ipns:xxx' = certain IPNS author, 'username:xxx' = certain username author / 現在のビューモード: 'all' = すべてのユーザー名サブスクリプション、'ipns:xxx' = 特定の IPNS 作者、'username:xxx' = 特定のユーザー名作者
  const [viewMode, setViewMode] = useState<string>('all')

  // IPNS loading author (not used yet, reserved for displaying loading state) / IPNS ロード中の作者（未使用、ロード状態表示用に予約）
  // const [ipnsLoadingKey, setIpnsLoadingKey] = useState<string | null>(null)

  // Dropdown menu state / ドロップダウンメニュー状態
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadSubscriptions()
  }, [])

  useEffect(() => {
    if (usernameSubs.length > 0 && viewMode === 'all') {
      loadUsernameContents(1, true)
    } else if (usernameSubs.length === 0 && viewMode === 'all') {
      // When no subscriptions, default to showing RedPill account
      handleViewChange(`username:${DEVELOPER_ACCOUNT}`)
    }
  }, [usernameSubs])

  // Load creator info / クリエイター情報を読み込む
  useEffect(() => {
    const loadCreatorsInfo = async () => {
      const newCreatorsInfo = new Map<string, Creator>()
      for (const sub of usernameSubs) {
        if (sub.username) {
          const creator = await getCreatorByUsername(sub.username)
          if (creator) {
            newCreatorsInfo.set(sub.username, creator)
          }
        }
      }
      setCreatorsInfo(newCreatorsInfo)
    }
    if (usernameSubs.length > 0) {
      loadCreatorsInfo()
    }
  }, [usernameSubs])

  const loadSubscriptions = () => {
    try {
      const subs = privateDataMgr.getAllSubscriptions()
      setSubscriptions(subs)

      const withUsername: SubscriptionItem[] = []
      const ipnsOnly: SubscriptionItem[] = []
      for (const sub of subs) {
        if (sub.username) {
          withUsername.push(sub)
        } else if (sub.ipns) {
          ipnsOnly.push(sub)
        }
      }
      setUsernameSubs(withUsername)
      setIpnsOnlySubs(ipnsOnly)
    } catch (err) {
      console.error('Failed to load subscription list:', err)
      setError(t('subscribe.loadFailed'))
    }
  }

  // Load works from username subscriptions (from database) / ユーザー名サブスクリプションから作品を読み込む（データベースから）
  const loadUsernameContents = async (pageNum: number, reset: boolean) => {
    if (reset) {
      setContentLoading(true)
      setError(null)
    } else {
      setLoadingMore(true)
    }

    try {
      let usernames: string[]
      if (viewMode.startsWith('username:')) {
        usernames = [viewMode.slice('username:'.length)]
      } else {
        // 'all' mode - all subscriptions with username / 'all' モード - ユーザー名を持つすべてのサブスクリプション
        usernames = usernameSubs.map((s) => s.username!).filter(Boolean)
      }

      if (usernames.length === 0) {
        if (reset) setContents([])
        setHasMore(false)
        return
      }

      const works = await getWorksByCreators(usernames, pageNum, PAGE_SIZE)
      const cards = works.map(workToCard)

      if (reset) {
        setContents(cards)
      } else {
        setContents((prev) => [...prev, ...cards])
      }

      setHasMore(cards.length >= PAGE_SIZE)
      setPage(pageNum)
    } catch (err) {
      console.error('Failed to load subscription content:', err)
      if (reset) setError(t('subscribe.loadContentFailed'))
    } finally {
      setContentLoading(false)
      setLoadingMore(false)
    }
  }

  // Load content from IPNS author / IPNS 作者のコンテンツを読み込む
  const loadIpnsContents = async (ipns: string) => {
    setContentLoading(true)
    setError(null)
    // setIpnsLoadingKey(ipns)

    try {
      const resolvedCID = await ipfsConnector.resolveIPNS(ipns)
      const files = await ipfsConnector.listFiles(resolvedCID)
      const siteInfoFile = files.find(
        (file) => file.name === APP_CONFIG.SITE_FILE_NAME,
      )

      if (!siteInfoFile) {
        setError(t('subscribe.creatorContentNotFound'))
        setContents([])
        return
      }

      const siteInfo = await ipfsConnector.downloadFileAsJSON(siteInfoFile.hash)
      const subscription = subscriptions.find((sub) => sub.ipns === ipns)

      // Support works field (contract-aligned naming) / works フィールドをサポート（コントラクト整列命名）
      const worksList = siteInfo.works
      if (worksList && Array.isArray(worksList)) {
        const cards: ItemCardData[] = worksList.map(
          (item: any, index: number) => ({
            id: `${ipns}_${index}`,
            title: item.title || t('common.unnamed'),
            desc: item.desc || t('common.noDescription'),
            type: item.type || 0,
            img_cid: item.img_cid || '',
            cid: item.cid || '',
            source_ipns: ipns,
            creator_name:
              subscription?.title || siteInfo.title || t('common.unknownCreator'),
            published_at: item.published_at || item.created_at,
          }),
        )
        setContents(cards)
      } else {
        setContents([])
      }
      setHasMore(false) // IPNS does not paginate
    } catch (err) {
      console.error('Failed to load IPNS content:', err)
      setError(t('subscribe.ipnsLoadFailed'))
      setContents([])
    } finally {
      setContentLoading(false)
      // setIpnsLoadingKey(null)
    }
  }

  // Switch view / ビューを切り替え
  const handleViewChange = (mode: string) => {
    setViewMode(mode)
    setSelectedType(null)
    setPage(1)
    setHasMore(true)
    setContents([])

    if (mode === 'all') {
      loadUsernameContents(1, true)
    } else if (mode.startsWith('username:')) {
      // Single username author - load from DB / 単一ユーザー名作者 - DB から読み込む
      const username = mode.slice('username:'.length)
      setContentLoading(true)
      setError(null)
      getWorksByCreators([username], 1, PAGE_SIZE).then((works) => {
        setContents(works.map(workToCard))
        setHasMore(works.length >= PAGE_SIZE)
        setPage(1)
        setContentLoading(false)
      }).catch(() => {
        setError(t('subscribe.loadContentFailed'))
        setContentLoading(false)
      })
    } else if (mode.startsWith('ipns:')) {
      // IPNS author - need manual click to load / IPNS 作者 - 手動クリックで読み込む必要
      // Do not auto load, wait for user confirmation / 自動読み込みしない、ユーザー確認を待つ
    }
  }

  // IPNS author manual load / IPNS 作者手動読み込み
  const handleIpnsLoad = (ipns: string) => {
    setViewMode(`ipns:${ipns}`)
    loadIpnsContents(ipns)
  }

  // Infinite scroll / 無限スクロール
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el || loadingMore || !hasMore || contentLoading) return
    // Only support pagination for DB query content / DB クエリコンテンツのみページネーションをサポート
    if (viewMode.startsWith('ipns:')) return

    const { scrollTop, scrollHeight, clientHeight } = el
    if (scrollHeight - scrollTop - clientHeight < 200) {
      loadUsernameContents(page + 1, false)
    }
  }, [loadingMore, hasMore, contentLoading, page, viewMode, usernameSubs])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('scroll', handleScroll)
    return () => el.removeEventListener('scroll', handleScroll)
  }, [handleScroll])

  const handleUnsubscribe = (sub: SubscriptionItem) => {
    if (confirm(t('subscribe.confirmUnsubscribe'))) {
      const success = sub.username
        ? privateDataMgr.removeSubscriptionByUsernameOrIpns(sub.username, sub.ipns)
        : privateDataMgr.removeSubscription(sub.ipns)
      if (success) {
        loadSubscriptions()
        // If the currently selected item is deleted, switch back to All
        if (
          (sub.username && viewMode === `username:${sub.username}`) ||
          (sub.ipns && viewMode === `ipns:${sub.ipns}`)
        ) {
          handleViewChange('all')
        }
      }
    }
  }

  const handleCreatorClick = (ipns: string) => {
    if (ipns) {
      dispatch(setCreatorPage(ipns))
    }
  }

  const getTypeIcon = (type: number) => {
    const iconClass = "w-5 h-5"
    switch (type) {
      case 0: return <FolderIcon className={iconClass} />
      case 1: return <VideoCameraIcon className={iconClass} />
      case 2: return <MusicalNoteIcon className={iconClass} />
      case 3: return <DocumentTextIcon className={iconClass} />
      default: return <DocumentIcon className={iconClass} />
    }
  }

  const getTypeName = (type: number) => {
    switch (type) {
      case 0: return t('common.contentTypes.file')
      case 1: return t('common.contentTypes.video')
      case 2: return t('common.contentTypes.audio')
      case 3: return t('common.contentTypes.imageText')
      default: return t('common.contentTypes.unknown')
    }
  }

  const filteredContents =
    selectedType !== null
      ? filterItems(contents).filter((c) => c.type === selectedType)
      : filterItems(contents)

  const getSubKey = (sub: SubscriptionItem) => sub.username || sub.ipns

  const isSelected = (sub: SubscriptionItem) => {
    if (sub.username) return viewMode === `username:${sub.username}`
    return viewMode === `ipns:${sub.ipns}`
  }

  return (
    <div className="max-w-full">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          {t('subscribe.title')}
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          {t('subscribe.description')}
        </p>
      </div>

      <div className="flex gap-4">
        {/* Left side: Creator list */}
        <div className="w-64 flex-shrink-0">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
            <div className="p-3 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                {t('subscribe.subscriptionList')} ({subscriptions.length})
              </h2>
            </div>

            <div className="max-h-[calc(100vh-300px)] overflow-y-auto">
              {/* All content options */}
              {usernameSubs.length > 0 && (
                <div
                  onClick={() => handleViewChange('all')}
                  className={`p-3 cursor-pointer border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                    viewMode === 'all'
                      ? 'bg-blue-50 dark:bg-blue-900/20 border-l-4 border-l-blue-500'
                      : ''
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold">
                      {t('subscribe.allContent').charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                        {t('subscribe.allContent')}
                      </h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t('subscribe.allContentDesc')}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Creator with username (on-chain) */}
              <div className="px-3 pt-2 pb-1">
                <span className="text-xs text-gray-400 dark:text-gray-500">{t('subscribe.onchainCreators')}</span>
              </div>
              
              {/* Fixed developer account subscription -always shown */}
              <div
                onClick={() => handleViewChange(`username:${DEVELOPER_ACCOUNT}`)}
                className={`p-3 cursor-pointer border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                  viewMode === `username:${DEVELOPER_ACCOUNT}`
                    ? 'bg-blue-50 dark:bg-blue-900/20 border-l-4 border-l-blue-500'
                    : ''
                }`}
              >
                <div className="flex items-center space-x-2">
                  <div className="w-8 h-8 p-1 rounded-full overflow-hidden flex-shrink-0">
                    <Logo className="text-red-600 dark:text-red-500" width={24} height={24} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {DEVELOPER_ACCOUNT}
                    </h3>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      {t('subscribe.defaultSubscription')}
                    </p>
                  </div>
                </div>
              </div>
              
              {usernameSubs.map((sub) => {
                const creator = sub.username ? creatorsInfo.get(sub.username) : null
                const avatarCid = creator?.avatar_cid
                const hasAvatarError = sub.username ? avatarErrors.has(sub.username) : false
                const subKey = getSubKey(sub)
                const isMenuOpen = openMenuKey === subKey
                
                return (
                  <div
                    key={subKey}
                    className={`p-3 cursor-pointer border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors relative ${
                      isSelected(sub)
                        ? 'bg-blue-50 dark:bg-blue-900/20 border-l-4 border-l-blue-500'
                        : ''
                    }`}
                  >
                    <div
                      onClick={() => handleViewChange(`username:${sub.username}`)}
                      className="flex items-center space-x-2"
                    >
                      <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0">
                        {avatarCid && !hasAvatarError ? (
                          <img
                            src={ipfsConnector.getGatewayUrl(avatarCid)}
                            alt={sub.username}
                            className="w-full h-full object-cover"
                            onError={() => {
                              if (sub.username) {
                                setAvatarErrors(prev => new Set(prev).add(sub.username!))
                              }
                            }}
                          />
                        ) : (
                          <BoringAvatar hash={sub.username || 'user'} variant="beam" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {sub.title || sub.username || t('subscribe.unnamedCreator')}
                        </h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {sub.username ? `@${sub.username}` : sub.desc || t('common.noDescription')}
                        </p>
                        <p className="text-xs text-gray-400 dark:text-gray-500">
                          {new Date(sub.subscribedAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    
                    {/* three dot menu button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setOpenMenuKey(isMenuOpen ? null : subKey)
                      }}
                      className="absolute top-2 right-2 p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                    >
                      <EllipsisVerticalIcon className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                    </button>

                    {/* drop down menu */}
                    {isMenuOpen && (
                      <>
                        <div
                          className="fixed inset-0 z-10"
                          onClick={() => setOpenMenuKey(null)}
                        />
                        <div className="absolute top-8 right-2 z-20 bg-white dark:bg-gray-700 rounded-lg shadow-lg border border-gray-200 dark:border-gray-600 py-1 min-w-[120px]">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setOpenMenuKey(null)
                              handleUnsubscribe(sub)
                            }}
                            className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-gray-100 dark:text-red-400 dark:hover:bg-gray-600 transition-colors"
                          >
                            {t('subscribe.unsubscribe')}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )
              })}

              {/*IPNS creators only */}
              {ipnsOnlySubs.length > 0 && (
                <div className="px-3 pt-2 pb-1">
                  <span className="text-xs text-gray-400 dark:text-gray-500">{t('subscribe.ipnsCreatorsClickToLoad')}</span>
                </div>
              )}
              {ipnsOnlySubs.map((sub) => {
                const subKey = sub.ipns
                const isMenuOpen = openMenuKey === subKey
                
                return (
                  <div
                    key={subKey}
                    className={`p-3 cursor-pointer border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors relative ${
                      isSelected(sub)
                        ? 'bg-blue-50 dark:bg-blue-900/20 border-l-4 border-l-blue-500'
                        : ''
                    }`}
                  >
                    <div
                      onClick={() => handleIpnsLoad(sub.ipns)}
                      className="flex items-center space-x-2"
                    >
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-400 to-yellow-500 flex items-center justify-center text-white text-xs font-bold">
                        {(sub.title || 'I').charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {sub.title || t('subscribe.unnamedCreator')}
                        </h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {sub.desc || 'IPNS'}
                        </p>
                        <p className="text-xs text-gray-400 dark:text-gray-500">
                          {new Date(sub.subscribedAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    
                    {/*Three-dot menu button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setOpenMenuKey(isMenuOpen ? null : subKey)
                      }}
                      className="absolute top-2 right-2 p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                    >
                      <EllipsisVerticalIcon className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                    </button>

                    {/*drop-down menu */}
                    {isMenuOpen && (
                      <>
                        <div
                          className="fixed inset-0 z-10"
                          onClick={() => setOpenMenuKey(null)}
                        />
                        <div className="absolute top-8 right-2 z-20 bg-white dark:bg-gray-700 rounded-lg shadow-lg border border-gray-200 dark:border-gray-600 py-1 min-w-[120px]">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setOpenMenuKey(null)
                              handleUnsubscribe(sub)
                            }}
                            className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-gray-100 dark:text-red-400 dark:hover:bg-gray-600 transition-colors"
                          >
                            {t('subscribe.unsubscribe')}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )
              })}

              {subscriptions.length === 0 && (
                <div className="p-6 text-center">
                  <p className="text-gray-500 dark:text-gray-400 text-xs">
                    {t('subscribe.noOtherSubscriptions')}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/*Right side: content display */}
        <div className="flex-1 flex flex-col" style={{ maxHeight: 'calc(100vh - 220px)' }}>
          {viewMode.startsWith('ipns:') && contents.length === 0 && !contentLoading && !error ? (
            <div className="text-center py-12">
              <DocumentTextIcon className="w-24 h-24 mx-auto mb-4 text-gray-400 dark:text-gray-500" />
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                {t('subscribe.ipnsCreators')}
              </h2>
              <p className="text-gray-600 dark:text-gray-400">
                {t('subscribe.clickIpnsToLoad')}
              </p>
            </div>
          ) : (
            <>
              {/*Content type filter -fixed at top */}
              <div className="mb-4 flex-shrink-0">
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setSelectedType(null)}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${
                      selectedType === null
                        ? 'bg-red-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    {t('common.all')} ({contents.length})
                  </button>
                  {ITEM_TYPE.map((_, index) => {
                    const count = contents.filter((c) => c.type === index).length
                    if (count === 0) return null
                    return (
                      <button
                        key={index}
                        onClick={() => setSelectedType(index)}
                        className={`px-4 py-2 rounded-full text-sm font-medium transition-colors whitespace-nowrap inline-flex items-center gap-1 ${
                          selectedType === index
                            ? 'bg-red-600 text-white'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                      >
                        <span>{getTypeIcon(index)}</span>
                        <span>{getTypeName(index)} ({count})</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/*Scrollable content area */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto">
                {/* Loading status */}
                {contentLoading && (
                  <div className="flex items-center justify-center py-12">
                    <LoadingSpinner />
                    <span className="ml-3 text-gray-600 dark:text-gray-400">
                      {t('subscribe.loadingContent')}
                    </span>
                  </div>
                )}

                {/* error status */}
                {error && (
                  <div className="text-center py-12">
                    <div className="text-6xl mb-4">❌</div>
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                      {t('common.loadFailed')}
                    </h3>
                    <p className="text-gray-600 dark:text-gray-400">{error}</p>
                  </div>
                )}

                {/* Contents list */}
                {!contentLoading && !error && (
                  <>
                    {filteredContents.length === 0 ? (
                      <div className="text-center py-12">
                        <div className="text-6xl mb-4">📄</div>
                        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                          {t('common.noContent')}
                        </h2>
                        <p className="text-gray-600 dark:text-gray-400">
                          {selectedType !== null
                            ? `${t('subscribe.noTypeContent', { type: getTypeName(selectedType) })}`
                            : t('subscribe.noPublishedContent')}
                        </p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {filteredContents.map((content) => (
                          <ItemCard
                            key={content.id}
                            item={content}
                            onCreatorClick={handleCreatorClick}
                          />
                        ))}
                      </div>
                    )}

                    {/*Load more indicators */}
                    {loadingMore && (
                      <div className="flex items-center justify-center py-6">
                        <LoadingSpinner />
                        <span className="ml-3 text-gray-500 dark:text-gray-400 text-sm">
                          {t('common.loadMore')}
                        </span>
                      </div>
                    )}

                    {!hasMore && contents.length > 0 && (
                      <div className="text-center py-6 text-gray-400 dark:text-gray-500 text-sm">
                        {t('common.allLoaded')}
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default MySubscribe
