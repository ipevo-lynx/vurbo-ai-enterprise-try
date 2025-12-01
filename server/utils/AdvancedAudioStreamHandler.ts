/**
 * Advanced WebSocket Audio Stream Server
 * 支援非線性音訊傳送、狀態查詢和補發機制
 */

import type {
  AckMessage,
  AudioStreamMessage,
  AudioStreamStatus,
  AudioStreamStatusResponse,
} from '~/service/schema/audioStream'
import { WebSocket, WebSocketServer } from 'ws'

// 音訊塊狀態
interface AudioChunkRecord {
  chunkId: string
  sequenceNumber: number
  audioData: string
  format: 'mp3' | 'wav' | 'webm'
  duration: number
  timestamp: number
  isLast: boolean
  receivedAt: Date
  processedAt?: Date
  status: 'received' | 'processed' | 'error'
  errorMessage?: string
  processingTime?: number
  metadata?: any
}

// 音訊流狀態
interface AudioStreamRecord {
  streamId: string
  taskId: string
  clientId: string
  chunks: Map<string, AudioChunkRecord>
  totalExpected?: number
  startedAt: Date
  completedAt?: Date
  isComplete: boolean
  lastSequence: number
  missingSequences: Set<number>
}

// 擴展客戶端介面
interface AdvancedClient {
  id: string
  ws: WebSocket
  ip: string
  connectTime: Date
  lastPong: Date
  taskId?: string
  audioStreams: Map<string, AudioStreamRecord> // 支援多個音訊流
}

/**
 * 進階音訊串流處理器
 */
export class AdvancedAudioStreamHandler {
  private clients = new Map<string, AdvancedClient>()
  private wss: WebSocketServer

  constructor(port: number = 8080) {
    this.wss = new WebSocketServer({ port })
    this.setupServer()
    console.log(`🎵 Advanced Audio Stream Server running on port ${port}`)
  }

  private setupServer() {
    this.wss.on('connection', (ws, req) => {
      const clientId = this.generateClientId()
      const client: AdvancedClient = {
        id: clientId,
        ws,
        ip: req.socket.remoteAddress || 'unknown',
        connectTime: new Date(),
        lastPong: new Date(),
        audioStreams: new Map(),
      }

      this.clients.set(clientId, client)
      console.log(`✅ Client ${clientId} connected from ${client.ip}`)

      ws.on('message', (data) => {
        this.handleMessage(client, data)
      })

      ws.on('close', () => {
        this.clients.delete(clientId)
        console.log(`❌ Client ${clientId} disconnected`)
      })

      ws.on('error', (error) => {
        console.error(`🚨 WebSocket error for client ${clientId}:`, error)
      })

      // 發送歡迎訊息
      this.sendMessage(ws, {
        type: 'connection_established',
        data: { clientId },
        timestamp: new Date().toISOString(),
      })
    })
  }

  private generateClientId(): string {
    return `client_${Math.random().toString(36).substr(2, 9)}`
  }

  private handleMessage(client: AdvancedClient, data: any) {
    try {
      const message = JSON.parse(data.toString())

      switch (message.type) {
        case 'audio_stream':
          this.handleAudioStream(client, message as AudioStreamMessage)
          break
        case 'audio_status':
          this.handleStatusQuery(client, message as AudioStreamStatus)
          break
        default:
          console.log(`📨 Received message from ${client.id}:`, message.type)
      }
    }
    catch (error) {
      console.error(`❌ Failed to parse message from ${client.id}:`, error)
    }
  }

