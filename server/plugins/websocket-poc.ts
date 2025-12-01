/**
 * WebSocket POC Server Plugin for Nitro
 *
 * 功能說明：
 * - 建立 WebSocket 伺服器，用於 POC2 測試
 * - 支援多客戶端連線管理
 * - 提供訊息回送功能
 * - 在 Nitro 中建立 WebSocket 伺服器，提供本地 WebSocket 服務
 * - 支援斷線模擬功能，用於測試重連機制
 *
 * 使用方式：
 * - 伺服器會在 8080 port 啟動 WebSocket 服務
 * - 前端可以透過 ws://localhost:8080 連線
 * - 支援即時訊息傳遞和狀態監控
 * - 提供斷線模擬 API 用於測試
 */

import type { AudioStreamMessage } from '~/service/schema/audioStream'
import { WebSocket, WebSocketServer } from 'ws'

// 斷線模擬器
class DisconnectionSimulator {
  private isSimulatingDisconnection = false
  private disconnectionTimer?: NodeJS.Timeout
  private reconnectionTimer?: NodeJS.Timeout
  private clientManager?: ClientManager

  constructor(clientManager?: ClientManager) {
    this.clientManager = clientManager
  }

  // 模擬定時斷線（開始錄音後N秒斷線）
  scheduleDisconnection(delayMs: number, durationMs?: number): void {
    console.log(`[DisconnectionSim] 🕐 排程斷線：${delayMs}ms 後斷線，持續 ${durationMs || '永久'}ms`)

    this.disconnectionTimer = setTimeout(() => {
      this.simulateDisconnection()

      if (durationMs && durationMs > 0) {
        this.scheduleReconnection(durationMs)
      }
    }, delayMs)
  }

  // 立即模擬斷線
  simulateDisconnection(): void {
    if (this.isSimulatingDisconnection) {
      console.log(`[DisconnectionSim] ⚠️ 已在模擬斷線狀態中`)
      return
    }

    console.log(`[DisconnectionSim] 🚨 開始模擬斷線：強制斷開所有客戶端連線`)
    this.isSimulatingDisconnection = true

    if (this.clientManager) {
      this.clientManager.forceDisconnectAll('模擬斷線測試')
    }
  }

  // 恢復連線能力
  scheduleReconnection(durationMs: number): void {
    console.log(`[DisconnectionSim] 🔄 排程重連：${durationMs}ms 後恢復連線`)

    this.reconnectionTimer = setTimeout(() => {
      this.restoreConnection()
    }, durationMs)
  }

  // 恢復連線
  restoreConnection(): void {
    if (!this.isSimulatingDisconnection) {
      console.log(`[DisconnectionSim] ⚠️ 沒有在模擬斷線狀態`)
      return
    }

    console.log(`[DisconnectionSim] ✅ 恢復連線：允許新客戶端連接`)
    this.isSimulatingDisconnection = false

    // 通知客戶端管理器恢復連線已可用
    if (this.clientManager) {
      console.log(`[DisconnectionSim] 📡 通知客戶端管理器：連線已恢復`)
    }
  }

  // 手動停止模擬
  stopSimulation(): void {
    if (this.disconnectionTimer) {
      clearTimeout(this.disconnectionTimer)
      this.disconnectionTimer = undefined
    }

    if (this.reconnectionTimer) {
      clearTimeout(this.reconnectionTimer)
      this.reconnectionTimer = undefined
    }

    this.isSimulatingDisconnection = false
    console.log(`[DisconnectionSim] 🛑 停止斷線模擬`)
  }

  // 檢查是否應該自動恢復（當沒有客戶端時）
  checkAutoRestore(): void {
    if (this.isSimulatingDisconnection && this.clientManager && !this.clientManager.hasActiveConnections()) {
      // 如果正在模擬斷線但沒有任何客戶端，則考慮自動恢復
      console.log(`[DisconnectionSim] 🤔 檢測到無客戶端連線，考慮自動恢復...`)

      // 設定30秒後自動恢復的計時器（避免意外恢復）
      setTimeout(() => {
        if (this.isSimulatingDisconnection && this.clientManager && !this.clientManager.hasActiveConnections()) {
          console.log(`[DisconnectionSim] 🔄 無客戶端連線30秒，自動恢復連線能力`)
          this.restoreConnection()
        }
      }, 30000)
    }
  }

  // 檢查是否在模擬斷線
  isDisconnectionActive(): boolean {
    return this.isSimulatingDisconnection
  }

