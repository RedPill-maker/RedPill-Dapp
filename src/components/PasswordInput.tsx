import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline'
import LoadingSpinner from './LoadingSpinner'
import CreatorAvatar from './filecoin/CreatorAvatar'
import { walletMgr, type WalletInfo } from '../utils/walletMgr'

interface PasswordInputProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (password: string) => void | Promise<void>
  title: string
  description: string
  confirmText?: string
  isLoading?: boolean
  error?: string | null
  walletAddress?: string // optional: show which wallet the password is for
}

const PasswordInput: React.FC<PasswordInputProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = '',
  isLoading = false,
  error = null,
  walletAddress,
}) => {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [walletInfo, setWalletInfo] = useState<WalletInfo | undefined>(undefined)

  useEffect(() => {
    if (walletAddress) {
      walletMgr.getWalletByAddress(walletAddress).then(setWalletInfo)
    }
  }, [walletAddress])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password.trim() || isLoading) return

    try {
      await onConfirm(password)
    } catch (err) {
      // Error handling is the parent component's responsibility
    }
  }

  const handleClose = () => {
    setPassword('')
    setShowPassword(false)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4">
        <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
          {title}
        </h3>

        <p className="text-gray-600 dark:text-gray-400 mb-6">{description}</p>

        {walletAddress && (() => {
          const truncated = walletAddress.length > 12
            ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
            : walletAddress
          return (
            <div className="mb-4 flex items-center gap-3 px-3 py-2.5 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <CreatorAvatar walletAddress={walletAddress} size="sm" />
              <div className="min-w-0">
                {walletInfo?.name && (
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {walletInfo.name}
                  </p>
                )}
                <p className="text-xs font-mono text-gray-500 dark:text-gray-400">
                  {truncated}
                </p>
              </div>
            </div>
          )
        })()}

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t('passwordInput.label')}
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                placeholder={t('passwordInput.placeholder')}
                disabled={isLoading}
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                disabled={isLoading}
              >
                {showPassword ? (
                  <EyeSlashIcon className="h-5 w-5" />
                ) : (
                  <EyeIcon className="h-5 w-5" />
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-300 rounded">
              {error}
            </div>
          )}

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={handleClose}
              disabled={isLoading}
              className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={!password.trim() || isLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
            >
              {isLoading ? (
                <>
                  <LoadingSpinner />
                  <span className="ml-2">{t('common.processing')}</span>
                </>
              ) : (
                confirmText || t('common.confirm')
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default PasswordInput
