import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider } from 'react-redux'
import { privateDataMgr } from './utils/privateDataMgr'
import './index.css'

async function bootstrap() {
  // Initialize storage backend before anything else.
  // In Electron mode this loads non-sensitive data (settings, userData, creatorData)
  // from file storage into the in-memory cache, so that Redux store initialization
  // and i18n setup can read the correct persisted values synchronously.
  await privateDataMgr.init()

  // Dynamic imports ensure store and App are created AFTER the cache is ready,
  // so themeSlice / languageSlice / rpcConnector read the correct saved values.
  const [{ store }, { default: App }] = await Promise.all([
    import('./store'),
    import('./App'),
  ])

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Provider store={store}>
        <App />
      </Provider>
    </React.StrictMode>,
  )
}

bootstrap()