  // 獲取狀態
  getStatus() {
    return {
      isSimulating: this.isSimulatingDisconnection,
      hasScheduledDisconnection: !!this.disconnectionTimer,
      hasScheduledReconnection: !!this.reconnectionTimer,
    }
  }
}

// 斷線模擬 API 路由
interface SimulationCommand {
  action: 'schedule' | 'immediate' | 'restore' | 'stop' | 'status'
  delayMs?: number
  durationMs?: number
}

// 客戶端介面定義
interface Client {
  id: string
  ws: WebSocket
  ip: string
  connectTime: Date
  lastPong: Date
  taskId?: string // 新增：任務代碼
  isReconnection?: boolean // 新增：是否為重連
  audioChunks?: Map<string, { chunk: AudioStreamMessage, receivedAt: Date }> // 音訊塊緩存
}

// 伺服器統計資料
interface ServerStats {
  totalConnections: number
  currentConnections: number
  messagesReceived: number
  messagesSent: number
  startTime: Date
}

// 訊息類型定義
interface Message {
  type: string
  data: any
  timestamp: string
  clientId?: string
}

// 任務管理器
class TaskManager {
  private tasks = new Map<string, {
    taskId: string
    clientId: string
    createTime: Date
    lastActivity: Date
    status: 'active' | 'suspended' | 'completed'
  }>()

  // 產生新任務代碼
  generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  }

  // 創建新任務
  createTask(clientId: string): string {
    const taskId = this.generateTaskId()
    this.tasks.set(taskId, {
      taskId,
      clientId,
      createTime: new Date(),
      lastActivity: new Date(),
      status: 'active',
    })
    console.log(`[Task] 創建新任務 ${taskId} for ${clientId}`)
    return taskId
  }

  // 恢復現有任務
  resumeTask(taskId: string, newClientId: string): boolean {
    const task = this.tasks.get(taskId)
    if (task && task.status === 'suspended') {
      task.clientId = newClientId
      task.lastActivity = new Date()
      task.status = 'active'
      console.log(`[Task] 恢復任務 ${taskId} with ${newClientId}`)
      return true
    }
    return false
  }

  // 暫停任務（客戶端斷線時）
  suspendTask(taskId: string): void {
    const task = this.tasks.get(taskId)
    if (task) {
      task.status = 'suspended'
      console.log(`[Task] 暫停任務 ${taskId}`)
    }
  }

  // 檢查任務是否存在且可恢復
  isTaskResumable(taskId: string): boolean {
    const task = this.tasks.get(taskId)
    return task !== undefined && task.status === 'suspended'
  }

  // 清理過期任務（超過1小時的暫停任務）
  cleanupExpiredTasks(): void {
    const now = Date.now()
    for (const [taskId, task] of this.tasks) {
      if (task.status === 'suspended' && (now - task.lastActivity.getTime()) > 3600000) {
        this.tasks.delete(taskId)
        console.log(`[Task] 清理過期任務 ${taskId}`)
      }
    }
  }

  // 獲取任務統計
  getTaskStats() {
    const stats = { active: 0, suspended: 0, total: this.tasks.size }
    for (const task of this.tasks.values()) {
      if (task.status === 'active')
        stats.active++
      if (task.status === 'suspended')
        stats.suspended++
    }
    return stats
  }
}

// 客戶端管理器
class ClientManager {
  private clients = new Map<string, Client>()
  private taskManager = new TaskManager()
  private stats: ServerStats = {
    totalConnections: 0,
    currentConnections: 0,
    messagesReceived: 0,
    messagesSent: 0,
    startTime: new Date(),
  }

  // 新增客戶端 - 支援任務管理
  addClient(ws: WebSocket, ip: string, reconnectionTaskId?: string): { clientId: string, taskId: string, isReconnection: boolean } {
    const clientId = this.generateClientId()
    let taskId: string
    let isReconnection = false

    // 檢查是否為重連
    if (reconnectionTaskId && this.taskManager.isTaskResumable(reconnectionTaskId)) {
      taskId = reconnectionTaskId
      isReconnection = true
      this.taskManager.resumeTask(taskId, clientId)
    }
    else {
      taskId = this.taskManager.createTask(clientId)
    }

    const client: Client = {
      id: clientId,
      ws,
      ip,
      connectTime: new Date(),
      lastPong: new Date(),
      taskId,
      isReconnection,
      audioChunks: new Map(),
    }

    this.clients.set(clientId, client)
    this.stats.totalConnections++
    this.stats.currentConnections++

    console.log(`[WebSocket] ${isReconnection ? '重新' : '新'}連線 ${clientId} (Task: ${taskId}) from ${ip}`)
    console.log(`[WebSocket] 目前連線數: ${this.stats.currentConnections}`)

    return { clientId, taskId, isReconnection }
  }

