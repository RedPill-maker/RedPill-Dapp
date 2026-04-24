/**
* Image cropping popup component
* Uses react-easy-crop to implement image cropping functionality
* Supports square cropping and outputs images with a specified maximum size
 */

import React, { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Cropper, { Area } from 'react-easy-crop'

interface ImageCropModalProps {
  isOpen: boolean
  imageSrc: string
  onClose: () => void
  onCropComplete: (croppedBlob: Blob) => void
  maxSize?: number // max output width (pixels), default 512
  aspectRatio?: number // crop aspect ratio, default 1 (square)
}

// Get cropped image Blob from crop area / クロップ領域からクロップされた画像 Blob を取得
async function getCroppedImg(
  imageSrc: string,
  pixelCrop: Area,
  maxSize: number,
): Promise<Blob> {
  const image = new Image()
  image.crossOrigin = 'anonymous'
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = reject
    image.src = imageSrc
  })

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas context not available')

  // Limit width by maxSize, height scales proportionally / maxSize で幅を制限、高さは比例的にスケール
  const scale = Math.min(maxSize / pixelCrop.width, 1)
  canvas.width = Math.round(pixelCrop.width * scale)
  canvas.height = Math.round(pixelCrop.height * scale)

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    canvas.width,
    canvas.height,
  )

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Canvas toBlob failed'))
      },
      'image/png',
      0.9,
    )
  })
}

const ImageCropModal: React.FC<ImageCropModalProps> = ({
  isOpen,
  imageSrc,
  onClose,
  onCropComplete,
  maxSize = 512,
  aspectRatio = 1,
}) => {
  const { t } = useTranslation()
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)
  const [processing, setProcessing] = useState(false)

  const onCropChange = useCallback((_: any, croppedAreaPixels: Area) => {
    setCroppedAreaPixels(croppedAreaPixels)
  }, [])

  const handleConfirm = async () => {
    if (!croppedAreaPixels) return
    setProcessing(true)
    try {
      const blob = await getCroppedImg(imageSrc, croppedAreaPixels, maxSize)
      onCropComplete(blob)
    } catch (err) {
      console.error('Crop failed:', err)
    } finally {
      setProcessing(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-[60]">
      <div className="bg-white dark:bg-gray-800 rounded-xl w-[480px] h-[520px] flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 text-center">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            {t('imageCrop.title')}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {t('imageCrop.hint')}
          </p>
        </div>

        <div className="relative flex-1 bg-gray-900">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={aspectRatio}
            cropShape={aspectRatio === 1 ? 'round' : 'rect'}
            showGrid={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropChange}
          />
        </div>

        {/* Zoom control */}
        <div className="px-6 py-2 flex items-center gap-3">
          <span className="text-xs text-gray-500 dark:text-gray-400">{t('imageCrop.zoom')}</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="flex-1 h-1 accent-blue-600"
          />
        </div>

        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={processing}
            className="px-4 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={processing}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {processing ? t('common.processing') : t('imageCrop.confirmCrop')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ImageCropModal
