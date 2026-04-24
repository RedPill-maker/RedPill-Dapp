import React from 'react'
import { useTranslation } from 'react-i18next'

interface IPFSSyncNoticeProps {
  title?: string
  message?: string
  type?: 'info' | 'success' | 'warning'
  className?: string
}

const IPFSSyncNotice: React.FC<IPFSSyncNoticeProps> = ({
  title,
  message,
  type = 'info',
  className = '',
}) => {
  const { t } = useTranslation()
  const resolvedTitle = title || t('ipfsSyncNotice.title')
  const resolvedMessage = message || t('ipfsSyncNotice.content')
  const getStyles = () => {
    switch (type) {
      case 'success':
        return {
          container:
            'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700',
          icon: '✅',
          iconColor: 'text-green-500',
          titleColor: 'text-green-900 dark:text-green-100',
          messageColor: 'text-green-700 dark:text-green-300',
        }
      case 'warning':
        return {
          container:
            'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-700',
          icon: '⚠️',
          iconColor: 'text-yellow-500',
          titleColor: 'text-yellow-900 dark:text-yellow-100',
          messageColor: 'text-yellow-700 dark:text-yellow-300',
        }
      default: // info
        return {
          container:
            'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700',
          icon: 'ℹ️',
          iconColor: 'text-blue-500',
          titleColor: 'text-blue-900 dark:text-blue-100',
          messageColor: 'text-blue-700 dark:text-blue-300',
        }
    }
  }

  const styles = getStyles()

  return (
    <div className={`border rounded-lg p-3 ${styles.container} ${className}`}>
      <div className="flex items-start">
        <div className={`${styles.iconColor} mr-2 mt-0.5`}>{styles.icon}</div>
        <div>
          <p className={`text-xs font-medium ${styles.titleColor} mb-1`}>
            {resolvedTitle}
          </p>
          <p className={`text-xs ${styles.messageColor}`}>{resolvedMessage}</p>
        </div>
      </div>
    </div>
  )
}

export default IPFSSyncNotice
