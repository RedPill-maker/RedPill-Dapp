#!/usr/bin/env node

import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'
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

// Color output functions
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
}

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`)
}

function logStep(step, message) {
  log(`[${step}] ${message}`, 'cyan')
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green')
}

function logError(message) {
  log(`❌ ${message}`, 'red')
}

// Get command line arguments
const args = process.argv.slice(2)
const platform = args[0] || 'mac-arm64'

// Platform mapping
const platformMap = {
  'mac-arm64': {
    os: 'mac',
    arch: 'arm64',
    name: 'macOS ARM64',
    kuboDir: 'darwin-arm64',
    builderTarget: '--mac --arm64',
  },
  'mac-x64': {
    os: 'mac',
    arch: 'x64',
    name: 'macOS Intel',
    kuboDir: 'darwin-amd64',
    builderTarget: '--mac --x64',
  },
  'win-x64': {
    os: 'win',
    arch: 'x64',
    name: 'Windows x64',
    kuboDir: 'windows-amd64',
    builderTarget: '--win --x64',
  },
  'linux-x64': {
    os: 'linux',
    arch: 'x64',
    name: 'Linux x64',
    kuboDir: 'linux-amd64',
    builderTarget: '--linux --x64',
  },
}

if (!platformMap[platform]) {
  logError(`Unsupported platform: ${platform}`)
  logError(`Supported platforms: ${Object.keys(platformMap).join(', ')}`)
  process.exit(1)
}

const targetPlatform = platformMap[platform]

// Create platform-specific package.json
function createPlatformPackageJson() {
  const basePackage = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'))

  // Create platform-specific configurations
  const platformConfig = {
    appId: basePackage.build.appId,
    productName: appName, // Use app name from config.ts
    directories: basePackage.build.directories,
    files: [
      'main.js',
      'preload.cjs',
      'splash.html',
      'assets/icon.png',
      'assets/icon.ico',
      {
        from: '../dist',
        to: 'dist',
        filter: ['**/*'],
      },
    ],
    extraResources: [
      {
        from: '../dbSync-dist',
        to: 'dbSync',
        filter: ['**/*'],
      },
      {
        from: '../data',
        to: 'data',
        filter: ['**/*'],
      },
      {
        from: '../contract_info',
        to: 'contract_info',
        filter: ['**/*'],
      },
    ],
    extraFiles: [
      {
        from: `../kubo/${targetPlatform.kuboDir}`,
        to: `Resources/kubo/${targetPlatform.kuboDir}`,
        filter: ['**/*'],
      },
    ],
  }

  // Only keep configuration for current platform and set custom file name
  if (targetPlatform.os === 'mac') {
    const macPlatform = targetPlatform.arch === 'arm64' ? 'MacArm64' : 'MacX64'
    platformConfig.mac = {
      ...basePackage.build.mac,
      target: [
        {
          target: 'dmg',
          arch: [targetPlatform.arch] // Dynamically set architecture
        }
      ],
      artifactName: `${appName}-${macPlatform}-v${version}.\${ext}`
    }
  } else if (targetPlatform.os === 'win') {
    platformConfig.win = {
      ...basePackage.build.win,
      artifactName: `${appName}-WinX64-v${version}.\${ext}`
    }
    platformConfig.nsis = basePackage.build.nsis
  } else if (targetPlatform.os === 'linux') {
    platformConfig.linux = {
      ...basePackage.build.linux,
      artifactName: `${appName}-LinuxX64-v${version}.\${ext}`
    }
  }

  // Write temporary configuration file
  const tempConfigPath = path.join(__dirname, 'electron-builder-temp.json')
  fs.writeFileSync(tempConfigPath, JSON.stringify(platformConfig, null, 2))

  return tempConfigPath
}

async function build() {
  try {
    log(`🚀 Building IPFS WebUI for ${targetPlatform.name}`, 'bright')

    // Step 1: Check required files
    logStep('1/7', 'Checking required files...')

    const requiredFiles = [
      '../package.json',
      '../src',
      `../kubo/${targetPlatform.kuboDir}`,
      'main.js',
      'preload.cjs',
      'package.json',
    ]

    for (const file of requiredFiles) {
      const filePath = path.resolve(__dirname, file)
      if (!fs.existsSync(filePath)) {
        logError(`Required file/directory not found: ${file}`)
        if (file === 'preload.cjs') {
          logError('preload.cjs is required for Electron API functionality')
          logError(
            'Make sure the preload.cjs file exists in the electron directory',
          )
        }
        process.exit(1)
      }
    }
    logSuccess('All required files found')

    // Step 2: Build web application
    logStep('2/7', 'Building web application...')
    execSync('npm run build', {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'inherit',
    })
    logSuccess('Web application built successfully')

    // Step 3: Compile dbSync TypeScript files
    logStep('3/7', 'Compiling dbSync TypeScript files...')
    const dbSyncDistDir = path.resolve(__dirname, '..', 'dbSync-dist')

    // Clean up old compiled files
    if (fs.existsSync(dbSyncDistDir)) {
      fs.rmSync(dbSyncDistDir, { recursive: true, force: true })
    }

    // Use tsup to compile dbSync files (configuration in dbSync/tsup.config.ts)
    // noExternal: [/.+/] forces bundling all third-party dependencies (packaged Electron app has no node_modules)
    // Only Node.js built-in modules (fs, path, node:sqlite, etc.) remain external
    execSync('npx tsup --config dbSync/tsup.config.ts', {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'inherit',
    })

    // Fix node:sqlite prefix issue
    // tsup/esbuild's platform:node outputs import "node:sqlite" as import "sqlite"
    // But Node.js 22 requires the node:sqlite prefix, so do text replacement after compilation
    const distFiles = fs
      .readdirSync(dbSyncDistDir)
      .filter((f) => f.endsWith('.js'))
    let fixedCount = 0
    for (const file of distFiles) {
      const filePath = path.join(dbSyncDistDir, file)
      const content = fs.readFileSync(filePath, 'utf-8')
      if (content.includes('from "sqlite"')) {
        fs.writeFileSync(
          filePath,
          content.replace(/from "sqlite"/g, 'from "node:sqlite"'),
          'utf-8',
        )
        fixedCount++
      }
    }
    if (fixedCount > 0) {
      log(`  Fixed node:sqlite imports in ${fixedCount} file(s)`, 'yellow')
    }
    logSuccess('dbSync files compiled successfully')

    // Step 4: Install Electron dependencies
    logStep('4/7', 'Installing Electron dependencies...')
    if (!fs.existsSync(path.resolve(__dirname, 'node_modules'))) {
      execSync('npm install', {
        cwd: __dirname,
        stdio: 'inherit',
      })
    } else {
      log('Electron dependencies already installed', 'yellow')
    }
    logSuccess('Electron dependencies ready')

    // Step 5: Create release directory
    logStep('5/7', 'Preparing release directory...')
    const releaseDir = path.resolve(__dirname, '..', 'release')
    if (!fs.existsSync(releaseDir)) {
      fs.mkdirSync(releaseDir, { recursive: true })
    }
    logSuccess('Release directory ready')

    // Step 6: Create platform-specific configuration
    logStep('6/7', 'Creating platform-specific configuration...')
    const tempConfigPath = createPlatformPackageJson()
    logSuccess('Platform configuration created')

    // Step 7: Build Electron application
    logStep('7/7', `Building Electron app for ${targetPlatform.name}...`)
    const buildCommand = `npx electron-builder ${targetPlatform.builderTarget} --config ${tempConfigPath}`
    execSync(buildCommand, {
      cwd: __dirname,
      stdio: 'inherit',
    })

    // Clean up temporary files
    fs.unlinkSync(tempConfigPath)

    logSuccess(`Electron app built successfully for ${targetPlatform.name}`)

    // Display build results
    log('\n🎉 Build completed successfully!', 'bright')
    log(`📦 Output directory: ${releaseDir}`, 'green')

    // List generated files
    try {
      const files = fs.readdirSync(releaseDir)
      if (files.length > 0) {
        log('\n📋 Generated files:', 'cyan')
        files.forEach((file) => {
          const filePath = path.join(releaseDir, file)
          const stats = fs.statSync(filePath)
          if (stats.isFile()) {
            const size = (stats.size / 1024 / 1024).toFixed(2)
            log(`   • ${file} (${size} MB)`, 'blue')
          }
        })
      }
    } catch (err) {
      log('Could not list generated files', 'yellow')
    }
  } catch (error) {
    logError(`Build failed: ${error.message}`)
    process.exit(1)
  }
}

// Run build
build()
