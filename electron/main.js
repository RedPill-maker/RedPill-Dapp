import {
  app,
  BrowserWindow,
  shell,
  Menu,
  Tray,
  ipcMain,
  dialog,
  globalShortcut,
  safeStorage,
} from 'electron'
import path from 'path'
import { spawn, exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import os from 'os'
import net from 'net'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const execAsync = promisify(exec)

let mainWindow
let splashWindow = null // Splash screen window
let kuboProcess = null
let kuboWatchdog = null // Watchdog process monitor
let isKuboShuttingDown = false // Flag for active kubo shutdown
let kuboRestartCount = 0 // Restart counter
let lastRestartTime = 0 // Last restart time
const MAX_RESTART_ATTEMPTS = 3 // Reduced max restart attempts
const RESTART_DELAY = 5000 // Increased restart delay to 5 seconds
const RESTART_COOLDOWN = 10000 // Restart cooldown time 10 seconds

// dbSync service process
let dbSyncProcess = null
let isDbSyncShuttingDown = false

// System tray (Windows only)
let tray = null

// Dynamically allocated ports
let allocatedPorts = {
  dbServer: 3001,
  ipfsApi: 5001,
  ipfsGateway: 8080,
  ipfsSwarm: 4001,
}

// Port range configuration
const PORT_RANGES = {
  dbServer: [3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009, 3010],
  ipfsApi: [5001, 5002, 5003, 5004, 5005, 5006, 5007, 5008, 5009, 5010],
  ipfsGateway: [8080, 8081, 8082, 8083, 8084, 8085, 8086, 8087, 8088, 8089],
  ipfsSwarm: [4001, 4002, 4003, 4004, 4005, 4006, 4007, 4008, 4009, 4010],
}

// ==================== Port detection tools ====================

/**
 * Check if port is available
 * @param {number} port Port to check
 * @returns {Promise<boolean>} Whether port is available
 */
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer()

    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false)
      } else {
        resolve(false)
      }
    })

    server.once('listening', () => {
      server.close()
      resolve(true)
    })

    server.listen(port, '127.0.0.1')
  })
}

/**
 * Find first available port from port range
 * @param {number[]} portRange Port range array
 * @param {string} serviceName Service name (for logging)
 * @returns {Promise<number>} Available port number
 */
async function findAvailablePort(portRange, serviceName) {
  for (const port of portRange) {
    const available = await isPortAvailable(port)
    if (available) {
      console.log(`${serviceName}: Found available port ${port}`)
      return port
    } else {
      console.log(`${serviceName}: Port ${port} is in use, trying next...`)
    }
  }

  throw new Error(
    `${serviceName}: All ports are in use (${portRange[0]}-${portRange[portRange.length - 1]})`
  )
}

// Startup log buffer — renderer can pull via 'get-startup-logs' invoke
const startupLogBuffer = []

// Send startup status to splash window
function sendStartupStatus(service, state, message, error = null) {
  const entry = { type: 'status', service, state, message, error, ts: Date.now() }
  startupLogBuffer.push(entry)
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('startup-status', { service, state, message, error })
  }
  console.log(`Startup status: ${service} - ${state} - ${message}`)
}

// Send log to splash window
function sendLog(service, message) {
  const trimmed = message.trim()
  const entry = { type: 'log', service, message: trimmed, ts: Date.now() }
  startupLogBuffer.push(entry)
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('startup-log', { service, message: trimmed })
  }
  console.log(`[${service}] ${trimmed}`)
}

// IPC handler: renderer pulls buffered logs
ipcMain.handle('get-startup-logs', (event, sinceIndex) => {
  const idx = sinceIndex || 0
  return { logs: startupLogBuffer.slice(idx), total: startupLogBuffer.length }
})

// Get kubo executable path for current platform
function getKuboPath() {
  const platform = os.platform()
  const arch = os.arch()

  let kuboDir
  if (platform === 'darwin') {
    kuboDir = arch === 'arm64' ? 'darwin-arm64' : 'darwin-amd64'
  } else if (platform === 'linux') {
    kuboDir = 'linux-amd64'
  } else if (platform === 'win32') {
    kuboDir = 'windows-amd64'
  } else {
    throw new Error(`Unsupported platform: ${platform}`)
  }

  const kuboName = platform === 'win32' ? 'ipfs.exe' : 'ipfs'

  // In packaged app, kubo files are in Resources directory
  let kuboPath
  if (app.isPackaged) {
    kuboPath = path.join(process.resourcesPath, 'kubo', kuboDir, kuboName)
  } else {
    // Development environment
    kuboPath = path.join(__dirname, '..', 'kubo', kuboDir, kuboName)
  }

  console.log('Kubo path:', kuboPath)
  return kuboPath
}

