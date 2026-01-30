import type { Message } from '@/types'
import { authService } from '@/services/auth'

export class WebSocketService {
  private ws: WebSocket | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000
  private messageHandlers: ((message: Message) => void)[] = []
  private connectionState: 'disconnected' | 'connecting' | 'connected' = 'disconnected'
  private lastConnected: string | null = null
  private stateChangeHandlers: ((state: 'disconnected' | 'connecting' | 'connected') => void)[] = []

  private setConnectionState(state: 'disconnected' | 'connecting' | 'connected') {
    this.connectionState = state
    this.stateChangeHandlers.forEach(handler => handler(state))
  }

  connect(token: string) {
    // 根据API规范，WebSocket端点支持多种认证方式，但浏览器WebSocket API限制只能使用查询参数
    // 支持的认证方式：clientTokenQuery（当前实现）、clientTokenAuthorizationHeader（不支持）、
    // clientTokenHeader（不支持）、basicAuth（不支持）
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/stream?token=${encodeURIComponent(token)}`

    try {
      this.setConnectionState('connecting')
      this.ws = new WebSocket(wsUrl)

      this.ws.onopen = () => {
        console.log('WebSocket connected')
        this.reconnectAttempts = 0
        this.lastConnected = new Date().toISOString()
        this.setConnectionState('connected')
      }

      this.ws.onmessage = (event) => {
        try {
          const message: Message = JSON.parse(event.data)
          this.messageHandlers.forEach(handler => handler(message))
        } catch (error) {
          console.error('Error parsing WebSocket message:', error)
        }
      }

      this.ws.onclose = () => {
        console.log('WebSocket disconnected')
        this.setConnectionState('disconnected')
        this.attemptReconnect(token)
      }

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error)
        this.setConnectionState('disconnected')
      }
    } catch (error) {
      console.error('Failed to connect WebSocket:', error)
      this.setConnectionState('disconnected')
      this.attemptReconnect(token)
    }
  }

  connectWithStoredToken() {
    const info = authService.getToken('client')
    if (!info?.token) return false
    this.connect(info.token)
    return true
  }

  private attemptReconnect(token: string) {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++
      console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`)

      setTimeout(() => {
        this.connect(token)
      }, this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1))
    } else {
      console.error('Max reconnection attempts reached')
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
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

  onStateChange(handler: (state: 'disconnected' | 'connecting' | 'connected') => void) {
    this.stateChangeHandlers.push(handler)
    // 立即触发一次当前状态
    handler(this.connectionState)
  }

  offStateChange(handler: (state: 'disconnected' | 'connecting' | 'connected') => void) {
    const index = this.stateChangeHandlers.indexOf(handler)
    if (index > -1) {
      this.stateChangeHandlers.splice(index, 1)
    }
  }

  isConnected(): boolean {
    return this.connectionState === 'connected'
  }

  getConnectionState(): 'disconnected' | 'connecting' | 'connected' {
    return this.connectionState
  }

  getLastConnected(): string | null {
    return this.lastConnected
  }
}

export const wsService = new WebSocketService()
