import React, { useState, useEffect } from 'react'
import { getCreatorByWallet } from '../../utils/dbConnector'
import { ipfsConnector } from '../../utils/ipfsConnector'
import BoringAvatar from '../BoringAvatar'
import { WalletIcon } from '@heroicons/react/24/outline'

interface CreatorAvatarProps {
  walletAddress: string
  size?: 'sm' | 'md' | 'lg'
  showUsername?: boolean
  className?: string
}

const sizeClasses = {
  sm: 'w-10 h-10',
  md: 'w-16 h-16',
  lg: 'w-24 h-24',
}


const CreatorAvatar: React.FC<CreatorAvatarProps> = ({
  walletAddress,
  size = 'md',
  showUsername = false,
  className = '',
}) => {
  const [creator, setCreator] = useState<{
    username: string
    avatar_cid: string | null
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [avatarError, setAvatarError] = useState(false)

  useEffect(() => {
    loadCreator()
  }, [walletAddress])

  const loadCreator = async () => {
    setLoading(true)
    setAvatarError(false)
    const data = await getCreatorByWallet(walletAddress)
    if (data) {
      setCreator({
        username: data.username,
        avatar_cid: data.avatar_cid,
      })
    }
    setLoading(false)
  }

  return (
    <div className={className}>
      <div
        className={`${sizeClasses[size]} rounded-full overflow-hidden flex-shrink-0 bg-gray-100 dark:bg-gray-700`}
      >
        {loading ? (
          <div className="w-full h-full flex items-center justify-center">
            <div className="animate-spin rounded-full h-1/2 w-1/2 border-b-2 border-gray-400"></div>
          </div>
        ) : creator ? (
          <>
            {creator.avatar_cid && !avatarError ? (
              <img
                src={ipfsConnector.getGatewayUrl(creator.avatar_cid)}
                alt={creator.username}
                className="w-full h-full object-cover"
                onError={() => setAvatarError(true)}
              />
            ) : (
              <BoringAvatar hash={creator.username} variant="beam" />
            )}
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400 dark:text-gray-500">
            <WalletIcon className="w-2/3 h-2/3" />
          </div>
        )}
      </div>
      {showUsername && creator && (
        <div className="mt-2 text-sm text-blue-600 dark:text-blue-400">
          @{creator.username}
        </div>
      )}
    </div>
  )
}

export default CreatorAvatar

export const useCreatorInfo = (walletAddress: string) => {
  const [creator, setCreator] = useState<{
    username: string
    avatar_cid: string | null
  } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadCreator = async () => {
      setLoading(true)
      const data = await getCreatorByWallet(walletAddress)
      if (data) {
        setCreator({
          username: data.username,
          avatar_cid: data.avatar_cid,
        })
      }
      setLoading(false)
    }
    loadCreator()
  }, [walletAddress])

  return { creator, loading }
}
