import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit'
import { privateDataMgr } from '../../utils/privateDataMgr'
import { getTipsByCreator } from '../../utils/dbConnector'
import type { TipRecord } from '../../utils/dbConnector'

interface MyHomeState {
  tipsBadgeCount: number
  lastFetchedAt: number | null
}

const initialState: MyHomeState = {
  tipsBadgeCount: 0,
  lastFetchedAt: null,
}

const CACHE_TTL_MS = 5 * 60 * 1000

export const fetchTipsBadge = createAsyncThunk(
  'myHome/fetchTipsBadge',
  async (force: boolean = false, { getState }) => {
    const state = (getState() as { myHome: MyHomeState }).myHome
    if (!force && state.lastFetchedAt && Date.now() - state.lastFetchedAt < CACHE_TTL_MS) {
      return null
    }

    const creatorInfo = privateDataMgr.getCreatorInfo()
    if (!creatorInfo || creatorInfo.mode !== 'fvm' || !creatorInfo.walletAddress) {
      return { tipsBadgeCount: 0 }
    }

    try {
      const tips: TipRecord[] = await getTipsByCreator(creatorInfo.walletAddress, 200)
      if (tips.length === 0) return { tipsBadgeCount: 0 }

      const lastSeen = privateDataMgr.getTipsLastSeen(creatorInfo.walletAddress)
      const newCount = lastSeen === 0
        ? tips.length
        : tips.filter((t) => t.block_number > lastSeen).length

      return { tipsBadgeCount: newCount }
    } catch {
      return { tipsBadgeCount: 0 }
    }
  },
)

const myHomeSlice = createSlice({
  name: 'myHome',
  initialState,
  reducers: {
    clearTipsBadge(state) {
      state.tipsBadgeCount = 0
    },
    setTipsBadgeCount(state, action: PayloadAction<number>) {
      state.tipsBadgeCount = action.payload
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchTipsBadge.fulfilled, (state, action) => {
        if (action.payload === null) return
        state.tipsBadgeCount = action.payload.tipsBadgeCount
        state.lastFetchedAt = Date.now()
      })
  },
})

export const { clearTipsBadge, setTipsBadgeCount } = myHomeSlice.actions
export default myHomeSlice.reducer