// Start kubo daemon
async function startKubo() {
  return new Promise(async (resolve, reject) => {
    try {
      // If process already running, clean up first
      if (kuboProcess) {
        console.log('Cleaning up existing kubo process...')
        try {
          kuboProcess.kill('SIGKILL') // Force kill
        } catch (err) {
          console.log('Failed to kill existing process:', err.message)
        }
        kuboProcess = null
      }

      const kuboPath = getKuboPath()

      // Check kubo file exists
      if (!fs.existsSync(kuboPath)) {
        reject(new Error(`Kubo executable not found at: ${kuboPath}`))
        return
      }

      // Set IPFS_PATH to user data directory
      const ipfsPath = path.join(app.getPath('userData'), '.ipfs')
      process.env.IPFS_PATH = ipfsPath

      console.log('IPFS_PATH:', ipfsPath)
      console.log('Starting kubo daemon with dynamic port allocation...')

      // Clean up stale lock files before starting (common cause of Windows hangs)
      const lockFiles = [
        path.join(ipfsPath, 'repo.lock'),
        path.join(ipfsPath, 'datastore', 'LOCK'),
        path.join(ipfsPath, 'api'),
      ]
      lockFiles.forEach((lockFile) => {
        if (fs.existsSync(lockFile)) {
          try {
            fs.unlinkSync(lockFile)
            console.log('Removed stale lock file:', lockFile)
            sendLog('kubo', `Removed stale lock file: ${path.basename(lockFile)}`)
          } catch (err) {
            console.warn('Could not remove lock file:', lockFile, err.message)
          }
        }
      })

      // Allocate ports
      try {
        sendLog('kubo', 'Allocating ports...')
        allocatedPorts.ipfsApi = await findAvailablePort(
          PORT_RANGES.ipfsApi,
          'Kubo API'
        )
        allocatedPorts.ipfsGateway = await findAvailablePort(
          PORT_RANGES.ipfsGateway,
          'Kubo Gateway'
        )
        allocatedPorts.ipfsSwarm = await findAvailablePort(
          PORT_RANGES.ipfsSwarm,
          'Kubo Swarm'
        )

        sendLog('kubo', `Ports allocated — API:${allocatedPorts.ipfsApi} GW:${allocatedPorts.ipfsGateway} Swarm:${allocatedPorts.ipfsSwarm}`)
        console.log('Allocated ports:', {
          api: allocatedPorts.ipfsApi,
          gateway: allocatedPorts.ipfsGateway,
          swarm: allocatedPorts.ipfsSwarm,
        })
      } catch (err) {
        reject(
          new Error(
            `Port allocation failed: ${err.message}\n\nPlease check if other programs are using many ports, or try restarting your computer.`
          )
        )
        return
      }

      // Check if already initialized; run init regardless (safe to re-run)
      sendLog('kubo', 'Running ipfs init...')
      const initProcess = spawn(kuboPath, ['init'], {
        env: { ...process.env, IPFS_PATH: ipfsPath },
      })

      initProcess.stdout.on('data', (data) => {
        sendLog('kubo', data.toString().trim())
      })
      initProcess.stderr.on('data', (data) => {
        sendLog('kubo', data.toString().trim())
      })

      initProcess.on('close', async (code) => {
        console.log('Init process exited with code:', code)
        sendLog('kubo', `ipfs init exited with code ${code}`)

        // Configure Kubo ports
        try {
          sendLog('kubo', 'Configuring ports...')
          await configureKuboPorts(ipfsPath)
        } catch (err) {
          console.error('Failed to configure Kubo ports:', err)
          reject(new Error(`Kubo port configuration failed: ${err.message}`))
          return
        }

        // Start daemon
        sendLog('kubo', 'Spawning ipfs daemon...')
        kuboProcess = spawn(kuboPath, ['daemon'], {
          env: { ...process.env, IPFS_PATH: ipfsPath },
          stdio: ['ignore', 'pipe', 'pipe'], // Explicitly set stdio
        })

        let daemonReady = false

        kuboProcess.stdout.on('data', (data) => {
          const output = data.toString()
          console.log('Kubo stdout:', output)
          sendLog('kubo', output)
          // Check if daemon started successfully
          if (output.includes('Daemon is ready') && !daemonReady) {
            daemonReady = true
            console.log('Kubo daemon started successfully')
            console.log('Kubo ports:', {
              API: allocatedPorts.ipfsApi,
              Gateway: allocatedPorts.ipfsGateway,
              Swarm: allocatedPorts.ipfsSwarm,
            })
            // Start watchdog process monitor
            startKuboWatchdog()
            resolve()
          }
        })

        kuboProcess.stderr.on('data', (data) => {
          const output = data.toString()
          console.error('Kubo stderr:', output)
          sendLog('kubo', output)
        })

        kuboProcess.on('close', (code, signal) => {
          console.log(
            `Kubo daemon exited with code: ${code}, signal: ${signal}`,
          )
          kuboProcess = null

          // If not actively shutting down, trigger auto-restart
          if (!isKuboShuttingDown && !daemonReady) {
            console.log('Kubo daemon failed to start properly')
            reject(new Error(`Kubo daemon failed to start, exit code: ${code}`))
          } else if (!isKuboShuttingDown && daemonReady) {
            console.log(
              'Kubo daemon unexpectedly exited, triggering restart...',
            )
            handleKuboUnexpectedExit()
          }
        })

        kuboProcess.on('error', (err) => {
          console.error('Failed to start kubo daemon:', err)
          kuboProcess = null
          reject(err)
        })

        // Set timeout: if "Daemon is ready" not seen within 15 seconds, consider startup failed
        setTimeout(() => {
          if (kuboProcess && kuboProcess.pid && !daemonReady) {
            console.log('Kubo daemon startup timeout')
            reject(new Error('Kubo daemon startup timeout'))
          }
        }, 15000)
      })

      initProcess.on('error', (err) => {
        console.error('Failed to initialize kubo:', err)
        reject(err)
      })
    } catch (err) {
      reject(err)
    }
  })
}

/**
 * Configure Kubo ports
 * @param {string} ipfsPath IPFS data directory
 */
async function configureKuboPorts(ipfsPath) {
  const configPath = path.join(ipfsPath, 'config')

  if (!fs.existsSync(configPath)) {
    throw new Error('Kubo config file not found')
  }

  //Read configuration file
  const configData = fs.readFileSync(configPath, 'utf8')
  const config = JSON.parse(configData)

  // Modify port configuration
  config.Addresses = config.Addresses || {}
  config.Addresses.API = `/ip4/127.0.0.1/tcp/${allocatedPorts.ipfsApi}`
  config.Addresses.Gateway = `/ip4/127.0.0.1/tcp/${allocatedPorts.ipfsGateway}`

  // Swarm address
  config.Addresses.Swarm = config.Addresses.Swarm || []
  config.Addresses.Swarm = [
    `/ip4/0.0.0.0/tcp/${allocatedPorts.ipfsSwarm}`,
    `/ip6/::/tcp/${allocatedPorts.ipfsSwarm}`,
    `/ip4/0.0.0.0/udp/${allocatedPorts.ipfsSwarm}/quic-v1`,
    `/ip4/0.0.0.0/udp/${allocatedPorts.ipfsSwarm}/quic-v1/webtransport`,
    `/ip6/::/udp/${allocatedPorts.ipfsSwarm}/quic-v1`,
    `/ip6/::/udp/${allocatedPorts.ipfsSwarm}/quic-v1/webtransport`,
  ]

  // Write back configuration file
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')

  console.log('Kubo ports configured:', {
    API: allocatedPorts.ipfsApi,
    Gateway: allocatedPorts.ipfsGateway,
    Swarm: allocatedPorts.ipfsSwarm,
  })
}

// ==================== Kubo watchdog process monitor ====================

/**
 * Start Kubo watchdog process monitor
 * Periodically check kubo process status, auto-restart if process not found
 */
function startKuboWatchdog() {
  // Clear previous monitor
  if (kuboWatchdog) {
    clearInterval(kuboWatchdog)
  }

  console.log('Starting Kubo watchdog...')

  kuboWatchdog = setInterval(() => {
    // Check if kubo process is still running
    if (!kuboProcess || !kuboProcess.pid) {
      console.log(
        'Kubo watchdog: Process not found, checking if restart needed...',
      )

      // If not actively shutting down, restart is needed
      if (!isKuboShuttingDown) {
        console.log('Kubo watchdog: Triggering restart...')
        handleKuboUnexpectedExit()
      }
    } else {
      // Process exists, check if it's really running
      try {
        // Send signal 0 to check if process exists (won't kill process)
        process.kill(kuboProcess.pid, 0)
        // If no exception thrown, process exists
      } catch (err) {
        console.log(
          'Kubo watchdog: Process PID exists but not responding, triggering restart...',
        )
        kuboProcess = null
        if (!isKuboShuttingDown) {
          handleKuboUnexpectedExit()
        }
      }
    }
  }, 5000) // Check every 5 seconds
}

/**
 * Stop Kubo watchdog process monitor
 */
function stopKuboWatchdog() {
  if (kuboWatchdog) {
    console.log('Stopping Kubo watchdog...')
    clearInterval(kuboWatchdog)
    kuboWatchdog = null
  }
}

/**
 * Handle Kubo unexpected exit
 * Implements auto-restart logic with retry limit, delay, and cooldown
 */
