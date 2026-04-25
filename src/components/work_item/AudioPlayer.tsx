import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import BoringAvatar from '../BoringAvatar'

interface AudioPlayerProps {
  src: string
  /** CID of the thumbnail image */
  imgCid?: string
  /** Gateway URL for the thumbnail image */
  imgUrl?: string
  /** Fallback hash for BoringAvatar (use content CID) */
  fallbackHash: string
  title?: string
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({ src, imgUrl, fallbackHash, title }) => {
  const { t } = useTranslation()
  const [imgError, setImgError] = useState(false)

  const showImg = !!imgUrl && !imgError

  return (
    <div className="w-full px-4 py-6 bg-black flex flex-col items-center gap-4">
      {/* Thumbnail / avatar above the audio controls */}
      <div className="w-full max-w-xs aspect-square rounded-xl overflow-hidden shadow-lg">
        {showImg ? (
          <img
            src={imgUrl}
            alt={title || ''}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <BoringAvatar hash={fallbackHash} variant="marble" />
        )}
      </div>

      {/* Native audio element — always rendered */}
      <audio
        controls
        className="w-full"
        preload="metadata"
      >
        <source src={src} />
        {t('itemPage.audioNotSupported')}
      </audio>
    </div>
  )
}

export default AudioPlayer
