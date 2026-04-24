/**
 * SetupSecurityModal - Force setup security password on first startup / 初回起動時にセキュリティパスワードを強制設定
 */
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { privateDataMgr } from '../utils/privateDataMgr'
import GesturePassword from './GesturePassword'
import { ShieldCheckIcon } from '@heroicons/react/24/outline'

interface SetupSecurityModalProps {
  isOpen: boolean
  onComplete: () => void
}

const SetupSecurityModal: React.FC<SetupSecurityModalProps> = ({
  isOpen,
  onComplete,
}) => {
  const { t } = useTranslation()
  const [step, setStep] = useState<'intro' | 'draw1' | 'draw2'>('intro')
  const [firstPattern, setFirstPattern] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [gestureKey, setGestureKey] = useState(0)

  const handlePattern = async (pattern: string) => {
    setError(null)
    if (step === 'draw1') {
      setFirstPattern(pattern)
      setStep('draw2')
      setGestureKey((k) => k + 1)
    } else if (step === 'draw2') {
      if (pattern !== firstPattern) {
        setError(t('setupSecurity.errorMismatch'))
        setFirstPattern('')
        setStep('draw1')
        setGestureKey((k) => k + 1)
        return
      }
      try {
        await privateDataMgr.setPassword(pattern)
        onComplete()
      } catch (err: any) {
        setError(err.message || t('common.error'))
        setGestureKey((k) => k + 1)
      }
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-[100]">
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl">
        {step === 'intro' && (
          <>
            <div className="flex flex-col items-center mb-6">
              <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center mb-4">
                <ShieldCheckIcon className="w-8 h-8 text-blue-600 dark:text-blue-400" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                {t('setupSecurity.title')}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
                {t('setupSecurity.intro')}
              </p>
            </div>

            <ul className="space-y-2 mb-6 text-sm text-gray-600 dark:text-gray-300">
              <li className="flex items-center space-x-2">
                <span className="text-blue-500">•</span>
                <span>{t('setupSecurity.item1')}</span>
              </li>
              <li className="flex items-center space-x-2">
                <span className="text-blue-500">•</span>
                <span>{t('setupSecurity.item2')}</span>
              </li>
              <li className="flex items-center space-x-2">
                <span className="text-blue-500">•</span>
                <span>{t('setupSecurity.item3')}</span>
              </li>
            </ul>

            <button
              onClick={() => setStep('draw1')}
              className="w-full py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors"
            >
              {t('setupSecurity.startSetup')}
            </button>
          </>
        )}

        {(step === 'draw1' || step === 'draw2') && (
          <>
            <div className="text-center mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {step === 'draw1' ? t('setupSecurity.draw1Title') : t('setupSecurity.draw2Title')}
              </h2>
              <p className="text-xs text-blue-500 mt-1">
                {step === 'draw1' ? t('setupSecurity.step1') : t('setupSecurity.step2')}
              </p>
              {step === 'draw2' && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  {t('setupSecurity.draw2Desc')}
                </p>
              )}
            </div>

            <div className="flex justify-center">
              <GesturePassword
                key={gestureKey}
                mode="set"
                onComplete={handlePattern}
                error={error}
              />
            </div>

            {step === 'draw2' && (
              <button
                onClick={() => {
                  setStep('draw1')
                  setFirstPattern('')
                  setError(null)
                  setGestureKey((k) => k + 1)
                }}
                className="w-full mt-3 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              >
                {t('setupSecurity.redraw')}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default SetupSecurityModal
