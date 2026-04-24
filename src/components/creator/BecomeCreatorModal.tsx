import React, { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ethers } from 'ethers'
import { APP_CONFIG, getKnownTokens, IPFS_CONFIG } from '../../../config'
import CreatorHubABI from '../../../contract_info/CreatorHub_abi.json'
import { ipfsConnector } from '../../utils/ipfsConnector'
import { privateDataMgr } from '../../utils/privateDataMgr'
import { creatorHubMgr } from '../../utils/creatorHubMgr'
import { rpcConnectorInstance, getCreatorHubAddress } from '../../utils/rpcConnector'
import { getCreatorByUsername } from '../../utils/dbConnector'
import { useAppDispatch } from '../../hooks/redux'
import { setCurrentPage } from '../../store/slices/pageSlice'
import LoadingSpinner from '../LoadingSpinner'
import DHTModeConfirm from '../DHTModeConfirm'
import WalletSelectorModal, {
  PaymentConfig,
  TransactionResult,
  GasEstimateCallback,
} from '../../global_modal/WalletSelectorModal'
import IPFSDropzone from '../IPFSDropzone'
import BoringAvatar from '../BoringAvatar'
import {
  LinkIcon,
  FolderOpenIcon,
  CheckCircleIcon,
  XCircleIcon,
  ArrowPathIcon,
  WalletIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'

type RegistrationMode = 'ipns' | 'onchain'
type WizardStep = 'mode' | 'info' | 'complete'

const STEPS: WizardStep[] = ['mode', 'info', 'complete']
const STEP_LABELS: Record<WizardStep, string> = {
  mode: 'selectMode',
  info: 'fillInfo',
  complete: 'complete',
}

interface FormData {
  mode: RegistrationMode
  username: string
  avatarCid: string
  title: string
  description: string
  backgroundCid: string
}

interface BecomeCreatorModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (ipnsId?: string) => void
  currentSiteInfo?: any
  isEdit?: boolean
  creatorIPNS?: string
  onlyOnchain?: boolean // show only on-chain registration flow (skip mode selection)
  upgradeOnchain?: boolean // upgrade from IPNS mode to on-chain mode
}

