/**
 * Global notification component / グローバル通知コンポーネント
 *
 * Features / 機能：
 * 1. Persistent button at bottom of page, click to expand notification history / ページ下部の常駐ボタン、クリックして通知履歴を展開
 * 2. Multiple notifications stacked, new notifications animate in / 複数の通知がスタック表示、新しい通知がアニメーション
 * 3. Any component can initiate notifications via notify(), returns controllable instance / 任意のコンポーネントがnotify()で通知を開始、制御可能なインスタンスを返す
 * 4. Notification history stored in sessionStorage / 通知履歴はsessionStorageに保存
 * 5. Globally mounted, page switching doesn't affect / グローバルにマウント、ページ切り替えに影響なし
 *
 * Usage：
 *   import { notify } from '../global_modal/ToastNotification'
 *   const handle = notify('Processing transaction...')
 *   handle.update('Confirming...')
 *   handle.success('Transaction successful', txHash)
 *   handle.error('Transaction failed')
 *   handle.close(3)  // Close after 3 seconds / 3秒後に閉じる
 */

import React, { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { APP_CONFIG } from '../../config'

const THEME_COLOR = `#${APP_CONFIG.THEME_COLOR}`
const STORAGE_KEY = 'toast_notification_history'
const MAX_VISIBLE = 5
const MAX_HISTORY = 50

// ==================== Notification Data Types / 通知データ型 ====================

export type NotificationStatus = 'pending' | 'success' | 'error'

export interface NotificationAction {
  label: string
  onClick: () => void
}

export interface NotificationItem {
  id: string
  message: string
  status: NotificationStatus
  txHash?: string
  action?: NotificationAction
  createdAt: number
  updatedAt: number
  visible: boolean // whether visible in floating notification area
}

export interface NotificationHandle {
  id: string
  update: (message: string) => void
  success: (message: string, txHash?: string) => void
  error: (message: string) => void
  close: (delaySec?: number) => void
  setAction: (action: NotificationAction | undefined) => void
}

// ==================== Event-Driven Core / イベント駆動コア ====================

type Listener = () => void
let notifications: NotificationItem[] = []
const listeners = new Set<Listener>()

const emitChange = () => {
  try {
    const history = notifications.map(({ visible, ...rest }) => rest)
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)))
  } catch { /* ignore */ }
  listeners.forEach((fn) => fn())
}

const loadHistory = (): NotificationItem[] => {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const items = JSON.parse(raw) as Omit<NotificationItem, 'visible'>[]
    return items.map((item) => ({ ...item, visible: false }))
  } catch { return [] }
}

notifications = loadHistory()

const genId = () => `n_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

const findAndUpdate = (id: string, updater: (item: NotificationItem) => NotificationItem) => {
  notifications = notifications.map((n) => (n.id === id ? updater(n) : n))
  emitChange()
}

const hideNotification = (id: string) => {
  findAndUpdate(id, (n) => ({ ...n, visible: false }))
}

// ==================== Public API / 公開API ====================

export const notify = (message: string): NotificationHandle => {
  const id = genId()
  const now = Date.now()
  const item: NotificationItem = {
    id, message, status: 'pending',
    createdAt: now, updatedAt: now, visible: true,
  }

  const visibleCount = notifications.filter((n) => n.visible).length
  if (visibleCount >= MAX_VISIBLE) {
    const oldest = notifications.find((n) => n.visible)
    if (oldest) oldest.visible = false
  }

  notifications = [item, ...notifications]
  emitChange()

  return {
    id,
    update: (msg: string) => {
      findAndUpdate(id, (n) => ({ ...n, message: msg, updatedAt: Date.now() }))
    },
    success: (msg: string, txHash?: string) => {
      findAndUpdate(id, (n) => ({ ...n, message: msg, status: 'success', txHash, updatedAt: Date.now() }))
    },
    error: (msg: string) => {
      findAndUpdate(id, (n) => ({ ...n, message: msg, status: 'error', updatedAt: Date.now() }))
    },
    close: (delaySec?: number) => {
      if (delaySec && delaySec > 0) {
        setTimeout(() => hideNotification(id), delaySec * 1000)
      } else {
        hideNotification(id)
      }
    },
    setAction: (action: NotificationAction | undefined) => {
      findAndUpdate(id, (n) => ({ ...n, action, updatedAt: Date.now() }))
    },
  }
}

export const clearNotificationHistory = () => {
  notifications = notifications.filter((n) => n.visible)
  emitChange()
}

// ==================== Hook ====================

const useNotifications = () => {
  const [, setTick] = useState(0)
  useEffect(() => {
    const listener = () => setTick((t) => t + 1)
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, [])
  return notifications
}

// ==================== Helper Functions / ヘルパー関数 ====================

const statusIcon = (status: NotificationStatus) => {
  switch (status) {
    case 'pending': return <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
    case 'success': return <span className="text-green-500 flex-shrink-0">✓</span>
    case 'error': return <span className="text-red-500 flex-shrink-0">✗</span>
  }
}

const statusBorder = (status: NotificationStatus) => {
  switch (status) {
    case 'pending': return 'border-l-blue-500'
    case 'success': return 'border-l-green-500'
    case 'error': return 'border-l-red-500'
  }
}

const formatTime = (ts: number) => {
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`
}


