import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ipfsConnector } from '../utils/ipfsConnector'
import LoadingSpinner from './LoadingSpinner'

interface DHTModeConfirmProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
}

const DHTModeConfirm: React.FC<DHTModeConfirmProps> = ({
  isOpen,
  onClose,
  onConfirm,
}) => {
  const [switching, setSwitching] = useState(false)
  const { t } = useTranslation()
  const [error, setError] = useState<string | null>(null)

  const handleConfirm = async () => {
    try {
      setSwitching(true)
      setError(null)

      // Check the current DHT mode
      const currentMode = await ipfsConnector.getDHTMode()

      if (currentMode === 'dhtserver') {
        // It is already in server mode, no need to switch.
        onConfirm()
        return
      }

      // Switch to server mode
      await ipfsConnector.setDHTMode('dhtserver')

      // Restart daemon
      await ipfsConnector.restartDaemon()

      onConfirm()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dhtModeConfirm.switchFailed'))
    } finally {
      setSwitching(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4">
        <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
          {t('dhtModeConfirm.title')}
        </h3>

        <div className="mb-6">
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            {t('dhtModeConfirm.description')}
          </p>

          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-4">
            <h4 className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-2">
              {t('dhtModeConfirm.advantages')}
            </h4>
            <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
              <li>• {t('dhtModeConfirm.fasterPublish')}</li>
              <li>• {t('dhtModeConfirm.betterAccess')}</li>
              <li>• {t('dhtModeConfirm.networkStability')}</li>
            </ul>
          </div>

          <div className="mt-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg p-4">
            <p className="text-sm text-yellow-800 dark:text-yellow-200">
              ⚠️ {t('dhtModeConfirm.restartWarning')}
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-300 rounded">
            {error}
          </div>
        )}

        <div className="flex justify-end space-x-3">
          <button
            onClick={onClose}
            disabled={switching}
            className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors disabled:opacity-50"
          >
            {t('dhtModeConfirm.notNow')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={switching}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
          >
            {switching ? (
              <>
                <LoadingSpinner />
                <span className="ml-2">{t('dhtModeConfirm.switching')}</span>
              </>
            ) : (
              t('dhtModeConfirm.confirmSwitch')
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export default DHTModeConfirm
