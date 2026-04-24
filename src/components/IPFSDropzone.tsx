/**
 * IPFS Drag-and-drop upload component / IPFS ドラッグ&ドロップアップロードコンポーネント
 * Supports drag-and-drop and click to select files for uploading to IPFS network / ドラッグ&ドロップとクリックでファイルを選択して IPFS ネットワークにアップロード
 *
 * Features：
 * 1. Drag-and-drop area detects file entry / ドラッグ&ドロップエリアがファイル入力を検出
 * 2. Click button to select file / クリックボタンでファイルを選択
 * 3. Upload to IPFS and return CID / IPFS にアップロードして CID を返す
 * 4. Hidden input field stores CID for form submission / 隠しフィールドが CID をフォーム送信用に保存
 * 5. Filter file types by ITEM_TYPE / ITEM_TYPE でファイルタイプをフィルタリング
 * 6. Optional upload to creator IPNS directory / クリエイター IPNS ディレクトリへのオプションアップロード
 * 7. Upload progress animation / アップロード進捗アニメーション
 */

import React, { useState, useRef, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ITEM_TYPE, ItemTypeName, IPFS_CONFIG } from '../../config'
import { ipfsConnector } from '../utils/ipfsConnector'
import { privateDataMgr } from '../utils/privateDataMgr'
import ImageCropModal from './ImageCropModal'
import {
  ArrowUpTrayIcon,
  PhotoIcon,
  VideoCameraIcon,
  MusicalNoteIcon,
  DocumentTextIcon,
  DocumentIcon,
  RocketLaunchIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'

// File metadata callback / ファイルメタデータコールバック
export interface DropzoneFileMetadata {
  cid: string
  type: ItemTypeName
  previewUrl?: string
  icon?: React.ReactNode
  fileName?: string
  fileSize?: number
  mimeType?: string
  error?: string
}

interface IPFSDropzoneProps {
  name?: string // hidden input name attribute
  value?: string // externally controlled CID value
  onChange?: (cid: string) => void
  onMetadata?: (metadata: DropzoneFileMetadata | null) => void
  allowedTypes?: ItemTypeName[]
  uploadToIPNS?: boolean
  disabled?: boolean
  className?: string
  enableCrop?: boolean // whether to enable image cropping (only when allowedTypes includes img)
  cropMaxSize?: number // max crop size (pixels), default 512
  cropAspectRatio?: number // crop aspect ratio, default 1 (square)
}

// Detect ITEM_TYPE by file extension/MIME / ファイル拡張子/MIME で ITEM_TYPE を検出
const detectFileType = (fileName: string, mimeType?: string): ItemTypeName => {
  const ext = fileName.toLowerCase().split('.').pop() || ''
  for (const t of ITEM_TYPE) {
    if (t.extensions.some((e) => e === `.${ext}`)) return t.name
  }
  if (mimeType) {
    if (mimeType.startsWith('image/')) return 'img'
    if (mimeType.startsWith('video/')) return 'video'
    if (mimeType.startsWith('audio/')) return 'audio'
    if (mimeType.includes('markdown')) return 'markdown'
  }
  return 'file'
}

// File type icon / ファイルタイプアイコン
const getFileIcon = (type: ItemTypeName): React.ReactNode => {
  const cls = 'w-5 h-5'
  switch (type) {
    case 'img': return <PhotoIcon className={cls} />
    case 'video': return <VideoCameraIcon className={cls} />
    case 'audio': return <MusicalNoteIcon className={cls} />
    case 'markdown': return <DocumentTextIcon className={cls} />
    default: return <DocumentIcon className={cls} />
  }
}

// Get readable description of file extension, e.g. "mp4 video" / ファイル拡張子の読み取り可能な説明を取得、例：「mp4 ビデオ」
const getFileTypeLabel = (fileName: string): string => {
  const ext = fileName.toLowerCase().split('.').pop() || ''
  const type = detectFileType(fileName)
  const typeConfig = ITEM_TYPE.find((t) => t.name === type)
  return `${ext} ${typeConfig?.label || 'File'}`
}

// Build accept string / accept 文字列を構築
const buildAcceptString = (allowedTypes?: ItemTypeName[]): string => {
  if (!allowedTypes || allowedTypes.length === 0) return '*'
  return allowedTypes
    .map((name) => ITEM_TYPE.find((t) => t.name === name)?.accept || '')
    .filter(Boolean)
    .join(',')
}

// Build allowed extension hint / 許可された拡張子のヒントを構築
const buildAllowedHint = (allowedTypes?: ItemTypeName[]): string => {
  if (!allowedTypes || allowedTypes.length === 0) return ''
  const exts = allowedTypes.flatMap((name) => {
    const t = ITEM_TYPE.find((item) => item.name === name)
    return t ? t.extensions : []
  })
  return exts.join(', ')
}

// Validate file type / ファイルタイプを検証
const validateFile = (file: File, allowedTypes?: ItemTypeName[]): boolean => {
  if (!allowedTypes || allowedTypes.length === 0) return true
  const fileName = file.name.toLowerCase()
  const fileType = file.type.toLowerCase()
  for (const typeName of allowedTypes) {
    const cfg = ITEM_TYPE.find((t) => t.name === typeName)
    if (!cfg) continue
    if (cfg.extensions.some((ext) => fileName.endsWith(ext))) return true
    if (cfg.accept === '*') return true
    const accepted = cfg.accept.split(',').some((a) => {
      const trimmed = a.trim()
      if (trimmed.endsWith('/*')) return fileType.startsWith(trimmed.slice(0, -2))
      return fileType === trimmed || fileName.endsWith(trimmed)
    })
    if (accepted) return true
  }
  return false
}

const IPFSDropzone: React.FC<IPFSDropzoneProps> = ({
  name,
  value = '',
  onChange,
  onMetadata,
  allowedTypes,
  uploadToIPNS = false,
  disabled = false,
  className = '',
  enableCrop = false,
  cropMaxSize = 512,
  cropAspectRatio = 1,
}) => {
  const { t } = useTranslation()
  const [cid, setCid] = useState(value)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null)
  const [uploadedFileType, setUploadedFileType] = useState<ItemTypeName | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Crop-related state / トリミング関連の状態
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)

  // Sync external value / 外部値を同期
  useEffect(() => {
    if (value !== cid) setCid(value)
  }, [value])

  // Simulate upload progress (IPFS API does not provide progress callback) / アップロード進捗をシミュレート（IPFS API は進捗コールバックを提供しない）
  const simulateProgress = useCallback(() => {
    setProgress(0)
    let current = 0
    const interval = setInterval(() => {
      current += Math.random() * 15
      if (current >= 90) {
        current = 90
        clearInterval(interval)
      }
      setProgress(Math.min(Math.round(current), 90))
    }, 300)
    return () => clearInterval(interval)
  }, [])

  const processFile = async (file: File) => {
    if (!validateFile(file, allowedTypes)) {
      const hint = allowedTypes
        ?.map((t) => ITEM_TYPE.find((item) => item.name === t)?.label)
        .join(', ') || ''
      const errMsg = t('ipfsDropzone.unsupportedType', { hint })
      setError(errMsg)
      onMetadata?.({ cid: '', type: 'file', error: errMsg })
      return
    }

    // If crop is enabled and it's an image file, show crop window first / トリミングが有効で画像ファイルの場合、先にトリミングウィンドウを表示
    if (enableCrop && file.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = () => {
        setCropImageSrc(reader.result as string)
        setPendingFile(file)
      }
      reader.readAsDataURL(file)
      return
    }

    await uploadFile(file)
  }

  // Upload after crop is complete / トリミング完了後にアップロード
  const handleCropComplete = async (croppedBlob: Blob) => {
    setCropImageSrc(null)
    const fileName = pendingFile?.name || 'avatar.png'
    const croppedFile = new File([croppedBlob], fileName, { type: 'image/png' })
    setPendingFile(null)
    await uploadFile(croppedFile)
  }

  const uploadFile = async (file: File) => {
    setUploading(true)
    setError(null)
    setProgress(0)
    const stopProgress = simulateProgress()

    try {
      let result: { hash: string; name: string; size: string }

      if (uploadToIPNS) {
        const creatorInfo = privateDataMgr.getCreatorInfo()
        if (!creatorInfo?.ipnsId) {
          throw new Error('Creator IPNS info not found')
        }
        result = await ipfsConnector.uploadFilesToExistingIPNS(
          [file],
          creatorInfo.ipnsId,
        )
      } else {
        result = await ipfsConnector.uploadFileDirectly(file)
      }

      stopProgress()
      setProgress(100)

      const uploadedCid = result.hash
      const fileType = detectFileType(file.name, file.type)

      setCid(uploadedCid)
      setUploadedFileName(file.name)
      setUploadedFileType(fileType)
      onChange?.(uploadedCid)

      // Build metadata / メタデータを構築
      const metadata: DropzoneFileMetadata = {
        cid: uploadedCid,
        type: fileType,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        icon: getFileIcon(fileType),
      }

      if (fileType === 'img') {
        metadata.previewUrl = ipfsConnector.getGatewayUrl(uploadedCid)
      }

      onMetadata?.(metadata)
    } catch (err) {
      stopProgress()
      setProgress(0)
      const errMsg = err instanceof Error ? err.message : 'Upload failed'
      setError(errMsg)
      onMetadata?.({ cid: '', type: 'file', error: errMsg })
    } finally {
      setUploading(false)
    }
  }

  // Drag-and-drop events / ドラッグ&ドロップイベント
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!disabled && !uploading) setDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    if (disabled || uploading) return
    const file = e.dataTransfer.files?.[0]
    if (file) processFile(file)
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const allowedHint = buildAllowedHint(allowedTypes)
  const hasResult = !!cid && !uploading

  return (
    <div className={className}>
      {/* Hidden input field for form submission / フォーム送信用の隠しフィールド */}
      <input type="hidden" name={name} value={cid} />

      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed
          transition-all duration-200 min-h-[180px] px-4 py-6
          ${disabled ? 'opacity-50 cursor-not-allowed bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-600' : ''}
          ${dragOver ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 scale-[1.01]' : ''}
          ${hasResult ? 'border-green-400 dark:border-green-600 bg-green-50/50 dark:bg-green-900/10' : ''}
          ${!disabled && !dragOver && !hasResult ? 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 hover:border-blue-400 hover:bg-blue-50/50 dark:hover:bg-blue-900/10' : ''}
        `}
      >
        {/* Uploading state / アップロード中の状態 */}
        {uploading && (
          <div className="flex flex-col items-center gap-3 w-full">
            <RocketLaunchIcon className="w-10 h-10 text-blue-500 animate-bounce" />
            <p className="text-sm text-blue-600 dark:text-blue-400 font-medium">
              {t('ipfsDropzone.uploading')}
            </p>
            <div className="w-full max-w-xs">
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-center">
                {progress}%
              </p>
            </div>
          </div>
        )}

        {/* Upload success state / アップロード成功の状態 */}
        {hasResult && !uploading && (
          <div className="flex flex-col items-center gap-2 w-full">
            <CheckCircleIcon className="w-8 h-8 text-green-500" />
            {uploadedFileName && uploadedFileType && (
              <div className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
                {getFileIcon(uploadedFileType)}
                <span>{getFileTypeLabel(uploadedFileName)}</span>
              </div>
            )}
            <p className="text-xs text-gray-500 dark:text-gray-400 font-mono break-all text-center max-w-full px-2">
              CID: {cid}
            </p>
            <button
              type="button"
              onClick={() => !disabled && fileInputRef.current?.click()}
              disabled={disabled}
              className="mt-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              {t('ipfsDropzone.reupload')}
            </button>
          </div>
        )}

        {/* Default empty state / デフォルトの空の状態 */}
        {!uploading && !hasResult && (
          <div className="flex flex-col items-center gap-3">
            <ArrowUpTrayIcon className="w-10 h-10 text-gray-400 dark:text-gray-500" />
            <div className="text-center">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t('ipfsDropzone.dragHint')}
              </p>
              {allowedHint && (
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  {t('ipfsDropzone.supportOnly')} {allowedHint}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('ipfsDropzone.selectFile')}
            </button>
          </div>
        )}
      </div>

      {/* Hidden file selector / 隠しファイルセレクター */}
      <input
        ref={fileInputRef}
        type="file"
        accept={buildAcceptString(allowedTypes)}
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Error message / エラーメッセージ */}
      {error && (
        <div className="flex items-center gap-1.5 mt-2 text-sm text-red-600 dark:text-red-400">
          <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Image crop modal / 画像トリミングモーダル */}
      {cropImageSrc && (
        <ImageCropModal
          isOpen={!!cropImageSrc}
          imageSrc={cropImageSrc}
          onClose={() => {
            setCropImageSrc(null)
            setPendingFile(null)
          }}
          onCropComplete={handleCropComplete}
          maxSize={cropMaxSize}
          aspectRatio={cropAspectRatio}
        />
      )}
    </div>
  )
}

export default IPFSDropzone
