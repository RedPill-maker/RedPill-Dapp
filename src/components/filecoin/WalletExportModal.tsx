import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { walletMgr } from '../../utils/walletMgr'
import LoadingSpinner from '../LoadingSpinner'

interface WalletExportModalProps {
  isOpen: boolean
  onClose: () => void
  walletAddress: string
  exportType: 'privateKey' | 'mnemonic'
}

const WalletExportModal: React.FC<WalletExportModalProps> = ({
  isOpen,
  onClose,
  walletAddress,
  exportType,
}) => {
  const [password, setPassword] = useState('')
  const { t } = useTranslation()
  const [exportedData, setExportedData] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)

  const handleExport = async () => {
    if (!password) {
      setError(t('walletExport.enterPassword'))
      return
    }

    setIsExporting(true)
    setError(null)

    try {
      const result = await walletMgr.exportWalletSecrets(walletAddress, password)
      if (result.success) {
        if (exportType === 'privateKey') {
          setExportedData(result.privateKey!)
        } else {
          if (result.mnemonic) {
            setExportedData(result.mnemonic)
          } else {
            setError(t('walletExport.noMnemonic'))
          }
        }
      } else {
        setError(result.error || t('walletExport.enterPassword'))
      }
    } catch (error: any) {
      setError(error.message || t('walletExport.exportFailed'))
    }

    setIsExporting(false)
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        alert(t('common.copySuccess'))
      })
      .catch(() => {
        alert(t('common.copyFailed'))
      })
  }

  const handleClose = () => {
    setPassword('')
    setExportedData('')
    setError(null)
    onClose()
  }

  if (!isOpen) return null

  const title = exportType === 'privateKey' ? t('walletExport.exportPrivateKey') : t('walletExport.exportMnemonic')
  const dataLabel =
    exportType === 'privateKey' ? t('walletExport.privateKeyLabel') : t('walletExport.mnemonicLabel')
  const typeWord = exportType === 'privateKey' ? t('walletExport.exportPrivateKey') : t('walletExport.exportMnemonic')

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4">
        <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
          {title}
        </h3>

        {!exportedData ? (
          <div className="space-y-4">
            <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <div className="flex items-start">
                <span className="text-red-600 dark:text-red-400 text-xl mr-2">
                  ⚠️
                </span>
                <div className="text-sm text-red-800 dark:text-red-200">
                  <strong>{t('walletExport.securityWarning')}：</strong>
                  <ul className="mt-2 space-y-1 list-disc list-inside">
                    <li>
                      {exportType === 'privateKey' ? t('walletExport.privateKeyCredential') : t('walletExport.mnemonicCredential')}
                    </li>
                    <li>
                      {t('walletExport.anyoneCanControl', { type: exportType === 'privateKey' ? t('walletExport.exportPrivateKey') : t('walletExport.exportMnemonic') })}
                    </li>
                    <li>{t('walletExport.safeEnvironment')}</li>
                    <li>{t('walletExport.noScreenshot')}</li>
                  </ul>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('walletExport.walletPassword')}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                placeholder={t('walletExport.passwordPlaceholder')}
                onKeyPress={(e) => e.key === 'Enter' && handleExport()}
              />
            </div>

            {error && (
              <div className="p-3 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-300 rounded">
                {error}
              </div>
            )}

            <div className="flex justify-end space-x-3">
              <button
                onClick={handleClose}
                disabled={isExporting}
                className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors disabled:opacity-50"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleExport}
                disabled={isExporting || !password}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
              >
                {isExporting ? (
                  <>
                    <LoadingSpinner />
                    <span className="ml-2">{t('walletExport.verifying')}</span>
                  </>
                ) : (
                  t('walletExport.confirmExport')
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
              <div className="flex items-start">
                <span className="text-green-600 dark:text-green-400 text-xl mr-2">
                  ✅
                </span>
                <div className="text-sm text-green-800 dark:text-green-200">
                  {t('walletExport.exportSuccessMsg')}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {dataLabel}
              </label>
              <div className="relative">
                <textarea
                  value={exportedData}
                  readOnly
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white font-mono text-sm"
                  rows={3}
                  onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                />
                <button
                  onClick={() => copyToClipboard(exportedData)}
                  className="absolute top-2 right-2 px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 transition-colors"
                >
                  {t('walletExport.copy')}
                </button>
              </div>
            </div>

            <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
              <div className="text-xs text-yellow-800 dark:text-yellow-200">
                💡 {t('walletExport.saveHint', { type: exportType === 'privateKey' ? t('walletExport.exportPrivateKey') : t('walletExport.exportMnemonic') })}
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={handleClose}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default WalletExportModal