function handleKuboUnexpectedExit() {
  // Prevent duplicate triggers
  if (isKuboShuttingDown) {
    console.log('Kubo is shutting down, ignoring restart request')
    return
  }

  const now = Date.now()

  // Check cooldown time
  if (now - lastRestartTime < RESTART_COOLDOWN) {
    console.log(
      `Restart cooldown active, ignoring restart request (${RESTART_COOLDOWN - (now - lastRestartTime)}ms remaining)`,
    )
    return
  }

  kuboRestartCount++
  lastRestartTime = now
  console.log(
    `Kubo unexpected exit detected (attempt ${kuboRestartCount}/${MAX_RESTART_ATTEMPTS})`,
  )

  // Check if max retry attempts exceeded
  if (kuboRestartCount > MAX_RESTART_ATTEMPTS) {
    console.error('Kubo restart attempts exceeded maximum limit, giving up...')
    stopKuboWatchdog()

    // Notify user
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents
        .executeJavaScript(
          `
        alert('IPFS node failed to restart multiple times. Please restart the app or check system status.\\n\\nSuggested actions:\\n1. Completely close the app\\n2. Wait 10 seconds\\n3. Restart the app');
      `,
        )
        .catch((err) => console.error('Failed to show alert:', err))
    }
    return
  }

  console.log(`Scheduling Kubo restart in ${RESTART_DELAY}ms...`)

  // Delay restart to avoid fast restart loop
  setTimeout(async () => {
    // Check again if shutting down
    if (isKuboShuttingDown) {
      console.log(
        'Kubo shutdown detected during restart delay, aborting restart',
      )
      return
    }

    try {
      console.log('Attempting to restart Kubo daemon...')

      // Ensure complete cleanup of previous process
      if (kuboProcess) {
        try {
          kuboProcess.kill('SIGKILL')
        } catch (err) {
          console.log('Failed to kill process during restart:', err.message)
        }
        kuboProcess = null
      }

      // Wait a bit to ensure process is fully cleaned up
      await new Promise((resolve) => setTimeout(resolve, 2000))

      await startKubo()

      // Restart successful, reset counter
      kuboRestartCount = 0
      console.log('Kubo daemon restarted successfully')

      // Notify user of successful restart
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents
          .executeJavaScript(
            `
          console.log('IPFS node automatically restarted');
        `,
          )
          .catch((err) => console.error('Failed to log message:', err))
      }
    } catch (err) {
      console.error('Failed to restart Kubo daemon:', err)

      // If not exceeded max retry attempts, continue trying
      if (kuboRestartCount < MAX_RESTART_ATTEMPTS) {
        console.log('Restart failed, will try again after cooldown...')
        // Don't retry immediately, wait for next watchdog detection
      } else {
        console.error('Max restart attempts reached after failure')
        stopKuboWatchdog()
      }
    }
  }, RESTART_DELAY)
}

/**
 * Reset Kubo state and restart counter
 * Used to resolve issues from frequent switching
 */
function resetKuboState() {
  console.log('Resetting Kubo state...')

  // Stop all monitoring and processes
  stopKuboWatchdog()

  if (kuboProcess) {
    try {
      kuboProcess.kill('SIGKILL')
    } catch (err) {
      console.log('Failed to kill process during reset:', err.message)
    }
    kuboProcess = null
  }

  // Reset all state
  isKuboShuttingDown = false
  kuboRestartCount = 0
  lastRestartTime = 0

  console.log('Kubo state reset complete')
}

// Stop kubo daemon
function stopKubo() {
  if (kuboProcess) {
    console.log('Stopping kubo daemon...')
    isKuboShuttingDown = true // Mark as active shutdown

    // Stop watchdog process monitor
    stopKuboWatchdog()

    try {
      // Try graceful shutdown first
      kuboProcess.kill('SIGTERM')

      // If still running after 3 seconds, force kill
      setTimeout(() => {
        if (kuboProcess) {
          console.log('Force killing kubo process...')
          try {
            kuboProcess.kill('SIGKILL')
          } catch (err) {
            console.log('Failed to force kill process:', err.message)
          }
          kuboProcess = null
        }

        // Clean up lock files to ensure next startup won't have issues
        try {
          const ipfsPath = path.join(app.getPath('userData'), '.ipfs')
          const lockFiles = [
            path.join(ipfsPath, 'repo.lock'),
            path.join(ipfsPath, 'datastore', 'LOCK'),
            path.join(ipfsPath, 'api'),
          ]

          lockFiles.forEach((lockFile) => {
            if (fs.existsSync(lockFile)) {
              fs.unlinkSync(lockFile)
              console.log('Cleaned up lock file:', lockFile)
            }
          })
        } catch (err) {
          console.warn('Failed to clean up lock files:', err.message)
        }
      }, 3000)
    } catch (err) {
      console.error('Error stopping kubo:', err)
    }

    kuboProcess = null

    // Reset state with extended delay to ensure complete cleanup
    setTimeout(() => {
      isKuboShuttingDown = false
      kuboRestartCount = 0
      lastRestartTime = 0
      console.log('Kubo shutdown complete, state reset')
    }, 5000)
  }
}

// ==================== dbSync service management ====================

/**
 * Start dbSync service
 */
