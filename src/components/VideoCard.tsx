import React from 'react'
import { useTranslation } from 'react-i18next'
import { Video } from '../store/slices/videoSlice'

interface VideoCardProps {
  video: Video
}

const VideoCard: React.FC<VideoCardProps> = ({ video }) => {
  const { t } = useTranslation()
  return (
    <div className="group cursor-pointer">
      {/* Thumbnail / サムネイル */}
      <div className="relative aspect-video rounded-xl overflow-hidden bg-gray-200 dark:bg-rp-gray-700">
        <img
          src={video.thumbnail}
          alt={video.title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
        />

        {/* Duration / 動画の長さ */}
        <div className="absolute bottom-2 right-2 bg-black bg-opacity-80 text-white text-xs px-1.5 py-0.5 rounded">
          {video.duration}
        </div>
      </div>

      {/* Video info / ビデオ情報 */}
      <div className="flex mt-3 space-x-3">
        {/* Channel avatar / チャンネルアバター */}
        <div className="flex-shrink-0">
          <img
            src={video.channelAvatar}
            alt={video.channel}
            className="w-9 h-9 rounded-full"
          />
        </div>

        {/* Video details / ビデオの詳細 */}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-gray-900 dark:text-white line-clamp-2 group-hover:text-blue-600 dark:group-hover:text-blue-400">
            {video.title}
          </h3>

          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 hover:text-gray-900 dark:hover:text-white cursor-pointer">
            {video.channel}
          </p>

          <div className="flex items-center text-sm text-gray-600 dark:text-gray-400 mt-1 space-x-1">
            <span>{video.views}{t('videoCard.views')}</span>
            <span>•</span>
            <span>{video.timestamp}</span>
          </div>
        </div>

        {/* More options / その他のオプション */}
        <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-rp-gray-700">
            <svg
              className="w-4 h-4 text-gray-600 dark:text-gray-400"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

export default VideoCard
