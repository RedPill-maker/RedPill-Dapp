import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ipfsConnector } from '../../utils/ipfsConnector'
import { privateDataMgr } from '../../utils/privateDataMgr'
import { ArrowDownTrayIcon, XMarkIcon } from '@heroicons/react/24/outline'

// Common MIME type to file extension mapping
const MIME_TO_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
  'application/x-tar': 'tar',
  'application/gzip': 'gz',
  'application/x-gzip': 'gz',
  'application/x-7z-compressed': '7z',
  'application/x-rar-compressed': 'rar',
  'application/x-apple-diskimage': 'dmg',
  'application/octet-stream': '',
  'application/x-msdownload': 'exe',
  'application/vnd.microsoft.portable-executable': 'exe',
  'application/x-deb': 'deb',
  'application/x-rpm': 'rpm',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-msvideo': 'avi',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/flac': 'flac',
  'audio/aac': 'aac',
  'text/plain': 'txt',
  'text/html': 'html',
  'text/css': 'css',
  'text/javascript': 'js',
  'application/json': 'json',
  'application/xml': 'xml',
  'text/markdown': 'md',
}

// Extract extension from filename/title (e.g. "my file.dmg" -> "dmg")
const getExtFromName = (name: string): string => {
  const match = name.match(/\.([a-zA-Z0-9]+)$/)
  return match ? match[1].toLowerCase() : ''
}

interface WorkCacheControlProps {
  cid: string
  title?: string
  className?: string
  onStatusChange?: (cid: string, isDownloaded: boolean) => void
}

type CacheState = 'none' | 'downloading' | 'cached'

const WorkCacheControl: React.FC<WorkCacheControlProps> = ({ cid, title, className = '', onStatusChange }) => {
  const { t } = useTranslation()
  const [state, setState] = useState<CacheState>('none')
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    //Determine the status from local records, and then asynchronously confirm whether the pin is completed
    if (privateDataMgr.isDownloaded(cid)) {
      // First display cached optimistically, and then asynchronously verify whether the pin is really completed.
      setState('cached')
      ipfsConnector.listPinnedFiles().then((pins) => {
        if (!pins.includes(cid)) {
          // It is in the record but the pin is not completed, indicating that the last download was interrupted.
          setState('downloading')
        }
      }).catch(() => {
        // Keep cached display when IPFS is unavailable
      })
    } else {
      setState('none')
    }
  }, [cid])

  const handleCache = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      setState('downloading')
      setProgress(0)
      //Write local record first, then trigger pin
      privateDataMgr.addDownloaded(cid)
      onStatusChange?.(cid, true)

      await ipfsConnector.pinFile(cid)

      // Simulation progress (IPFS has no real-time progress)
      for (let i = 10; i <= 100; i += 10) {
        setProgress(i)
        await new Promise((r) => setTimeout(r, 80))
      }
      setState('cached')
    } catch (error) {
      console.error('Cache failed:', error)
      setState('downloading') // keep downloading state, pin may continue in background
    }
  }

  const handleUnpin = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      privateDataMgr.removeDownloaded(cid)
      onStatusChange?.(cid, false)
      setState('none')
      // TODO: ipfsConnector.unpinFile(cid)
    } catch (error) {
      console.error('Failed to cancel cache:', error)
    }
  }

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const baseName = title || cid
    let ext = getExtFromName(baseName)

    // Always do a HEAD request to get accurate Content-Type from gateway
    try {
      const headUrl = `${ipfsConnector.getGatewayUrl(cid)}?filename=${encodeURIComponent(baseName)}`
      const res = await fetch(headUrl, { method: 'HEAD' })
      const contentType = res.headers.get('content-type')?.split(';')[0].trim() || ''
      const detectedExt = MIME_TO_EXT[contentType] || ''
      if (detectedExt) ext = detectedExt
    } catch {
      // Proceed with whatever ext we have
    }

    const fileName = ext ? `${baseName.replace(/\.[^/.]+$/, '')}.${ext}` : baseName
    const url = `${ipfsConnector.getGatewayUrl(cid)}?filename=${encodeURIComponent(fileName)}&download=true`
    const link = document.createElement('a')
    link.href = url
    link.click()
  }

  if (state === 'downloading') {
    return (
      <div className={`bg-green-50 dark:bg-green-900/20 rounded-lg px-3 py-3 ${className}`}>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-green-700 dark:text-green-400">
            {t('workCache.downloading')} {progress}%
          </span>
        </div>
        <div className="w-full bg-green-200 dark:bg-green-800 rounded-full h-1.5">
          <div
            className="bg-green-600 dark:bg-green-500 h-1.5 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    )
  }

  if (state === 'cached') {
    return (
      <div className={`flex gap-2 ${className}`}>
        <button
          onClick={handleUnpin}
          className="flex-1 px-3 py-3 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors flex items-center justify-center gap-1"
        >
          <XMarkIcon className="w-3.5 h-3.5" />
          {t('workCache.remove')}
        </button>
        <button
          onClick={handleDownload}
          className="flex-1 px-3 py-3 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-1"
        >
          <ArrowDownTrayIcon className="w-3.5 h-3.5" />
          {t('workCache.download')}
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={handleCache}
      className={`w-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg px-3 py-3 transition-colors text-xs text-gray-600 dark:text-gray-400 ${className}`}
    >
      {t('workCache.cache')}
    </button>
  )
}

export default WorkCacheControl
