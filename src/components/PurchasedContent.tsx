import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ITEM_TYPE } from '../../config'

interface PurchasedItem {
  id: string
  title: string
  desc: string
  type: number
  img_cid: string
  cid: string
  purchaseDate: string
  price: number
}

const PurchasedContent: React.FC = () => {
  const { t } = useTranslation()
  const [selectedType, setSelectedType] = useState<number | null>(null)

  // Mock purchased content data
  const mockPurchasedItems: PurchasedItem[] = [
    {
      id: '1',
      title: 'React Advanced Development Tutorial',
      desc: 'Deep dive into React advanced features and best practices',
      type: 0, // file
      img_cid: 'QmVFA7tSuUKSmVZhMidxq1e4JYSU2snkzVQT5NZFHQQb7Y',
      cid: 'QmExample1',
      purchaseDate: '2024-01-15',
      price: 99,
    },
    {
      id: '2',
      title: 'JavaScript Advanced Video Course',
      desc: 'Complete JavaScript learning path from basics to advanced',
      type: 1, // video
      img_cid: 'QmVFA7tSuUKSmVZhMidxq1e4JYSU2snkzVQT5NZFHQQb7Y',
      cid: 'QmExample2',
      purchaseDate: '2024-01-10',
      price: 199,
    },
    {
      id: '3',
      title: 'Programming Music Album',
      desc: 'Focus music collection designed for programmers',
      type: 2, // audio
      img_cid: 'QmVFA7tSuUKSmVZhMidxq1e4JYSU2snkzVQT5NZFHQQb7Y',
      cid: 'QmExample3',
      purchaseDate: '2024-01-08',
      price: 49,
    },
    {
      id: '4',
      title: 'Complete Web Development Guide',
      desc: 'Complete web development tutorial with illustrations',
      type: 3, // markdown
      img_cid: 'QmVFA7tSuUKSmVZhMidxq1e4JYSU2snkzVQT5NZFHQQb7Y',
      cid: 'QmExample4',
      purchaseDate: '2024-01-05',
      price: 149,
    },
    {
      id: '5',
      title: 'TypeScript Practical Project',
      desc: 'TypeScript enterprise-level project development in practice',
      type: 0, // file
      img_cid: 'QmVFA7tSuUKSmVZhMidxq1e4JYSU2snkzVQT5NZFHQQb7Y',
      cid: 'QmExample5',
      purchaseDate: '2024-01-03',
      price: 129,
    },
  ]

  const getTypeIcon = (type: number) => {
    switch (type) {
      case 0:
        return '📁' // file
      case 1:
        return '🎥' // video
      case 2:
        return '🎵' // audio
      case 3:
        return '📝' // markdown
      default:
        return '📄'
    }
  }

  const getTypeName = (type: number) => {
    switch (type) {
      case 0:
        return t('common.contentTypes.file')
      case 1:
        return t('common.contentTypes.video')
      case 2:
        return t('common.contentTypes.audio')
      case 3:
        return t('common.contentTypes.imageText')
      default:
        return t('common.contentTypes.unknown')
    }
  }

  const filteredItems =
    selectedType !== null
      ? mockPurchasedItems.filter((item) => item.type === selectedType)
      : mockPurchasedItems

  const handleDownload = (item: PurchasedItem) => {
    // Implement actual download logic here
    console.log('Download content:', item.title)
    // Can open IPFS gateway link
    window.open(`http://localhost:8080/ipfs/${item.cid}`, '_blank')
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          {t('purchased.title')}
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          {t('purchased.description')}
        </p>
      </div>

      {/* Content type filter */}
      <div className="mb-6">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedType(null)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              selectedType === null
                ? 'bg-red-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            {t('common.all')} ({mockPurchasedItems.length})
          </button>
          {ITEM_TYPE.map((type, index) => {
            const count = mockPurchasedItems.filter(
              (item) => item.type === index,
            ).length
            return (
              <button
                key={index}
                onClick={() => setSelectedType(index)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  selectedType === index
                    ? 'bg-red-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {getTypeIcon(index)} {getTypeName(index)} ({count})
              </button>
            )
          })}
        </div>
      </div>

      {/* Content list */}
      {filteredItems.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-6xl mb-4">🛒</div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            {t('purchased.empty')}
          </h2>
          <p className="text-gray-600 dark:text-gray-400">
            {selectedType !== null
              ? t('purchased.emptyType', { type: getTypeName(selectedType) })
              : t('purchased.emptyAll')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredItems.map((item) => (
            <div
              key={item.id}
              className="bg-white dark:bg-gray-800 rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200"
            >
              {/* Thumbnail */}
              <div className="relative aspect-video bg-gray-200 dark:bg-gray-700 rounded-t-lg overflow-hidden">
                <img
                  src={`http://localhost:8080/ipfs/${item.img_cid}`}
                  alt={item.title}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement
                    // target.src = `https://ipfs.io/ipfs/${item.img_cid}`
                  }}
                />
                {/* Content type badge */}
                <div className="absolute top-2 left-2 bg-black bg-opacity-70 text-white px-2 py-1 rounded text-xs flex items-center">
                  <span className="mr-1">{getTypeIcon(item.type)}</span>
                  {getTypeName(item.type)}
                </div>
                {/* Price badge */}
                <div className="absolute top-2 right-2 bg-green-600 text-white px-2 py-1 rounded text-xs">
                  ¥{item.price}
                </div>
              </div>

              {/* Content info */}
              <div className="p-4">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-2 line-clamp-2">
                  {item.title}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 line-clamp-2">
                  {item.desc}
                </p>

                {/* Purchase info */}
                <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-3">
                  <span>{t('purchased.purchaseDate')} {item.purchaseDate}</span>
                </div>

                {/* Action buttons */}
                <div className="flex gap-2">
                  <button
                    onClick={() => handleDownload(item)}
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded text-sm font-medium transition-colors"
                  >
                    {item.type === 1 || item.type === 2 ? t('purchased.play') : t('purchased.download')}
                  </button>
                  <button className="px-3 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    {t('purchased.details')}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Statistics info */}
      <div className="mt-8 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          {t('purchased.stats.title')}
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          <div>
            <div className="text-2xl font-bold text-red-600">
              {mockPurchasedItems.length}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              {t('purchased.stats.totalContent')}
            </div>
          </div>
          <div>
            <div className="text-2xl font-bold text-blue-600">
              USDFC:
              {mockPurchasedItems.reduce((sum, item) => sum + item.price, 0)}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              {t('purchased.stats.totalSpent')}
            </div>
          </div>
          <div>
            <div className="text-2xl font-bold text-green-600">
              {mockPurchasedItems.filter((item) => item.type === 1).length}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              {t('purchased.stats.videoContent')}
            </div>
          </div>
          <div>
            <div className="text-2xl font-bold text-purple-600">
              {mockPurchasedItems.filter((item) => item.type === 0).length}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              {t('purchased.stats.fileResources')}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default PurchasedContent
