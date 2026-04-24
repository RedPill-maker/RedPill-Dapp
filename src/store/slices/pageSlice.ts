import { createSlice, PayloadAction } from '@reduxjs/toolkit'

const setHash = (hash: string) => {
  window.location.hash = hash
}

export type PageType =
  | 'home'
  | 'settings'
  | 'trending'
  | 'subscriptions'
  | 'library'
  | 'history'
  | 'watchLater'
  | 'liked'
  | 'purchased'
  | 'blacklist'
  | 'myHome'
  | 'contentPublish'
  | 'search'
  | 'creator'
  | 'item'
  | 'filecoinWallet'
  | 'withdraw'
  | 'localDownload'

interface PageState {
  currentPage: PageType
  previousPage?: PageType
  creatorIpns?: string
  creatorUsername?: string // on-chain creator username
  currentItem?: any
  itemCid?: string // current work CID (from hash route)
}

// Get initial page from URL hash
const getInitialPageFromHash = (): { page: PageType; itemCid?: string } => {
  const hash = window.location.hash.slice(1) // remove # symbol
  const validPages: PageType[] = [
    'home',
    'settings',
    'trending',
    'subscriptions',
    'library',
    'history',
    'watchLater',
    'liked',
    'purchased',
    'blacklist',
    'myHome',
    'contentPublish',
    'search',
    'creator',
    'item',
    'filecoinWallet',
    'withdraw',
    'localDownload',
  ]

  // Parse item/{cid} format
  if (hash.startsWith('item/')) {
    const cid = hash.slice(5) // remove 'item/' prefix
    if (cid) return { page: 'item', itemCid: cid }
  }

  // Parse myHome/{tab} format
  if (hash.startsWith('myHome/')) {
    return { page: 'myHome' }
  }

  // Backward compatibility for old 'rewards' hash
  if (hash === 'rewards') return { page: 'withdraw' }

  return {
    page: validPages.includes(hash as PageType) ? (hash as PageType) : 'home',
  }
}

const initialHash = getInitialPageFromHash()

const initialState: PageState = {
  currentPage: initialHash.page,
  previousPage: undefined,
  creatorIpns: undefined,
  creatorUsername: undefined,
  currentItem: undefined,
  itemCid: initialHash.itemCid,
}

const pageSlice = createSlice({
  name: 'page',
  initialState,
  reducers: {
    setCurrentPage: (state, action: PayloadAction<PageType>) => {
      state.previousPage = state.currentPage
      state.currentPage = action.payload
      setHash(action.payload)
      if (action.payload !== 'creator') {
        state.creatorIpns = undefined
        state.creatorUsername = undefined
      }
      if (action.payload !== 'item') {
        state.currentItem = undefined
        state.itemCid = undefined
      }
    },
    setCreatorPage: (state, action: PayloadAction<string>) => {
      state.previousPage = state.currentPage
      state.currentPage = 'creator'
      state.creatorIpns = action.payload
      state.creatorUsername = undefined
      setHash('creator')
      state.currentItem = undefined
      state.itemCid = undefined
    },
    setCreatorPageByUsername: (state, action: PayloadAction<string>) => {
      state.previousPage = state.currentPage
      state.currentPage = 'creator'
      state.creatorUsername = action.payload
      state.creatorIpns = undefined
      setHash('creator')
      state.currentItem = undefined
      state.itemCid = undefined
    },
    setItemPage: (state, action: PayloadAction<any>) => {
      state.previousPage = state.currentPage
      state.currentPage = 'item'
      state.currentItem = action.payload
      state.itemCid = action.payload?.cid
      setHash(`item/${action.payload?.cid || ''}`)
      state.creatorIpns = undefined
    },
    setItemPageByCid: (state, action: PayloadAction<string>) => {
      // Navigate by cid only (used when restoring from URL hash), do not modify previousPage
      state.currentPage = 'item'
      state.itemCid = action.payload
      state.creatorIpns = undefined
    },
    goBack: (state) => {
      const target = state.previousPage || 'home'
      state.currentPage = target
      state.previousPage = undefined

      if (target !== 'creator') {
        state.creatorIpns = undefined
        state.creatorUsername = undefined
      }
      if (target !== 'item') {
        state.currentItem = undefined
        state.itemCid = undefined
        // Preserve myHome/{tab} hash if present
        if (target === 'myHome') {
          const currentHash = window.location.hash.slice(1)
          if (!currentHash.startsWith('myHome/')) setHash(target)
        } else {
          setHash(target)
        }
      } else {
        const cid = state.itemCid || ''
        setHash(cid ? `item/${cid}` : 'item')
      }
    },
  },
})

export const {
  setCurrentPage,
  setCreatorPage,
  setCreatorPageByUsername,
  setItemPage,
  setItemPageByCid,
  goBack,
} = pageSlice.actions
export default pageSlice.reducer
