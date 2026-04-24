import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { privateDataMgr, FavoriteItem } from '../utils/privateDataMgr'
import { useAppDispatch } from '../hooks/redux'
import { setCreatorPage } from '../store/slices/pageSlice'
import CategoryGrid from './CategoryGrid'
import { ItemCardData } from './work_item/ItemCard'

const MyFavorites: React.FC = () => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [favoriteItems, setFavoriteItems] = useState<FavoriteItem[]>([])

  useEffect(() => {
    loadFavorites()
  }, [])

  const loadFavorites = () => {
    const favorites = privateDataMgr.getAllFavorites()
    setFavoriteItems(favorites)
  }

  const handleDelete = (item: ItemCardData) => {
    if (confirm(t('favorites.confirmDelete'))) {
      const success = privateDataMgr.removeFavorite(item.id)
      if (success) {
        loadFavorites() // reload favorites
      }
    }
  }

  const handleCreatorClick = (ipns: string) => {
    // Navigate to creator page / クリエイターページに移動
    if (ipns) {
      dispatch(setCreatorPage(ipns))
    }
  }

  // Convert data format / データ形式を変換
  const itemCardData: ItemCardData[] = favoriteItems.map((item) => ({
    id: item.id,
    title: item.title,
    desc: item.desc,
    type: item.type,
    img_cid: item.img_cid,
    cid: item.cid,
    source_ipns: item.source_ipns,
    creator_name: item.creator_name || t('common.unknownCreator'),
    published_at: item.favoriteAt, // use favorite time as publish time
  }))

  return (
    <CategoryGrid
      items={itemCardData}
      title={t('favorites.title')}
      description={t('favorites.description')}
      showDeleteButton={true}
      onDelete={handleDelete}
      onCreatorClick={handleCreatorClick}
      emptyMessage={t('favorites.empty')}
      emptyIcon="⏰"
    />
  )
}

export default MyFavorites