async function startDbSync() {
  return new Promise(async (resolve, reject) => {
    try {
      if (dbSyncProcess) {
        console.log('dbSync process already running')
        resolve()
        return
      }

      console.log('Starting dbSync server with dynamic port allocation...')
      sendLog('dbsync', 'Allocating port...')

      // Allocate port
      try {
        allocatedPorts.dbServer = await findAvailablePort(
          PORT_RANGES.dbServer,
          'dbSync Server'
        )
        console.log('Allocated dbSync port:', allocatedPorts.dbServer)
        sendLog('dbsync', `Port allocated: ${allocatedPorts.dbServer}`)
      } catch (err) {
        reject(
          new Error(
            `dbSync port allocation failed: ${err.message}\n\nPlease check if other programs are using many ports, or try restarting your computer.`
          )
        )
        return
      }

      // Get dbSync server script path
      let dbSyncPath
      let nodePath = process.execPath // Electron's node path
      let args = []

      if (app.isPackaged) {
        // In packaged app, compiled dbSync JS files are in Resources directory
        dbSyncPath = path.join(process.resourcesPath, 'dbSync', 'server.js')
        // node:sqlite is experimental module, needs --experimental-sqlite flag
        args = ['--experimental-sqlite', dbSyncPath]
      } else {
        // Development environment, use tsx to run TypeScript
        dbSyncPath = path.join(__dirname, '..', 'dbSync', 'server.ts')
        nodePath = 'npx'
        args = ['tsx', dbSyncPath]
      }

      console.log('dbSync path:', dbSyncPath)
      console.log('Node path:', nodePath)
      console.log('Args:', args)

      // Check if file exists
      if (!fs.existsSync(dbSyncPath)) {
        reject(new Error(`dbSync server file not found at: ${dbSyncPath}`))
        return
      }

      // Set environment variables
      const userDataPath = app.getPath('userData')
      const dbDataPath = app.isPackaged
        ? path.join(userDataPath, 'data')
        : path.join(__dirname, '..', 'data')

      const env = {
        ...process.env,
        DB_SERVER_PORT: allocatedPorts.dbServer.toString(),
        NODE_ENV: app.isPackaged ? 'production' : 'development',
        DB_DATA_PATH: dbDataPath,
        // In packaged environment, process.execPath is Electron binary
        // Need to set ELECTRON_RUN_AS_NODE=1 to run child processes in pure Node.js mode
        ...(app.isPackaged ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      }

      console.log('DB_DATA_PATH:', dbDataPath)
      console.log('DB_SERVER_PORT:', allocatedPorts.dbServer)
      console.log('Environment:', app.isPackaged ? 'production' : 'development')
      sendLog('dbsync', `DB path: ${dbDataPath}`)
      sendLog('dbsync', `Node: ${nodePath}`)
      sendLog('dbsync', `Script: ${dbSyncPath}`)

      // In packaged environment, ensure database directory exists
      if (app.isPackaged) {
        if (!fs.existsSync(dbDataPath)) {
          fs.mkdirSync(dbDataPath, { recursive: true })
          console.log('Created database directory:', dbDataPath)
        }

        // Copy initial database files (if not exist)
        const sourceDataPath = path.join(process.resourcesPath, 'data')
        if (fs.existsSync(sourceDataPath)) {
          const dbFiles = ['core.db', 'peripheral.db', 'txhistory2.db']
          dbFiles.forEach((dbFile) => {
            const sourcePath = path.join(sourceDataPath, dbFile)
            const targetPath = path.join(dbDataPath, dbFile)
            if (fs.existsSync(sourcePath) && !fs.existsSync(targetPath)) {
              fs.copyFileSync(sourcePath, targetPath)
              console.log(`Copied ${dbFile} to user data directory`)
            }
          })
        }
      }

      // Create log file stream
      const logPath = path.join(userDataPath, 'dbsync.log')
      const logStream = fs.createWriteStream(logPath, { flags: 'a' })

      const writeLog = (message) => {
        const timestamp = new Date().toISOString()
        logStream.write(`[${timestamp}] ${message}\n`)
      }

      writeLog('=== dbSync Service Starting ===')
      writeLog(`Database path: ${dbDataPath}`)
      writeLog(`Service port: ${allocatedPorts.dbServer}`)
      writeLog(`Log file: ${logPath}`)

      sendLog('dbsync', 'Spawning dbSync server...')

      // Start dbSync service
      dbSyncProcess = spawn(nodePath, args, {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: app.isPackaged
          ? process.resourcesPath
          : path.join(__dirname, '..'),
      })

      let serverReady = false

      dbSyncProcess.stdout.on('data', (data) => {
        const output = data.toString()
        console.log('dbSync stdout:', output)
        writeLog(output)
        sendLog('dbsync', output)

        // Check if service started successfully
        if (output.includes('dbSync service started') && !serverReady) {
          serverReady = true
          console.log('dbSync server started successfully on port', allocatedPorts.dbServer)
          writeLog(`✓ dbSync service started successfully, port: ${allocatedPorts.dbServer}`)
          resolve()
        }
      })

      dbSyncProcess.stderr.on('data', (data) => {
        const output = data.toString()
        console.error('dbSync stderr:', output)
        writeLog(`[ERROR] ${output}`)
        sendLog('dbsync', output)
      })

      dbSyncProcess.on('close', (code, signal) => {
        const msg = `dbSync server exited with code: ${code}, signal: ${signal}`
        console.log(msg)
        writeLog(msg)
        dbSyncProcess = null
        logStream.end()

        if (!isDbSyncShuttingDown && !serverReady) {
          console.log('dbSync server failed to start properly')
          writeLog('✗ dbSync service failed to start')
          reject(new Error(`dbSync server failed to start, exit code: ${code}`))
        }
      })

      dbSyncProcess.on('error', (err) => {
        console.error('Failed to start dbSync server:', err)
        writeLog(`✗ Startup failed: ${err.message}`)
        dbSyncProcess = null
        logStream.end()
        reject(err)
      })

      // Set timeout: if startup success message not seen within 10 seconds, consider startup failed
      setTimeout(() => {
        if (dbSyncProcess && dbSyncProcess.pid && !serverReady) {
          console.log('dbSync server startup timeout')
          writeLog('✗ Startup timeout')
          reject(new Error('dbSync server startup timeout'))
        }
      }, 10000)
    } catch (err) {
      reject(err)
    }
  })
}

/**
 * Stop dbSync service
 */
function stopDbSync() {
  if (dbSyncProcess) {
    console.log('Stopping dbSync server...')
    isDbSyncShuttingDown = true

    try {
      // Try graceful shutdown first
      dbSyncProcess.kill('SIGTERM')

      // If still running after 3 seconds, force kill
      setTimeout(() => {
        if (dbSyncProcess) {
          console.log('Force killing dbSync process...')
          try {
            dbSyncProcess.kill('SIGKILL')
          } catch (err) {
            console.log('Failed to force kill dbSync process:', err.message)
          }
          dbSyncProcess = null
        }
      }, 3000)
    } catch (err) {
      console.error('Error stopping dbSync:', err)
    }

    dbSyncProcess = null

    // Reset state
    setTimeout(() => {
      isDbSyncShuttingDown = false
      console.log('dbSync shutdown complete, state reset')
    }, 5000)
  }
}

// ==================== Window creation functions ====================

function createSplashWindow() {
  return new Promise((resolve) => {
    splashWindow = new BrowserWindow({
      width: 500,
      height: 400,
      frame: false,
      transparent: false,
      resizable: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.cjs'),
      },
    })

    const splashPath = path.join(__dirname, 'splash.html')

    // Wait for the renderer to signal it's ready (listeners registered)
    // Fallback: if renderer never signals, resolve after timeout
    const fallbackTimer = setTimeout(() => {
      console.log('Splash ready timeout — proceeding anyway')
      resolve()
    }, 3000)

    ipcMain.once('splash-ready', () => {
      console.log('Splash renderer signaled ready')
      clearTimeout(fallbackTimer)
      resolve()
    })

    splashWindow.loadFile(splashPath)

    if (!app.isPackaged) {
      splashWindow.webContents.openDevTools()
    }

    splashWindow.webContents.on(
      'did-fail-load',
      (event, errorCode, errorDescription) => {
        console.error(
          'Splash window failed to load:',
          errorCode,
          errorDescription,
        )
        clearTimeout(fallbackTimer)
        resolve()
      },
    )

    splashWindow.on('closed', () => {
      splashWindow = null
    })
  })
}

