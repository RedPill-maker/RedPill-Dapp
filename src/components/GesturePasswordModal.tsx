/**
* GesturePasswordModal - Gesture Password Popup
* Supports three modes:
* - 'create': Create (confirm twice)
* - 'verify': Verify
* - 'change': Change (verify old password first, then confirm new password twice)
 */
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import GesturePassword from './GesturePassword'
import { XMarkIcon } from '@heroicons/react/24/outline'

type ModalMode = 'create' | 'verify' | 'change'

interface GesturePasswordModalProps {
  isOpen: boolean
  onClose: () => void
  mode: ModalMode
  title?: string
  description?: string
  /** Verify old password in change mode */
  onVerifyOld?: (pattern: string) => boolean | Promise<boolean>
  /** Callback after completion, returning the final pattern */
  onComplete: (pattern: string) => void | Promise<void>
  error?: string | null
}

const GesturePasswordModal: React.FC<GesturePasswordModalProps> = ({
  isOpen,
  onClose,
  mode,
  title,
  description,
  onVerifyOld,
  onComplete,
  error: externalError,
}) => {
  const { t } = useTranslation()
  // Change mode steps: 'old' | 'new1' | 'new2' / 変更モードステップ: 'old' | 'new1' | 'new2'
  // Create mode steps: 'new1' | 'new2' / 作成モードステップ: 'new1' | 'new2'
  // Verify mode steps: 'verify' / 検証モードステップ: 'verify'
  type Step = 'old' | 'new1' | 'new2' | 'verify'
  const initialStep: Step =
    mode === 'change' ? 'old' : mode === 'verify' ? 'verify' : 'new1'

  const [step, setStep] = useState<Step>(initialStep)
  const [firstPattern, setFirstPattern] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [gestureKey, setGestureKey] = useState(0)

  const resetAll = () => {
    setStep(initialStep)
    setFirstPattern('')
    setError(null)
    setGestureKey((k) => k + 1)
  }

  const handleClose = () => {
    resetAll()
    onClose()
  }

  const handlePattern = async (pattern: string) => {
    setError(null)

    if (step === 'old') {
      if (onVerifyOld && !(await onVerifyOld(pattern))) {
        setError(t('gesturePasswordModal.errorWrongGesture'))
        setGestureKey((k) => k + 1)
        return
      }
      setStep('new1')
      setGestureKey((k) => k + 1)
    } else if (step === 'new1') {
      setFirstPattern(pattern)
      setStep('new2')
      setGestureKey((k) => k + 1)
    } else if (step === 'new2') {
      if (pattern !== firstPattern) {
        setError(t('gesturePasswordModal.errorMismatch'))
        setFirstPattern('')
        setStep('new1')
        setGestureKey((k) => k + 1)
        return
      }
      try {
        await onComplete(pattern)
        resetAll()
      } catch (err: any) {
        setError(err.message || t('common.error'))
        setGestureKey((k) => k + 1)
      }
    } else if (step === 'verify') {
      try {
        await onComplete(pattern)
        resetAll()
      } catch (err: any) {
        setError(err.message || t('gesturePasswordModal.errorWrongGesture'))
        setGestureKey((k) => k + 1)
      }
    }
  }

  if (!isOpen) return null

  const stepTitle = () => {
    if (step === 'old') return t('gesturePasswordModal.stepOld')
    if (step === 'new1') return mode === 'create' ? t('gesturePasswordModal.stepNew1Set') : t('gesturePasswordModal.stepNew1Change')
    if (step === 'new2') return t('gesturePasswordModal.stepNew2')
    return title || t('gesturePasswordModal.stepVerify')
  }

  const stepDesc = () => {
    if (step === 'old') return t('gesturePasswordModal.stepOldDesc')
    if (step === 'new1') return description || t('gesturePasswordModal.stepNew1Desc')
    if (step === 'new2') return t('gesturePasswordModal.stepNew2Desc')
    return description || ''
  }

  const stepIndicator = () => {
    if (mode === 'create') return step === 'new1' ? t('gesturePasswordModal.indicatorCreate1') : t('gesturePasswordModal.indicatorCreate2')
    if (mode === 'change') {
      if (step === 'old') return t('gesturePasswordModal.indicatorChange1')
      if (step === 'new1') return t('gesturePasswordModal.indicatorChange2')
      return t('gesturePasswordModal.indicatorChange3')
    }
    return ''
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-sm mx-4 shadow-xl">
        {/* Title */}
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {stepTitle()}
          </h3>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Step instructions */}
        {stepIndicator() && (
          <p className="text-xs text-blue-500 mb-1">{stepIndicator()}</p>
        )}

        {/* Description */}
        {stepDesc() && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{stepDesc()}</p>
        )}

        {/* Gesture Area */}
        <div className="flex justify-center">
          <GesturePassword
            key={gestureKey}
            mode={step === 'verify' || step === 'old' ? 'verify' : 'set'}
            onComplete={handlePattern}
            error={error || externalError}
          />
        </div>

        {/* Cancel button */}
        <div className="mt-4 flex justify-center">
          <button
            onClick={handleClose}
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            {t('gesturePasswordModal.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default GesturePasswordModal
