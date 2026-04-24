import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { walletMgr } from '../../utils/walletMgr'
import { removeWallet } from '../../utils/dbConnector'
import LoadingSpinner from '../LoadingSpinner'

interface DeleteWalletModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  walletAddress: string
}

const DeleteWalletModal: React.FC<DeleteWalletModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  walletAddress,
}) => {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDelete = async () => {
    if (!password) {
      setError(t('deleteWallet.enterPassword'))
      return
    }

    setIsDeleting(true)
    setError(null)

    try {
      const result = await walletMgr.unlockWallet(walletAddress, password)
      if (result.success) {
        const deleted = await walletMgr.deleteWallet(walletAddress)
        if (deleted) {
          // Remove from tracking list (transaction history is preserved)
          await removeWallet(walletAddress)
          alert(t('deleteWallet.walletDeleted'))
          handleClose()
          onSuccess()
        } else {
          setError(t('deleteWallet.deleteFailed'))
        }
      } else {
        setError(result.error || t('deleteWallet.passwordWrong'))
      }
    } catch (error: any) {
      setError(error.message || t('deleteWallet.deleteFailed'))
    }

    setIsDeleting(false)
  }

  const handleClose = () => {
    setPassword('')
    setError(null)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4">
        <h3 className="text-xl font-bold text-red-600 dark:text-red-400 mb-4">
          {t('deleteWallet.title')}
        </h3>

        <div className="space-y-4">
          <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <div className="flex items-start">
              <ExclamationTriangleIcon className="w-6 h-6 text-red-600 dark:text-red-400 mr-2 flex-shrink-0" />
              <div className="text-sm text-red-800 dark:text-red-200">
                <strong>{t('deleteWallet.dangerLabel')}</strong>
                <ul className="mt-2 space-y-1 list-disc list-inside">
                  <li>{t('deleteWallet.warningItem1')}</li>
                  <li>{t('deleteWallet.warningItem2')}</li>
                  <li>{t('deleteWallet.warningItem3')}</li>
                </ul>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t('deleteWallet.walletPassword')}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
              placeholder={t('deleteWallet.passwordPlaceholder')}
              onKeyDown={(e) => e.key === 'Enter' && handleDelete()}
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
              disabled={isDeleting}
              className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleDelete}
              disabled={isDeleting || !password}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
            >
              {isDeleting ? (
                <>
                  <LoadingSpinner />
                  <span className="ml-2">{t('deleteWallet.deleting')}</span>
                </>
              ) : (
                t('deleteWallet.confirmDelete')
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default DeleteWalletModal
