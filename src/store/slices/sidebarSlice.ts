import { createSlice } from '@reduxjs/toolkit'

export interface SidebarState {
  isOpen: boolean
  isCompact: boolean
}

const initialState: SidebarState = {
  isOpen: true,
  isCompact: false,
}

const sidebarSlice = createSlice({
  name: 'sidebar',
  initialState,
  reducers: {
    toggleSidebar: (state) => {
      state.isOpen = !state.isOpen
    },
    setSidebarOpen: (state, action) => {
      state.isOpen = action.payload
    },
    toggleCompact: (state) => {
      state.isCompact = !state.isCompact
    },
  },
})

export const { toggleSidebar, setSidebarOpen, toggleCompact } =
  sidebarSlice.actions
export default sidebarSlice.reducer
