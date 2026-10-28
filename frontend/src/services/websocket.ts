import type { Message } from '@/types'
import { authService } from '@/services/auth'


const PING_INTERVAL_MS = 180_000


export const RECONNECT_BASE_DELAY_MS = 1_000
export const RECONNECT_MAX_DELAY_MS = 30_000

export interface WebSocketLocationLike {
  protocol: string
  host: string
}


export function buildWebSocketUrl(
  token: string,
  location: WebSocketLocationLike,
  baseUrl: string
): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const normalizedBase = baseUrl === '/'
    ? ''
    : `/${baseUrl.replace(/^\/+|\/+$/g, '')}`
  const encodedToken = encodeURIComponent(token)
  return `${scheme}//${location.host}${normalizedBase}/stream?token=${encodedToken}`
}





export function computeReconnectDelayMs(
  attempt: number,
  baseDelay: number = RECONNECT_BASE_DELAY_MS,
  maxDelay: number = RECONNECT_MAX_DELAY_MS
): number {
  return Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay)
}

export type WsConnectionState = 'disconnected' | 'connecting' | 'connected'

export class WebSocketService {
  private ws: WebSocket | null = null

  private token: string | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  private isManualClose = false
  private pingInterval: ReturnType<typeof setInterval> | null = null
  private messageHandlers: ((message: Message) => void)[] = []
  private connectionState: WsConnectionState = 'disconnected'
  private lastConnected: string | null = null
  private stateChangeHandlers: ((state: WsConnectionState) => void)[] = []

  constructor() {


    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.reconnect()
        }
      })
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.reconnect()
      })
    }
  }

  private setConnectionState(state: WsConnectionState) {
    this.connectionState = state
    this.stateChangeHandlers.forEach(handler => handler(state))
  }


  private startPing() {
    this.stopPing()
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.send('ping')
        } catch {

        }
      }
    }, PING_INTERVAL_MS)
  }


  private stopPing() {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
  }


  private clearReconnectTimer() {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  connect(token: string) {



    this.token = token
    this.isManualClose = false
    this.clearReconnectTimer()
    this.stopPing()


    if (this.ws) {
      this.ws.onopen = this.ws.onmessage = this.ws.onclose = this.ws.onerror = null
      try {
        this.ws.close()
      } catch {

      }
      this.ws = null
    }

    const wsUrl = buildWebSocketUrl(token, window.location, import.meta.env.BASE_URL)

    try {
      this.setConnectionState('connecting')
      this.ws = new WebSocket(wsUrl)

      this.ws.onopen = () => {
        this.reconnectAttempts = 0
        this.lastConnected = new Date().toISOString()
        this.setConnectionState('connected')
        this.startPing()
      }

      this.ws.onmessage = (event) => {

        if (event.data === 'pong') return
        try {
          const message: Message = JSON.parse(event.data)
          this.messageHandlers.forEach(handler => handler(message))
        } catch (error) {
          console.error('Error parsing WebSocket message:', error)
        }
      }

      this.ws.onclose = () => {
        this.stopPing()
        this.setConnectionState('disconnected')
        if (!this.isManualClose) {
          this.scheduleReconnect()
        }
      }

      this.ws.onerror = () => {
        this.stopPing()
        this.setConnectionState('disconnected')
      }
    } catch (error) {
      console.error('Failed to connect WebSocket:', error)
      this.setConnectionState('disconnected')
      this.scheduleReconnect()
    }
  }

  connectWithStoredToken() {
    const info = authService.getToken('client')
    if (!info?.token) return false
    this.connect(info.token)
    return true
  }






  reconnect() {
    if (!this.token || this.isManualClose || this.connectionState === 'connected') {
      return
    }
    this.reconnectAttempts = 0
    this.clearReconnectTimer()
    this.connect(this.token)
  }

  private scheduleReconnect() {
    if (this.isManualClose) return


    if (authService.getClientCredentialForRevocation() === null) {
      this.setConnectionState('disconnected')
      return
    }

    if (this.reconnectTimer !== null) return

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++
      const delay = computeReconnectDelayMs(this.reconnectAttempts)
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null
        if (this.token && authService.getClientCredentialForRevocation() !== null) {
          this.connect(this.token)
        }
      }, delay)
    }

  }

  disconnect() {
    this.isManualClose = true
    this.clearReconnectTimer()
    this.stopPing()
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.token = null
    this.messageHandlers = []
  }

  onMessage(handler: (message: Message) => void) {
    this.messageHandlers.push(handler)
  }

  offMessage(handler: (message: Message) => void) {
    const index = this.messageHandlers.indexOf(handler)
    if (index > -1) {
      this.messageHandlers.splice(index, 1)
    }
  }

  onStateChange(handler: (state: WsConnectionState) => void) {
    this.stateChangeHandlers.push(handler)

    handler(this.connectionState)
  }

  offStateChange(handler: (state: WsConnectionState) => void) {
    const index = this.stateChangeHandlers.indexOf(handler)
    if (index > -1) {
      this.stateChangeHandlers.splice(index, 1)
    }
  }

  isConnected(): boolean {
    return this.connectionState === 'connected'
  }

  getConnectionState(): WsConnectionState {
    return this.connectionState
  }

  getLastConnected(): string | null {
    return this.lastConnected
  }
}

export const wsService = new WebSocketService()
