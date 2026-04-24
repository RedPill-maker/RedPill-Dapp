#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function removeDir(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true })
    console.log(`✅ Removed: ${dirPath}`)
  }
}

function clean() {
  console.log('🧹 Cleaning Electron build files...')

  // Clean electron node_modules
  removeDir(path.resolve(__dirname, 'node_modules'))

  // Clean release directory
  removeDir(path.resolve(__dirname, '..', 'release'))

  // Clean dist directory
  removeDir(path.resolve(__dirname, '..', 'dist'))

  console.log('✨ Clean completed!')
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  clean()
}

export { clean }
