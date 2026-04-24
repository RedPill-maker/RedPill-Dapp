/**
 * IPFS file input component / IPFS ファイル入力コンポーネント
 * Generic IPFS file upload and CID input component / 汎用 IPFS ファイルアップロードおよび CID 入力コンポーネント
 *
 * Features：
 * 1. Input CID to automatically get file info / CID を入力して自動的にファイル情報を取得
 * 2. Upload files to IPFS network / ファイルを IPFS ネットワークにアップロード
 * 3. Support type filtering and preview / タイプフィルタリングとプレビューをサポート
 * 4. Callback file metadata to parent component / ファイルメタデータを親コンポーネントにコールバック
 */

import React, { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ITEM_TYPE, ItemTypeName, IPFS_CONFIG } from '../../config'
import { ipfsConnector } from '../utils/ipfsConnector'
import { privateDataMgr } from '../utils/privateDataMgr'
import {
  ArrowUpTrayIcon,
  PhotoIcon,
  VideoCameraIcon,
  MusicalNoteIcon,
  DocumentTextIcon,
  DocumentIcon,
} from '@heroicons/react/24/outline'

// File metadata / ファイルメタデータ
export interface FileMetadata {
  cid: string
  type: ItemTypeName
  previewUrl?: string // image preview URL
  icon?: React.ReactNode // icon for other types
  fileName?: string
  fileSize?: number
  mimeType?: string
  error?: string
}

interface IPFSFileInputProps {
  value?: string // CID value
  onChange?: (cid: string) => void // CID change callback
  onMetadata?: (metadata: FileMetadata | null) => void // file metadata callback
  allowedTypes?: ItemTypeName[] // allowed file types, default all
  uploadToIPNS?: boolean // whether to upload to creator IPNS directory, default false
  placeholder?: string
  disabled?: boolean
  className?: string
}

