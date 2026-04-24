import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { 
  ChevronDownIcon, 
  ClipboardDocumentIcon, 
  CheckIcon,
  InformationCircleIcon,
  QrCodeIcon
} from '@heroicons/react/24/outline'
import { QRCodeSVG } from 'qrcode.react'

interface AddressDisplayProps {
  ethAddress: string
  filAddress: string
  showFullAddress?: boolean
  className?: string
}

const AddressDisplay: React.FC<AddressDisplayProps> = ({
  ethAddress,
  filAddress,
  showFullAddress = false,
  className = '',
}) => {
  const [showDropdown, setShowDropdown] = useState(false)
  const [copiedType, setCopiedType] = useState<'eth' | 'fil' | null>(null)
  const { t } = useTranslation()

  // Format address display (with ellipsis)
  const formatAddress = (address: string, length: number = 20): string => {
    if (showFullAddress || address.length <= length) {
      return address
    }
    return `${address.slice(0, length)}...`
  }

  // Copy to clipboard
  const copyToClipboard = (text: string, type: 'eth' | 'fil') => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopiedType(type)
        setTimeout(() => setCopiedType(null), 2000)
      })
      .catch(() => {
        alert(t('common.copyFailed'))
      })
  }

  return (
    <div className={`relative inline-block ${className}`}>
      {/* Main display area - Filecoin address */}
      <div className="flex items-center space-x-2">
        <span className="font-mono text-sm text-gray-900 dark:text-white">
          {formatAddress(filAddress)}
        </span>

        {/* Dropdown button */}
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className="flex items-center space-x-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          title={t('addressDisplay.receiveAddress')}
        >
          <span>{t('addressDisplay.receiveAddress')}</span>
          <ChevronDownIcon
            className={`w-4 h-4 transition-transform ${showDropdown ? 'rotate-180' : ''}`}
          />
        </button>

        {/* Copy Filecoin address button */}
        <button
          onClick={() => copyToClipboard(filAddress, 'fil')}
          className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
          title={t('addressDisplay.copyFilecoin')}
        >
          {copiedType === 'fil' ? (
            <CheckIcon className="w-4 h-4 text-green-600 dark:text-green-400" />
          ) : (
            <ClipboardDocumentIcon className="w-4 h-4 text-gray-600 dark:text-gray-400" />
          )}
        </button>
      </div>

      {/* Dropdown menu - Ethereum address */}
      {showDropdown && (
        <>
          {/* Overlay */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setShowDropdown(false)}
          />

          {/* Dropdown content */}
          <div className="absolute top-full left-0 mt-2 w-full min-w-[520px] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-20 p-4">
            {/* Filecoin address */}
            <div className="mb-4">
              <div className="flex items-start space-x-3">
                {/* Address and Copy Button */}
                <div className="flex-1 flex flex-col space-y-2">
                  <div className="flex items-center mb-2">
                    <span className="text-xs bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 px-2 py-0.5 rounded">
                      {t('addressDisplay.nativeFormat')}
                    </span>
                    <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 ml-2">
                      {t('addressDisplay.filecoinAddress')}
                    </span>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-700 rounded px-3 py-2 font-mono text-xs text-gray-900 dark:text-white break-all">
                    {filAddress}
                  </div>
                  <button
                    onClick={() => copyToClipboard(filAddress, 'fil')}
                    className="flex items-center justify-center space-x-1 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-600 dark:hover:bg-gray-500 rounded transition-colors text-sm"
                    title={t('common.copy')}
                  >
                    {copiedType === 'fil' ? (
                      <>
                        <CheckIcon className="w-4 h-4 text-green-600 dark:text-green-400" />
                        <span className="text-green-600 dark:text-green-400">{t('common.copied')}</span>
                      </>
                    ) : (
                      <>
                        <ClipboardDocumentIcon className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                        <span className="text-gray-700 dark:text-gray-300">{t('common.copy')}</span>
                      </>
                    )}
                  </button>
                </div>
                {/* QR Code */}
                <div className="flex-shrink-0 bg-white p-2 rounded-lg border border-gray-200">
                  <QRCodeSVG value={filAddress} size={100} level="M" />
                </div>
              </div>
            </div>

            {/* Ethereum address */}
            <div className="mb-4 border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-start space-x-3 mt-4">
                {/* Address and Copy Button */}
                <div className="flex-1 flex flex-col space-y-2">
                  <div className="flex items-center mb-2">
                    <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-2 py-0.5 rounded">
                      {t('addressDisplay.compatFormat')}
                    </span>
                    <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 ml-2">
                      {t('addressDisplay.ethereumAddress')}
                    </span>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-700 rounded px-3 py-2 font-mono text-xs text-gray-900 dark:text-white break-all">
                    {ethAddress}
                  </div>
                  <button
                    onClick={() => copyToClipboard(ethAddress, 'eth')}
                    className="flex items-center justify-center space-x-1 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-600 dark:hover:bg-gray-500 rounded transition-colors text-sm"
                    title={t('common.copy')}
                  >
                    {copiedType === 'eth' ? (
                      <>
                        <CheckIcon className="w-4 h-4 text-green-600 dark:text-green-400" />
                        <span className="text-green-600 dark:text-green-400">{t('common.copied')}</span>
                      </>
                    ) : (
                      <>
                        <ClipboardDocumentIcon className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                        <span className="text-gray-700 dark:text-gray-300">{t('common.copy')}</span>
                      </>
                    )}
                  </button>
                </div>
                {/* QR Code */}
                <div className="flex-shrink-0 bg-white p-2 rounded-lg border border-gray-200">
                  <QRCodeSVG value={ethAddress} size={100} level="M" />
                </div>
              </div>
            </div>

            {/* Description text */}
            <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1 flex items-center gap-1">
                <InformationCircleIcon className="w-3.5 h-3.5 flex-shrink-0" />
                {t('addressDisplay.sameWalletHint')}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                <QrCodeIcon className="w-3.5 h-3.5 flex-shrink-0" />
                {t('addressDisplay.scanToReceive')}
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default AddressDisplay