  // 移除客戶端 - 支援任務暫停
  removeClient(clientId: string): void {
    const client = this.clients.get(clientId)
    if (client) {
      // 暫停任務而不是刪除
      if (client.taskId) {
        this.taskManager.suspendTask(client.taskId)
      }

      this.clients.delete(clientId)
      this.stats.currentConnections--

      const duration = Date.now() - client.connectTime.getTime()
      console.log(`[WebSocket] 客戶端 ${clientId} 斷線 (Task: ${client.taskId})，連線時間: ${Math.round(duration / 1000)}秒`)
      console.log(`[WebSocket] 目前連線數: ${this.stats.currentConnections}`)
    }
  }

  // 取得客戶端
  getClient(clientId: string): Client | undefined {
    return this.clients.get(clientId)
  }

  // 取得所有客戶端
  getAllClients(): Client[] {
    return Array.from(this.clients.values())
  }

  // 更新統計
  incrementMessageReceived(): void {
    this.stats.messagesReceived++
  }

  incrementMessageSent(): void {
    this.stats.messagesSent++
  }

  // 取得統計資料
  getStats(): ServerStats {
    return { ...this.stats }
  }

  // 產生客戶端ID
  private generateClientId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  }

  // 更新客戶端 pong 時間
  updateClientPong(clientId: string): void {
    const client = this.clients.get(clientId)
    if (client) {
      client.lastPong = new Date()
    }
  }

  // 定期清理過期任務
  cleanupTasks(): void {
    this.taskManager.cleanupExpiredTasks()
  }

  // 獲取任務統計
  getTaskStats() {
    return this.taskManager.getTaskStats()
  }

  // 強制斷開所有客戶端連線（用於模擬斷線）
  forceDisconnectAll(reason: string = '伺服器模擬斷線'): void {
    const clients = Array.from(this.clients.values())
    console.log(`[WebSocket] 🚨 強制斷開所有連線 (${clients.length} 個客戶端)，原因: ${reason}`)

    clients.forEach((client) => {
      try {
        // 發送斷線通知
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(JSON.stringify({
            type: 'server_disconnect',
            data: { reason },
            timestamp: new Date().toISOString(),
          }))
        }

        // 強制關閉 WebSocket 連線
        client.ws.terminate()

        // 從管理器中移除（這會觸發任務暫停）
        this.removeClient(client.id)
      }
      catch (error) {
        console.error(`[WebSocket] 強制斷線客戶端 ${client.id} 時發生錯誤:`, error)
      }
    })

    console.log(`[WebSocket] ✅ 所有客戶端已強制斷線`)
  }

  // 檢查是否有活躍連線
  hasActiveConnections(): boolean {
    return this.clients.size > 0
  }

  // 獲取連線數量
  getConnectionCount(): number {
    return this.clients.size
  }
}

// WebSocket 伺服器管理器
class WebSocketServerManager {
  private wss: WebSocketServer | null = null
  private clientManager = new ClientManager()
  private heartbeatInterval: NodeJS.Timeout | null = null
  private disconnectionSimulator: DisconnectionSimulator

  constructor() {
    this.disconnectionSimulator = new DisconnectionSimulator(this.clientManager)
  }

  // 重置斷線模擬狀態（用於緊急重置）
  resetDisconnectionSimulation(): void {
    console.log('[WebSocket] 🚨 執行緊急重置斷線模擬狀態')
    this.disconnectionSimulator.stopSimulation()
  }

  // 檢查是否有重置請求
  checkResetRequest(): void {
    try {
      // 動態導入重置 API 來檢查標記
      import('../api/websocket-reset.post').then((module) => {
        if (module.getNeedReset && module.getNeedReset()) {
          console.log('[WebSocket] 🔄 檢測到重置請求，執行重置')
          this.resetDisconnectionSimulation()
          if (module.clearResetFlag) {
            module.clearResetFlag()
          }
        }
      }).catch(() => {
        // 忽略導入錯誤
      })
    }
    catch {
      // 忽略錯誤
    }
  }

