import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ITEM_TYPE } from '../../config'
import ItemCard, { ItemCardData } from './work_item/ItemCard'
import {
  FolderIcon,
  FilmIcon,
  MusicalNoteIcon,
  DocumentTextIcon,
} from '@heroicons/react/24/outline'

interface CategoryGridProps {
  items: ItemCardData[]
  title?: string
  description?: string
  showDeleteButton?: boolean
  onDelete?: (item: ItemCardData) => void
  onCreatorClick?: (ipns: string) => void
  emptyMessage?: string
  emptyIcon?: string
}

const CategoryGrid: React.FC<CategoryGridProps> = ({
  items,
  title,
  description,
  showDeleteButton = false,
  onDelete,
  onCreatorClick,
  emptyMessage = '',
  emptyIcon = '📄',
}) => {
  const { t } = useTranslation()
  const [selectedType, setSelectedType] = useState<number | null>(null)

  const getTypeIcon = (type: number) => {
    const iconClass = 'w-5 h-5 inline-block'
    switch (type) {
      case 0:
        return <FolderIcon className={iconClass} /> // file
      case 1:
        return <FilmIcon className={iconClass} /> // video
      case 2:
        return <MusicalNoteIcon className={iconClass} /> // audio
      case 3:
        return <DocumentTextIcon className={iconClass} /> // markdown
      default:
        return <FolderIcon className={iconClass} />
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
      ? items.filter((item) => item.type === selectedType)
      : items

  return (
    <div className="max-w-full">
      {/* Title and description / タイトルと説明 */}
      {(title || description) && (
        <div className="mb-6">
          {title && (
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
              {title}
            </h1>
          )}
          {description && (
            <p className="text-gray-600 dark:text-gray-400">{description}</p>
          )}
        </div>
      )}

      {/* Content type filter / コンテンツタイプフィルター */}
      {items.length > 0 && (
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
              {t('common.all')} ({items.length})
            </button>
            {ITEM_TYPE.map((type, index) => {
              const count = items.filter((item) => item.type === index).length
              if (count === 0) return null

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
                  <span className="inline-flex items-center gap-1">
                    {getTypeIcon(index)} {getTypeName(index)} ({count})
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Content grid / コンテンツグリッド */}
      {filteredItems.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-6xl mb-4">{emptyIcon}</div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            {emptyMessage === '' ? t('categoryGrid.empty') : emptyMessage}
          </h2>
          <p className="text-gray-600 dark:text-gray-400">
            {selectedType !== null
              ? t('common.noContent')
              : t('categoryGrid.empty')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
          {filteredItems.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              showDeleteButton={showDeleteButton}
              onDelete={onDelete}
              onCreatorClick={onCreatorClick}
            />
          ))}
        </div>
      )}

      {/* Statistics */}
      {items.length > 0 && (
        <div className="mt-8 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            {t('categoryGrid.stats.title')}
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold text-blue-600">
                {items.length}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                {t('categoryGrid.stats.totalContent')}
              </div>
            </div>
            <div>
              <div className="text-2xl font-bold text-green-600">
                {items.filter((item) => item.type === 1).length}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                {t('categoryGrid.stats.videoContent')}
              </div>
            </div>
            <div>
              <div className="text-2xl font-bold text-purple-600">
                {items.filter((item) => item.type === 0).length}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                {t('categoryGrid.stats.fileResources')}
              </div>
            </div>
            <div>
              <div className="text-2xl font-bold text-orange-600">
                {items.filter((item) => item.type === 2).length}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                {t('categoryGrid.stats.audioContent')}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default CategoryGrid
