import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { walletMgr, WalletInfo } from '../../utils/walletMgr'
import { privateDataMgr, CreatorInfo } from '../../utils/privateDataMgr'
import { creatorHubMgr } from '../../utils/creatorHubMgr'
import { ipfsConnector } from '../../utils/ipfsConnector'
import { useCreatorInfo } from './CreatorAvatar'
import PasswordInput from '../PasswordInput'
import CreateWallet from './CreateWallet'
import FilecoinIcon from '../FilecoinIcon'
import CreatorAvatar from './CreatorAvatar'
import USDFCExchange from './USDFCExchange'
import { ChevronRightIcon } from '@heroicons/react/24/outline'
interface WalletListItem {
  ethAddress: string
  filAddress: string
  name: string
  createdAt: string
}

interface WalletListProps {
  onWalletSelect: (wallet: WalletInfo) => void
}

const WalletListItemComponent: React.FC<{
  wallet: WalletListItem
  isCurrentCreator: boolean
  onSelect: () => void
  onSetAsCreator: () => void
}> = ({ wallet, isCurrentCreator, onSelect, onSetAsCreator }) => {
  const { t } = useTranslation()
  const { creator } = useCreatorInfo(wallet.ethAddress)

  return (
    <div
      className={`bg-white dark:bg-gray-800 rounded-lg p-6 border-2 transition-all cursor-pointer ${
        isCurrentCreator
          ? 'border-red-500 dark:border-red-400 shadow-lg'
          : 'border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600'
      }`}
      onClick={onSelect}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4 flex-1">
          <CreatorAvatar walletAddress={wallet.ethAddress} size="md" />

          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-2 mb-1">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                {wallet.name}
              </h3>
              {isCurrentCreator && (
                <span className="text-xs bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 px-2 py-0.5 rounded">
                  {t('walletList.currentCreator')}
                </span>
              )}
            </div>

            {creator && (
              <div className="text-sm text-blue-600 dark:text-blue-400 mb-2">
                @{creator.username}
              </div>
            )}

            <div className="text-sm text-gray-600 dark:text-gray-400 font-mono truncate">
              {wallet.ethAddress}
            </div>

            <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">
              {t('walletList.createdAt')} {new Date(wallet.createdAt).toLocaleString()}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 ml-4">
          {creator &&
            (isCurrentCreator ? (
              <span className="text-xs text-red-600 dark:text-red-400 px-3 py-1 border border-red-300 dark:border-red-600 rounded bg-red-50 dark:bg-red-900/20">
                {t('walletList.currentCreator')}
              </span>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onSetAsCreator()
                }}
                className="text-xs text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 px-3 py-1 border border-gray-300 dark:border-gray-600 rounded hover:border-red-500 transition-colors"
              >
                {t('walletList.setAsCreator')}
              </button>
            ))}
          <ChevronRightIcon className="w-6 h-6 text-blue-600 dark:text-blue-400" />
        </div>
      </div>
    </div>
  )
}

