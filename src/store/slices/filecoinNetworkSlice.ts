import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { rpcConnectorInstance } from '../../utils/rpcConnector'
import { fileStoreMgr } from '../../utils/fileStoreMgr'
import { FILECOIN_NETWORKS } from '../../../config'

// Dynamically generate network types based on config file
export type FilecoinNetwork = string

interface FilecoinNetworkState {
  current: string // stores network name
}

// Get current network setting from rpcConnector
const getCurrentNetwork = (): string => {
  const network = rpcConnectorInstance.getCurrentNetwork()
  return network.name
}

const initialState: FilecoinNetworkState = {
  current: getCurrentNetwork(),
}

const filecoinNetworkSlice = createSlice({
  name: 'filecoinNetwork',
  initialState,
  reducers: {
    setFilecoinNetwork: (state, action: PayloadAction<string>) => {
      state.current = action.payload
      // Get network config from unified config
      const networkConfig = rpcConnectorInstance.getNetworkByName(
        action.payload,
      )

      if (networkConfig) {
        rpcConnectorInstance.setCurrentNetwork(networkConfig)
        // Clear cached Synapse instance — it's bound to the previous network
        fileStoreMgr.clearSynapse()
      } else {
        console.error(`Network not found: ${action.payload}`)
      }
    },
  },
})

export const { setFilecoinNetwork } = filecoinNetworkSlice.actions
export default filecoinNetworkSlice.reducer
