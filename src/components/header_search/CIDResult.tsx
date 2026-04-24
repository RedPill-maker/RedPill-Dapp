import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppSelector } from '../../hooks/redux'
import { VideoState } from '../../store/slices/videoSlice'
import { SidebarState } from '../../store/slices/sidebarSlice'
import { searchWorks } from '../../utils/dbConnector'
import { ipfsConnector } from '../../utils/ipfsConnector'
import { APP_CONFIG } from '../../../config'
import { privateDataMgr } from '../../utils/privateDataMgr'
import LoadingSpinner from '../LoadingSpinner'
import ItemCard, { ItemCardData } from '../work_item/ItemCard'

interface CIDInfo {
  cid: string
  title: string
  desc: string
  type: number
  img_cid: string
  creator_name?: string
  source_ipns?: string
  file_name?: string
  file_size?: number
  is_creator_content: boolean
  from_database: boolean
}

const CIDResult: React.FC = () => {
  const videosState = useAppSelector((state) => state.videos) as VideoState
  const sidebarState = useAppSelector((state) => state.sidebar) as SidebarState
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cidInfo, setCidInfo] = useState<CIDInfo | null>(null)
  const { t } = useTranslation()

  const { searchQuery } = videosState
  const { isOpen } = sidebarState

  useEffect(() => {
    if (searchQuery) {
      searchCID(searchQuery)
    }
  }, [searchQuery])

  const detectFileType = (fileName: string): number => {
    const extension = fileName.toLowerCase().split('.').pop() || ''
    const videoExtensions = ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv', 'm4v', '3gp', 'ogv']
    if (videoExtensions.includes(extension)) return 1
    const audioExtensions = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'opus', 'aiff']
    if (audioExtensions.includes(extension)) return 2
    const markdownExtensions = ['md', 'markdown', 'mdown', 'mkd', 'mdx']
    if (markdownExtensions.includes(extension)) return 3
    return 0
  }

  const searchCID = async (cid: string) => {
    try {
      setLoading(true)
      setError(null)
      setCidInfo(null)

      console.log('Searching CID:', cid)

      // 1. Search database first
      try {
        const works = await searchWorks(cid, 1)
        if (works && works.length > 0) {
          const work = works[0]
          const cidInfoData: CIDInfo = {
            cid: work.cid,
            title: work.title,
            desc: work.description || t('common.noDescription'),
            type: work.content_type || 0,
            img_cid: work.img_cid || '',
            creator_name: work.creator_username,
            source_ipns: work.creator_username,
            is_creator_content: true,
            from_database: true,
          }
          setCidInfo(cidInfoData)
          console.log('Found CID content in database')
          return
        }
      } catch (dbError) {
        console.warn('Database search failed, trying IPFS network:', dbError)
      }

      // 2. No database result, search IPFS network
      console.log('No database result, searching IPFS network')
      await searchFromIPFS(cid)
    } catch (err) {
      console.error('CID search failed:', err)
      setError(err instanceof Error ? err.message : t('common.loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  const searchFromIPFS = async (cid: string) => {
    // 1. Try to get basic CID info
    let fileName = 'unknown_file'
    let fileSize = 0

    try {
      const fileContent = await ipfsConnector.downloadFile(cid)
      fileSize = fileContent.byteLength
      console.log('CID file size:', fileSize)
    } catch (err) {
      console.warn('Cannot download CID content:', err)
    }

    // 2. Check if this CID belongs to a creator's IPNS
    let creatorInfo: { ipns: string; siteInfo: any } | null = null

    try {
      const subscriptions = privateDataMgr.getAllSubscriptions()

      for (const subscription of subscriptions) {
        try {
          const resolvedCID = await ipfsConnector.resolveIPNS(subscription.ipns)
          const files = await ipfsConnector.listFiles(resolvedCID)
          const siteInfoFile = files.find((file) => file.name === APP_CONFIG.SITE_FILE_NAME)

          if (siteInfoFile) {
            const siteInfo = await ipfsConnector.downloadFileAsJSON(siteInfoFile.hash)

            if (siteInfo.works && Array.isArray(siteInfo.works)) {
              const foundItem = siteInfo.works.find(
                (item: any) => item.cid === cid || item.img_cid === cid,
              )

              if (foundItem) {
                creatorInfo = { ipns: subscription.ipns, siteInfo }
                const cidInfoData: CIDInfo = {
                  cid,
                  title: foundItem.title || t('cidResult.unnamedContent'),
                  desc: foundItem.desc || t('common.noDescription'),
                  type: foundItem.type || 0,
                  img_cid: foundItem.img_cid || '',
                  creator_name: siteInfo.username || siteInfo.title || t('common.unknownCreator'),
                  source_ipns: subscription.ipns,
                  file_size: fileSize,
                  is_creator_content: true,
                  from_database: false,
                }
                setCidInfo(cidInfoData)
                return
              }
            }
          }
        } catch (err) {
          console.warn(`Check IPNS ${subscription.ipns} failed:`, err)
        }
      }
    } catch (err) {
      console.warn('Failed to find creator info:', err)
    }

    // 3. Not creator content, treat as generic file
    if (!creatorInfo) {
      let inferredType = 0
      let inferredTitle = `CID_${cid.substring(0, 12)}`

      try {
        const fileContent = await ipfsConnector.downloadFile(cid)
        const contentType = await detectContentType(fileContent)
        if (contentType) {
          inferredType = contentType.type
          inferredTitle = contentType.title || inferredTitle
          fileName = contentType.fileName || fileName
        }
      } catch (err) {
        console.warn('Cannot analyze file content:', err)
      }

      const cidInfoData: CIDInfo = {
        cid,
        title: inferredTitle,
        desc: t('cidResult.unknownSourceDesc', { cid }),
        type: inferredType,
        img_cid: '',
        creator_name: t('common.unknownCreator'),
        file_name: fileName,
        file_size: fileSize,
        is_creator_content: false,
        from_database: false,
      }
      setCidInfo(cidInfoData)
    }
  }

  const detectContentType = async (
    content: ArrayBuffer,
  ): Promise<{ type: number; title?: string; fileName?: string } | null> => {
    try {
      const uint8Array = new Uint8Array(content)
      const header = Array.from(uint8Array.slice(0, 16))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')

      if (header.startsWith('ffd8ff')) return { type: 0, fileName: 'image.jpg' }
      if (header.startsWith('89504e47')) return { type: 0, fileName: 'image.png' }
      if (header.startsWith('474946')) return { type: 0, fileName: 'image.gif' }
      if (header.startsWith('25504446')) return { type: 0, fileName: 'document.pdf' }
      if (header.startsWith('504b0304')) return { type: 0, fileName: 'archive.zip' }

      try {
        const text = new TextDecoder('utf-8').decode(content)
        if (text.includes('# ') || text.includes('## ') || text.includes('### ')) {
          return { type: 3, title: t('cidResult.documentContent'), fileName: 'document.md' }
        }
        if (text.length > 0 && text.length < 10000) {
          return { type: 0, title: t('cidResult.textFile'), fileName: 'text.txt' }
        }
      } catch (err) {
        // not a text file
      }

      return null
    } catch (err) {
      return null
    }
  }

  const handleCreatorClick = (ipns: string) => {
    // Navigate to creator page
    console.log('Navigate to creator page:', ipns)
  }

  if (loading) {
    return (
      <main className={`pt-20 pb-8 transition-all duration-300 ${isOpen ? 'lg:ml-60' : 'ml-0'}`}>
        <div className="px-4 md:px-6">
          <div className="flex items-center justify-center py-12">
            <LoadingSpinner />
            <span className="ml-3 text-gray-600 dark:text-gray-400">
              {t('cidResult.searching')}
            </span>
          </div>
        </div>
      </main>
    )
  }

  if (error) {
    return (
      <main className={`pt-20 pb-8 transition-all duration-300 ${isOpen ? 'lg:ml-60' : 'ml-0'}`}>
        <div className="px-4 md:px-6">
          <div className="text-center py-12">
            <div className="text-6xl mb-4">❌</div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
              {t('cidResult.searchFailed')}
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-4">{error}</p>
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-4 max-w-md mx-auto">
              <h4 className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-2">
                💡 {t('cidResult.searchTips')}
              </h4>
              <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1 text-left">
                <li>• {t('cidResult.tip1')}</li>
                <li>• {t('cidResult.tip2')}</li>
                <li>• {t('cidResult.tip3')}</li>
                <li>• {t('cidResult.tip4')}</li>
              </ul>
            </div>
          </div>
        </div>
      </main>
    )
  }

  if (!cidInfo) {
    return (
      <main className={`pt-20 pb-8 transition-all duration-300 ${isOpen ? 'lg:ml-60' : 'ml-0'}`}>
        <div className="px-4 md:px-6">
          <div className="text-center py-12">
            <div className="text-6xl mb-4">🔍</div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
              {t('cidResult.notFound')}
            </h3>
            <p className="text-gray-600 dark:text-gray-400">
              {t('cidResult.notFoundDesc')}
            </p>
          </div>
        </div>
      </main>
    )
  }

  // Convert to ItemCard data format
  const itemCardData: ItemCardData = {
    id: `cid_${cidInfo.cid}`,
    title: cidInfo.title,
    desc: cidInfo.desc,
    type: cidInfo.type,
    img_cid: cidInfo.img_cid,
    cid: cidInfo.cid,
    source_ipns: cidInfo.source_ipns,
    creator_name: cidInfo.creator_name,
  }

  return (
    <main className={`pt-20 pb-8 transition-all duration-300 ${isOpen ? 'lg:ml-60' : 'ml-0'}`}>
      <div className="px-4 md:px-6">
        <div className="mb-6">
          <h2 className="text-lg font-medium text-gray-900 dark:text-white">
            {t('cidResult.title', { query: searchQuery })}
          </h2>
          <div className="flex items-center gap-3 mt-2">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {cidInfo.is_creator_content ? t('cidResult.creatorContent') : t('cidResult.unknownSourceFile')}
            </p>
            {cidInfo.from_database ? (
              <div className="inline-flex items-center px-3 py-1 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-full text-sm">
                <span className="text-green-600 dark:text-green-400 mr-1">✓</span>
                <span className="text-green-700 dark:text-green-300">{t('cidResult.fromDatabase')}</span>
              </div>
            ) : (
              <div className="inline-flex items-center px-3 py-1 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-full text-sm">
                <span className="text-blue-600 dark:text-blue-400 mr-1">🌐</span>
                <span className="text-blue-700 dark:text-blue-300">{t('cidResult.fromIpfs')}</span>
              </div>
            )}
          </div>
        </div>

        <div className="mb-6">
          {cidInfo.is_creator_content ? (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg p-4">
              <div className="flex items-start">
                <div className="text-green-500 mr-3 mt-1">✅</div>
                <div>
                  <h4 className="text-sm font-medium text-green-900 dark:text-green-100 mb-1">
                    {t('cidResult.creatorContentLabel')}
                  </h4>
                  <p className="text-sm text-green-700 dark:text-green-300">
                    {t('cidResult.contentFromCreator', { name: cidInfo.creator_name })}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg p-4">
              <div className="flex items-start">
                <div className="text-yellow-500 mr-3 mt-1">⚠️</div>
                <div>
                  <h4 className="text-sm font-medium text-yellow-900 dark:text-yellow-100 mb-1">
                    {t('cidResult.unknownSourceLabel')}
                  </h4>
                  <p className="text-sm text-yellow-700 dark:text-yellow-300">
                    {t('cidResult.unknownSourceWarning')}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="max-w-sm">
          <ItemCard item={itemCardData} onCreatorClick={cidInfo.source_ipns ? handleCreatorClick : undefined} />
        </div>

        <div className="mt-6 bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            {t('cidResult.detailInfo')}
          </h3>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">CID:</span>
              <code className="text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">
                {cidInfo.cid}
              </code>
            </div>
            {cidInfo.file_size && (
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">{t('cidResult.fileSize')}</span>
                <span className="text-gray-900 dark:text-white">
                  {ipfsConnector.formatFileSize(cidInfo.file_size)}
                </span>
              </div>
            )}
            {cidInfo.source_ipns && (
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">{t('cidResult.sourceIpns')}</span>
                <code className="text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">
                  {cidInfo.source_ipns.substring(0, 20)}...
                </code>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">{t('cidResult.contentType')}</span>
              <span className="text-gray-900 dark:text-white">
                {cidInfo.type === 0
                  ? t('common.contentTypes.file')
                  : cidInfo.type === 1
                    ? t('common.contentTypes.video')
                    : cidInfo.type === 2
                      ? t('common.contentTypes.audio')
                      : t('common.contentTypes.document')}
              </span>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}

export default CIDResult
