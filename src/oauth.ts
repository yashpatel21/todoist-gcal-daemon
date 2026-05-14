import http from 'node:http'
import { URL } from 'node:url'
import { google } from 'googleapis'
import { loadConfig } from './config.js'
import { log, setLogLevel } from './logger.js'

const SCOPES = ['https://www.googleapis.com/auth/calendar']

/**
 * One-shot OAuth bootstrap: spins up a localhost callback server, prints a consent URL,
 * exchanges the returned code for a refresh token, prints the token, and exits.
 *
 * Designed for container workflows: the user pastes the printed token into
 * `GOOGLE_REFRESH_TOKEN` and restarts. The daemon will then skip this bootstrap
 * and go straight into the sync loop.
 */
export async function runOAuthBootstrap(): Promise<string> {
	const config = loadConfig()
	setLogLevel(config.daemon.logLevel)

	const oauth2Client = new google.auth.OAuth2(
		config.google.clientId,
		config.google.clientSecret,
		config.google.redirectUri,
	)

	const redirect = new URL(config.google.redirectUri)
	if (redirect.protocol !== 'http:' && redirect.protocol !== 'https:') {
		throw new Error(`Unsupported redirect URI protocol: ${redirect.protocol}`)
	}
	const host = redirect.hostname || 'localhost'
	const port = redirect.port ? Number(redirect.port) : redirect.protocol === 'https:' ? 443 : 80
	const callbackPath = redirect.pathname || '/'

	const authUrl = oauth2Client.generateAuthUrl({
		access_type: 'offline',
		prompt: 'consent',
		scope: SCOPES,
	})

	log.info('Starting OAuth bootstrap server', { host, port, callbackPath })
	log.info('Open this URL in a browser to authorize:')
	log.info(authUrl)

	const code = await waitForCode({ host, port, callbackPath })
	log.info('Received authorization code; exchanging for tokens')

	const { tokens } = await oauth2Client.getToken(code)
	if (!tokens.refresh_token) {
		throw new Error(
			'Google did not return a refresh_token. ' +
				'This usually means the user has previously authorized the app. ' +
				'Revoke access at https://myaccount.google.com/permissions and retry.',
		)
	}

	return tokens.refresh_token
}

type WaitForCodeArgs = { host: string; port: number; callbackPath: string }

function waitForCode(args: WaitForCodeArgs): Promise<string> {
	const { host, port, callbackPath } = args

	return new Promise((resolve, reject) => {
		const server = http.createServer((req, res) => {
			try {
				if (!req.url) {
					res.writeHead(400).end('Bad request')
					return
				}
				const reqUrl = new URL(req.url, `http://${req.headers.host ?? `${host}:${port}`}`)
				if (reqUrl.pathname !== callbackPath) {
					res.writeHead(404).end('Not found')
					return
				}
				const err = reqUrl.searchParams.get('error')
				if (err) {
					res.writeHead(400, { 'Content-Type': 'text/html' })
					res.end(`<h1>OAuth error</h1><pre>${escapeHtml(err)}</pre>`)
					server.close()
					reject(new Error(`OAuth error from Google: ${err}`))
					return
				}
				const code = reqUrl.searchParams.get('code')
				if (!code) {
					res.writeHead(400).end('Missing code')
					return
				}
				res.writeHead(200, { 'Content-Type': 'text/html' })
				res.end(
					'<h1>Authorization complete</h1>' +
						'<p>You can close this tab and return to the terminal.</p>',
				)
				server.close()
				resolve(code)
			} catch (e) {
				try {
					res.writeHead(500).end('Internal error')
				} catch {
					/* response may already be sent */
				}
				server.close()
				reject(e instanceof Error ? e : new Error(String(e)))
			}
		})

		server.on('error', reject)
		server.listen(port, host, () => {
			log.debug('OAuth callback server listening')
		})
	})
}

function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => {
		switch (c) {
			case '&':
				return '&amp;'
			case '<':
				return '&lt;'
			case '>':
				return '&gt;'
			case '"':
				return '&quot;'
			case "'":
				return '&#39;'
			default:
				return c
		}
	})
}

// Allow running this file directly: `tsx src/oauth.ts`
const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
	runOAuthBootstrap()
		.then((refreshToken) => {
			console.log('')
			console.log('================ GOOGLE_REFRESH_TOKEN ================')
			console.log(refreshToken)
			console.log('======================================================')
			console.log('')
			console.log('Add this value to your environment as GOOGLE_REFRESH_TOKEN,')
			console.log('then restart the daemon. It will skip the OAuth bootstrap')
			console.log('and proceed directly to the sync loop.')
			process.exit(0)
		})
		.catch((err) => {
			console.error('OAuth bootstrap failed:', err instanceof Error ? err.message : err)
			process.exit(1)
		})
}