  // 啟動 WebSocket 伺服器
  start(port: number = 8080): void {
    if (this.wss) {
      console.log('[WebSocket] 伺服器已經在運行中')
      return
    }

    try {
      // 重置斷線模擬狀態
      if (this.disconnectionSimulator.isDisconnectionActive()) {
        console.log('[WebSocket] 🔄 服務器啟動時重置斷線模擬狀態')
        this.disconnectionSimulator.stopSimulation()
      }

      this.wss = new WebSocketServer({ port })

      console.log(`[WebSocket] 伺服器啟動在 port ${port}`)
      console.log(`[WebSocket] 可以透過 ws://localhost:${port} 連線`)

      // 處理新連線
      this.wss.on('connection', (ws: WebSocket, req: any) => {
        const ip = req.socket.remoteAddress || 'unknown'

        // 檢查是否有重置請求
        this.checkResetRequest()

        // 檢查是否正在模擬斷線狀態
        if (this.disconnectionSimulator.isDisconnectionActive()) {
          console.log(`[DisconnectionSim] 🚫 拒絕新連線 (${ip})，目前正在模擬斷線狀態`)
          ws.close(1013, '伺服器暫時不可用 - 模擬斷線中')
          return
        }

        // 解析 URL 參數獲取重連任務代碼
        const url = new URL(req.url || '', `http://${req.headers.host}`)
        const reconnectionTaskId = url.searchParams.get('taskId')

        const { clientId, taskId, isReconnection } = this.clientManager.addClient(ws, ip, reconnectionTaskId || undefined)

        // 發送連線建立訊息，包含任務代碼
        this.sendMessage(ws, {
          type: 'connection-established',
          data: {
            clientId,
            taskId,
            isReconnection,
            message: isReconnection ? '重新連線成功，任務已恢復' : '新連線建立，任務已創建',
            serverTime: new Date().toISOString(),
          },
          timestamp: new Date().toISOString(),
          clientId,
        })

        // 處理訊息
        ws.on('message', (data: any) => {
          this.handleMessage(clientId, data)
        })

        // 處理斷線
        ws.on('close', (code: number, reason: any) => {
          console.log(`[WebSocket] 客戶端 ${clientId} 斷線，代碼: ${code}, 原因: ${reason}`)
          this.clientManager.removeClient(clientId)
        })

        // 處理錯誤
        ws.on('error', (error: Error) => {
          console.error(`[WebSocket] 客戶端 ${clientId} 發生錯誤:`, error)
          this.clientManager.removeClient(clientId)
        })

        // 處理 pong
        ws.on('pong', () => {
          this.clientManager.updateClientPong(clientId)
        })
      })

      // 啟動心跳檢測
      this.startHeartbeat()

      // 啟動任務清理定時器
      setInterval(() => {
        this.clientManager.cleanupTasks()
      }, 600000) // 每10分鐘清理一次

      // 伺服器錯誤處理
      this.wss.on('error', (error: Error) => {
        console.error('[WebSocket] 伺服器錯誤:', error)
      })
    }
    catch (error) {
      console.error('[WebSocket] 啟動伺服器失敗:', error)
    }
  }

  // 處理收到的訊息
  private handleMessage(clientId: string, data: any): void {
    this.clientManager.incrementMessageReceived()

    try {
      const message = JSON.parse(data.toString())
      console.log(`[WebSocket] 收到來自 ${clientId} 的訊息:`, message)

      const client = this.clientManager.getClient(clientId)
      if (!client) {
        console.error(`[WebSocket] 找不到客戶端 ${clientId}`)
        return
      }

      // 根據訊息類型處理
      switch (message.type) {
        case 'ping':
          this.handlePing(client, message)
          break
        case 'frontend-heartbeat-ping':
          this.handleFrontendHeartbeat(client, message)
          break
        case 'echo':
          this.handleEcho(client, message)
          break
        case 'stats':
          this.handleStatsRequest(client)
          break
        case 'audio-stream':
          this.handleAudioStream(client, message)
          break
        case 'audio-chunk':
          this.handleAudioChunk(client, message)
          break
        case 'disconnection_simulation':
          this.handleDisconnectionSimulation(client, message)
          break
        default:
          this.handleGenericMessage(client, message)
      }
    }
    catch (error) {
      console.error(`[WebSocket] 解析訊息失敗 from ${clientId}:`, error)
      const client = this.clientManager.getClient(clientId)
      if (client) {
        this.sendMessage(client.ws, {
          type: 'error',
          data: { message: '訊息格式錯誤' },
          timestamp: new Date().toISOString(),
          clientId,
        })
      }
    }
  }

