import React from 'react'
import { useTranslation } from 'react-i18next'
import { useAppSelector, useAppDispatch } from '../hooks/redux'
import { setCurrentPage, goBack } from '../store/slices/pageSlice'
import { VideoState } from '../store/slices/videoSlice'
import { SidebarState } from '../store/slices/sidebarSlice'
import { HomePage } from './home_page'
import Settings from './Settings'
import { MyHome, WorkPublish } from './creator'
import MySubscribe from './MySubscribe'
import MyHistory from './MyHistory'
import MyFavorites from './MyFavorites'
import SearchResult from './header_search/SearchResult'
import PurchasedContent from './PurchasedContent'
import Blacklist from './Blacklist'
import CreatorPage from './CreatorPage'
import ItemPage from './work_item/ItemPage'
import WalletPage from './filecoin/WalletPage'
import Withdraw from './filecoin/Withdraw'
import LocalDownload from './local_download/LocalDownload'

const MainContent: React.FC = () => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const { currentPage, creatorIpns, creatorUsername, currentItem, itemCid } = useAppSelector(
    (state) => state.page,
  )
  const sidebarState = useAppSelector((state) => state.sidebar) as SidebarState
  const videosState = useAppSelector((state) => state.videos) as VideoState
  const { searchQuery } = videosState
  const { isOpen } = sidebarState

  const handleBackToHome = () => {
    dispatch(setCurrentPage('home'))
  }

  const handleGoBack = () => {
    dispatch(goBack())
  }

  const renderContent = () => {
    switch (currentPage) {
      case 'search':
        return <SearchResult />
      case 'home':
        return <HomePage />
      case 'settings':
        return (
          <main
            className={`pt-20 pb-8 transition-all duration-300 ${
              isOpen ? 'lg:ml-60' : 'ml-0'
            }`}
          >
            <div className="px-4 md:px-6">
              <Settings />
            </div>
          </main>
        )
      case 'subscriptions':
        return (
          <main
            className={`pt-20 pb-8 transition-all duration-300 ${
              isOpen ? 'lg:ml-60' : 'ml-0'
            }`}
          >
            <div className="px-4 md:px-6">
              <MySubscribe />
            </div>
          </main>
        )
      case 'library':
        return (
          <main
            className={`pt-20 pb-8 transition-all duration-300 ${
              isOpen ? 'lg:ml-60' : 'ml-0'
            }`}
          >
            <div className="px-4 md:px-6">
              <div className="text-center py-12">
                <div className="text-6xl mb-4">📚</div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  {t('mainContent.library')}
                </h2>
                <p className="text-gray-600 dark:text-gray-400">
                  {t('mainContent.libraryDesc')}
                </p>
              </div>
            </div>
          </main>
        )
      case 'history':
        return (
          <main
            className={`pt-20 pb-8 transition-all duration-300 ${
              isOpen ? 'lg:ml-60' : 'ml-0'
            }`}
          >
            <div className="px-4 md:px-6">
              <MyHistory />
            </div>
          </main>
        )
      case 'watchLater':
        return (
          <main
            className={`pt-20 pb-8 transition-all duration-300 ${
              isOpen ? 'lg:ml-60' : 'ml-0'
            }`}
          >
            <div className="px-4 md:px-6">
              <MyFavorites />
            </div>
          </main>
        )

      case 'purchased':
        return (
          <main
            className={`pt-20 pb-8 transition-all duration-300 ${
              isOpen ? 'lg:ml-60' : 'ml-0'
            }`}
          >
            <div className="px-4 md:px-6">
              <PurchasedContent />
            </div>
          </main>
        )
      case 'blacklist':
        return (
          <main
            className={`pt-20 pb-8 transition-all duration-300 ${
              isOpen ? 'lg:ml-60' : 'ml-0'
            }`}
          >
            <div className="px-4 md:px-6">
              <Blacklist />
            </div>
          </main>
        )
      case 'myHome':
        return (
          <main
            className={`pt-20 pb-8 transition-all duration-300 ${
              isOpen ? 'lg:ml-60' : 'ml-0'
            }`}
          >
            <div className="px-4 md:px-6">
              <MyHome />
            </div>
          </main>
        )
      case 'contentPublish':
        return (
          <main
            className={`pt-20 pb-8 transition-all duration-300 ${
              isOpen ? 'lg:ml-60' : 'ml-0'
            }`}
          >
            <div className="px-4 md:px-6">
              <WorkPublish />
            </div>
          </main>
        )
      case 'creator':
        return (
          <main
            className={`pt-20 pb-8 transition-all duration-300 ${
              isOpen ? 'lg:ml-60' : 'ml-0'
            }`}
          >
            <div className="px-4 md:px-6">
              {creatorUsername ? (
                <CreatorPage username={creatorUsername} />
              ) : creatorIpns ? (
                <CreatorPage ipnsId={creatorIpns} />
              ) : (
                <div className="text-center py-12">
                  <div className="text-6xl mb-4">❌</div>
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                    {t('mainContent.creatorInfoMissing')}
                  </h2>
                  <p className="text-gray-600 dark:text-gray-400">
                    {t('mainContent.creatorIpnsNotFound')}
                  </p>
                </div>
              )}
            </div>
          </main>
        )
      case 'item':
        return currentItem || itemCid ? (
          <ItemPage
            item={currentItem}
            itemCid={itemCid}
            onBack={handleGoBack}
          />
        ) : (
          <main
            className={`pt-20 pb-8 transition-all duration-300 ${
              isOpen ? 'lg:ml-60' : 'ml-0'
            }`}
          >
            <div className="px-4 md:px-6">
              <div className="text-center py-12">
                <div className="text-6xl mb-4">❌</div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  {t('mainContent.contentInfoMissing')}
                </h2>
                <p className="text-gray-600 dark:text-gray-400">
                  {t('mainContent.contentNotFound')}
                </p>
                <button
                  onClick={handleBackToHome}
                  className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  {t('mainContent.backToHome')}
                </button>
              </div>
            </div>
          </main>
        )
      case 'filecoinWallet':
        return (
          <main
            className={`pt-16 transition-all duration-300 ${
              isOpen ? 'lg:ml-60' : 'ml-0'
            }`}
          >
            <WalletPage />
          </main>
        )
      case 'withdraw':
        return (
          <main
            className={`pt-20 pb-8 transition-all duration-300 ${
              isOpen ? 'lg:ml-60' : 'ml-0'
            }`}
          >
            <div className="px-4 md:px-6">
              <Withdraw />
            </div>
          </main>
        )
      case 'localDownload':
        return (
          <main
            className={`pt-20 pb-8 transition-all duration-300 ${
              isOpen ? 'lg:ml-60' : 'ml-0'
            }`}
          >
            <div className="px-4 md:px-6">
              <LocalDownload />
            </div>
          </main>
        )
      default:
        return <HomePage />
    }
  }

  return renderContent()
}

export default MainContent
