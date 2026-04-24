import React from 'react'
import { useAppSelector, useAppDispatch } from '../../hooks/redux'
import { SidebarState } from '../../store/slices/sidebarSlice'
import { setCreatorPage } from '../../store/slices/pageSlice'
import TopAdBanner from './TopAdBanner'
import SidebarAds from '../ads/SidebarAds'
import { HOME_PAGE_AD_ADDRESS } from '../../../config'
import FilteredWorks from './FilteredWorks'
import TopTippedWorks from './TopTippedWorks'

const HomePage: React.FC = () => {
  const dispatch = useAppDispatch()
  const sidebarState = useAppSelector((state) => state.sidebar) as SidebarState
  const { isOpen } = sidebarState

  const handleCreatorClick = (ipns: string) => {
    if (ipns) dispatch(setCreatorPage(ipns))
  }

  return (
    <main
      className={`pt-20 pb-8 transition-all duration-300 ${
        isOpen ? 'lg:ml-60' : 'ml-0'
      }`}
    >
      <div className="px-4 md:px-6 space-y-8">
        {/* Top ad banner */}
        <TopAdBanner />

        {/* Content area */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Main content */}
          <div className="lg:col-span-3 space-y-8">
            <TopTippedWorks onCreatorClick={handleCreatorClick} />
            <FilteredWorks onCreatorClick={handleCreatorClick} />
          </div>

          {/* Sidebar ad area */}
          <div>
            <SidebarAds creatorAddress={HOME_PAGE_AD_ADDRESS} />
          </div>
        </div>
      </div>
    </main>
  )
}

export default HomePage
