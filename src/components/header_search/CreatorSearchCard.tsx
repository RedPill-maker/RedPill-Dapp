import React from 'react'
import { Creator } from '../../utils/dbConnector'
import { useAppDispatch } from '../../hooks/redux'
import { setCreatorPageByUsername } from '../../store/slices/pageSlice'
import BoringAvatar from '../BoringAvatar'
import { ChevronRightIcon } from '@heroicons/react/24/outline'

interface CreatorSearchCardProps {
  creator: Creator
}

const CreatorSearchCard: React.FC<CreatorSearchCardProps> = ({ creator }) => {
  const dispatch = useAppDispatch()

  const handleClick = () => {
    dispatch(setCreatorPageByUsername(creator.username))
  }

  return (
    <div
      onClick={handleClick}
      className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700 hover:shadow-lg hover:border-blue-500 dark:hover:border-blue-500 transition-all cursor-pointer"
    >
      <div className="flex items-center space-x-3">
        {/* Avatar */}
        <div className="flex-shrink-0">
          {creator.avatar_cid ? (
            <img
              src={`http://localhost:8080/ipfs/${creator.avatar_cid}`}
              alt={creator.username}
              className="w-12 h-12 rounded-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
                e.currentTarget.nextElementSibling?.classList.remove('hidden')
              }}
            />
          ) : null}
          <div className={creator.avatar_cid ? 'hidden' : ''}>
            <BoringAvatar
              hash={creator.username}
              size={48}
              variant="beam"
            />
          </div>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-gray-900 dark:text-white truncate">
            @{creator.username}
          </div>
          {creator.description && (
            <div className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2 mt-1">
              {creator.description}
            </div>
          )}
          <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            {creator.wallet_address.substring(0, 10)}...
          </div>
        </div>

        {/* Arrow icon */}
        <div className="flex-shrink-0 text-gray-400">
          <ChevronRightIcon className="w-5 h-5" />
        </div>
      </div>
    </div>
  )
}

export default CreatorSearchCard