const WalletList: React.FC<WalletListProps> = ({ onWalletSelect }) => {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<'wallets' | 'exchange'>('wallets')
  const [wallets, setWallets] = useState<WalletListItem[]>([])
  const [currentCreatorAddress, setCurrentCreatorAddress] = useState<
    string | null
  >(null)
  const [showCreateWallet, setShowCreateWallet] = useState(false)
  const [showPasswordInput, setShowPasswordInput] = useState(false)
  const [passwordInputConfig, setPasswordInputConfig] = useState({
    title: '',
    description: '',
    onConfirm: (_password: string) => {},
  })
  const [error, setError] = useState<string | null>(null)

  // Confirm replace creator dialog
  const [showReplaceConfirm, setShowReplaceConfirm] = useState(false)
  const [existingCreatorInfo, setExistingCreatorInfo] =
    useState<CreatorInfo | null>(null)
  const [newCreatorAddress, setNewCreatorAddress] = useState<string>('')

  useEffect(() => {
    loadWallets()
    loadCurrentCreator()
  }, [])

  const loadWallets = async () => {
    const walletList = await walletMgr.getWalletList()
    setWallets(walletList)
  }

  const loadCurrentCreator = () => {
    const creatorInfo = privateDataMgr.getCreatorInfo()
    if (creatorInfo) {
      // Read wallet address from CreatorInfo
      // If wallet address is not stored, try to match by username
      if (creatorInfo.walletAddress) {
        setCurrentCreatorAddress(creatorInfo.walletAddress)
      } else {
        setCurrentCreatorAddress(null)
      }
    } else {
      setCurrentCreatorAddress(null)
    }
  }

  const handleSetAsCreator = async (address: string) => {
    try {
      // 1. Check if creator info already exists
      const existingCreator = privateDataMgr.getCreatorInfo()

      if (existingCreator) {
        // Creator info exists, show confirmation dialog
        setExistingCreatorInfo(existingCreator)
        setNewCreatorAddress(address)
        setShowReplaceConfirm(true)
      } else {
        // No creator info, set directly
        await setCreatorFromWallet(address)
      }
    } catch (err: any) {
      setError(err.message || t('walletList.setCreatorFailed'))
    }
  }

  const setCreatorFromWallet = async (address: string) => {
    try {
      // 2. Get creator info from chain
      const username = await creatorHubMgr.getCreatorUsername(address)

      if (!username) {
        setError(t('walletList.notRegisteredAsCreator'))
        return
      }

      const profile = await creatorHubMgr.getCreatorProfile(username)

      // 3. Save creator info locally (including wallet address)
      const creatorInfo: CreatorInfo = {
        mode: 'fvm',
        username: profile.username,
        walletAddress: address, // store wallet address
        avatarCid: '', // needs to be fetched from chain
        backgroundCid: '', // needs to be fetched from chain
        title: '',
        description: '',
        createdAt: new Date(profile.registeredAt * 1000).toISOString(),
      }

      privateDataMgr.setCreatorInfo(creatorInfo)
      setCurrentCreatorAddress(address)
      setShowReplaceConfirm(false)
      setError(null)

      // No need to call loadCurrentCreator again, as currentCreatorAddress has been set
    } catch (err: any) {
      setError(err.message || t('walletList.fetchCreatorFailed'))
    }
  }

  const handleConfirmReplace = async () => {
    if (newCreatorAddress) {
      await setCreatorFromWallet(newCreatorAddress)
    }
  }

  const handleUnlockWallet = (address: string) => {
    // Directly pop up wallet password input box, no longer involves security password
    setPasswordInputConfig({
      title: t('walletList.unlockWalletTitle'),
      description: t('walletList.unlockWalletDesc'),
      onConfirm: async (password: string) => {
        unlockWalletWithPassword(address, password)
        setShowPasswordInput(false)
      },
    })
    setShowPasswordInput(true)
  }

  const unlockWalletWithPassword = async (
    address: string,
    password: string,
  ) => {
    const result = await walletMgr.unlockWallet(address, password)
    if (result.success && result.wallet) {
      setError(null)
      onWalletSelect(result.wallet)
    } else {
      setError(result.error || t('walletList.unlockFailed'))
    }
  }

  const handleCreateWalletSuccess = async (wallet: WalletInfo) => {
    loadWallets()
    onWalletSelect(wallet)
  }

  if (wallets.length === 0) {
    return (
      <div className="p-4">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-8">
            <div className="flex justify-center mb-4"><FilecoinIcon size={64} /></div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
              {t('walletList.title')}
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              {t('walletList.description')}
            </p>
          </div>

          <div className="grid md:grid-cols-1 gap-6 max-w-md mx-auto">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                {t('walletList.createOrImport')}
              </h3>
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                {t('walletList.description')}
              </p>
              <button
                onClick={() => setShowCreateWallet(true)}
                className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors"
              >
                {t('walletList.getStarted')}
              </button>
            </div>
          </div>
        </div>

        <CreateWallet
          isOpen={showCreateWallet}
          onClose={() => setShowCreateWallet(false)}
          onSuccess={handleCreateWalletSuccess}
        />

        <PasswordInput
          isOpen={showPasswordInput}
          onClose={() => setShowPasswordInput(false)}
          onConfirm={passwordInputConfig.onConfirm}
          title={passwordInputConfig.title}
          description={passwordInputConfig.description}
          error={error}
        />
      </div>
    )
  }

  return (
    <div className="p-4">
      <div>
        {/* Tabs - placed at the top */}
        <div className="flex border-b border-gray-200 dark:border-gray-700 mb-6">
          <button
            onClick={() => setActiveTab('wallets')}
            className={`px-6 py-3 text-sm font-medium transition-colors ${
              activeTab === 'wallets'
                ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            {t('walletList.walletsTab')}
          </button>
          <button
            onClick={() => setActiveTab('exchange')}
            className={`px-6 py-3 text-sm font-medium transition-colors ${
              activeTab === 'exchange'
                ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            {t('walletList.exchangeTab')}
          </button>
        </div>

        {/* Content area */}
        {activeTab === 'wallets' ? (
          <>
            <div className="flex justify-between items-center mb-8">
              <div>
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                  {t('walletList.myWallets')}
                </h1>
                <p className="text-gray-600 dark:text-gray-400">
                  {t('walletList.selectWalletHint')}
                </p>
              </div>

              <button
                onClick={() => setShowCreateWallet(true)}
                className="bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors"
              >
                {t('walletList.createImportWallet')}
              </button>
            </div>

            <div className="grid gap-4">
              {wallets.map((wallet) => (
                <WalletListItemComponent
                  key={wallet.ethAddress}
                  wallet={wallet}
                  isCurrentCreator={wallet.ethAddress === currentCreatorAddress}
                  onSelect={() => handleUnlockWallet(wallet.ethAddress)}
                  onSetAsCreator={() => handleSetAsCreator(wallet.ethAddress)}
                />
              ))}
            </div>
          </>
        ) : (
          <USDFCExchange wallets={wallets} />
        )}
      </div>

      <CreateWallet
        isOpen={showCreateWallet}
        onClose={() => setShowCreateWallet(false)}
        onSuccess={handleCreateWalletSuccess}
      />

      <PasswordInput
        isOpen={showPasswordInput}
        onClose={() => setShowPasswordInput(false)}
        onConfirm={passwordInputConfig.onConfirm}
        title={passwordInputConfig.title}
        description={passwordInputConfig.description}
        error={error}
      />

      {/* Replace creator confirmation dialog */}
      {showReplaceConfirm && existingCreatorInfo && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              {t('walletList.replaceCreator')}
            </h3>

            <div className="mb-6">
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                {t('walletList.replaceCreatorConfirm')}
              </p>

              <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 mb-4">
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                  {t('walletList.currentCreatorInfo')}
                </h4>
                <div className="space-y-2 text-sm">
                  {existingCreatorInfo.username && (
                    <div className="flex items-center space-x-2">
                      <span className="text-gray-600 dark:text-gray-400">
                        {t('walletList.usernameLabel')}
                      </span>
                      <span className="text-gray-900 dark:text-white font-medium">
                        @{existingCreatorInfo.username}
                      </span>
                    </div>
                  )}
                  {existingCreatorInfo.title && (
                    <div className="flex items-center space-x-2">
                      <span className="text-gray-600 dark:text-gray-400">
                        {t('walletList.titleLabel')}
                      </span>
                      <span className="text-gray-900 dark:text-white">
                        {existingCreatorInfo.title}
                      </span>
                    </div>
                  )}
                  {existingCreatorInfo.ipnsId && (
                    <div className="flex items-center space-x-2">
                      <span className="text-gray-600 dark:text-gray-400">
                        IPNS:
                      </span>
                      <span className="text-gray-900 dark:text-white font-mono text-xs">
                        {existingCreatorInfo.ipnsId.substring(0, 20)}...
                      </span>
                    </div>
                  )}
                  {existingCreatorInfo.avatarCid && (
                    <div className="mt-2">
                      <img
                        src={ipfsConnector.getGatewayUrl(
                          existingCreatorInfo.avatarCid,
                        )}
                        alt="Avatar"
                        className="w-16 h-16 rounded-full object-cover"
                      />
                    </div>
                  )}
                  <div className="flex items-center space-x-2">
                    <span className="text-gray-600 dark:text-gray-400">
                      {t('walletList.modeLabel')}
                    </span>
                    <span className="text-gray-900 dark:text-white">
                      {existingCreatorInfo.mode === 'fvm'
                        ? t('walletList.onchainMode')
                        : t('walletList.ipnsMode')}
                    </span>
                  </div>
                </div>
              </div>

              <p className="text-sm text-red-600 dark:text-red-400">
                ⚠️ {t('walletList.replaceWarning')}
              </p>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-300 rounded">
                {error}
              </div>
            )}

            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowReplaceConfirm(false)
                  setError(null)
                }}
                className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleConfirmReplace}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                {t('walletList.confirmReplace')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default WalletList
