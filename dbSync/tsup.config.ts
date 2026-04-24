import { defineConfig } from 'tsup'
import { builtinModules } from 'node:module'

// Node.js built-in module list (includes both node: prefix and non-prefix forms) (Node.js組み込みモジュールリスト・node:プレフィックス付きと無しの両方を含む)
const nodeBuiltins = [
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
]

export default defineConfig({
  entry: [
    'dbSync/server.ts',
    'dbSync/dataAPI.ts',
    'dbSync/eventToDB.ts',
    'dbSync/syncHistory.ts',
    'dbSync/transactionAPI.ts',
    'dbSync/ipfsEventFetcher.ts',
  ],
  format: ['esm'],
  platform: 'node',
  outDir: 'dbSync-dist',
  // Force bundle all third-party dependencies (bundled Electron app has no node_modules) (すべてのサードパーティ依存関係を強制バンドル・バンドル後のElectronアプリにはnode_modulesがない)
  noExternal: [/.+/],
  // Keep Node.js built-in modules external (Node.js組み込みモジュールはexternalのまま)
  external: nodeBuiltins,
  // CJS packages like express internally use require('events') etc. Node.js built-in modules (expressなどのCJSパッケージは内部でrequire('events')などのNode.js組み込みモジュールを使用)
  // ESM environment has no require, need to inject createRequire to make CJS shim work properly (ESM環境にはrequireがない、createRequireを注入してCJSシムが正常に動作するようにする必要がある)
  banner: {
    js: `import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);`,
  },
})
