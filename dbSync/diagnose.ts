/**
 * dbSync Diagnostic Tool (dbSync診断ツール)
 * Used to check database status and sync issues
 */

import { DatabaseSync } from 'node:sqlite'
import * as path from 'path'
import * as fs from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function getDbDir(): string {
  return process.env.DB_DATA_PATH || path.resolve(__dirname, '../data')
}

const DB_DIR = getDbDir()

console.log('=== dbSync Diagnostic Tool (dbSync診断ツール) ===')
console.log(`Database directory: ${DB_DIR}`)
console.log(`Environment: ${process.env.NODE_ENV || 'development'}`)
console.log('')

// Check database files (データベースファイルをチェック)
const dbFiles = ['core.db', 'peripheral.db', 'txhistory2.db']
console.log('1. Check database files:')
dbFiles.forEach((file) => {
  const filePath = path.join(DB_DIR, file)
  if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath)
    console.log(`   ✓ ${file} (${(stats.size / 1024).toFixed(2)} KB)`)
  } else {
    console.log(`   ✗ ${file} does not exist`)
  }
})
console.log('')

// Check core.db sync state (core.dbの同期状態をチェック)
console.log('2. Check sync state (core.db):')
try {
  const coreDbPath = path.join(DB_DIR, 'core.db')
  if (fs.existsSync(coreDbPath)) {
    const db = new DatabaseSync(coreDbPath)
    
    const syncState = db.prepare('SELECT * FROM sync_state WHERE id = 1').get() as any
    if (syncState) {
      console.log(`   Contract address: ${syncState.contract_address}`)
      console.log(`   Chain ID: ${syncState.chain_id}`)
      console.log(`   Start block: ${syncState.start_block}`)
      console.log(`   Last synced block: ${syncState.last_synced_block}`)
      console.log(`   Last synced tx: ${syncState.last_synced_tx_hash || 'N/A'}`)
      console.log(`   Updated at: ${new Date(syncState.updated_at * 1000).toLocaleString()}`)
    } else {
      console.log('   ✗ Sync state record not found')
    }
    
    db.close()
  } else {
    console.log('   ✗ core.db does not exist')
  }
} catch (err: any) {
  console.log(`   ✗ Read failed: ${err.message}`)
}
console.log('')

// Check data statistics (データ統計をチェック)
console.log('3. Check data statistics:')
try {
  const coreDbPath = path.join(DB_DIR, 'core.db')
  if (fs.existsSync(coreDbPath)) {
    const db = new DatabaseSync(coreDbPath)
    
    const creatorCount = db.prepare('SELECT COUNT(*) as count FROM creators').get() as any
    console.log(`   Creator count: ${creatorCount.count}`)
    
    const workCount = db.prepare('SELECT COUNT(*) as count FROM works WHERE is_deleted = 0').get() as any
    console.log(`   Work count: ${workCount.count}`)
    
    const latestWork = db.prepare('SELECT title, claimed_at FROM works WHERE is_deleted = 0 ORDER BY claimed_at DESC LIMIT 1').get() as any
    if (latestWork) {
      console.log(`   Latest work: "${latestWork.title}" (${new Date(latestWork.claimed_at * 1000).toLocaleString()})`)
    }
    
    db.close()
  }
} catch (err: any) {
  console.log(`   ✗ Read failed: ${err.message}`)
}
console.log('')

// Check peripheral.db (peripheral.dbをチェック)
console.log('4. Check peripheral data (peripheral.db):')
try {
  const peripheralDbPath = path.join(DB_DIR, 'peripheral.db')
  if (fs.existsSync(peripheralDbPath)) {
    const db = new DatabaseSync(peripheralDbPath)
    
    const tipCount = db.prepare('SELECT COUNT(*) as count FROM tip_records').get() as any
    console.log(`   Tip record count: ${tipCount.count}`)
    
    const latestTip = db.prepare('SELECT amount_sent, timestamp FROM tip_records ORDER BY timestamp DESC LIMIT 1').get() as any
    if (latestTip) {
      console.log(`   Latest tip: ${latestTip.amount_sent} (${new Date(latestTip.timestamp * 1000).toLocaleString()})`)
    }
    
    db.close()
  }
} catch (err: any) {
  console.log(`   ✗ Read failed: ${err.message}`)
}
console.log('')

console.log('=== Diagnostic Complete (診断完了) ===')
