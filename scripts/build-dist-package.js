#!/usr/bin/env node

/**
 * Build WebUI Hot Update Package
 * Automatically package the dist directory into a zip file, 
 * with the naming format：RedPill-dist-v{version}.zip
 */

import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import archiver from 'archiver'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const packageJson = require('../package.json')
const { version } = packageJson

// Read app name from config.ts
const configPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'config.ts')
const configContent = fs.readFileSync(configPath, 'utf-8')
const nameMatch = configContent.match(/NAME:\s*['"]([^'"]+)['"]/)
const appName = nameMatch ? nameMatch[1] : 'RedPill'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

//color output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
}

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`)
}

async function buildDistPackage() {
  try {
    log('🚀 Building WebUI dist package...', 'cyan')

    //1. Build WebUI
    log('\n[1/3] Building web application...', 'cyan')
    execSync('npm run build', {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'inherit',
    })
    log('✅ Web application built successfully', 'green')

    // 2. Prepare the output directory
    log('\n[2/3] Preparing output directory...', 'cyan')
    const releaseDir = path.resolve(__dirname, '..', 'release')
    if (!fs.existsSync(releaseDir)) {
      fs.mkdirSync(releaseDir, { recursive: true })
    }

    // 3. Package dist directory
    log('\n[3/3] Creating zip package...', 'cyan')
    const distDir = path.resolve(__dirname, '..', 'dist')
    const outputFileName = `${appName}-dist-v${version}.zip`
    const outputPath = path.join(releaseDir, outputFileName)

    // If the file already exists, delete it first
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath)
      log(`  Removed existing file: ${outputFileName}`, 'yellow')
    }

    // Create zip file
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(outputPath)
      const archive = archiver('zip', {
        zlib: { level: 9 }, // Maximum compression level
      })

      output.on('close', () => {
        const size = (archive.pointer() / 1024 / 1024).toFixed(2)
        log(`  Created: ${outputFileName} (${size} MB)`, 'green')
        resolve()
      })

      archive.on('error', (err) => {
        reject(err)
      })

      archive.pipe(output)

      // Add all files in the dist directory
      archive.directory(distDir, false)

      archive.finalize()
    })

    log('\n🎉 Dist package built successfully!', 'green')
    log(`📦 Output: ${outputPath}`, 'cyan')
    log(`\n💡 Upload this file to IPFS and publish as a work with title: ${outputFileName}`, 'yellow')
  } catch (error) {
    log(`\n❌ Build failed: ${error.message}`, 'red')
    process.exit(1)
  }
}

// Run the build
buildDistPackage()
