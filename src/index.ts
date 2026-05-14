import { ConfigError, loadConfig } from './config.js'
import { log, setLogLevel } from './logger.js'
import { runOAuthBootstrap } from './oauth.js'
import { runDaemon } from './sync/loop.js'

async function main(): Promise<void> {
  let config
  try {
    config = loadConfig()
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error('Configuration error:', e.message)
      process.exit(2)
    }
    throw e
  }
  setLogLevel(config.daemon.logLevel)

  if (!config.google.refreshToken) {
    log.warn('GOOGLE_REFRESH_TOKEN is not set; entering one-shot OAuth bootstrap')
    const refreshToken = await runOAuthBootstrap()
    console.log('')
    console.log('================ GOOGLE_REFRESH_TOKEN ================')
    console.log(refreshToken)
    console.log('======================================================')
    console.log('')
    console.log('Add this value to your environment as GOOGLE_REFRESH_TOKEN,')
    console.log('then restart the daemon.')
    process.exit(0)
  }

  const handle = await runDaemon(config)

  const shutdown = async (signal: string): Promise<void> => {
    log.info('Received signal; shutting down', { signal })
    try {
      await handle.stop()
    } finally {
      process.exit(0)
    }
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((err) => {
  console.error('Fatal error:', err instanceof Error ? err.stack ?? err.message : err)
  process.exit(1)
})