function createWindow() {
  // Create browser window
  const preloadPath = path.join(__dirname, 'preload.cjs')
  console.log('Preload script path:', preloadPath)
  console.log('Preload script exists:', fs.existsSync(preloadPath))

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      preload: preloadPath,
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    // On Windows: use default title bar for drag support.
    // On macOS: keep default title bar with native traffic lights.
    titleBarStyle: 'default',
    show: false,
  })

  // Allow opening developer tools in packaged environment too (for debugging)
  if (app.isPackaged) {
    // Can be opened via menu or keyboard shortcut
      console.log('Tip: You can open Developer Tools via View -> Toggle Developer Tools or F12')
  }

  // Load app's index.html
  // Version-aware loading: clear dist-override if app version changed
  const userDataPath = app.getPath('userData')
  const versionFilePath = path.join(userDataPath, 'app-version.txt')
  const currentVersion = app.getVersion() // from package.json

  // Check if app version changed
  let shouldClearOverride = false
  if (fs.existsSync(versionFilePath)) {
    const savedVersion = fs.readFileSync(versionFilePath, 'utf-8').trim()
    if (savedVersion !== currentVersion) {
      console.log(`App version changed: ${savedVersion} -> ${currentVersion}`)
      shouldClearOverride = true
    }
  } else {
    // First run, just save version (don't clear anything)
    console.log(`First run, saving version: ${currentVersion}`)
  }

  // Clear dist-override if version changed
  if (shouldClearOverride) {
    const distOverrideDir = path.join(userDataPath, 'dist-override')
    if (fs.existsSync(distOverrideDir)) {
      console.log('Clearing dist-override due to version upgrade...')
      try {
        fs.rmSync(distOverrideDir, { recursive: true, force: true })
        console.log('dist-override cleared successfully')
      } catch (err) {
        console.error('Failed to clear dist-override:', err)
      }
    }
  }

  // Save current version
  try {
    fs.writeFileSync(versionFilePath, currentVersion, 'utf-8')
  } catch (err) {
    console.error('Failed to save app version:', err)
  }

  // Load index.html (prioritize dist-override if exists, otherwise use packaged dist)
  let indexPath
  const distOverridePath = path.join(userDataPath, 'dist-override', 'index.html')
  if (app.isPackaged && fs.existsSync(distOverridePath)) {
    indexPath = distOverridePath
    console.log('Loading from dist-override (hot update applied):', indexPath)
  } else if (app.isPackaged) {
    indexPath = path.join(__dirname, 'dist', 'index.html')
  } else {
    indexPath = path.join(__dirname, '..', 'dist', 'index.html')
  }

  console.log('Loading index.html from:', indexPath)
  console.log('App version:', currentVersion)
  console.log('App is packaged:', app.isPackaged)
  console.log('__dirname:', __dirname)

  // Check if file exists
  if (!fs.existsSync(indexPath)) {
    console.error('index.html not found at:', indexPath)
    // Show error page
    mainWindow.loadURL(
      'data:text/html,<h1>Error: Application files not found</h1><p>Please rebuild the application.</p>',
    )
  } else {
    mainWindow.loadFile(indexPath)
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()

    // Auto-open developer tools in development environment or debug mode
    // Can also be forced open via --debug parameter
    if (
      process.env.NODE_ENV === 'development' ||
      process.argv.includes('--debug') ||
      !app.isPackaged
    ) {
      mainWindow.webContents.openDevTools()
      console.log('Developer tools opened, please check preload logs in console')
    }
  })

  // Monitor page load errors
  mainWindow.webContents.on(
    'did-fail-load',
    (event, errorCode, errorDescription, validatedURL) => {
      console.error(
        'Page failed to load:',
        errorCode,
        errorDescription,
        validatedURL,
      )
    },
  )

  // On Windows: intercept close to hide to tray instead of destroying the window
  if (process.platform === 'win32') {
    mainWindow.on('close', (event) => {
      if (!app.isQuitting) {
        event.preventDefault()
        mainWindow.hide()
      }
    })
  }

  mainWindow.on('closed', function () {
    mainWindow = null
  })

  // Add right-click context menu support (including clipboard functions)
  mainWindow.webContents.on('context-menu', (event, params) => {
    const { selectionText, isEditable } = params

    // Build context menu
    const contextMenuTemplate = []

    // Clipboard operations (always available)
    if (isEditable) {
      contextMenuTemplate.push(
        {
          role: 'cut',
          enabled: selectionText.length > 0,
        },
        {
          role: 'copy',
          enabled: selectionText.length > 0,
        },
        {
          role: 'paste',
        },
        { type: 'separator' },
        {
          role: 'selectAll',
        },
      )
    } else if (selectionText.length > 0) {
      // Non-editable area but has selected text, only show copy
      contextMenuTemplate.push({
        role: 'copy',
      })
    }

    // Developer tools (only in development environment or debug mode)
    if (
      process.env.NODE_ENV === 'development' ||
      process.argv.includes('--debug') ||
      !app.isPackaged
    ) {
      if (contextMenuTemplate.length > 0) {
        contextMenuTemplate.push({ type: 'separator' })
      }

      contextMenuTemplate.push(
        {
          label: 'Inspect Element',
          click: () => {
            mainWindow.webContents.inspectElement(params.x, params.y)
          },
        },
        {
          label: 'Open Developer Tools',
          accelerator: 'F12',
          click: () => {
            mainWindow.webContents.openDevTools()
          },
        },
        { type: 'separator' },
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            mainWindow.webContents.reload()
          },
        },
        {
          label: 'Force Reload',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => {
            mainWindow.webContents.reloadIgnoringCache()
          },
        },
      )
    }

    // Only show menu if there are menu items
    if (contextMenuTemplate.length > 0) {
      const contextMenu = Menu.buildFromTemplate(contextMenuTemplate)
      contextMenu.popup()
    }
  })

  // Intercept new window open, use system default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  // Another instance is already running — just quit silently.
  // The existing instance's second-instance handler will bring its window to focus.
  app.quit()
} else {
  // When a second instance is launched, show and focus the existing window instead of showing an error
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  // Continue with normal app startup flow
  app.whenReady().then(async () => {
    try {
      // Create splash window and wait for it to fully load
      await createSplashWindow()

      // Create menu
      createMenu()

      // Register global shortcuts
      registerGlobalShortcuts()

      // Now splash is ready to receive IPC — start services
      sendLog('system', 'App ready, calling startServices...')
      startServices().catch((err) => {
        sendLog('error', `startServices rejected: ${err.message}`)
        sendLog('error', err.stack || 'no stack')
      })
    } catch (err) {
      console.error('Fatal error in app.whenReady:', err)
      // Write directly to buffer so polling can pick it up
      startupLogBuffer.push({ type: 'log', service: 'error', message: `whenReady crash: ${err.message}`, ts: Date.now() })
      startupLogBuffer.push({ type: 'log', service: 'error', message: err.stack || 'no stack', ts: Date.now() })
    }

    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) {
        createSplashWindow().then(() => {
          startServices()
        })
      }
    })
  }).catch((err) => {
    console.error('Unhandled error in whenReady:', err)
    startupLogBuffer.push({ type: 'log', service: 'error', message: `whenReady unhandled: ${err.message}`, ts: Date.now() })
  })
}

// Start all services
async function startServices() {
  try {
    sendLog('system', `Platform: ${process.platform} ${process.arch}`)
    sendLog('system', `App version: ${app.getVersion()}`)
    sendLog('system', `Packaged: ${app.isPackaged}`)
    sendLog('system', `userData: ${app.getPath('userData')}`)
    if (app.isPackaged) {
      sendLog('system', `resourcesPath: ${process.resourcesPath}`)
    }

    // Start Kubo
    sendStartupStatus('kubo', 'starting', 'Starting IPFS node...')
    await startKubo()
    sendStartupStatus('kubo', 'success', 'Ready')

    // Start dbSync
    sendStartupStatus('dbsync', 'starting', 'Starting database service...')
    try {
      await startDbSync()
      sendStartupStatus('dbsync', 'success', 'Ready')
    } catch (err) {
      console.error('Failed to start dbSync:', err)
      sendStartupStatus('dbsync', 'error', 'Startup failed', err.message)
      throw err
    }

    // All services started successfully, wait a bit then create main window
    setTimeout(() => {
      createWindow()
      // Close splash window
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close()
      }
    }, 1000)
  } catch (err) {
    console.error('Failed to start services:', err)
    sendStartupStatus('kubo', 'error', 'Startup failed', err.message)
    // Don't auto-close splash window, let user see error message
  }
}

// Listen for retry startup
ipcMain.on('retry-startup', async () => {
  console.log('Retrying startup...')
  // Reset state
  sendStartupStatus('kubo', 'starting', 'Retrying...')
  sendStartupStatus('dbsync', 'starting', 'Waiting...')
  // Restart services
  await startServices()
})

// Register global shortcuts
function registerGlobalShortcuts() {
  try {
    globalShortcut.register('F12', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.toggleDevTools()
      }
    })

    globalShortcut.register('CommandOrControl+Shift+I', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.openDevTools()
      }
    })
  } catch (error) {
    console.error('Error registering global shortcuts:', error)
  }
}

