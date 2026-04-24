import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeftIcon } from '@heroicons/react/24/outline'
import { useAppSelector } from '../../hooks/redux'
import { VideoState } from '../../store/slices/videoSlice'
import { SidebarState } from '../../store/slices/sidebarSlice'
import { ipfsConnector } from '../../utils/ipfsConnector'
import { getCreatorByUsername } from '../../utils/dbConnector'
import { APP_CONFIG } from '../../../config'
import { privateDataMgr } from '../../utils/privateDataMgr'
import LoadingSpinner from '../LoadingSpinner'
import CreatorPage from '../CreatorPage'

interface CreatorInfo {
  ipnsId: string
  title: string
  desc: string
  bg_cid?: string
  avatar_cid?: string
  username?: string
  items?: any[]
  from_database: boolean
}

const CreatorList: React.FC = () => {
  const videosState = useAppSelector((state) => state.videos) as VideoState
  const sidebarState = useAppSelector((state) => state.sidebar) as SidebarState
  const [creators, setCreators] = useState<CreatorInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedCreator, setSelectedCreator] = useState<string | null>(null)
  const [showUnsubscribeModal, setShowUnsubscribeModal] = useState<string | null>(null)
  const { t } = useTranslation()

  const { searchQuery } = videosState
  const { isOpen } = sidebarState

  // IPNS address regex
  const isIPNSAddress = (query: string): boolean => {
    // IPNS address formats:
    // 1. k2-prefixed libp2p-key format (~62 chars)
    // 2. k51-prefixed format (~62 chars)
    // 3. Other k-prefixed CIDv1 formats
    const ipnsRegex = /^k[0-9a-z]{50,}$/i
    // Legacy IPFS hash format (Qm-prefixed, 46 chars)
    const legacyRegex = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/
    return ipnsRegex.test(query) || legacyRegex.test(query)
  }

  useEffect(() => {
    if (searchQuery && isIPNSAddress(searchQuery)) {
      searchCreator(searchQuery)
    } else {
      setCreators([])
      setError(null)
    }
  }, [searchQuery])

  const searchCreator = async (ipnsId: string) => {
    try {
      setLoading(true)
      setError(null)

      console.log('Searching IPNS creator:', ipnsId)

      // 1. Search database first (query by IPNS address as username)
      try {
        const dbCreator = await getCreatorByUsername(ipnsId)
        if (dbCreator) {
          console.log('Found creator in database:', dbCreator)
          const creatorInfo: CreatorInfo = {
            ipnsId: dbCreator.ipns_address || ipnsId,
            title: dbCreator.title || dbCreator.username,
            desc: dbCreator.description || t('common.noDescription'),
            bg_cid: dbCreator.background_cid || undefined,
            avatar_cid: dbCreator.avatar_cid || undefined,
            username: dbCreator.username,
            items: [], // work_count field in database represents work count
            from_database: true,
          }
          setCreators([creatorInfo])
          return
        }
      } catch (dbError) {
        console.warn('Database search failed, trying IPFS network:', dbError)
      }

      // 2. No database result, search IPFS network
      console.log('No database result, searching IPFS network')
      await searchFromIPFS(ipnsId)
    } catch (err) {
      console.error('Creator search failed:', err)
      setError(err instanceof Error ? err.message : t('common.loadFailed'))
      setCreators([])
    } finally {
      setLoading(false)
    }
  }

  const searchFromIPFS = async (ipnsId: string) => {
    // 1. Resolve IPNS
    const resolvedCID = await ipfsConnector.resolveIPNS(ipnsId)
    console.log('IPNS resolved, CID:', resolvedCID)

    // 2. Get file list
    const files = await ipfsConnector.listFiles(resolvedCID)
    console.log('File list:', files)

    // 3. Find site_info.json
    const siteInfoFile = files.find((file) => file.name === APP_CONFIG.SITE_FILE_NAME)

    if (siteInfoFile) {
      console.log('Found site_info.json:', siteInfoFile)

      // 4. Download and parse site info
      const siteInfo = await ipfsConnector.downloadFileAsJSON(siteInfoFile.hash)
      console.log('Site info:', siteInfo)

      const creatorInfo: CreatorInfo = {
        ipnsId,
        title: siteInfo.title || t('common.unnamed'),
        desc: siteInfo.desc || t('common.noDescription'),
        bg_cid: siteInfo.bg_cid,
        avatar_cid: siteInfo.avatar_cid,
        username: siteInfo.username,
        items: siteInfo.works || [],
        from_database: false,
      }
      setCreators([creatorInfo])
    } else {
      setError(t('creatorList.notCreatorPage'))
      setCreators([])
    }
  }

  const handleCreatorClick = (ipnsId: string) => {
    setSelectedCreator(ipnsId)
  }

  const handleBackToList = () => {
    setSelectedCreator(null)
  }

  const handleSubscribe = (e: React.MouseEvent, creator: CreatorInfo) => {
    e.stopPropagation()
    const success = privateDataMgr.addSubscription(
      creator.ipnsId,
      creator.username || creator.title,
      creator.desc,
    )
    if (success) {
      setCreators([...creators])
    }
  }

  const handleUnsubscribe = (e: React.MouseEvent, ipnsId: string) => {
    e.stopPropagation()
    setShowUnsubscribeModal(ipnsId)
  }

  const confirmUnsubscribe = () => {
    if (showUnsubscribeModal) {
      const success = privateDataMgr.removeSubscription(showUnsubscribeModal)
      if (success) {
        setCreators([...creators])
      }
      setShowUnsubscribeModal(null)
    }
  }

  const cancelUnsubscribe = () => {
    setShowUnsubscribeModal(null)
  }

  // If a creator is selected, show creator page
  if (selectedCreator) {
    return (
      <main className={`pt-20 pb-8 transition-all duration-300 ${isOpen ? 'lg:ml-60' : 'ml-0'}`}>
        <div className="px-4 md:px-6">
          <div className="mb-6">
            <button
              onClick={handleBackToList}
              className="flex items-center text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              <ChevronLeftIcon className="w-5 h-5 mr-2" />
              {t('creatorList.backToResults')}
            </button>
          </div>
          <CreatorPage ipnsId={selectedCreator} />
        </div>
      </main>
    )
  }

  return (
    <main className={`pt-20 pb-8 transition-all duration-300 ${isOpen ? 'lg:ml-60' : 'ml-0'}`}>
      <div className="px-4 md:px-6">
        {searchQuery && (
          <div className="mb-6">
            <h2 className="text-lg font-medium text-gray-900 dark:text-white">
              {t('creatorList.title', { query: searchQuery })}
            </h2>
            {isIPNSAddress(searchQuery) ? (
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                {t('creatorList.searchingIpns')}
              </p>
            ) : (
              <p className="text-sm text-orange-600 dark:text-orange-400 mt-1">
                {t('creatorList.invalidIpns')}
              </p>
            )}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-12">
            <LoadingSpinner />
            <span className="ml-3 text-gray-600 dark:text-gray-400">
              {t('creatorList.searching')}
            </span>
          </div>
        )}

        {error && (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">❌</div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
              {t('creatorList.searchFailed')}
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-4">{error}</p>
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-4 max-w-md mx-auto">
              <h4 className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-2">
                💡 {t('creatorList.searchTips')}
              </h4>
              <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
                <li>• {t('creatorList.tip1')}</li>
                <li>• {t('creatorList.tip2')}</li>
                <li>• {t('creatorList.tip3')}</li>
                <li>• {t('creatorList.tip4')}</li>
              </ul>
            </div>
          </div>
        )}

        {!loading && !error && creators.length > 0 && (
          <div className="space-y-4">
            {creators.map((creator) => (
              <div key={creator.ipnsId}>
                {creator.from_database ? (
                  <div className="mb-2 inline-flex items-center px-3 py-1 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-full text-sm">
                    <span className="text-green-600 dark:text-green-400 mr-1">✓</span>
                    <span className="text-green-700 dark:text-green-300">{t('creatorList.fromDatabase')}</span>
                  </div>
                ) : (
                  <div className="mb-2 inline-flex items-center px-3 py-1 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-full text-sm">
                    <span className="text-blue-600 dark:text-blue-400 mr-1">🌐</span>
                    <span className="text-blue-700 dark:text-blue-300">{t('creatorList.fromIpfs')}</span>
                  </div>
                )}

                <div
                  onClick={() => handleCreatorClick(creator.ipnsId)}
                  className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6 cursor-pointer hover:shadow-lg transition-all duration-300 hover:border-blue-300 dark:hover:border-blue-600"
                >
                  <div className="flex items-start space-x-4">
                    <div className="flex-shrink-0">
                      {creator.avatar_cid ? (
                        <img
                          src={ipfsConnector.getGatewayUrl(creator.avatar_cid)}
                          alt={t('creatorList.creatorAvatar')}
                          className="w-16 h-16 rounded-full object-cover border-2 border-gray-200 dark:border-gray-600"
                        />
                      ) : (
                        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xl font-bold">
                          {creator.username
                            ? creator.username.charAt(0).toUpperCase()
                            : creator.title.charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2 mb-2">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white truncate">
                          {creator.username || creator.title}
                        </h3>
                        <span className="text-green-500">✓</span>
                      </div>

                      {creator.username && creator.title !== creator.username && (
                        <p className="text-md text-gray-700 dark:text-gray-300 mb-2">{creator.title}</p>
                      )}

                      <p className="text-gray-600 dark:text-gray-400 mb-3 line-clamp-2">{creator.desc}</p>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-4 text-sm text-gray-500 dark:text-gray-400">
                          <span>📄 {t('creatorList.contentCount', { count: creator.items?.length || 0 })}</span>
                          <span>🔗 IPNS</span>
                        </div>

                        <div className="flex items-center space-x-2">
                          {privateDataMgr.isSubscribed(creator.ipnsId) ? (
                            <button
                              onClick={(e) => handleUnsubscribe(e, creator.ipnsId)}
                              className="px-3 py-1 bg-gray-200 hover:bg-gray-300 dark:bg-gray-600 dark:hover:bg-gray-500 text-gray-700 dark:text-gray-300 rounded text-sm font-medium transition-colors"
                            >
                              {t('creatorList.subscribed')}
                            </button>
                          ) : (
                            <button
                              onClick={(e) => handleSubscribe(e, creator)}
                              className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-medium transition-colors"
                            >
                              {t('creatorList.subscribe')}
                            </button>
                          )}
                          <button className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium">
                            {t('creatorList.viewHomepage')}
                          </button>
                        </div>
                      </div>

                      <div className="mt-3 p-2 bg-gray-50 dark:bg-gray-700 rounded text-xs">
                        <span className="text-gray-500 dark:text-gray-400">IPNS: </span>
                        <code className="text-gray-700 dark:text-gray-300">
                          {creator.ipnsId.substring(0, 20)}...{creator.ipnsId.substring(creator.ipnsId.length - 10)}
                        </code>
                      </div>
                    </div>
                  </div>

                  {creator.bg_cid && (
                    <div className="mt-4 rounded-lg overflow-hidden">
                      <img
                        src={ipfsConnector.getGatewayUrl(creator.bg_cid)}
                        alt={t('creatorList.backgroundPreview')}
                        className="w-full h-32 object-cover opacity-60"
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && !error && searchQuery && !isIPNSAddress(searchQuery) && (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">🔍</div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
              {t('creatorList.enterIpnsAddress')}
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              {t('creatorList.enterIpnsDesc')}
            </p>
            <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 max-w-md mx-auto">
              <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-2">
                {t('creatorList.ipnsFormatExample')}
              </h4>
              <div className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                <div>
                  <span className="font-mono bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">k2k4r8...</span>
                  <span className="ml-2">{t('creatorList.libp2pFormat')}</span>
                </div>
                <div>
                  <span className="font-mono bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">k51qzi5...</span>
                  <span className="ml-2">{t('creatorList.cidv1Format')}</span>
                </div>
                <div>
                  <span className="font-mono bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">QmXXXXXX...</span>
                  <span className="ml-2">{t('creatorList.legacyFormat')}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {showUnsubscribeModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              {t('creatorList.confirmUnsubscribe')}
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              {t('creatorList.confirmUnsubscribeDesc')}
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={cancelUnsubscribe}
                className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={confirmUnsubscribe}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
              >
                {t('creatorList.confirmUnsubscribeBtn')}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

export default CreatorList
