import { google } from 'googleapis'
import type { calendar_v3 } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'

const SCOPES = ['https://www.googleapis.com/auth/calendar']

export type GCalClient = {
  calendar: calendar_v3.Calendar
  oauth: OAuth2Client
}

/**
 * Builds an authenticated googleapis Calendar client backed by a refresh token.
 * The OAuth2 client transparently refreshes the access token as needed.
 */
export function createGCalClient(args: {
  clientId: string
  clientSecret: string
  refreshToken: string
  redirectUri: string
}): GCalClient {
  const oauth = new google.auth.OAuth2(args.clientId, args.clientSecret, args.redirectUri)
  oauth.setCredentials({ refresh_token: args.refreshToken, scope: SCOPES.join(' ') })
  const calendar = google.calendar({ version: 'v3', auth: oauth })
  return { calendar, oauth }
}

export function isGoogleNotFound(err: unknown): boolean {
  const code = (err as { code?: number | string } | null)?.code
  return code === 404 || code === '404'
}

export function isGoogleGone(err: unknown): boolean {
  const code = (err as { code?: number | string } | null)?.code
  return code === 410 || code === '410'
}
