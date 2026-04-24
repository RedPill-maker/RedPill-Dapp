import { configureStore } from '@reduxjs/toolkit'
import themeSlice from './slices/themeSlice'
import videoSlice from './slices/videoSlice'
import sidebarSlice from './slices/sidebarSlice'
import pageSlice from './slices/pageSlice'
import ipfsSlice from './slices/ipfsSlice'
import languageSlice from './slices/languageSlice'
import filecoinNetworkSlice from './slices/filecoinNetworkSlice'
import withdrawSlice from './slices/withdrawSlice'
import myHomeSlice from './slices/myHomeSlice'
import chainStorageSlice from './slices/chainStorageSlice'

export const store = configureStore({
  reducer: {
    theme: themeSlice,
    videos: videoSlice,
    sidebar: sidebarSlice,
    page: pageSlice,
    ipfs: ipfsSlice,
    language: languageSlice,
    filecoinNetwork: filecoinNetworkSlice,
    withdraw: withdrawSlice,
    myHome: myHomeSlice,
    chainStorage: chainStorageSlice,
  },
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