const IPFSFileInput: React.FC<IPFSFileInputProps> = ({
  value = '',
  onChange,
  onMetadata,
  allowedTypes,
  uploadToIPNS = false,
  placeholder,
  disabled = false,
  className = '',
}) => {
  const { t } = useTranslation()
  const resolvedPlaceholder = placeholder || t('ipfsFileInput.placeholder')
  const [cid, setCid] = useState(value)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Sync external value / 外部値を同期
  useEffect(() => {
    if (value !== cid) {
      setCid(value)
    }
  }, [value])

  // When CID changes, fetch file info / CID が変わるとファイル情報を取得
  useEffect(() => {
    if (cid && cid.trim().length > 0) {
      fetchFileMetadata(cid.trim())
    } else {
      onMetadata?.(null)
    }
  }, [cid])

  // Get file type icon / ファイルタイプアイコンを取得
  const getFileIcon = (type: ItemTypeName): React.ReactNode => {
    switch (type) {
      case 'img':
        return <PhotoIcon className="w-5 h-5" />
      case 'video':
        return <VideoCameraIcon className="w-5 h-5" />
      case 'audio':
        return <MusicalNoteIcon className="w-5 h-5" />
      case 'markdown':
        return <DocumentTextIcon className="w-5 h-5" />
      default:
        return <DocumentIcon className="w-5 h-5" />
    }
  }

  // Detect file type by file extension or MIME type / ファイル拡張子または MIME タイプでファイルタイプを検出
  const detectFileType = (
    fileName: string,
    mimeType?: string,
  ): ItemTypeName => {
    const ext = fileName.toLowerCase().split('.').pop() || ''

    // Check image / 画像を確認
    const imgType = ITEM_TYPE.find((t) => t.name === 'img')
    if (imgType && imgType.extensions.some((e) => e === `.${ext}`)) {
      return 'img'
    }

    // Check video / ビデオを確認
    const videoType = ITEM_TYPE.find((t) => t.name === 'video')
    if (videoType && videoType.extensions.some((e) => e === `.${ext}`)) {
      return 'video'
    }

    // Check audio / オーディオを確認
    const audioType = ITEM_TYPE.find((t) => t.name === 'audio')
    if (audioType && audioType.extensions.some((e) => e === `.${ext}`)) {
      return 'audio'
    }

    // Check Markdown / Markdown を確認
    const markdownType = ITEM_TYPE.find((t) => t.name === 'markdown')
    if (markdownType && markdownType.extensions.some((e) => e === `.${ext}`)) {
      return 'markdown'
    }

    // Detect by MIME type / MIME タイプで検出
    if (mimeType) {
      if (mimeType.startsWith('image/')) return 'img'
      if (mimeType.startsWith('video/')) return 'video'
      if (mimeType.startsWith('audio/')) return 'audio'
      if (mimeType.includes('markdown')) return 'markdown'
    }

    return 'file'
  }

  // Get file metadata / ファイルメタデータを取得
  const fetchFileMetadata = async (fileCid: string) => {
    setLoading(true)
    setError(null)

    try {
      // Try first as directory to get file list / まずディレクトリとして試してファイルリストを取得
      try {
        const files = await ipfsConnector.listFiles(fileCid)

        if (files.length > 0) {
          // Is directory, use first file info / ディレクトリです、最初のファイル情報を使用
          const file = files[0]
          const fileType = detectFileType(file.name, file.type)

          const metadata: FileMetadata = {
            cid: fileCid,
            type: fileType,
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type,
            icon: getFileIcon(fileType),
          }

          // If image, generate preview URL / 画像の場合、プレビュー URL を生成
          if (fileType === 'img') {
            metadata.previewUrl = `${IPFS_CONFIG.GATEWAY_URL}/ipfs/${fileCid}/${file.name}`
          }

          onMetadata?.(metadata)
          setLoading(false)
          return
        }
      } catch (listErr) {
        // listFiles failed, may be direct file CID, continue trying as file / listFiles が失敗しました。直接ファイル CID の可能性があります。ファイルとして試し続けます
        console.log('Failed to list as directory, trying as direct file:', listErr)
      }

      // Handle as direct file: get file info via IPFS API stat / 直接ファイルとして処理：IPFS API stat 経由でファイル情報を取得
      const statResponse = await fetch(
        `${IPFS_CONFIG.API_BASE_URL}/files/stat?arg=/ipfs/${fileCid}`,
        {
          method: 'POST',
        },
      )

      if (!statResponse.ok) {
        throw new Error(t('ipfsFileInput.cannotGetFileInfo'))
      }

      const statData = await statResponse.json()

      // Get file info from stat data / stat データからファイル情報を取得
      const fileSize = statData.Size || statData.CumulativeSize || 0

      // Try to detect MIME type by reading small amount of data / 少量のデータを読み取って MIME タイプを検出してみます
      let contentType = 'application/octet-stream'
      let fileName = 'file'

      try {
        // Read first few bytes of file to detect type / ファイルの最初の数バイトを読み取ってタイプを検出
        const catResponse = await fetch(
          `${IPFS_CONFIG.API_BASE_URL}/cat?arg=${fileCid}&length=512`,
          {
            method: 'POST',
          },
        )

        if (catResponse.ok) {
          const blob = await catResponse.blob()
          contentType = blob.type || 'application/octet-stream'

          // Generate file name based on detected type / 検出されたタイプに基づいてファイル名を生成
          if (contentType.startsWith('image/')) {
            const ext = contentType.split('/')[1]?.split(';')[0] || 'jpg'
            fileName = `image.${ext}`
          } else if (contentType.startsWith('video/')) {
            const ext = contentType.split('/')[1]?.split(';')[0] || 'mp4'
            fileName = `video.${ext}`
          } else if (contentType.startsWith('audio/')) {
            const ext = contentType.split('/')[1]?.split(';')[0] || 'mp3'
            fileName = `audio.${ext}`
          } else {
            fileName = 'file.bin'
          }
        }
      } catch (catErr) {
        console.warn('Cannot detect file type:', catErr)
      }

      // Detect file type by MIME type / MIME タイプでファイルタイプを検出
      const fileType = detectFileType(fileName, contentType)

      const metadata: FileMetadata = {
        cid: fileCid,
        type: fileType,
        fileName: fileName,
        fileSize: fileSize,
        mimeType: contentType,
        icon: getFileIcon(fileType),
      }

      // If image, generate preview URL / 画像の場合、プレビュー URL を生成
      if (fileType === 'img') {
        metadata.previewUrl = `${IPFS_CONFIG.GATEWAY_URL}/ipfs/${fileCid}`
      }

      onMetadata?.(metadata)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : t('ipfsFileInput.cannotGetFileInfo')
      setError(errorMsg)
      onMetadata?.({
        cid: fileCid,
        type: 'file',
        icon: getFileIcon('file'),
        error: errorMsg,
      })
    } finally {
      setLoading(false)
    }
  }

  // Handle CID input / CID 入力を処理
  const handleCidChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newCid = e.target.value
    setCid(newCid)
    onChange?.(newCid)
  }

  // Get allowed file type accept string / 許可されたファイルタイプ accept 文字列を取得
  const getAcceptString = (): string => {
    if (!allowedTypes || allowedTypes.length === 0) {
      return '*'
    }

    const acceptStrings = allowedTypes.map((typeName) => {
      const typeConfig = ITEM_TYPE.find((t) => t.name === typeName)
      return typeConfig?.accept || '*'
    })

    return acceptStrings.join(',')
  }

  // Validate file type / ファイルタイプを検証
  const validateFileType = (file: File): boolean => {
    if (!allowedTypes || allowedTypes.length === 0) {
      return true
    }

    const fileName = file.name.toLowerCase()
    const fileType = file.type.toLowerCase()

    for (const typeName of allowedTypes) {
      const typeConfig = ITEM_TYPE.find((t) => t.name === typeName)
      if (!typeConfig) continue

      // Check extension / 拡張子を確認
      const hasValidExtension = typeConfig.extensions.some((ext) =>
        fileName.endsWith(ext.toLowerCase()),
      )

      // Check MIME type / MIME タイプを確認
      const hasValidMimeType =
        typeConfig.accept === '*' ||
        typeConfig.accept.split(',').some((accept) => {
          const trimmedAccept = accept.trim()
          if (trimmedAccept.endsWith('/*')) {
            const prefix = trimmedAccept.slice(0, -2)
            return fileType.startsWith(prefix)
          }
          return fileType === trimmedAccept || fileName.endsWith(trimmedAccept)
        })

      if (hasValidExtension || hasValidMimeType) {
        return true
      }
    }

    return false
  }

  // Handle file upload / ファイルアップロードを処理
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type / ファイルタイプを検証
    if (!validateFileType(file)) {
      const allowedTypesStr =
        allowedTypes
          ?.map((typeName) => ITEM_TYPE.find((type) => type.name === typeName)?.label)
          .join(', ') || t('ipfsFileInput.allTypes')
      setError(t('ipfsFileInput.unsupportedType', { types: allowedTypesStr }))
      return
    }

    setUploading(true)
    setUploadProgress(0)
    setError(null)

    try {
      let result: any

      if (uploadToIPNS) {
        // Upload to creator IPNS directory / クリエイター IPNS ディレクトリにアップロード
        const creatorInfo = privateDataMgr.getCreatorInfo()
        if (!creatorInfo || !creatorInfo.ipnsId) {
          throw new Error(t('ipfsFileInput.creatorIpnsNotFound'))
        }
        result = await ipfsConnector.uploadFilesToExistingIPNS(
          [file],
          creatorInfo.ipnsId,
        )
      } else {
        // Upload directly to IPFS / IPFS に直接アップロード
        result = await ipfsConnector.uploadFileDirectly(file)
      }

      const uploadedCid = result.hash
      setCid(uploadedCid)
      onChange?.(uploadedCid)
      setUploadProgress(100)

      // Get file metadata / ファイルメタデータを取得
      await fetchFileMetadata(uploadedCid)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : t('ipfsFileInput.uploadFailed')
      setError(errorMsg)
      onMetadata?.({
        cid: '',
        type: 'file',
        error: errorMsg,
      })
    } finally {
      setUploading(false)
      // Clear file input to allow re-uploading same file / ファイル入力をクリアして同じファイルの再アップロードを許可
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  // Trigger file selection / ファイル選択をトリガー
  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  return (
    <div className={`relative ${className}`}>
      <div className="flex items-center gap-2">
        {/* CID input box / CID 入力ボックス */}
        <div className="flex-1 relative">
          <input
            type="text"
            value={cid}
            onChange={handleCidChange}
            placeholder={resolvedPlaceholder}
            disabled={disabled || uploading}
            className="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
          />
          {loading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
            </div>
          )}
        </div>

        {/* Upload button */}
        <button
          type="button"
          onClick={handleUploadClick}
          disabled={disabled || uploading}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          title={t('ipfsFileInput.uploadToIpfs')}
        >
          <ArrowUpTrayIcon className="w-5 h-5" />
          {uploading ? t('ipfsFileInput.uploading') : t('ipfsFileInput.upload')}
        </button>

        {/* Hide file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept={getAcceptString()}
          onChange={handleFileUpload}
          className="hidden"
        />
      </div>

      {/* Upload progessbar */}
      {uploading && uploadProgress > 0 && (
        <div className="mt-2">
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            ></div>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
            {t('ipfsFileInput.uploadProgress')} {uploadProgress}%
          </p>
        </div>
      )}

      {/* Error tips */}
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 mt-2">{error}</p>
      )}

      {/* File type tips */}
      {allowedTypes && allowedTypes.length > 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          {t('ipfsFileInput.allowedTypes')}{' '}
          {allowedTypes
            .map((typeName) => ITEM_TYPE.find((type) => type.name === typeName)?.label)
            .join(', ')}
        </p>
      )}
    </div>
  )
}

export default IPFSFileInput
