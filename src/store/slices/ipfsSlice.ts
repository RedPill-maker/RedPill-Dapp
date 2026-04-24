import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit'
import { ipfsConnector, IPFSStats } from '../../utils/ipfsConnector'

interface IPFSState {
  stats: IPFSStats
  isLoading: boolean
  error: string | null
  autoRefresh: boolean
  refreshInterval: number
}

const initialState: IPFSState = {
  stats: {
    peers: [],
    peerCount: 0,
    isConnected: false,
    nodeId: null,
    version: null,
    lastUpdated: 0,
  },
  isLoading: false,
  error: null,
  autoRefresh: true,
  refreshInterval: 5000, // refresh every 5 seconds
}

// Fetch IPFS node info asynchronously
export const fetchIPFSStats = createAsyncThunk(
  'ipfs/fetchStats',
  async (_, { rejectWithValue }) => {
    try {
      // Use ipfsConnector to get node stats
      const stats = await ipfsConnector.getNodeStats()
      return stats
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : 'IPFS connection failed',
      )
    }
  },
)

const ipfsSlice = createSlice({
  name: 'ipfs',
  initialState,
  reducers: {
    setAutoRefresh: (state, action: PayloadAction<boolean>) => {
      state.autoRefresh = action.payload
    },
    setRefreshInterval: (state, action: PayloadAction<number>) => {
      state.refreshInterval = action.payload
    },
    clearError: (state) => {
      state.error = null
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchIPFSStats.pending, (state) => {
        state.isLoading = true
        state.error = null
      })
      .addCase(fetchIPFSStats.fulfilled, (state, action) => {
        state.isLoading = false
        state.stats = action.payload
        state.error = null
      })
      .addCase(fetchIPFSStats.rejected, (state, action) => {
        state.isLoading = false
        state.error = action.payload as string
        state.stats.isConnected = false
      })
  },
})

export const { setAutoRefresh, setRefreshInterval, clearError } =
  ipfsSlice.actions
export default ipfsSlice.reducer