// Create application menu (macOS) or system tray (Windows)
function createMenu() {
  const isMac = process.platform === 'darwin'

  if (isMac) {
    // macOS: full application menu
    const template = [
      {
        label: app.getName(),
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          {
            label: 'Reset IPFS Node',
            click: async () => {
              const result = await dialog.showMessageBox(mainWindow, {
                type: 'warning',
                buttons: ['Reset', 'Cancel'],
                defaultId: 1,
                title: 'Reset IPFS Node',
                message: 'This will reset the IPFS node and restart it. Continue?',
                detail: 'This action will stop the current IPFS daemon and restart it with a clean state.',
              })
              if (result.response === 0) {
                resetKuboState()
                setTimeout(async () => {
                  try {
                    await startKubo()
                    console.log('IPFS node reset and restarted successfully')
                  } catch (err) {
                    console.error('Failed to restart IPFS node after reset:', err)
                  }
                }, 2000)
              }
            },
          },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideothers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'pasteAndMatchStyle' },
          { role: 'delete' },
          { role: 'selectAll' },
        ],
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload', accelerator: 'CmdOrCtrl+R' },
          { role: 'forceReload', accelerator: 'CmdOrCtrl+Shift+R' },
          {
            label: 'Toggle Developer Tools',
            accelerator: 'F12',
            click: () => { if (mainWindow) mainWindow.webContents.toggleDevTools() },
          },
          { type: 'separator' },
          {
            label: 'Open Logs Folder',
            click: () => { shell.openPath(app.getPath('userData')) },
          },
          { role: 'toggleFullScreen' },
        ],
      },
      {
        role: 'help',
        submenu: [
          {
            label: 'Source Code',
            click: async () => { await shell.openExternal('https://github.com/RedPill-maker/RedPill-Dapp') },
          },
          {
            label: 'Learn More about IPFS',
            click: async () => { await shell.openExternal('https://ipfs.io') },
          },
        ],
      },
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  } else {
    // Windows: no application menu bar (title bar is one row via titleBarOverlay).
    // All actions are accessible via the system tray icon.
    Menu.setApplicationMenu(null)
    createTray()
  }
}

// Create system tray icon with context menu (Windows only)
function createTray() {
  // Use .ico on Windows for best quality, fallback to .png
  const icoPath = path.join(__dirname, 'assets', 'icon.ico')
  const pngPath = path.join(__dirname, 'assets', 'icon.png')
  const iconPath = fs.existsSync(icoPath) ? icoPath : pngPath

  if (!fs.existsSync(iconPath)) {
    console.warn('Tray icon not found, skipping tray creation:', iconPath)
    return
  }

  try {
    tray = new Tray(iconPath)
  tray.setToolTip('RedPill')

  const trayMenu = Menu.buildFromTemplate([
    {
      label: 'Show Window',
      click: () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Reset IPFS Node',
      click: async () => {
        const result = await dialog.showMessageBox(mainWindow, {
          type: 'warning',
          buttons: ['Reset', 'Cancel'],
          defaultId: 1,
          title: 'Reset IPFS Node',
          message: 'This will reset the IPFS node and restart it. Continue?',
          detail: 'This action will stop the current IPFS daemon and restart it with a clean state.',
        })
        if (result.response === 0) {
          resetKuboState()
          setTimeout(async () => {
            try {
              await startKubo()
              console.log('IPFS node reset and restarted successfully')
            } catch (err) {
              console.error('Failed to restart IPFS node after reset:', err)
            }
          }, 2000)
        }
      },
    },
    {
      label: 'Toggle Developer Tools',
      click: () => { if (mainWindow) mainWindow.webContents.toggleDevTools() },
    },
    {
      label: 'Open Logs Folder',
      click: () => { shell.openPath(app.getPath('userData')) },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true
        stopDbSync()
        stopKubo()
        app.quit()
      },
    },
  ])

  tray.setContextMenu(trayMenu)

  // Single-click tray icon to show/focus window
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })
  } catch (err) {
    console.error('Failed to create tray:', err.message)
  }
}

app.on('window-all-closed', function () {
  // On Windows, closing the window minimizes to tray instead of quitting.
  // The user can quit via the tray context menu.
  if (process.platform === 'darwin') {
    stopDbSync()
    stopKubo()
  }
  // On Windows: do nothing — app stays alive in the tray
})

app.on('before-quit', () => {
  app.isQuitting = true
  // Clean up global shortcuts
  globalShortcut.unregisterAll()
  console.log('Global shortcuts unregistered')

  stopDbSync()
  stopKubo()
})

// ==================== IPC handlers ====================

/**
 * Get IPFS command path (prefer bundled kubo)
 */
function getIPFSCommandPath() {
  try {
    // First try to use bundled kubo
    const kuboPath = getKuboPath()
    if (fs.existsSync(kuboPath)) {
      console.log('Using bundled kubo:', kuboPath)
      return kuboPath
    }
  } catch (error) {
    console.warn('Failed to get bundled kubo path:', error.message)
  }

  // Fall back to system ipfs command
  console.log('Falling back to system ipfs command')
  return 'ipfs'
}

/**
 * Execute IPFS command using correct binary and environment
 */
async function executeIPFSCommand(args, options = {}) {
  const ipfsCommand = getIPFSCommandPath()
  const isKubo = ipfsCommand !== 'ipfs'

  // Set environment variables
  const env = { ...process.env }

  if (isKubo) {
    // When using bundled kubo, set IPFS_PATH to app data directory
    const ipfsPath = path.join(app.getPath('userData'), '.ipfs')
    env.IPFS_PATH = ipfsPath
    console.log('Using IPFS_PATH:', ipfsPath)
  }

  // Set working directory to temp directory to avoid creating files in read-only app package
  const workingDir = options.cwd || os.tmpdir()

  const command = `"${ipfsCommand}" ${args}`
  console.log('Executing command:', command)
  console.log('Working directory:', workingDir)

  return await execAsync(command, {
    env,
    cwd: workingDir,
    ...options,
  })
}

/**
 * Export IPNS key and show file save dialog
 */