  /**
   * 處理音訊流（支援非線性接收）
   */
  private handleAudioStream(client: AdvancedClient, message: AudioStreamMessage) {
    try {
      const audioData = message.data
      const taskId = message.taskId || 'default'

      console.log(`🎵 Received audio chunk from ${client.id}:`, {
        chunkId: audioData.chunkId,
        sequence: audioData.sequenceNumber,
        taskId,
        isLast: audioData.isLast,
        dataSize: audioData.audioData?.length || 0,
      })

      // 獲取或創建音訊流記錄
      const streamRecord = this.getOrCreateStream(client, taskId)

      // 檢查是否為重複的塊
      if (streamRecord.chunks.has(audioData.chunkId)) {
        console.log(`⚠️ Duplicate chunk received: ${audioData.chunkId}`)
        this.sendAck(client, audioData.chunkId, audioData.sequenceNumber, 'received', 'Duplicate chunk')
        return
      }

      // 創建音訊塊記錄
      const chunkRecord: AudioChunkRecord = {
        chunkId: audioData.chunkId,
        sequenceNumber: audioData.sequenceNumber,
        audioData: audioData.audioData,
        format: audioData.format,
        duration: audioData.duration,
        timestamp: audioData.timestamp,
        isLast: audioData.isLast,
        receivedAt: new Date(),
        status: 'received',
        metadata: audioData.metadata,
      }

      // 儲存音訊塊
      streamRecord.chunks.set(audioData.chunkId, chunkRecord)
      streamRecord.lastSequence = Math.max(streamRecord.lastSequence, audioData.sequenceNumber)

      // 更新遺失序列
      this.updateMissingSequences(streamRecord)

      // 立即發送 ACK 確認接收
      this.sendAck(client, audioData.chunkId, audioData.sequenceNumber, 'received')

      // 非同步處理音訊塊
      this.processAudioChunk(client, streamRecord, chunkRecord)

      // 如果是最後一個塊，檢查完整性
      if (audioData.isLast) {
        this.checkStreamCompleteness(client, streamRecord)
      }
    }
    catch (error) {
      console.error(`❌ Error handling audio stream from ${client.id}:`, error)
      this.sendAck(
        client,
        message.data?.chunkId || 'unknown',
        message.data?.sequenceNumber || 0,
        'error',
        'Processing failed',
      )
    }
  }

  /**
   * 獲取或創建音訊流記錄
   */
  private getOrCreateStream(client: AdvancedClient, taskId: string): AudioStreamRecord {
    let streamRecord = client.audioStreams.get(taskId)

    if (!streamRecord) {
      streamRecord = {
        streamId: `${client.id}_${taskId}`,
        taskId,
        clientId: client.id,
        chunks: new Map(),
        startedAt: new Date(),
        isComplete: false,
        lastSequence: 0,
        missingSequences: new Set(),
      }
      client.audioStreams.set(taskId, streamRecord)
    }

    return streamRecord
  }

  /**
   * 更新遺失的序列號
   */
  private updateMissingSequences(streamRecord: AudioStreamRecord) {
    const receivedSequences = Array.from(streamRecord.chunks.values())
      .map(chunk => chunk.sequenceNumber)
      .sort((a, b) => a - b)

    streamRecord.missingSequences.clear()

    for (let i = 1; i <= streamRecord.lastSequence; i++) {
      if (!receivedSequences.includes(i)) {
        streamRecord.missingSequences.add(i)
      }
    }
  }

  /**
   * 處理音訊塊（模擬處理時間）
   */
  private async processAudioChunk(
    client: AdvancedClient,
    streamRecord: AudioStreamRecord,
    chunkRecord: AudioChunkRecord,
  ) {
    try {
      const startTime = Date.now()

      // 模擬音訊處理（可以替換為實際的處理邏輯）
      await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200))

      const processingTime = Date.now() - startTime

      // 更新塊狀態
      chunkRecord.status = 'processed'
      chunkRecord.processedAt = new Date()
      chunkRecord.processingTime = processingTime

      // 發送處理完成 ACK
      this.sendAck(
        client,
        chunkRecord.chunkId,
        chunkRecord.sequenceNumber,
        'processed',
        undefined,
        processingTime,
      )