// ==================== Floating Notification Bar / フローティング通知バー ====================

const ToastItem: React.FC<{ item: NotificationItem }> = ({ item }) => (
  <div
    className={`pointer-events-auto flex items-center gap-2.5 px-4 py-3 bg-white dark:bg-gray-800 rounded-lg shadow-lg border-l-4 ${statusBorder(item.status)} w-max min-w-48 max-w-sm animate-slide-in-up`}
  >
    {!item.action && statusIcon(item.status)}
    <div className="flex-1 min-w-0">
      <p className="text-sm text-gray-900 dark:text-white break-words">{item.message}</p>
      {item.txHash && (
        <p className="text-xs text-gray-400 dark:text-gray-500 font-mono truncate mt-0.5">
          {item.txHash.slice(0, 10)}...{item.txHash.slice(-6)}
        </p>
      )}
      {item.action && (
        <button
          onClick={item.action.onClick}
          className="mt-1.5 text-xs font-medium text-blue-500 hover:text-blue-400 underline underline-offset-2"
        >
          {item.action.label}
        </button>
      )}
    </div>
    <button
      onClick={() => hideNotification(item.id)}
      className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex-shrink-0 text-xs"
    >
      ✕
    </button>
  </div>
)

// ==================== History Panel / 履歴パネル ====================

const HistoryPanel: React.FC<{ items: NotificationItem[]; onClose: () => void }> = ({ items, onClose }) => {
  const { t } = useTranslation()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div
      ref={panelRef}
      className="absolute bottom-12 right-0 w-80 max-h-96 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col animate-slide-in-up"
    >
      {/* Header / ヘッダー */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <span className="text-sm font-medium text-gray-900 dark:text-white">{t('toast.notificationHistory')}</span>
        <div className="flex items-center gap-2">
          {items.length > 0 && (
            <button
              onClick={clearNotificationHistory}
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              {t('toast.clear')}
            </button>
          )}
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xs">✕</button>
        </div>
      </div>
      {/* List / リスト */}
      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="text-center py-8 text-sm text-gray-400 dark:text-gray-500">{t('toast.noNotifications')}</div>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className={`flex items-start gap-2.5 px-4 py-3 border-b border-gray-100 dark:border-gray-700/50 last:border-b-0 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors`}
            >
              <div className="mt-0.5">{statusIcon(item.status)}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-900 dark:text-white break-words">{item.message}</p>
                {item.txHash && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 font-mono truncate mt-0.5">
                    tx: {item.txHash.slice(0, 10)}...{item.txHash.slice(-6)}
                  </p>
                )}
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{formatTime(item.createdAt)}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ==================== Main Component / メインコンポーネント ====================

const ToastNotification: React.FC = () => {
  const { t } = useTranslation()
  const allNotifications = useNotifications()
  const [showHistory, setShowHistory] = useState(false)

  const visibleToasts = allNotifications.filter((n) => n.visible)
  const pendingCount = allNotifications.filter((n) => n.status === 'pending' && n.visible).length

  return (
    <>
      {/* CSS Animation / CSSアニメーション */}
      <style>{`
        @keyframes slide-in-up {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-slide-in-up {
          animation: slide-in-up 0.25s ease-out;
        }
      `}</style>

      {/* Floating notification area - bottom right / フローティング通知エリア - 右下 */}
      <div className="fixed bottom-16 right-4 z-40 flex flex-col-reverse gap-2 pointer-events-none">
        {visibleToasts.map((item) => (
          <div key={item.id} className="pointer-events-auto">
            <ToastItem item={item} />
          </div>
        ))}
      </div>

      {/* Persistent button at bottom + history panel / 下部常駐ボタン + 履歴パネル */}
      <div className="fixed bottom-4 right-4 z-40">
        {showHistory && (
          <HistoryPanel items={allNotifications} onClose={() => setShowHistory(false)} />
        )}
        <button
          onClick={() => setShowHistory(!showHistory)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-full shadow-lg text-xs font-medium transition-all hover:scale-105 ${
            pendingCount > 0
              ? 'text-white'
              : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700'
          }`}
          style={pendingCount > 0 ? { backgroundColor: THEME_COLOR } : undefined}
        >
          {pendingCount > 0 ? (
            <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
          )}
          <span>{pendingCount > 0 ? `${pendingCount} ${t('toast.processing')}` : t('toast.notification')}</span>
          {allNotifications.length > 0 && !pendingCount && (
            <span className="bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-full px-1.5 text-xs">
              {allNotifications.length}
            </span>
          )}
        </button>
      </div>
    </>
  )
}

export default ToastNotification