  // 處理 ping
  private handlePing(client: Client, message: Message): void {
    this.sendMessage(client.ws, {
      type: 'pong',
      data: {
        originalTimestamp: message.timestamp,
        serverTimestamp: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
      clientId: client.id,
    })
  }

  // 處理前端心跳檢測
  private handleFrontendHeartbeat(client: Client, message: Message): void {
    console.log(`💓 [WebSocket] 收到來自 ${client.id} 的前端心跳`)

    const messageTimestamp = Number(message.timestamp) || Date.now()
    const roundTripTime = Date.now() - messageTimestamp

    this.sendMessage(client.ws, {
      type: 'frontend-heartbeat-pong',
      data: {
        originalTimestamp: message.timestamp,
        serverTimestamp: new Date().toISOString(),
        clientId: message.data?.clientId,
        roundTripTime,
      },
      timestamp: new Date().toISOString(),
      clientId: client.id,
    })

    // 更新客戶端活動時間
    this.clientManager.updateClientPong(client.id)
  }

  // 處理回音
  private handleEcho(client: Client, message: Message): void {
    this.sendMessage(client.ws, {
      type: 'echo-response',
      data: {
        original: message.data,
        echoed: `伺服器回音: ${message.data}`,
        receivedAt: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
      clientId: client.id,
    })
  }

  // 處理統計請求
  private handleStatsRequest(client: Client): void {
    const stats = this.clientManager.getStats()
    const allClients = this.clientManager.getAllClients()

    this.sendMessage(client.ws, {
      type: 'stats-response',
      data: {
        server: stats,
        clients: allClients.map(c => ({
          id: c.id,
          ip: c.ip,
          connectTime: c.connectTime,
          lastPong: c.lastPong,
        })),
      },
      timestamp: new Date().toISOString(),
      clientId: client.id,
    })
  }

  // 處理音訊流消息
  private handleAudioStream(client: Client, message: Message): void {
    try {
      const audioMessage = message.data as AudioStreamMessage
      const audioData = audioMessage.data

      console.log(`[WebSocket] 收到音訊流消息 from ${client.id}:`, {
        chunkId: audioData.chunkId,
        sequence: audioData.sequenceNumber,
        isLastChunk: audioData.isLast,
        dataSize: audioData.audioData?.length || 0,
        timestamp: audioData.timestamp,
      })

      // 緩存音訊塊
      if (!client.audioChunks) {
        client.audioChunks = new Map()
      }
      client.audioChunks.set(audioData.chunkId, {
        chunk: audioMessage,
        receivedAt: new Date(),
      })

      // 發送 ACK 確認（符合 AckMessage schema）
      const ackMessage = {
        type: 'ack',
        data: {
          chunkId: audioData.chunkId,
          sequenceNumber: audioData.sequenceNumber,
          status: 'received',
          timestamp: Date.now(),
        },
        taskId: client.taskId,
        timestamp: new Date().toISOString(),
        clientId: client.id,
      }

      this.sendMessage(client.ws, ackMessage)

      // 如果是最後一個塊，進行處理
      if (audioData.isLast) {
        this.processCompleteAudioStream(client, audioMessage.taskId || 'default')
      }
    }
    catch (error) {
      console.error(`[WebSocket] 處理音訊流消息失敗 from ${client.id}:`, error)

      const errorAckMessage = {
        type: 'ack',
        data: {
          chunkId: message.data?.chunkId || 'unknown',
          sequenceNumber: 0,
          status: 'error',
          timestamp: Date.now(),
          errorMessage: '音訊消息處理失敗',
        },
        taskId: client.taskId,
        timestamp: new Date().toISOString(),
        clientId: client.id,
      }

      this.sendMessage(client.ws, errorAckMessage)
    }
  }

  // 處理完整音訊流
  private processCompleteAudioStream(client: Client, streamId: string): void {
    if (!client.audioChunks)
      return

    const streamChunks = Array.from(client.audioChunks.values())
      .filter(item => item.chunk.taskId === streamId)
      .sort((a, b) => a.chunk.data.sequenceNumber - b.chunk.data.sequenceNumber)

    console.log(`[WebSocket] 處理完整音訊流 ${streamId}，共 ${streamChunks.length} 個塊`)

    // 這裡可以添加實際的音訊處理邏輯
    // 例如：合併音訊塊、語音識別、儲存等

    // 發送處理完成通知
    this.sendMessage(client.ws, {
      type: 'audio-stream-complete',
      data: {
        streamId,
        totalChunks: streamChunks.length,
        processedAt: new Date().toISOString(),
        status: 'completed',
      },
      timestamp: new Date().toISOString(),
      clientId: client.id,
    })
  }

  // 處理音頻塊（為未來音頻功能預留）
  private handleAudioChunk(client: Client, message: Message): void {
    console.log(`[WebSocket] 收到音頻塊 from ${client.id}, 大小: ${message.data?.size || 'unknown'}`)

    this.sendMessage(client.ws, {
      type: 'audio-chunk-ack',
      data: {
        received: true,
        chunkId: message.data?.chunkId,
        size: message.data?.size,
      },
      timestamp: new Date().toISOString(),
      clientId: client.id,
    })
  }

  // 處理斷線模擬請求
  private handleDisconnectionSimulation(client: Client, message: Message): void {
    try {
      const command = message.data as SimulationCommand
      console.log(`[DisconnectionSim] 收到來自 ${client.id} 的模擬命令:`, command)

      const result = this._handleSimulationCommand(this.disconnectionSimulator, command)

      // 回傳執行結果
      this.sendMessage(client.ws, {
        type: 'disconnection_simulation_response',
        data: result,
        timestamp: new Date().toISOString(),
        clientId: client.id,
      })

      console.log(`[DisconnectionSim] 命令執行結果:`, result)
    }
    catch (error) {
      console.error(`[DisconnectionSim] 處理模擬命令失敗:`, error)

      this.sendMessage(client.ws, {
        type: 'disconnection_simulation_response',
        data: { success: false, message: `命令處理失敗: ${error}` },
        timestamp: new Date().toISOString(),
        clientId: client.id,
      })
    }
  }

  // 處理斷線模擬命令的內部方法
  private _handleSimulationCommand(simulator: DisconnectionSimulator, command: SimulationCommand) {
    switch (command.action) {
      case 'schedule':
        if (command.delayMs !== undefined) {
          simulator.scheduleDisconnection(command.delayMs, command.durationMs)
          return { success: true, message: `排程斷線：${command.delayMs}ms 後斷線${command.durationMs ? `，${command.durationMs}ms 後恢復` : ''}` }
        }
        return { success: false, message: '缺少 delayMs 參數' }

      case 'immediate':
        simulator.simulateDisconnection()
        return { success: true, message: '立即執行斷線' }

      case 'restore':
        simulator.restoreConnection()
        return { success: true, message: '恢復連線' }

      case 'stop':
        simulator.stopSimulation()
        return { success: true, message: '停止模擬' }

      case 'status':
        return { success: true, data: simulator.getStatus() }

      default:
        return { success: false, message: `未知命令: ${command.action}` }
    }
  }

  // 處理一般訊息
  private handleGenericMessage(client: Client, message: Message): void {
    this.sendMessage(client.ws, {
      type: 'message-response',
      data: {
        originalType: message.type,
        response: `伺服器已收到您的 ${message.type} 訊息`,
        data: message.data,
      },
      timestamp: new Date().toISOString(),
      clientId: client.id,
    })
  }

  // 發送訊息
  private sendMessage(ws: WebSocket, message: Message): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message))
      this.clientManager.incrementMessageSent()
    }
  }

  // 啟動心跳檢測
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const clients = this.clientManager.getAllClients()
      const now = Date.now()

      clients.forEach((client) => {
        // 檢查是否超過 30 秒沒有 pong
        if (now - client.lastPong.getTime() > 30000) {
          console.log(`[WebSocket] 客戶端 ${client.id} 心跳逾時，關閉連線`)
          client.ws.terminate()
          this.clientManager.removeClient(client.id)
        }
        else if (client.ws.readyState === WebSocket.OPEN) {
          // 發送 ping
          client.ws.ping()
        }
      })
    }, 10000) // 每 10 秒檢查一次
  }

  // 停止伺服器
  stop(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }

    if (this.wss) {
      console.log('[WebSocket] 正在關閉伺服器...')
      this.wss.close(() => {
        console.log('[WebSocket] 伺服器已關閉')
      })
      this.wss = null
    }
  }
}

// 建立全域 WebSocket 伺服器實例
const wsServerManager = new WebSocketServerManager()

// 導出給 API 使用
export { wsServerManager }

// Nitro 插件導出
export default async function () {
  console.log('[WebSocket Plugin] 初始化 WebSocket POC 插件')

  // 只在開發環境啟動 WebSocket 伺服器
  if (process.env.NODE_ENV === 'development') {
    wsServerManager.start(8080)
  }
}
