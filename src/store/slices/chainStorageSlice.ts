import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import { privateDataMgr } from '../../utils/privateDataMgr'
import { getWorksByCreator, getCreatorByWallet } from '../../utils/dbConnector'

interface ChainStorageState {
  unstoredBadgeCount: number
}

const initialState: ChainStorageState = {
  unstoredBadgeCount: 0,
}

/**
 * Calculate the number of CIDs under the current creator that have not been stored on-chain
 * Logic: collect all related CIDs, compare with storedCids mapping, the difference is the unstored count
 */
export const fetchUnstoredCount = createAsyncThunk(
  'chainStorage/fetchUnstoredCount',
  async () => {
    const creatorInfo = privateDataMgr.getCreatorInfo()
    if (!creatorInfo || creatorInfo.mode !== 'fvm' || !creatorInfo.username) {
      return 0
    }

    const { username, walletAddress } = creatorInfo
    const storedCids = privateDataMgr.getStoredCids(username)
    const allCids = new Set<string>()

    // Avatar / background
    if (creatorInfo.avatarCid) allCids.add(creatorInfo.avatarCid)
    if (creatorInfo.backgroundCid) allCids.add(creatorInfo.backgroundCid)

    // Avatar / background in on-chain creator info
    if (walletAddress) {
      try {
        const onchainCreator = await getCreatorByWallet(walletAddress)
        if (onchainCreator?.avatar_cid) allCids.add(onchainCreator.avatar_cid)
        if (onchainCreator?.background_cid) allCids.add(onchainCreator.background_cid)
      } catch {
        // Ignore when db is unavailable
      }
    }

    // Work CID + cover CID
    try {
      let page = 1
      while (true) {
        const works = await getWorksByCreator(username, page, 100)
        if (works.length === 0) break
        for (const work of works) {
          allCids.add(work.cid)
          if (work.img_cid) allCids.add(work.img_cid)
        }
        if (works.length < 100) break
        page++
      }
    } catch {
      // Ignore when db is unavailable / db が利用できない場合は無視
    }

    const unstoredCount = Array.from(allCids).filter((cid) => !storedCids[cid]).length
    return unstoredCount
  },
)

const chainStorageSlice = createSlice({
  name: 'chainStorage',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder.addCase(fetchUnstoredCount.fulfilled, (state, action) => {
      state.unstoredBadgeCount = action.payload
    })
  },
})

export default chainStorageSlice.reducer
