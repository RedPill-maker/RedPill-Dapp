import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { adsMgr } from '../../utils/adsMgr'

interface AdSpacePurchaseProps {
  workCid: string
  adSpaceId?: number
  adStatus?: 'normal' | 'my-bid' | 'won'
  adWinnerAddress?: string
  onPurchaseClick?: () => void
  className?: string
}

const AdSpacePurchase: React.FC<AdSpacePurchaseProps> = ({
  workCid,
  adSpaceId,
  adStatus = 'normal',
  onPurchaseClick,
  className = '',
}) => {
  const { t } = useTranslation()
  const [currentPrice, setCurrentPrice] = useState<string>('0')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (adStatus === 'normal') {
      loadAdSpacePrice()
    } else {
      setLoading(false)
    }
  }, [workCid, adSpaceId, adStatus])

  const loadAdSpacePrice = async () => {
    try {
      setLoading(true)
      if (adSpaceId !== undefined) {
        // Use real-time current value for this specific ad space
        const value = await adsMgr.getCurrentValue(adSpaceId)
        setCurrentPrice(value)
      } else {
        // Fallback to global minimum price (e.g. new ad space creation)
        const constants = await adsMgr.getContractConstants()
        setCurrentPrice(constants.minPrice)
      }
    } catch (error) {
      console.error('Failed to get ad space price:', error)
      setCurrentPrice('0')
    } finally {
      setLoading(false)
    }
  }

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onPurchaseClick) onPurchaseClick()
  }

  if (loading) {
    return (
      <button disabled className={`w-full bg-gray-100 dark:bg-gray-700 rounded-lg p-3 ${className}`}>
        <span className="text-xs text-gray-500 dark:text-gray-400">{t('common.loading')}</span>
      </button>
    )
  }

  // Won: user can update ad content, locked to winner wallet
  if (adStatus === 'won') {
    return (
      <button
        onClick={handleClick}
        className={`w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white rounded-lg p-3 transition-all ${className}`}
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{t('sidebarAds.wonLabel')}</span>
          <span className="text-xs opacity-90">{t('sidebarAds.editAd')}</span>
        </div>
      </button>
    )
  }

  // My-bid: user is current highest bidder, still in protection period
  if (adStatus === 'my-bid') {
    return (
      <button
        onClick={handleClick}
        className={`w-full bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white rounded-lg p-3 transition-all ${className}`}
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{t('sidebarAds.myBidLabel')}</span>
          <span className="text-xs opacity-90">{t('sidebarAds.leading')}</span>
        </div>
      </button>
    )
  }

  // Normal: open for bidding
  return (
    <button
      onClick={handleClick}
      className={`w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white rounded-lg p-3 transition-all ${className}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{t('sidebarAds.buyAdSpace')}</span>
        <span className="text-xs opacity-90">{currentPrice} FIL+</span>
      </div>
    </button>
  )
}

export default AdSpacePurchase
