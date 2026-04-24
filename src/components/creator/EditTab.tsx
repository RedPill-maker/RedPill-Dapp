import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { getKnownTokens, IPFS_CONFIG } from '../../../config'
import { privateDataMgr } from '../../utils/privateDataMgr'
import { creatorHubMgr } from '../../utils/creatorHubMgr'
import IPFSDropzone from '../IPFSDropzone'
import BoringAvatar from '../BoringAvatar'
import LoadingSpinner from '../LoadingSpinner'
import WalletSelectorModal, { PaymentConfig, TransactionResult } from '../../global_modal/WalletSelectorModal'
import ChainModePrompt from './ChainModePrompt'

interface EditTabProps {
  onSuccess: () => void
  currentSiteInfo?: any
}

const EditTab: React.FC<EditTabProps> = ({ onSuccess, currentSiteInfo }) => {
  const { t } = useTranslation()
  const creatorInfo = privateDataMgr.getCreatorInfo()
  const isFvm = creatorInfo?.mode === 'fvm'

  const [title, setTitle] = useState(creatorInfo?.title || currentSiteInfo?.title || '')
  const [description, setDescription] = useState(creatorInfo?.description || currentSiteInfo?.desc || '')
  const [backgroundCid, setBackgroundCid] = useState(creatorInfo?.backgroundCid || currentSiteInfo?.bg_cid || '')
  const [avatarCid, setAvatarCid] = useState(creatorInfo?.avatarCid || '')
  const [showWallet, setShowWallet] = useState(false)
  const [ipnsSaving, setIpnsSaving] = useState(false)
  const [ipnsSaveError, setIpnsSaveError] = useState<string | null>(null)

  useEffect(() => {
    setAvatarCid(creatorInfo?.avatarCid || '')
    setBackgroundCid(creatorInfo?.backgroundCid || currentSiteInfo?.bg_cid || '')
    setTitle(creatorInfo?.title || currentSiteInfo?.title || '')
    setDescription(creatorInfo?.description || currentSiteInfo?.desc || '')
  }, [])

  const handleIpnsSave = async () => {
    if (!creatorInfo?.ipnsId) return
    setIpnsSaving(true)
    setIpnsSaveError(null)
    try {
      // Update cache with new profile fields — sync hook handles IPNS push
      const cache = privateDataMgr.getIPNSSiteInfoCache()
      const currentData = cache?.data || {}
      const updatedData = {
        ...currentData,
        title,
        desc: description,
        bg_cid: backgroundCid || currentData.bg_cid || '',
      }
      privateDataMgr.setIPNSSiteInfoCache(updatedData)
      privateDataMgr.setCreatorInfo({ ...creatorInfo, title, description, backgroundCid })
      onSuccess()
    } catch (err: any) {
      setIpnsSaveError(err.message || t('common.error'))
    } finally {
      setIpnsSaving(false)
    }
  }

  if (!isFvm) {
    return (
      <div className="max-w-xl mx-auto space-y-4">
        <ChainModePrompt 
          currentSiteInfo={currentSiteInfo}
          onSuccess={onSuccess}
        />
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4" />
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('becomeCreator.pageTitleLabel')}
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 128))}
            maxLength={128}
            className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white text-sm"
            placeholder={t('becomeCreator.pageTitlePlaceholder')}
          />
          <p className="text-xs text-gray-400 mt-0.5 text-right">{title.length}/128</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('becomeCreator.pageDescLabel')}
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, 256))}
            maxLength={256}
            rows={3}
            className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white text-sm resize-none"
            placeholder={t('becomeCreator.pageDescPlaceholder')}
          />
          <p className="text-xs text-gray-400 mt-0.5 text-right">{description.length}/256</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('becomeCreator.bgImageLabel')}
          </label>
          <IPFSDropzone value={backgroundCid} onChange={setBackgroundCid} allowedTypes={['img']} />
        </div>
        {ipnsSaveError && <p className="text-xs text-red-600 dark:text-red-400 text-center">{ipnsSaveError}</p>}
        <button
          onClick={handleIpnsSave}
          disabled={ipnsSaving}
          className="w-full py-2.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {ipnsSaving ? <><LoadingSpinner size="small" />{t('common.processing')}</> : t('common.save')}
        </button>
      </div>
    )
  }

  const paymentConfig: PaymentConfig = {
    type: 'gas-only',
    token: getKnownTokens()[0].address,
    tokenSymbol: getKnownTokens()[0].symbol,
    description: t('myHome.edit.submitChanges'),
  }

  const handleConfirm = async (address: string, password: string): Promise<TransactionResult> => {
    try {
      const result = await creatorHubMgr.updateProfile(address, password, avatarCid, backgroundCid, '', '0x', title, description)
      if (result.success) {
        privateDataMgr.setCreatorInfo({ ...creatorInfo!, avatarCid, backgroundCid, title, description })
        onSuccess()
        return { success: true, txHash: result.txHash }
      }
      return { success: false, error: result.error, rawError: result.rawError }
    } catch (err: any) {
      return { success: false, error: err.message, rawError: err }
    }
  }

  return (
    <div className="max-w-xl mx-auto space-y-4">
      <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 text-center">
        {t('myHome.edit.onchainTitle')}
      </h3>
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-gray-200 dark:border-gray-600 flex-shrink-0">
          {avatarCid ? (
            <img src={`${IPFS_CONFIG.GATEWAY_URL}/ipfs/${avatarCid}`} alt="avatar" className="w-full h-full object-cover" />
          ) : (
            <BoringAvatar hash={creatorInfo?.username || 'default'} variant="beam" className="rounded-full" />
          )}
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('becomeCreator.form.uploadAvatar')}
          </label>
          <IPFSDropzone value={avatarCid} onChange={setAvatarCid} allowedTypes={['img']} enableCrop cropMaxSize={512} cropAspectRatio={1} className="[&>div]:min-h-[80px] [&>div]:py-2" />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('becomeCreator.pageTitleLabel')}
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, 128))}
          maxLength={128}
          className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white text-sm"
          placeholder={t('becomeCreator.pageTitlePlaceholder')}
        />
        <p className="text-xs text-gray-400 mt-0.5 text-right">{title.length}/128</p>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('becomeCreator.pageDescLabel')}
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, 256))}
          maxLength={256}
          rows={3}
          className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white text-sm resize-none"
          placeholder={t('becomeCreator.pageDescPlaceholder')}
        />
        <p className="text-xs text-gray-400 mt-0.5 text-right">{description.length}/256</p>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('becomeCreator.bgImageLabel')}
        </label>
        <IPFSDropzone value={backgroundCid} onChange={setBackgroundCid} allowedTypes={['img']} />
      </div>
      <div className="pt-2">
        <button
          onClick={() => setShowWallet(true)}
          className="w-full py-2.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
        >
          {t('myHome.edit.submitChanges')}
        </button>
      </div>
      {showWallet && (
        <WalletSelectorModal
          isOpen={showWallet}
          onClose={() => setShowWallet(false)}
          paymentConfig={paymentConfig}
          onConfirm={handleConfirm}
          highlightAddress={creatorInfo?.walletAddress}
          allowedAddresses={creatorInfo?.walletAddress ? [creatorInfo.walletAddress] : []}
        />
      )}
    </div>
  )
}

export default EditTab
