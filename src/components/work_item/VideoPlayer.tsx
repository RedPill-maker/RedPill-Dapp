import React, { useRef, useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import LoadingSpinner from '../LoadingSpinner'
import { PlayIcon } from '@heroicons/react/24/solid'
import { ExclamationCircleIcon } from '@heroicons/react/24/outline'

interface VideoPlayerProps {
  src: string
  poster?: string
}

type VideoState = 'loading' | 'ready' | 'error'

const VideoPlayer: React.FC<VideoPlayerProps> = ({ src, poster }) => {
  const { t } = useTranslation()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<VideoState>('loading')
  // Key used to force remount the video element on retry
  const [retryKey, setRetryKey] = useState(0)

  // Reset to loading state whenever src changes
  useEffect(() => {
    setState('loading')
  }, [src, retryKey])

  const handleCanPlay = useCallback(() => {
    setState('ready')
  }, [])

  const handleError = useCallback(() => {
    setState('error')
  }, [])

  // Waiting event fires when buffering; only show loading if not yet ready
  const handleWaiting = useCallback(() => {
    setState((prev) => (prev === 'ready' ? 'ready' : 'loading'))
  }, [])

  const handleRetry = useCallback(() => {
    setRetryKey((k) => k + 1)
    setState('loading')
  }, [])

  return (
    // Outer container always maintains 16:9 aspect ratio
    <div className="relative w-full bg-black" style={{ aspectRatio: '16 / 9' }}>
      {/* Native video element — always rendered so browser can load in background */}
      <video
        key={retryKey}
        ref={videoRef}
        className="absolute inset-0 w-full h-full"
        controls={state === 'ready'}
        poster={poster}
        playsInline
        preload="metadata"
        onCanPlay={handleCanPlay}
        onLoadedData={handleCanPlay}
        onError={handleError}
        onWaiting={handleWaiting}
      >
        <source src={src} />
        {t('itemPage.videoNotSupported')}
      </video>

      {/* Loading overlay */}
      {state === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 pointer-events-none">
          <LoadingSpinner size="large" />
        </div>
      )}

      {/* Error overlay — click to retry */}
      {state === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70">
          <ExclamationCircleIcon className="w-10 h-10 text-gray-400 mb-3" />
          <p className="text-sm text-gray-300 mb-4">{t('itemPage.videoLoadFailed')}</p>
          <button
            onClick={handleRetry}
            className="flex items-center justify-center w-16 h-16 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
            aria-label={t('common.retry')}
          >
            <PlayIcon className="w-8 h-8 text-white ml-1" />
          </button>
          <p className="text-xs text-gray-400 mt-3">{t('itemPage.clickToRetry')}</p>
        </div>
      )}
    </div>
  )
}

export default VideoPlayer