ipcMain.handle('export-ipns-key-with-dialog', async (event, keyName) => {
  console.log('IPC: export-ipns-key-with-dialog called with keyName:', keyName)

  try {
    // 1. Create temporary directory for key export
    const tempDir = os.tmpdir()
    const tempKeyFile = path.join(tempDir, `${keyName}_${Date.now()}.key`)

    console.log('Executing IPFS key export command...')
    console.log('Temporary key file:', tempKeyFile)

    // 2. Export key to temporary file
    const { stdout, stderr } = await executeIPFSCommand(
      `key export ${keyName}`,
      {
        cwd: tempDir,
      },
    )

    if (stderr && stderr.trim()) {
      console.error('IPFS CLI stderr:', stderr)
      throw new Error(`IPFS CLI error: ${stderr}`)
    }

    // 3. Check if key file was generated
    const expectedKeyFile = path.join(tempDir, `${keyName}.key`)
    let keyData = ''

    if (fs.existsSync(expectedKeyFile)) {
      // Read key data from generated file (binary mode)
      const keyBuffer = fs.readFileSync(expectedKeyFile)
      keyData = keyBuffer.toString('base64')
      console.log(
        'Key export successful, binary data converted to base64, length:',
        keyData.length,
      )

      // Clean up temporary file
      try {
        fs.unlinkSync(expectedKeyFile)
      } catch (err) {
        console.warn('Failed to cleanup temp key file:', err.message)
      }
    } else if (stdout && stdout.trim()) {
      // If command output to stdout, assume base64 format
      keyData = stdout.trim()
      console.log(
        'Key export successful from stdout, data length:',
        keyData.length,
      )
    } else {
      throw new Error('Key export failed: key data not found')
    }

    // 4. Show file save dialog
    console.log('Showing save dialog...')
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save IPNS Key',
      defaultPath: `creator_key_${keyName}.key`,
      filters: [
        { name: 'Key Files', extensions: ['key'] },
        { name: 'PEM Files', extensions: ['pem'] },
        { name: 'Text Files', extensions: ['txt'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })

    if (result.canceled) {
      console.log('User canceled save dialog')
      return { success: false, error: 'User canceled save operation' }
    }

    // 5. Save key to user-selected file (binary mode)
    console.log('Saving key to file:', result.filePath)
    const keyBuffer = Buffer.from(keyData, 'base64')
    fs.writeFileSync(result.filePath, keyBuffer)

    console.log('Key export completed successfully')
    return {
      success: true,
      filePath: result.filePath,
    }
  } catch (error) {
    console.error('Key export failed:', error)
    return {
      success: false,
      error: `Key export failed: ${error.message}`,
    }
  }
})

/**
 * Export key data only (no dialog)
 */
ipcMain.handle('export-ipns-key', async (event, keyName) => {
  console.log('IPC: export-ipns-key called with keyName:', keyName)

  try {
    // Create temporary directory for key export
    const tempDir = os.tmpdir()

    console.log('Executing IPFS key export command...')
    const { stdout, stderr } = await executeIPFSCommand(
      `key export ${keyName}`,
      {
        cwd: tempDir,
      },
    )

    if (stderr && stderr.trim()) {
      console.error('IPFS CLI stderr:', stderr)
      throw new Error(`IPFS CLI error: ${stderr}`)
    }

    // Check if key file was generated
    const expectedKeyFile = path.join(tempDir, `${keyName}.key`)
    let keyData = ''

    if (fs.existsSync(expectedKeyFile)) {
      // Read key data from generated file (binary mode)
      const keyBuffer = fs.readFileSync(expectedKeyFile)
      keyData = keyBuffer.toString('base64')
      console.log(
        'Key export successful, binary data converted to base64, length:',
        keyData.length,
      )

      // Clean up temporary file
      try {
        fs.unlinkSync(expectedKeyFile)
      } catch (err) {
        console.warn('Failed to cleanup temp key file:', err.message)
      }
    } else if (stdout && stdout.trim()) {
      // If command output to stdout, assume base64 format
      keyData = stdout.trim()
      console.log(
        'Key export successful from stdout, data length:',
        keyData.length,
      )
    } else {
      throw new Error('Key export failed: key data not found')
    }

    return keyData
  } catch (error) {
    console.error('Key export failed:', error)
    throw new Error(`Key export failed: ${error.message}`)
  }
})

/**
 * Validate key file format
 */
function validateKeyData(keyData) {
  if (!keyData || typeof keyData !== 'string') {
    throw new Error('Key data is empty or format is incorrect')
  }

  // Clean key data (remove extra whitespace)
  const cleanedData = keyData.trim()

  if (cleanedData.length === 0) {
    throw new Error('Key file content is empty')
  }

  // Check if PEM format
  const isPEM =
    cleanedData.includes('-----BEGIN') && cleanedData.includes('-----END')

  // Check if base64 format (IPFS native format or converted binary format)
  const isBase64 = /^[A-Za-z0-9+/=\s]+$/.test(cleanedData)

  if (!isPEM && !isBase64) {
    throw new Error(
      'Key format not supported. Please ensure key file is valid PEM format or IPFS native format',
    )
  }

  console.log('Key validation passed:', {
    length: cleanedData.length,
    format: isPEM ? 'PEM' : 'Base64/Native',
    hasBegin: cleanedData.includes('-----BEGIN'),
    hasEnd: cleanedData.includes('-----END'),
  })

  return cleanedData
}

/**
 * Import IPNS key
 */
ipcMain.handle('import-ipns-key', async (event, keyName, keyData) => {
  console.log('IPC: import-ipns-key called with keyName:', keyName)
  console.log('Key data length:', keyData ? keyData.length : 0)

  try {
    // 1. Validate key data
    const validatedKeyData = validateKeyData(keyData)

    // 2. Create temporary file
    const tempDir = os.tmpdir()
    const tempFilePath = path.join(tempDir, `temp_key_${Date.now()}.key`)

    console.log('Writing key to temp file:', tempFilePath)

    // 3. Write key data to temporary file
    console.log('Writing key to temp file:', tempFilePath)

    // Check if data is base64-encoded (possibly converted from binary)
    const isBase64Only =
      /^[A-Za-z0-9+/=]+$/.test(validatedKeyData) &&
      !validatedKeyData.includes('-----BEGIN')

    if (isBase64Only) {
      // If pure base64 data, need to convert back to binary format
      try {
        const binaryData = Buffer.from(validatedKeyData, 'base64')
        fs.writeFileSync(tempFilePath, binaryData)
        console.log(
          'Base64 key data converted to binary and written to temp file',
        )
      } catch (err) {
        console.error('Failed to decode base64 key data:', err)
        throw new Error('Key data format error: unable to decode base64 data')
      }
    } else {
      // PEM format or other text format, write directly
      fs.writeFileSync(tempFilePath, validatedKeyData, 'utf8')
      console.log('Text key data written to temp file')
    }

    // 4. Verify temporary file
    const fileStats = fs.statSync(tempFilePath)
    console.log('Temp file created:', {
      path: tempFilePath,
      size: fileStats.size,
      exists: fs.existsSync(tempFilePath),
    })

    try {
      // 5. Execute import command
      console.log('Executing IPFS key import command...')
      console.log('Command:', `key import ${keyName} "${tempFilePath}"`)

      const { stdout, stderr } = await executeIPFSCommand(
        `key import ${keyName} "${tempFilePath}"`,
      )

      console.log('Command stdout:', stdout)
      console.log('Command stderr:', stderr)

      if (stderr && stderr.trim()) {
        // Analyze stderr content, provide more specific error message
        const stderrMsg = stderr.trim()

        if (
          stderrMsg.includes('unable to unmarshall') ||
          stderrMsg.includes('proto: cannot parse')
        ) {
          throw new Error(
            `Key format error: file content cannot be parsed.\n\nPossible causes:\n1. Key file is not valid IPFS key format\n2. File encoding issue\n3. Key file is truncated or corrupted\n\nSuggestions:\n- Ensure key file is exported via 'ipfs key export' command\n- Check if file content is complete\n- Try re-exporting key file`,
          )
        } else if (
          stderrMsg.includes('key with name') &&
          stderrMsg.includes('already exists')
        ) {
          throw new Error(
            `Key name conflict: key named "${keyName}" already exists.\n\nSuggestions:\n- Use different key name\n- Or delete existing key first`,
          )
        } else if (stderrMsg.includes('daemon not running')) {
          throw new Error(
            `IPFS daemon not running.\n\nSuggestions:\n- Wait for app to fully start\n- Or restart the app`,
          )
        } else {
          throw new Error(`IPFS CLI error: ${stderrMsg}`)
        }
      }

      // 6. Parse output to get key ID
      const output = stdout.trim()

      if (!output) {
        throw new Error('Key import command did not return key ID')
      }

      console.log('Key import successful, output:', output)

      // IPFS key import usually returns key ID
      return {
        name: keyName,
        id: output,
      }
    } finally {
      // 7. Clean up temporary file
      try {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath)
          console.log('Temp file cleaned up:', tempFilePath)
        }
      } catch (err) {
        console.warn('Failed to cleanup temp file:', err.message)
      }
    }
  } catch (error) {
    console.error('Key import failed:', error)

    // Provide more user-friendly error message
    let errorMessage = error.message

    if (error.message.includes('Command failed')) {
      errorMessage = `Key import failed: ${error.message}\n\nTroubleshooting:\n1. Check if key file is valid IPFS key\n2. Ensure key file is complete and not corrupted\n3. Try using different key file\n4. Restart app and try again`
    }

    throw new Error(errorMessage)
  }
})

