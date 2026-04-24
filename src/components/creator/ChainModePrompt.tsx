import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LinkIcon } from '@heroicons/react/24/outline'
import BecomeCreatorModal from './BecomeCreatorModal'

interface ChainModePromptProps {
  currentSiteInfo?: any
  onSuccess?: () => void
}

const ChainModePrompt: React.FC<ChainModePromptProps> = ({ currentSiteInfo, onSuccess }) => {
  const { t } = useTranslation()
  const [showBecomeCreator, setShowBecomeCreator] = useState(false)

  return (
    <div className="py-10 text-center space-y-4">
      <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto">
        <LinkIcon className="w-8 h-8 text-blue-600 dark:text-blue-400" />
      </div>
      <div className="space-y-2">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white">
          {t('myHome.chainModePrompt.title')}
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 max-w-sm mx-auto">
          {t('myHome.chainModePrompt.desc')}
        </p>
      </div>
      <button
        onClick={() => setShowBecomeCreator(true)}
        className="px-5 py-2.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
      >
        {t('myHome.edit.upgradeBtn')}
      </button>
      {showBecomeCreator && (
        <BecomeCreatorModal
          isOpen={showBecomeCreator}
          onClose={() => setShowBecomeCreator(false)}
          onSuccess={() => { setShowBecomeCreator(false); onSuccess?.() }}
          currentSiteInfo={currentSiteInfo}
          onlyOnchain
          upgradeOnchain
        />
      )}
    </div>
  )
}

export default ChainModePrompt
