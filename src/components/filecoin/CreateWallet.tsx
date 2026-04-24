import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { walletMgr, WalletInfo } from '../../utils/walletMgr'
import { importWallet } from '../../utils/dbConnector'
import LoadingSpinner from '../LoadingSpinner'

interface CreateWalletProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (wallet: WalletInfo) => void
}

const CreateWallet: React.FC<CreateWalletProps> = ({ isOpen, onClose, onSuccess }) => {
  const { t } = useTranslation()

  const [walletName, setWalletName] = useState('')
  const [walletPassword, setWalletPassword] = useState('')
  const [walletPasswordConfirm, setWalletPasswordConfirm] = useState('')
  const [importType, setImportType] = useState<'create' | 'mnemonic' | 'privateKey'>('create')
  const [mnemonic, setMnemonic] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const resetForm = () => {
    setWalletName('')
    setWalletPassword('')
    setWalletPasswordConfirm('')
    setImportType('create')
    setMnemonic('')
    setPrivateKey('')
    setError(null)
  }

  const handleClose = () => {
    resetForm()
    onClose()
  }

  const handleSubmit = async () => {
    if (!walletName.trim()) {
      setError(t('createWallet.errorName'))
      return
    }
    if (!walletPassword || walletPassword.length < 6) {
      setError(t('createWallet.errorPasswordLength'))
      return
    }
    if (walletPassword !== walletPasswordConfirm) {
      setError(t('createWallet.errorPasswordMismatch'))
      return
    }
    if (importType === 'mnemonic' && !mnemonic.trim()) {
      setError(t('createWallet.errorMnemonic'))
      return
    }
    if (importType === 'privateKey' && !privateKey.trim()) {
      setError(t('createWallet.errorPrivateKey'))
      return
    }

    setLoading(true)
    setError(null)

    try {
      let result
      if (importType === 'create') {
        result = await walletMgr.createWallet(walletName.trim(), walletPassword)
      } else if (importType === 'mnemonic') {
        result = await walletMgr.importWalletFromMnemonic(walletName.trim(), mnemonic.trim(), walletPassword)
      } else {
        result = await walletMgr.importWalletFromPrivateKey(walletName.trim(), privateKey.trim(), walletPassword)
      }

      if (result.success && result.wallet) {
        // Track wallet for incoming transaction monitoring
        await importWallet(result.wallet.address)
        onSuccess(result.wallet)
        handleClose()
      } else {
        setError(result.error || t('createWallet.errorFailed'))
      }
    } catch (err: any) {
      setError(err.message || t('createWallet.errorFailed'))
    }

    setLoading(false)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700 mb-4">
          {(['create', 'mnemonic', 'privateKey'] as const).map((type) => (
            <button
              key={type}
              onClick={() => { setImportType(type); setError(null) }}
              className={`flex-1 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                importType === type
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {type === 'create'
                ? t('createWallet.createNew')
                : type === 'mnemonic'
                  ? t('createWallet.mnemonic')
                  : t('createWallet.privateKey')}
            </button>
          ))}
        </div>

        <div className="space-y-4">

          {/* Wallet name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t('createWallet.walletName')}
            </label>
            <input
              type="text"
              value={walletName}
              onChange={(e) => setWalletName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
              placeholder={t('createWallet.walletNamePlaceholder')}
            />
          </div>

          {/* Mnemonic input */}
          {importType === 'mnemonic' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('createWallet.mnemonic')}
              </label>
              <textarea
                value={mnemonic}
                onChange={(e) => setMnemonic(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                placeholder={t('createWallet.mnemonicPlaceholder')}
                rows={3}
              />
            </div>
          )}

          {/* Private key input */}
          {importType === 'privateKey' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('createWallet.privateKey')}
              </label>
              <input
                type="text"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                placeholder={t('createWallet.privateKeyPlaceholder')}
              />
            </div>
          )}

          {/* Password */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t('createWallet.walletPassword')}
            </label>
            <input
              type="password"
              value={walletPassword}
              onChange={(e) => setWalletPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
              placeholder={t('createWallet.walletPasswordPlaceholder')}
            />
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t('createWallet.walletPasswordHint')}
            </div>
          </div>

          {/* Confirm password */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t('createWallet.confirmPassword')}
            </label>
            <input
              type="password"
              value={walletPasswordConfirm}
              onChange={(e) => setWalletPasswordConfirm(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
              placeholder={t('createWallet.confirmPasswordPlaceholder')}
            />
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-300 rounded">
            {error}
          </div>
        )}

        <div className="flex justify-end space-x-3 mt-6">
          <button
            onClick={handleClose}
            disabled={loading}
            className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
          >
            {loading ? (
              <>
                <LoadingSpinner />
                <span className="ml-2">
                  {importType === 'create' ? t('createWallet.creating') : t('createWallet.importing')}
                </span>
              </>
            ) : importType === 'create' ? (
              t('createWallet.createWallet')
            ) : (
              t('createWallet.importWallet')
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export default CreateWallet
