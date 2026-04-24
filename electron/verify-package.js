#!/usr/bin/env node

import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function verifyPackage() {
  console.log('🔍 Verifying packaged app contents...')

  const appPath = path.resolve(
    __dirname,
    '..',
    'release',
    'mac-arm64',
    'IPFS WebUI.app',
  )
  const asarPath = path.join(appPath, 'Contents', 'Resources', 'app.asar')
  const kuboPath = path.join(appPath, 'Contents', 'Resources', 'kubo')

  console.log('\n📦 Checking app structure:')

  // Check if app exists
  if (fs.existsSync(appPath)) {
    console.log('✅ App bundle exists')
  } else {
    console.log('❌ App bundle not found')
    return
  }

  // Check app.asar
  if (fs.existsSync(asarPath)) {
    console.log('✅ app.asar exists')

    try {
      const asarContents = execSync(`npx asar list "${asarPath}"`, {
        encoding: 'utf8',
      })
      console.log('\n📋 app.asar contents:')
      console.log(asarContents)

      // Check for critical files
      if (asarContents.includes('/main.js')) {
        console.log('✅ main.js found in asar')
      } else {
        console.log('❌ main.js not found in asar')
      }

      if (asarContents.includes('/dist/index.html')) {
        console.log('✅ dist/index.html found in asar')
      } else {
        console.log('❌ dist/index.html not found in asar')
      }

      if (asarContents.includes('/dist/assets/')) {
        console.log('✅ dist/assets found in asar')
      } else {
        console.log('❌ dist/assets not found in asar')
      }
    } catch (err) {
      console.log('❌ Failed to read asar contents:', err.message)
    }
  } else {
    console.log('❌ app.asar not found')
  }

  // Check kubo
  if (fs.existsSync(kuboPath)) {
    console.log('✅ kubo directory exists')

    const kuboContents = fs.readdirSync(kuboPath)
    console.log('\n🔧 kubo contents:', kuboContents)

    if (kuboContents.includes('darwin-arm64')) {
      console.log('✅ darwin-arm64 kubo found')

      const kuboExe = path.join(kuboPath, 'darwin-arm64', 'kubo')
      if (fs.existsSync(kuboExe)) {
        console.log('✅ kubo executable found')

        // Check file permissions
        const stats = fs.statSync(kuboExe)
        const isExecutable = (stats.mode & parseInt('111', 8)) !== 0
        if (isExecutable) {
          console.log('✅ kubo executable has correct permissions')
        } else {
          console.log('⚠️  kubo executable may not have execute permissions')
        }
      } else {
        console.log('❌ kubo executable not found')
      }
    } else {
      console.log('❌ darwin-arm64 kubo not found')
    }
  } else {
    console.log('❌ kubo directory not found')
  }

  // Display package size
  try {
    const appSize = execSync(`du -sh "${appPath}"`, { encoding: 'utf8' }).trim()
    console.log(`\n📏 App size: ${appSize}`)
  } catch (err) {
    console.log('⚠️  Could not determine app size')
  }

  console.log('\n🎉 Package verification completed!')
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  verifyPackage()
}

export { verifyPackage }