const BecomeCreatorModal: React.FC<BecomeCreatorModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  currentSiteInfo,
  isEdit = false,
  creatorIPNS,
  onlyOnchain = false,
  upgradeOnchain = false,
}) => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  // Step state / ステップ状態
  const [currentStep, setCurrentStep] = useState<WizardStep>('mode')

  const [formData, setFormData] = useState<FormData>({
    mode: 'onchain',
    username: '',
    avatarCid: '',
    title: currentSiteInfo?.title || '',
    description: currentSiteInfo?.desc || '',
    backgroundCid: '',
  })

  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Username validation state / ユーザー名検証状態
  const [usernameChecking, setUsernameChecking] = useState(false)
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null)
  const [usernameError, setUsernameError] = useState<string | null>(null)

  // Registration fee / 登録料金
  const [registrationFee, setRegistrationFee] = useState<string>('0')

  // Wallet check / ウォレットチェック
  const [hasWallets, setHasWallets] = useState(true)

  // DHT mode switch related state / DHT モード切り替え関連の状態
  const [showDHTConfirm, setShowDHTConfirm] = useState(false)

  // Wallet selector / ウォレットセレクター
  const [showWalletSelector, setShowWalletSelector] = useState(false)
  const [walletPaymentConfig, setWalletPaymentConfig] = useState<PaymentConfig | null>(null)

  // Creation process state / 作成プロセス状態
  const [createdIPNS, setCreatedIPNS] = useState<string | null>(null)

  // Complete step: confirmation state / 完了ステップ：確認状態
  const [confirmReady, setConfirmReady] = useState(false)
  const confirmTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ==================== Effects ====================

  // Initialize / 初期化
  useEffect(() => {
    if (isOpen) {
      if (isEdit && currentSiteInfo) {
        setFormData({
          mode: 'onchain',
          username: '',
          avatarCid: '',
          title: currentSiteInfo.title || '',
          description: currentSiteInfo.desc || '',
          backgroundCid: '',
        })
        setCurrentStep('info')
      } else if (onlyOnchain) {
        // On-chain only mode: skip mode selection, go directly to info entry, pre-fill site info / オンチェーンのみモード：モード選択をスキップ、情報入力に直接進む、サイト情報を事前入力
        setFormData({
          mode: 'onchain',
          username: '',
          avatarCid: '',
          title: currentSiteInfo?.title || '',
          description: currentSiteInfo?.desc || '',
          backgroundCid: currentSiteInfo?.bg_cid || '',
        })
        setCurrentStep('mode') // stay on mode step but show only on-chain tab
      } else {
        setFormData({
          mode: 'onchain',
          username: '',
          avatarCid: '',
          title: '',
          description: '',
          backgroundCid: '',
        })
        setCurrentStep('mode')
      }
      setError(null)
      setUsernameAvailable(null)
      setUsernameError(null)
      setConfirmReady(false)
    }
    return () => {
      if (confirmTimerRef.current) clearInterval(confirmTimerRef.current)
    }
  }, [isOpen, isEdit, onlyOnchain, currentSiteInfo])

  // Get registration fee / 登録料金を取得
  useEffect(() => {
    if (isOpen) {
      loadRegistrationFee()
    }
  }, [isOpen])

  // Check wallet / ウォレットをチェック
  useEffect(() => {
    if (isOpen && formData.mode === 'onchain') {
      privateDataMgr.getWalletList().then((wallets) => {
        setHasWallets(wallets.length > 0)
      })
    }
  }, [isOpen, formData.mode])

  // Complete step polling confirmation / 完了ステップポーリング確認
  useEffect(() => {
    if (currentStep !== 'complete') return
    setConfirmReady(false)

    const check = async () => {
      try {
        if (formData.mode === 'onchain') {
          const creator = await getCreatorByUsername(formData.username)
          if (creator) {
            setConfirmReady(true)
            if (confirmTimerRef.current) clearInterval(confirmTimerRef.current)
          }
        } else {
          // IPNS mode: check if site json is accessible / IPNS モード：サイト json がアクセス可能かチェック
          if (createdIPNS) {
            const cid = await ipfsConnector.resolveIPNS(createdIPNS)
            if (cid) {
              setConfirmReady(true)
              if (confirmTimerRef.current) clearInterval(confirmTimerRef.current)
            }
          }
        }
      } catch {
        // Continue polling / ポーリングを続ける
      }
    }

    check()
    confirmTimerRef.current = setInterval(check, 3000)
    return () => {
      if (confirmTimerRef.current) clearInterval(confirmTimerRef.current)
    }
  }, [currentStep, formData.mode, formData.username, createdIPNS])

  const loadRegistrationFee = async () => {
    try {
      const fee = await creatorHubMgr.getRegistrationFee()
      setRegistrationFee(fee)
    } catch (err) {
      console.error('Failed to get registration fee:', err)
      setRegistrationFee('0')
    }
  }

  // ==================== Username validation / ユーザー名検証 ====================

  const checkUsernameAvailability = async (username: string) => {
    if (!username || username.length === 0) {
      setUsernameAvailable(null)
      setUsernameError(null)
      return
    }
    if (username.length < 3 || username.length > 64) {
      setUsernameAvailable(false)
      setUsernameError(t('becomeCreator.usernameLengthError'))
      return
    }
    setUsernameChecking(true)
    setUsernameError(null)
    try {
      //Use silentNotFound=true to avoid logging "Not found" errors when checking username availability
      const profile = await creatorHubMgr.getCreatorProfile(username, true)
      if (profile.isRegistered) {
        setUsernameAvailable(false)
        setUsernameError(t('becomeCreator.usernameTaken'))
      } else {
        setUsernameAvailable(true)
        setUsernameError(null)
      }
    } catch {
      // "Not found" error indicates username is available / "Not found" エラーはユーザー名が利用可能であることを示す
      setUsernameAvailable(true)
      setUsernameError(null)
    } finally {
      setUsernameChecking(false)
    }
  }

  const handleUsernameBlur = () => {
    if (formData.mode === 'onchain' && formData.username) {
      checkUsernameAvailability(formData.username)
    }
  }

  // ==================== Step navigation / ステップナビゲーション ====================

  const canGoNext = (): boolean => {
    if (currentStep === 'mode') {
      if (formData.mode === 'onchain') {
        return (
          !!formData.username.trim() &&
          formData.username.length >= 3 &&
          formData.username.length <= 64 &&
          usernameAvailable !== false &&
          hasWallets
        )
      }
      return true // IPNS mode has no prerequisites
    }
    return true
  }

  const handleNext = () => {
    if (currentStep === 'mode') {
      setError(null)
      setCurrentStep('info')
    }
  }

  const handleBack = () => {
    if (currentStep === 'info') {
      setError(null)
      setCurrentStep('mode')
    }
  }

  // ==================== Creation logic / 作成ロジック ====================

  const handleSubmit = async () => {
    if (formData.mode === 'onchain') {
      if (!formData.username || formData.username.trim().length === 0) {
        setError(t('becomeCreator.onchainUsernameRequired'))
        return
      }
      if (usernameAvailable === false) {
        setError(t('becomeCreator.usernameUnavailable'))
        return
      }
      await handleOnchainCreation()
    } else {
      await handleIPNSCreation()
    }
  }

  // IPNS mode creation / IPNS モード作成
  const handleIPNSCreation = async () => {
    try {
      setCreating(true)
      setError(null)

      let siteInfo = {
        title: formData.title,
        desc: formData.description,
        bg_cid: formData.backgroundCid || currentSiteInfo?.bg_cid || '',
        items: currentSiteInfo?.items || [],
      }

      const siteInfoContent = JSON.stringify(siteInfo, null, 2)
      const siteInfoBlob = new Blob([siteInfoContent], { type: 'application/json' })
      const siteInfoFile = new File([siteInfoBlob], APP_CONFIG.SITE_FILE_NAME, {
        type: 'application/json',
      })

      if (isEdit && creatorIPNS) {
        const uploadResult = await ipfsConnector.uploadFilesToExistingIPNS(
          [siteInfoFile],
          creatorIPNS,
        )
        const result = await ipfsConnector.publishToIPNS(creatorIPNS, uploadResult.hash)
        setCreatedIPNS(result.name)
        setCurrentStep('complete')
        onSuccess(result.name)
      } else {
        const keyName = `creator_${Date.now()}`
        const newKey = await ipfsConnector.createIPNSKey(keyName)
        const uploadResult = await ipfsConnector.uploadFile(siteInfoFile)
        const ipnsId = await ipfsConnector.publishIPNS(uploadResult.hash, newKey.name)

        privateDataMgr.setCreatorInfo({
          mode: 'ipns',
          ipnsId: newKey.id,
          keyName: newKey.name,
          title: formData.title,
          description: formData.description,
          backgroundCid: formData.backgroundCid,
          createdAt: new Date().toISOString(),
        })

        setCreatedIPNS(ipnsId)

        const currentMode = await ipfsConnector.getDHTMode()
        if (currentMode !== 'dhtserver') {
          setShowDHTConfirm(true)
        } else {
          setCurrentStep('complete')
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('becomeCreator.saveFailed'))
    } finally {
      setCreating(false)
    }
  }

  // On-chain mode creation / オンチェーン モード作成
  const handleOnchainCreation = async () => {
    const paymentConfig: PaymentConfig = {
      type: 'fixed',
      amount: registrationFee,
      token: getKnownTokens()[0].address,
      tokenSymbol: getKnownTokens()[0].symbol,
      description: t('becomeCreator.registerDesc', { username: formData.username }),
    }
    setWalletPaymentConfig(paymentConfig)
    setShowWalletSelector(true)
  }

  // Handle on-chain registration transaction / オンチェーン登録トランザクションを処理
  const handleOnchainTransaction = async (
    address: string,
    password: string,
  ): Promise<TransactionResult> => {
    try {
      let ipnsAddress = ''
      let ipnsSignature = '0x'

      // If upgrading from IPNS mode to on-chain mode, need to pass IPNS address and signature / IPNS モードからオンチェーン モードにアップグレードする場合は、IPNS アドレスと署名を渡す必要があります
      if (upgradeOnchain && creatorIPNS) {
        ipnsAddress = creatorIPNS
        
        // Use IPNS private key to sign username / IPNS 秘密鍵を使用してユーザー名に署名
        try {
          const { signWithIPNSKey } = await import('../../utils/ipnsSigner')
          const signature = await signWithIPNSKey(creatorIPNS, formData.username)
          ipnsSignature = '0x' + signature
        } catch (err: any) {
          console.error('IPNS signing failed:', err)
          return {
            success: false,
            error: t('becomeCreator.ipnsSignFailed') || `IPNS signing failed: ${err.message}`,
          }
        }
      }

      const result = await creatorHubMgr.registerCreator(
        address,
        password,
        formData.username,
        formData.avatarCid,
        formData.backgroundCid,
        ipnsAddress,
        ipnsSignature,
        formData.title,
        formData.description,
      )

      if (result.success) {
        privateDataMgr.setCreatorInfo({
          mode: 'fvm',
          username: formData.username,
          walletAddress: address,
          avatarCid: formData.avatarCid,
          backgroundCid: formData.backgroundCid,
          ipnsAddress: ipnsAddress || undefined,
          title: formData.title,
          description: formData.description,
          createdAt: new Date().toISOString(),
        })
        // After transaction succeeds, enter complete step / トランザクション成功後、完了ステップに進む
        setShowWalletSelector(false)
        setCurrentStep('complete')
        return { success: true, txHash: result.txHash }
      }
      return { success: false, error: result.error || t('becomeCreator.registerFailed'), rawError: result.rawError }
    } catch (err: any) {
      return { success: false, error: err.message || t('becomeCreator.registerFailed'), rawError: err }
    }
  }

  const handleRegisterGasEstimate: GasEstimateCallback = async (address: string) => {
    try {
      const contract = new ethers.Contract(getCreatorHubAddress(), CreatorHubABI, rpcConnectorInstance.getProvider())
      const data = contract.interface.encodeFunctionData('registerCreator', [
        formData.username,
        formData.avatarCid,
        formData.backgroundCid,
        upgradeOnchain && creatorIPNS ? creatorIPNS : '',
        '0x',
        formData.title,
        formData.description
      ])
      return await rpcConnectorInstance.estimateContractGas(address, getCreatorHubAddress(), data, 0n)
    } catch (err: any) {
      console.error('Failed to estimate gas for register:', err)
      return { success: false, error: err.message }
    }
  }

  const handleDHTConfirm = () => {
    setShowDHTConfirm(false)
    setCurrentStep('complete')
  }

  // Complete button / 完了ボタン
  const handleFinish = () => {
    if (createdIPNS) {
      onSuccess(createdIPNS)
    } else {
      onSuccess()
    }
    // Navigate to user home page / ユーザーホームページに移動
    if (formData.mode === 'onchain') {
      dispatch(setCurrentPage('myHome'))
    } else if (createdIPNS) {
      dispatch(setCurrentPage('myHome'))
    }
    onClose()
  }

  // ==================== Rendering ====================

  if (!isOpen) return null

  // DHT mode switch confirmation dialog / DHT モード切り替え確認ダイアログ
  if (showDHTConfirm) {
    return (
      <DHTModeConfirm
        isOpen={showDHTConfirm}
        onClose={handleDHTConfirm}
        onConfirm={handleDHTConfirm}
      />
    )
  }

  // Wallet selector / ウォレットセレクター
  if (showWalletSelector && walletPaymentConfig) {
    return (
      <WalletSelectorModal
        isOpen={showWalletSelector}
        onClose={() => {
          setShowWalletSelector(false)
          setCreating(false)
        }}
        paymentConfig={walletPaymentConfig}
        onConfirm={handleOnchainTransaction}
        onGasEstimate={handleRegisterGasEstimate}
        transactionMetadata={{
          method: 'registerCreator',
        }}
      />
    )
  }

  // ==================== Step indicator ====================

  const renderStepIndicator = () => (
    <div className="flex items-center justify-center gap-2 mb-3">
      {STEPS.map((step, idx) => {
        const isActive = step === currentStep
        const isPast = STEPS.indexOf(currentStep) > idx
        return (
          <React.Fragment key={step}>
            {idx > 0 && (
              <div
                className={`h-px w-8 ${isPast ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
              />
            )}
            <div className="flex items-center gap-1.5">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : isPast
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                }`}
              >
                {isPast ? (
                  <CheckCircleIcon className="w-4 h-4" />
                ) : (
                  idx + 1
                )}
              </div>
              <span
                className={`text-xs ${
                  isActive
                    ? 'text-blue-600 dark:text-blue-400 font-medium'
                    : 'text-gray-500 dark:text-gray-400'
                }`}
              >
                {t(`becomeCreator.steps.${STEP_LABELS[step]}`)}
              </span>
            </div>
          </React.Fragment>
        )
      })}
    </div>
  )

  // ==================== Step 1: Select mode ====================

  const renderModeStep = () => (
    <div className="flex-1 px-6">
      {/* Mode tabs / モードタブ */}
      {!onlyOnchain && (
        <div className="flex border-b border-gray-200 dark:border-gray-700 mb-3">
          <button
            onClick={() => setFormData({ ...formData, mode: 'onchain' })}
            className={`flex-1 py-2.5 text-sm font-medium text-center border-b-2 transition-colors ${
              formData.mode === 'onchain'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <LinkIcon className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />
            {t('becomeCreator.onchainModeLabel')}
          </button>
          <button
            onClick={() => setFormData({ ...formData, mode: 'ipns' })}
            className={`flex-1 py-2.5 text-sm font-medium text-center border-b-2 transition-colors ${
              formData.mode === 'ipns'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <FolderOpenIcon className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />
            {t('becomeCreator.ipnsModeLabel')}
          </button>
        </div>
      )}

      {formData.mode === 'onchain' || onlyOnchain ? renderOnchainTab() : renderIPNSTab()}
    </div>
  )

  const renderOnchainTab = () => {
    // On-chain mode description (always displayed) / オンチェーン モード説明（常に表示）
    const description = (
      <div className="p-2.5 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-xs text-gray-600 dark:text-gray-400 space-y-1">
        <p>
          <span className="font-medium text-gray-700 dark:text-gray-300">{t('becomeCreator.onchainModeLabel')}</span>
          ：{t('becomeCreator.onchainModeIntro')}
        </p>
        <p>
          ✦ {t('becomeCreator.modes.onchainDesc')}
        </p>
        <p className="text-gray-500 dark:text-gray-400">
          {t('becomeCreator.usernameImmutable')}
        </p>
        {registrationFee !== '0' && (
          <p className="font-medium text-amber-600 dark:text-amber-400 pt-0.5">
            {t('becomeCreator.registrationFee', { fee: registrationFee })}
          </p>
        )}
      </div>
    )

    // No wallet when showing create wallet prompt + description / ウォレットがない場合、ウォレット作成プロンプト + 説明を表示
    if (!hasWallets) {
      return (
        <div className="space-y-3">
          <div className="flex flex-col items-center py-6">
            <WalletIcon className="w-12 h-12 text-yellow-500 mb-3" />
            <p className="text-sm text-gray-700 dark:text-gray-300 mb-1 text-center">
              {t('becomeCreator.onchainNeedWallet')}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 text-center">
              {t('becomeCreator.noWalletYet')}
            </p>
            <button
              onClick={() => {
                onClose()
                dispatch(setCurrentPage('filecoinWallet'))
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <WalletIcon className="w-4 h-4" />
              {t('createWallet.createWallet')}
            </button>
          </div>
          {description}
        </div>
      )
    }

    return (
    <div className="space-y-2">
      {/* Avatar preview / アバタープレビュー */}
      <div className="flex flex-col items-center">
        <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-gray-200 dark:border-gray-600 mb-1">
          {formData.avatarCid ? (
            <img
              src={`${IPFS_CONFIG.GATEWAY_URL}/ipfs/${formData.avatarCid}`}
              alt="Avatar"
              className="w-full h-full object-cover"
            />
          ) : (
            <BoringAvatar
              hash={formData.username || 'default-creator'}
              variant="beam"
              className="rounded-full"
            />
          )}
        </div>
      </div>

      {/* Username / ユーザー名 */}
      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('becomeCreator.usernameLabel')} <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={formData.username}
          onChange={(e) => {
            const val = e.target.value.slice(0, 64)
            setFormData({ ...formData, username: val })
            setUsernameAvailable(null)
            setUsernameError(null)
          }}
          onBlur={handleUsernameBlur}
          maxLength={64}
          className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white text-sm"
          placeholder={t('becomeCreator.usernamePlaceholder')}
        />
        <div className="flex items-center justify-between mt-0.5">
          <div>
            {usernameChecking && (
              <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center">
                <ArrowPathIcon className="w-3 h-3 mr-1 animate-spin" />
                {t('becomeCreator.usernameChecking')}
              </p>
            )}
            {usernameAvailable === true && (
              <p className="text-xs text-green-600 dark:text-green-400 flex items-center">
                <CheckCircleIcon className="w-3 h-3 mr-1" />
                {t('becomeCreator.usernameAvailable')}
              </p>
            )}
            {usernameError && (
              <p className="text-xs text-red-600 dark:text-red-400 flex items-center">
                <XCircleIcon className="w-3 h-3 mr-1" />
                {usernameError}
              </p>
            )}
          </div>
          <span className="text-xs text-gray-400">{formData.username.length}/64</span>
        </div>
      </div>

      {/* Avatar upload / アバタアップロード */}
      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('becomeCreator.form.uploadAvatar')}
        </label>
        <IPFSDropzone
          value={formData.avatarCid}
          onChange={(cid) => setFormData({ ...formData, avatarCid: cid })}
          allowedTypes={['img']}
          enableCrop
          cropMaxSize={512}
          cropAspectRatio={1}
          className="[&>div]:min-h-[120px] [&>div]:py-3"
        />
      </div>

      {/* On-chain mode description / オンチェーン モード説明 */}
      {description}
    </div>
    )
  }

  const renderIPNSTab = () => (
    <div className="space-y-3">
      <div className="p-2.5 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-xs text-gray-600 dark:text-gray-400 space-y-1.5">
        <p>
          <span className="font-medium text-gray-700 dark:text-gray-300">{t('becomeCreator.ipnsModeLabel')}</span>
          ：{t('becomeCreator.ipnsModeIntro')}
        </p>
        <p className="flex items-start gap-1">
          <ExclamationTriangleIcon className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-500" />
          {t('becomeCreator.modes.ipnsDesc')}
        </p>
        <p className="pt-1 text-gray-500 dark:text-gray-400">
          {t('becomeCreator.ipnsSuggestion')}
        </p>
      </div>
    </div>
  )

  // ==================== Step 2: Fill information ====================

  const renderInfoStep = () => (
    <div className="flex-1 px-6 space-y-3">
      {/* Home page title / ホームページタイトル */}
      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('becomeCreator.pageTitleLabel')}
        </label>
        <input
          type="text"
          value={formData.title}
          onChange={(e) => setFormData({ ...formData, title: e.target.value.slice(0, 128) })}
          maxLength={128}
          className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white text-sm"
          placeholder={t('becomeCreator.pageTitlePlaceholder')}
        />
        <div className="text-right mt-0.5">
          <span className="text-xs text-gray-400">{formData.title.length}/128</span>
        </div>
      </div>

      {/* Home page introduction / ホームページ紹介 */}
      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('becomeCreator.pageDescLabel')}
        </label>
        <textarea
          value={formData.description}
          onChange={(e) =>
            setFormData({ ...formData, description: e.target.value.slice(0, 256) })
          }
          maxLength={256}
          rows={3}
          className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white text-sm resize-none"
          placeholder={t('becomeCreator.pageDescPlaceholder')}
        />
        <div className="text-right mt-0.5">
          <span className="text-xs text-gray-400">{formData.description.length}/256</span>
        </div>
      </div>

      {/* Background image */}
      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('becomeCreator.bgImageLabel')}
        </label>
        <IPFSDropzone
          value={formData.backgroundCid}
          onChange={(cid) => setFormData({ ...formData, backgroundCid: cid })}
          allowedTypes={['img']}
        />
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
          {t('becomeCreator.bgImageHint')}
        </p>
        {currentSiteInfo?.bg_cid && !formData.backgroundCid && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {t('becomeCreator.currentBgImage', { cid: currentSiteInfo.bg_cid.substring(0, 16) })}
          </p>
        )}
      </div>
    </div>
  )

  // ==================== Step 3: Complete ====================

  const renderCompleteStep = () => (
    <div className="flex-1 flex flex-col items-center justify-center px-6">
      {confirmReady ? (
        <>
          <CheckCircleIcon className="w-16 h-16 text-green-500 mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            {isEdit ? t('becomeCreator.pageInfoUpdated') : t('becomeCreator.createSuccess')}
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 text-center">
            {formData.mode === 'onchain'
              ? t('becomeCreator.onchainConfirmSuccess')
              : t('becomeCreator.ipnsConfirmSuccess')}
          </p>
        </>
      ) : (
        <>
          <ArrowPathIcon className="w-12 h-12 text-blue-500 animate-spin mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            {t('becomeCreator.waitingConfirm')}
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 text-center max-w-xs">
            {formData.mode === 'onchain'
              ? t('becomeCreator.waitingOnchain')
              : t('becomeCreator.waitingIpns')}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
            {t('becomeCreator.waitingTime')}
          </p>
        </>
      )}
    </div>
  )

  // ==================== Bottom buttons ====================

  const renderFooter = () => {
    if (currentStep === 'mode') {
      return (
        <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleNext}
            disabled={!canGoNext()}
            className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('common.nextStep')}
          </button>
        </div>
      )
    }

    if (currentStep === 'info') {
      return (
        <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-between">
          <button
            onClick={handleBack}
            disabled={creating}
            className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
          >
            {t('common.prevStep')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={creating}
            className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating ? (
              <span className="flex items-center gap-1.5">
                <LoadingSpinner />
                {t('becomeCreator.creating')}
              </span>
            ) : (
              <>
                {isEdit ? t('common.save') : t('becomeCreator.create')}
                {formData.mode === 'onchain' && registrationFee !== '0' && (
                  <span className="ml-1.5 opacity-90">({registrationFee} FIL)</span>
                )}
              </>
            )}
          </button>
        </div>
      )
    }

    // complete step
    return (
      <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end">
        <button
          onClick={handleFinish}
          disabled={!confirmReady}
          className="px-5 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {t('common.complete')}
        </button>
      </div>
    )
  }

  //==================== Main rendering ====================

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-xl w-[600px] min-h-[760px] flex flex-col shadow-2xl">
        {/*title bar */}
        <div className="px-6 pt-4 pb-2">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white text-center mb-3">
            {upgradeOnchain ? t('becomeCreator.upgradeTitle') : isEdit ? t('becomeCreator.editTitle') : t('becomeCreator.title')}
          </h3>
          {renderStepIndicator()}
        </div>

        {/* Step content / ステップコンテンツ */}
        {currentStep === 'mode' && renderModeStep()}
        {currentStep === 'info' && renderInfoStep()}
        {currentStep === 'complete' && renderCompleteStep()}

        {/* Error message / エラーメッセージ */}
        {error && (
          <div className="mx-6 mb-2 p-2.5 bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* Bottom buttons / 下部ボタン */}
        {renderFooter()}
      </div>
    </div>
  )
}

export default BecomeCreatorModal
