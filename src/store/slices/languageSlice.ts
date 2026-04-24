import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import i18n from '../../i18n/i18n'
import { SupportedLanguage } from '../../../config'
import { privateDataMgr } from '../../utils/privateDataMgr'

interface LanguageState {
  current: SupportedLanguage
}

const initialState: LanguageState = {
  current: privateDataMgr.getLanguage(),
}

const languageSlice = createSlice({
  name: 'language',
  initialState,
  reducers: {
    setLanguage: (state, action: PayloadAction<SupportedLanguage>) => {
      state.current = action.payload
      privateDataMgr.setLanguage(action.payload)
      i18n.changeLanguage(action.payload)
    },
  },
})

export const { setLanguage } = languageSlice.actions
export default languageSlice.reducer