/**
 * Check if IPFS CLI is available
 */
ipcMain.handle('check-ipfs-cli', async (event) => {
  console.log('IPC: check-ipfs-cli called')

  try {
    const { stdout, stderr } = await executeIPFSCommand('version')
    console.log('IPFS CLI version check successful:', stdout.trim())
    return true
  } catch (error) {
    console.error('IPFS CLI not available:', error.message)
    return false
  }
})

/**
 * Get app version
 */
ipcMain.handle('get-app-version', async (event) => {
  return app.getVersion()
})

/**
 * Get platform information
 */
ipcMain.handle('get-platform', async (event) => {
  return process.platform
})

/**
 * Save app installer to user-selected directory
 */
ipcMain.handle('save-app-update', async (event, data, fileName) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Installer',
      defaultPath: path.join(app.getPath('downloads'), fileName),
      filters: [{ name: 'All Files', extensions: ['*'] }],
    })
    if (result.canceled || !result.filePath) return null
    const buffer = Buffer.from(data)
    fs.writeFileSync(result.filePath, buffer)
    console.log('App update saved to:', result.filePath)
    return result.filePath
  } catch (err) {
    console.error('Failed to save app update:', err)
    return null
  }
})

/**
 * Show file in file manager
 */
ipcMain.handle('show-item-in-folder', async (event, filePath) => {
  shell.showItemInFolder(filePath)
})

/**
 * Open a URL in the system's default external browser
 */
ipcMain.handle('open-external-url', async (event, url) => {
  // Only allow safe protocols
  if (
    url &&
    (url.startsWith('https://') ||
      url.startsWith('http://') ||
      url.startsWith('mailto:'))
  ) {
    await shell.openExternal(url)
  }
})

/**
 * Apply WebUI hot update
 * Receive decompressed file list from frontend, write to userData/dist-override, prioritize loading on next startup
 * files: Array<{ relativePath: string, data: number[] }>
 */
ipcMain.handle('write-dist-files', async (event, files) => {
  const overrideDir = path.join(app.getPath('userData'), 'dist-override')
  try {
    // 1. Clean up old override directory
    if (fs.existsSync(overrideDir)) {
      fs.rmSync(overrideDir, { recursive: true, force: true })
    }
    fs.mkdirSync(overrideDir, { recursive: true })

    // 2. Write files one by one
    for (const file of files) {
      const filePath = path.join(overrideDir, file.relativePath)
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, Buffer.from(file.data))
    }
    console.log('[Update] Wrote', files.length, 'files to:', overrideDir)

    // 3. Verify index.html exists
    const indexPath = path.join(overrideDir, 'index.html')
    if (!fs.existsSync(indexPath)) {
      throw new Error('index.html not found, update package may be incomplete')
    }

    // 4. Load new version directly (no restart needed)
    if (mainWindow) {
      console.log('[Update] Loading new version:', indexPath)
      await mainWindow.loadFile(indexPath)
    }

    console.log('[Update] Hot update applied successfully')
    return true
  } catch (err) {
    console.error('[Update] Hot update failed:', err)
    try {
      if (fs.existsSync(overrideDir)) fs.rmSync(overrideDir, { recursive: true, force: true })
    } catch (_) {}
    return false
  }
})

/**
 * Get dynamically allocated service ports
 */
ipcMain.handle('get-service-ports', async (event) => {
  console.log('IPC: get-service-ports called, returning:', allocatedPorts)
  return {
    dbServer: allocatedPorts.dbServer,
    ipfsApi: allocatedPorts.ipfsApi,
    ipfsGateway: allocatedPorts.ipfsGateway,
    ipfsSwarm: allocatedPorts.ipfsSwarm,
    platform: process.platform,
    arch: process.arch,
  }
})

// ==================== Safe Storage IPC Handlers ====================

/**
 * Get the directory for safe storage files
 */
function getSafeStorageDir() {
  const dir = path.join(app.getPath('userData'), 'secure-data')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * Get the directory for non-sensitive app data files
 */
function getAppDataDir() {
  const dir = path.join(app.getPath('userData'), 'app-data')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

// Sensitive keys that use OS-level encryption via safeStorage
const SENSITIVE_KEYS = ['redpill_wallets', 'redpill_encrypted_password']

/**
 * Check if safeStorage encryption is available
 */
ipcMain.handle('safe-storage-available', () => {
  return safeStorage.isEncryptionAvailable()
})

/**
 * Store data securely
 * - Sensitive keys: encrypted with safeStorage (OS-level encryption)
 * - Non-sensitive keys: stored as plain JSON files
 */
ipcMain.handle('safe-storage-set', (event, key, value) => {
  try {
    const jsonStr = JSON.stringify(value)

    if (SENSITIVE_KEYS.includes(key)) {
      // Encrypt with OS-level safeStorage
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Safe storage encryption is not available')
      }
      const encrypted = safeStorage.encryptString(jsonStr)
      const filePath = path.join(getSafeStorageDir(), `${key}.enc`)
      fs.writeFileSync(filePath, encrypted)
    } else {
      // Non-sensitive: plain JSON file
      const filePath = path.join(getAppDataDir(), `${key}.json`)
      fs.writeFileSync(filePath, jsonStr, 'utf-8')
    }
    return true
  } catch (err) {
    console.error(`safe-storage-set error for key "${key}":`, err.message)
    return false
  }
})

/**
 * Retrieve stored data
 * - Sensitive keys: decrypted with safeStorage
 * - Non-sensitive keys: read from plain JSON files
 */
ipcMain.handle('safe-storage-get', (event, key) => {
  try {
    if (SENSITIVE_KEYS.includes(key)) {
      const filePath = path.join(getSafeStorageDir(), `${key}.enc`)
      if (!fs.existsSync(filePath)) return null
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Safe storage encryption is not available')
      }
      const encrypted = fs.readFileSync(filePath)
      const jsonStr = safeStorage.decryptString(encrypted)
      return JSON.parse(jsonStr)
    } else {
      const filePath = path.join(getAppDataDir(), `${key}.json`)
      if (!fs.existsSync(filePath)) return null
      const jsonStr = fs.readFileSync(filePath, 'utf-8')
      return JSON.parse(jsonStr)
    }
  } catch (err) {
    console.error(`safe-storage-get error for key "${key}":`, err.message)
    return null
  }
})

/**
 * Delete stored data
 */
ipcMain.handle('safe-storage-delete', (event, key) => {
  try {
    if (SENSITIVE_KEYS.includes(key)) {
      const filePath = path.join(getSafeStorageDir(), `${key}.enc`)
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    } else {
      const filePath = path.join(getAppDataDir(), `${key}.json`)
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    }
    return true
  } catch (err) {
    console.error(`safe-storage-delete error for key "${key}":`, err.message)
    return false
  }
})

console.log('IPC handlers registered successfully')
