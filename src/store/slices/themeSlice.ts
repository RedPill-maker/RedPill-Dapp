import { createSlice } from '@reduxjs/toolkit'
import { privateDataMgr } from '../../utils/privateDataMgr'

interface ThemeState {
  isDark: boolean
}

const getInitialTheme = (): boolean => {
  const savedTheme = privateDataMgr.getTheme()
  if (savedTheme) return savedTheme === 'dark'
  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return true
  return false
}

const initialState: ThemeState = {
  isDark: getInitialTheme(),
}

const themeSlice = createSlice({
  name: 'theme',
  initialState,
  reducers: {
    toggleTheme: (state) => {
      state.isDark = !state.isDark
      privateDataMgr.setTheme(state.isDark ? 'dark' : 'light')
    },
    setTheme: (state, action) => {
      state.isDark = action.payload
      privateDataMgr.setTheme(state.isDark ? 'dark' : 'light')
    },
  },
})

export const { toggleTheme, setTheme } = themeSlice.actions
export default themeSlice.reducer
