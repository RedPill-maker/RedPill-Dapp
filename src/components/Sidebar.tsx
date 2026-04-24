import React from 'react'
import { useTranslation } from 'react-i18next'
import { useAppDispatch, useAppSelector } from '../hooks/redux'
import { toggleSidebar, SidebarState } from '../store/slices/sidebarSlice'
import { setCurrentPage, PageType } from '../store/slices/pageSlice'
import { setSearchQuery } from '../store/slices/videoSlice'
import {
  HomeIcon,
  TvIcon,
  ClockIcon,
  HeartIcon,
  NoSymbolIcon,
  UserIcon,
  DocumentTextIcon,
  WalletIcon,
  ArrowDownTrayIcon,
  Cog6ToothIcon,
  ArrowDownOnSquareIcon,
} from '@heroicons/react/24/outline'


const Sidebar: React.FC = () => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const sidebarState = useAppSelector((state) => state.sidebar) as SidebarState
  const { currentPage } = useAppSelector((state) => state.page)
  const withdrawBadgeCount = useAppSelector((state) => state.withdraw.badgeCount)
  const tipsBadgeCount = useAppSelector((state) => state.myHome.tipsBadgeCount)
  const unstoredBadgeCount = useAppSelector((state) => state.chainStorage.unstoredBadgeCount)
  const { isOpen } = sidebarState

  const menuItems = [
    { icon: HomeIcon, label: t('sidebar.home'), page: 'home' as PageType },
    { icon: TvIcon, label: t('sidebar.subscriptions'), page: 'subscriptions' as PageType },
    { icon: ArrowDownOnSquareIcon, label: t('sidebar.localDownload'), page: 'localDownload' as PageType },
    { icon: ClockIcon, label: t('sidebar.history'), page: 'history' as PageType },
    { icon: HeartIcon, label: t('sidebar.favorites'), page: 'watchLater' as PageType },
    { icon: NoSymbolIcon, label: t('sidebar.blacklist'), page: 'blacklist' as PageType },
  ]

  const myMenuItems = [
    { icon: UserIcon, label: t('sidebar.myHome'), page: 'myHome' as PageType },
    {
      icon: DocumentTextIcon,
      label: t('sidebar.publish'),
      page: 'contentPublish' as PageType,
    },
  ]

  const handleMenuClick = (page: PageType) => {
    dispatch(setCurrentPage(page))

    // If clicking home, clear search query / ホームをクリックしたら検索クエリをクリア
    if (page === 'home') {
      dispatch(setSearchQuery(''))
    }

    // Close sidebar on mobile after clicking menu item / モバイルでメニュー項目をクリック後にサイドバーを閉じる
    if (window.innerWidth < 1024) {
      dispatch(toggleSidebar())
    }
  }

  const handleSettingsClick = () => {
    dispatch(setCurrentPage('settings'))
    // Clear search query / 検索クエリをクリア
    dispatch(setSearchQuery(''))
    // Close sidebar on mobile after clicking settings / モバイルで設定をクリック後にサイドバーを閉じる
    if (window.innerWidth < 1024) {
      dispatch(toggleSidebar())
    }
  }

  if (!isOpen) return null

  return (
    <>
      {/* Mobile overlay / モバイルオーバーレイ */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 z-30 lg:hidden"
        onClick={() => dispatch(toggleSidebar())}
      />

      {/* Sidebar / サイドバー */}
      <aside className="fixed left-0 top-16 bottom-0 w-60 bg-white dark:bg-rp-gray-900 border-r border-gray-200 dark:border-rp-gray-700 overflow-y-auto z-40 transform transition-transform duration-300 lg:translate-x-0">
        <div className="p-3">
          {/* Main menu / メインメニュー */}
          <div className="space-y-1">
            {menuItems.map((item, index) => {
              const IconComponent = item.icon
              return (
                <div
                  key={index}
                  onClick={() => handleMenuClick(item.page)}
                  className={`sidebar-item ${currentPage === item.page && currentPage !== 'search' ? 'active' : ''}`}
                >
                  <IconComponent className="w-5 h-5 mr-6 text-gray-700 dark:text-white" />
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    {item.label}
                  </span>
                </div>
              )
            })}
          </div>

          <hr className="my-3 border-gray-200 dark:border-rp-gray-700" />

          {/* My section / マイセクション */}
          <div>
            <h3 className="px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">
              {t('sidebar.mySection')}
            </h3>
            <div className="space-y-1">
              {myMenuItems.map((item, index) => {
                const IconComponent = item.icon
                const isMyHome = item.page === 'myHome'
                return (
                  <div
                    key={index}
                    onClick={() => handleMenuClick(item.page)}
                    className={`sidebar-item ${currentPage === item.page && currentPage !== 'search' ? 'active' : ''}`}
                  >
                    <IconComponent className="w-5 h-5 mr-6 text-gray-700 dark:text-white" />
                    <span className="text-sm text-gray-900 dark:text-white flex-1">
                      {item.label}
                    </span>
                    {isMyHome && tipsBadgeCount > 0 && (
                      <span className="ml-1 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-xs rounded-full flex items-center justify-center leading-none">
                        {tipsBadgeCount > 99 ? '99+' : tipsBadgeCount}
                      </span>
                    )}
                    {item.page === 'contentPublish' && unstoredBadgeCount > 0 && (
                      <span className="ml-1 min-w-[18px] h-[18px] px-1 bg-orange-500 text-white text-xs rounded-full flex items-center justify-center leading-none">
                        {unstoredBadgeCount > 99 ? '99+' : unstoredBadgeCount}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <hr className="my-3 border-gray-200 dark:border-rp-gray-700" />

          {/* Filecoin */}
          <div>
            <h3 className="px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">
              Filecoin
            </h3>
            <div className="space-y-1">
              <div
                onClick={() => handleMenuClick('filecoinWallet')}
                className={`sidebar-item ${currentPage === 'filecoinWallet' ? 'active' : ''}`}
              >
                <WalletIcon className="w-5 h-5 mr-6 text-gray-700 dark:text-white" />
                <span className="text-sm text-gray-900 dark:text-white">
                  {t('sidebar.wallet')}
                </span>
              </div>
              <div
                onClick={() => handleMenuClick('withdraw')}
                className={`sidebar-item ${currentPage === 'withdraw' ? 'active' : ''}`}
              >
                <ArrowDownTrayIcon className="w-5 h-5 mr-6 text-gray-700 dark:text-white" />
                <span className="text-sm text-gray-900 dark:text-white flex-1">
                  {t('sidebar.withdraw')}
                </span>
                {withdrawBadgeCount > 0 && (
                  <span className="ml-1 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-xs rounded-full flex items-center justify-center leading-none">
                    {withdrawBadgeCount > 99 ? '99+' : withdrawBadgeCount}
                  </span>
                )}
              </div>
            </div>
          </div>

          <hr className="my-3 border-gray-200 dark:border-rp-gray-700" />

          {/* Settings */}
          <div>
            <h3 className="px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">
              {t('sidebar.more')}
            </h3>
            <div className="space-y-1">
              <div
                className={`sidebar-item ${currentPage === 'settings' ? 'active' : ''}`}
                onClick={handleSettingsClick}
              >
                <Cog6ToothIcon className="w-5 h-5 mr-6 text-gray-700 dark:text-white" />
                <span className="text-sm text-gray-900 dark:text-white">
                  {t('sidebar.settings')}
                </span>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}

export default Sidebar
