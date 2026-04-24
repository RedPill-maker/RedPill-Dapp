import React, { useState, useEffect, ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import { privateDataMgr } from '../../utils/privateDataMgr'
import LoadingSpinner from '../LoadingSpinner'
import BecomeCreatorModal from './BecomeCreatorModal'
import { PaintBrushIcon, CheckIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline'

export interface CreatorCheckProps {
  isCreator: boolean
  currentSiteInfo: any
  refreshCreatorStatus: () => Promise<void>
}

export function withCreatorCheck<P extends CreatorCheckProps>(
  WrappedComponent: ComponentType<P>,
) {
  return function WithCreatorCheckComponent(
    props: Omit<P, keyof CreatorCheckProps>,
  ) {
    const { t } = useTranslation()
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [isCreator, setIsCreator] = useState(false)
    const [showBecomeCreatorModal, setShowBecomeCreatorModal] = useState(false)
    const [currentSiteInfo, setCurrentSiteInfo] = useState<any>(null)
    const [refreshCount, setRefreshCount] = useState(0)

    useEffect(() => {
      checkCreatorStatus()
    }, [])

    const checkCreatorStatus = async () => {
      try {
        setLoading(true)
        setError(null)

        const mode = privateDataMgr.getCreatorMode()

        // mode is null, not a creator / mode は null、クリエイターではない
        if (mode === null) {
          setIsCreator(false)
          setCurrentSiteInfo(null)
          setLoading(false)
          return
        }

        // FVM mode: directly mark as creator, no need to load site data / FVM モード：直接クリエイターとしてマーク、サイトデータを読み込む必要なし
        if (mode === 'fvm') {
          setIsCreator(true)
          setCurrentSiteInfo(null)
          setLoading(false)
          setRefreshCount((c) => c + 1)
          return
        }

        // IPNS mode: confirm as creator, site data loaded by MyHome itself / IPNS モード：クリエイターとして確認、サイトデータは MyHome 自身で読み込む
        if (mode === 'ipns') {
          setIsCreator(true)
          setCurrentSiteInfo(null)
          setLoading(false)
          setRefreshCount((c) => c + 1)
          return
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t('creatorCheck.checkFailed'))
      } finally {
        setLoading(false)
      }
    }

    const handleCreatorSuccess = () => {
      // Re-check status after successful registration / 登録成功後にステータスを再確認
      checkCreatorStatus()
    }

    // Loading state / ロード中状態
    if (loading) {
      return (
        <div className="flex items-center justify-center py-12">
          <LoadingSpinner />
          <span className="ml-3 text-gray-600 dark:text-gray-400">
            {t('creatorCheck.checking')}
          </span>
        </div>
      )
    }

    // Error state / エラー状態
    if (error) {
      return (
        <div className="text-center py-12">
          <ExclamationCircleIcon className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            {t('creatorCheck.loadFailed')}
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">{error}</p>
          <button
            onClick={checkCreatorStatus}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            {t('common.retry')}
          </button>
        </div>
      )
    }

    //If not the creator, show the guide page
    if (!isCreator) {
      return (
        <div>
          <div className="text-center py-12">
            <div className="flex justify-center mb-4">
              <PaintBrushIcon className="w-16 h-16 text-purple-500" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              {t('creatorCheck.becomeCreatorAction')}
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              {t('creatorCheck.becomeCreatorIntro')}
            </p>
            <button
              onClick={() => setShowBecomeCreatorModal(true)}
              className="px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all duration-300"
            >
              {t('creatorCheck.becomeCreator')}
            </button>

            <div className="mt-8 max-w-md mx-auto text-left">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
                {t('creatorCheck.benefits')}
              </h3>
              <ul className="space-y-2 text-gray-600 dark:text-gray-400">
                <li className="flex items-center">
                  <CheckIcon className="w-5 h-5 text-green-500 mr-2" />
                  {t('creatorCheck.benefit1')}
                </li>
                <li className="flex items-center">
                  <CheckIcon className="w-5 h-5 text-green-500 mr-2" />
                  {t('creatorCheck.benefit2')}
                </li>
                <li className="flex items-center">
                  <CheckIcon className="w-5 h-5 text-green-500 mr-2" />
                  {t('creatorCheck.benefit3')}
                </li>
                <li className="flex items-center">
                  <CheckIcon className="w-5 h-5 text-green-500 mr-2" />
                  {t('creatorCheck.benefit4')}
                </li>
              </ul>
            </div>
          </div>

          <BecomeCreatorModal
            isOpen={showBecomeCreatorModal}
            onClose={() => setShowBecomeCreatorModal(false)}
            onSuccess={handleCreatorSuccess}
            isEdit={false}
          />
        </div>
      )
    }

    // Render wrapped component / ラップされたコンポーネントをレンダリング
    return (
      <WrappedComponent
        {...(props as P)}
        isCreator={isCreator}
        currentSiteInfo={refreshCount}
        refreshCreatorStatus={checkCreatorStatus}
      />
    )
  }
}
