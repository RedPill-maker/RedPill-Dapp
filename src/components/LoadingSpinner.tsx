import React from 'react'
import Logo from './Logo'

interface LoadingSpinnerProps {
  size?: 'small' | 'medium' | 'large'
  className?: string
}

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 'medium',
  className = '',
}) => {
  const sizeMap = {
    small: 16,
    medium: 32,
    large: 48,
  }

  const logoSize = sizeMap[size]

  return (
    <div className={`inline-flex items-center justify-center ${className}`}>
      <div
        className="animate-spin-ease"
        style={{
          animation: 'spin-ease 1.5s cubic-bezier(0.68, -0.55, 0.265, 1.55) infinite',
        }}
      >
        <Logo width={logoSize} height={logoSize} className="text-red-600 dark:text-red-500" />
      </div>
      <style>{`
        @keyframes spin-ease {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

export default LoadingSpinner
