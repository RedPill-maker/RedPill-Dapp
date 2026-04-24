import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import { privateDataMgr } from '../../utils/privateDataMgr'
import { creatorHubMgr } from '../../utils/creatorHubMgr'
import { adsMgr } from '../../utils/adsMgr'
import { getCreatorByWallet } from '../../utils/dbConnector'
import { getKnownTokens } from '../../../config'
import type { CreatorWalletBalance } from '../../components/filecoin/withdraw/CreatorWithdrawTab'
import type { AdsWalletBalance } from '../../components/filecoin/withdraw/AdsWithdrawTab'

// Cache TTL: 1 minute
const CACHE_TTL_MS = 1 * 60 * 1000

interface WithdrawState {
  badgeCount: number
  creatorBalances: CreatorWalletBalance[]
  adsBalances: AdsWalletBalance[]
  loading: boolean
  lastFetchedAt: number | null
}

const initialState: WithdrawState = {
  badgeCount: 0,
  creatorBalances: [],
  adsBalances: [],
  loading: false,
  lastFetchedAt: null,
}

export const fetchWithdrawBalances = createAsyncThunk(
  'withdraw/fetchBalances',
  async (force: boolean = false, { getState }) => {
    const state = (getState() as { withdraw: WithdrawState }).withdraw

    // If not forced, check if cache is still valid
    if (!force && state.lastFetchedAt && Date.now() - state.lastFetchedAt < CACHE_TTL_MS) {
      return null // Return null to use cache; reducer will skip update
    }

    const wallets = await privateDataMgr.getWalletList()
    if (wallets.length === 0) {
      return { creatorBalances: [], adsBalances: [], badgeCount: 0 }
    }

    const tokenAddresses = getKnownTokens().map((t) => t.address)

    const [creatorResults, adsResults] = await Promise.all([
      Promise.all(
        wallets.map(async (wallet) => {
          try {
            const username = await creatorHubMgr.getCreatorUsername(wallet.ethAddress)
            if (!username) return null

            let avatarCid = ''
            try {
              const creatorInfo = await getCreatorByWallet(wallet.ethAddress)
              avatarCid = creatorInfo?.avatar_cid || ''
            } catch {
              // ignore when db is unavailable
            }

            const balanceArr = await creatorHubMgr.getBalances(wallet.ethAddress, tokenAddresses)
            const balances: Record<string, string> = {}
            tokenAddresses.forEach((addr, i) => {
              balances[addr] = balanceArr[i] || '0'
            })

            return {
              ethAddress: wallet.ethAddress,
              filAddress: wallet.filAddress,
              name: wallet.name,
              username,
              avatarCid,
              balances,
            } as CreatorWalletBalance
          } catch {
            return null
          }
        }),
      ),
      Promise.all(
        wallets.map(async (wallet) => {
          try {
            const amount = await adsMgr.getPendingWithdrawal(wallet.ethAddress)
            return {
              ethAddress: wallet.ethAddress,
              filAddress: wallet.filAddress,
              name: wallet.name,
              pendingAmount: amount,
            } as AdsWalletBalance
          } catch {
            return {
              ethAddress: wallet.ethAddress,
              filAddress: wallet.filAddress,
              name: wallet.name,
              pendingAmount: '0',
            } as AdsWalletBalance
          }
        }),
      ),
    ])

    const creatorBalances = creatorResults.filter(Boolean) as CreatorWalletBalance[]

    let badgeCount = 0
    creatorBalances.forEach((w) => {
      getKnownTokens().forEach((tk) => {
        if (parseFloat(w.balances[tk.address] || '0') > 0) badgeCount++
      })
    })
    adsResults.forEach((w) => {
      if (parseFloat(w.pendingAmount || '0') > 0) badgeCount++
    })

    return { creatorBalances, adsBalances: adsResults, badgeCount }
  },
)

const withdrawSlice = createSlice({
  name: 'withdraw',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchWithdrawBalances.pending, (state) => {
        state.loading = true
      })
      .addCase(fetchWithdrawBalances.fulfilled, (state, action) => {
        state.loading = false
        if (action.payload === null) return // cache hit, skip update
        state.creatorBalances = action.payload.creatorBalances
        state.adsBalances = action.payload.adsBalances
        state.badgeCount = action.payload.badgeCount
        state.lastFetchedAt = Date.now()
      })
      .addCase(fetchWithdrawBalances.rejected, (state) => {
        state.loading = false
      })
  },
})

export default withdrawSlice.reducer
