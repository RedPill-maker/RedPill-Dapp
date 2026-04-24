import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { privateDataMgr, HistoryItem } from '../utils/privateDataMgr'
import { useAppDispatch } from '../hooks/redux'
import { setCreatorPage } from '../store/slices/pageSlice'
import CategoryGrid from './CategoryGrid'
import { ItemCardData } from './work_item/ItemCard'

const MyHistory: React.FC = () => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([])

  useEffect(() => {
    loadHistory()
  }, [])

  const loadHistory = () => {
    const history = privateDataMgr.getAllHistory()
    setHistoryItems(history)
  }

  const handleDelete = (item: ItemCardData) => {
    if (confirm(t('history.confirmDelete'))) {
      const success = privateDataMgr.removeHistory(item.id)
      if (success) {
        loadHistory() // reload history
      }
    }
  }

  const handleCreatorClick = (ipns: string) => {
    // Navigate to creator page / クリエイターページに移動
    if (ipns) {
      dispatch(setCreatorPage(ipns))
    }
  }

  const handleClearAll = () => {
    if (confirm(t('history.confirmClear'))) {
      const success = privateDataMgr.clearHistory()
      if (success) {
        setHistoryItems([])
      }
    }
  }

  // Convert data format / データ形式を変換
  const itemCardData: ItemCardData[] = historyItems.map((item) => ({
    id: item.id,
    title: item.title,
    desc: item.desc,
    type: item.type,
    img_cid: item.img_cid,
    cid: item.cid,
    source_ipns: item.source_ipns,
    creator_name: item.creator_name || t('common.unknownCreator'),
    published_at: item.viewedAt, // use view time as publish time
  }))

  return (
    <div className="max-w-full">
      {/* Title & operation */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            {t('history.title')}
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            {t('history.description')}
          </p>
        </div>

        {historyItems.length > 0 && (
          <button
            onClick={handleClearAll}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
          >
            {t('history.clearHistory')}
          </button>
        )}
      </div>

      <CategoryGrid
        items={itemCardData}
        showDeleteButton={true}
        onDelete={handleDelete}
        onCreatorClick={handleCreatorClick}
        emptyMessage={t('history.empty')}
        emptyIcon="📜"
      />
    </div>
  )
}

export default MyHistory