      console.log(`✅ Processed chunk ${chunkRecord.sequenceNumber} in ${processingTime}ms`)
    }
    catch (error) {
      console.error(`❌ Error processing chunk ${chunkRecord.chunkId}:`, error)
      chunkRecord.status = 'error'
      chunkRecord.errorMessage = String(error)

      this.sendAck(
        client,
        chunkRecord.chunkId,
        chunkRecord.sequenceNumber,
        'error',
        String(error),
      )
    }
  }

  /**
   * 檢查音訊流完整性
   */
  private checkStreamCompleteness(client: AdvancedClient, streamRecord: AudioStreamRecord) {
    const hasAllSequences = streamRecord.missingSequences.size === 0

    if (hasAllSequences) {
      streamRecord.isComplete = true
      streamRecord.completedAt = new Date()

      console.log(`🎯 Audio stream ${streamRecord.streamId} completed successfully with ${streamRecord.chunks.size} chunks`)

      // 發送完成通知
      this.sendMessage(client.ws, {
        type: 'audio_stream_complete',
        data: {
          streamId: streamRecord.streamId,
          taskId: streamRecord.taskId,
          totalChunks: streamRecord.chunks.size,
          processingTime: streamRecord.completedAt.getTime() - streamRecord.startedAt.getTime(),
        },
        timestamp: new Date().toISOString(),
      })
    }
    else {
      console.log(`⚠️ Audio stream ${streamRecord.streamId} incomplete. Missing sequences: ${Array.from(streamRecord.missingSequences)}`)

      // 發送遺失報告
      this.sendMessage(client.ws, {
        type: 'audio_stream_incomplete',
        data: {
          streamId: streamRecord.streamId,
          taskId: streamRecord.taskId,
          missingSequences: Array.from(streamRecord.missingSequences),
          receivedChunks: streamRecord.chunks.size,
        },
        timestamp: new Date().toISOString(),
      })
    }
  }

  /**
   * 處理狀態查詢
   */
  private handleStatusQuery(client: AdvancedClient, message: AudioStreamStatus) {
    const taskId = message.taskId || 'default'
    const streamRecord = client.audioStreams.get(taskId)

    if (!streamRecord) {
      // 發送空狀態回應
      const response: AudioStreamStatusResponse = {
        type: 'audio_status_response',
        data: {
          totalChunks: 0,
          receivedChunks: 0,
          processedChunks: 0,
          errorChunks: 0,
        },
        taskId,
      }

      this.sendMessage(client.ws, response)
      return
    }

    const chunks = Array.from(streamRecord.chunks.values())
    const processedChunks = chunks.filter(chunk => chunk.status === 'processed').length
    const errorChunks = chunks.filter(chunk => chunk.status === 'error').length

    // 準備塊狀態資訊
    let chunkStatuses: {
      chunkId: string
      sequenceNumber: number
      status: 'received' | 'processed' | 'error' | 'pending'
      timestamp: number
      errorMessage?: string
    }[] | undefined

    if (message.data.chunkIds && message.data.chunkIds.length > 0) {
      chunkStatuses = message.data.chunkIds
        .map((chunkId) => {
          const chunk = streamRecord.chunks.get(chunkId)
          return chunk
            ? {
                chunkId: chunk.chunkId,
                sequenceNumber: chunk.sequenceNumber,
                status: chunk.status as 'received' | 'processed' | 'error' | 'pending',
                timestamp: chunk.timestamp,
                errorMessage: chunk.errorMessage,
              }
            : null
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
    }

    const response: AudioStreamStatusResponse = {
      type: 'audio_status_response',
      data: {
        totalChunks: chunks.length,
        receivedChunks: chunks.length,
        processedChunks,
        errorChunks,
        chunkStatuses,
      },
      taskId,
    }

    this.sendMessage(client.ws, response)
    console.log(`📊 Sent status response for ${taskId}: ${chunks.length} total, ${processedChunks} processed`)
  }

  /**
   * 發送 ACK 確認
   */
  private sendAck(
    client: AdvancedClient,
    chunkId: string,
    sequenceNumber: number,
    status: 'received' | 'processed' | 'error',
    errorMessage?: string,
    processingTime?: number,
  ) {
    const ackMessage: AckMessage = {
      type: 'ack',
      data: {
        chunkId,
        sequenceNumber,
        status,
        timestamp: Date.now(),
        errorMessage,
        processingTime,
      },
      taskId: client.taskId,
    }

    this.sendMessage(client.ws, ackMessage)
  }

  /**
   * 發送訊息到客戶端
   */
  private sendMessage(ws: WebSocket, message: any) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message))
    }
  }

  /**
   * 獲取伺服器統計
   */
  getServerStats() {
    const totalStreams = Array.from(this.clients.values())
      .reduce((sum, client) => sum + client.audioStreams.size, 0)

    const totalChunks = Array.from(this.clients.values())
      .reduce((sum, client) => {
        return sum + Array.from(client.audioStreams.values())
          .reduce((streamSum, stream) => streamSum + stream.chunks.size, 0)
      }, 0)

    return {
      connectedClients: this.clients.size,
      totalStreams,
      totalChunks,
    }
  }
}
