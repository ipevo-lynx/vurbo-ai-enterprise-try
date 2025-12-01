/**
 * Enhanced WebSocket Audio Stream Server with Detailed Integrity Checking
 * 支援詳細的音訊 chunk 完整性檢查和報告
 */

import type {
  AckMessage,
  AudioStreamMessage,
  IntegrityCheckRequest,
  IntegrityReport,
} from '~/service/schema/audioStream'
import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import { WebSocket, WebSocketServer } from 'ws'

// 詳細音訊塊記錄
interface DetailedAudioChunkRecord {
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
  // 完整性檢查資訊
  integrity: {
    expectedSize?: number
    actualSize: number
    checksum: string
    isComplete: boolean
    isValid: boolean
    corruptionDetails?: string
  }
}

// 音訊流記錄
interface DetailedAudioStreamRecord {
  streamId: string
  taskId: string
  clientId: string
  chunks: Map<string, DetailedAudioChunkRecord>
  totalExpected?: number
  startedAt: Date
  completedAt?: Date
  isComplete: boolean
  lastSequence: number
  missingSequences: Set<number>
  integrityStats: {
    completeChunks: number
    incompleteChunks: number
    corruptedChunks: number
    totalSize: number
  }
}

// 擴展客戶端介面
interface EnhancedClient {
  id: string
  ws: WebSocket
  ip: string
  connectTime: Date
  lastPong: Date
  taskId?: string
  audioStreams: Map<string, DetailedAudioStreamRecord>
}

/**
 * 增強音訊串流處理器，支援詳細完整性檢查
 */
export class EnhancedAudioStreamHandler {
  private clients = new Map<string, EnhancedClient>()
  private wss: WebSocketServer

  constructor(port: number = 8080) {
    this.wss = new WebSocketServer({ port })
    this.setupServer()
    console.log(`🎵 Enhanced Audio Stream Server running on port ${port}`)
  }

  private setupServer() {
    this.wss.on('connection', (ws, req) => {
      const clientId = this.generateClientId()
      const client: EnhancedClient = {
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

  private handleMessage(client: EnhancedClient, data: any) {
    try {
      const message = JSON.parse(data.toString())

      switch (message.type) {
        case 'audio_stream':
          this.handleAudioStream(client, message as AudioStreamMessage)
          break
        case 'integrity_check':
          this.handleIntegrityCheckRequest(client, message as IntegrityCheckRequest)
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
   * 處理音訊流，包含詳細的完整性檢查
   */
  private handleAudioStream(client: EnhancedClient, message: AudioStreamMessage) {
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

      // 進行詳細的完整性檢查
      const integrityResult = this.performIntegrityCheck(audioData)

      // 創建詳細音訊塊記錄
      const chunkRecord: DetailedAudioChunkRecord = {
        chunkId: audioData.chunkId,
        sequenceNumber: audioData.sequenceNumber,
        audioData: audioData.audioData,
        format: audioData.format,
        duration: audioData.duration,
        timestamp: audioData.timestamp,
        isLast: audioData.isLast,
        receivedAt: new Date(),
        status: integrityResult.isValid ? 'received' : 'error',
        metadata: audioData.metadata,
        integrity: integrityResult,
      }

      // 如果完整性檢查失敗，設置錯誤
      if (!integrityResult.isValid) {
        chunkRecord.errorMessage = integrityResult.corruptionDetails || 'Integrity check failed'
        streamRecord.integrityStats.corruptedChunks++
      }
      else {
        streamRecord.integrityStats.completeChunks++
      }

      // 儲存音訊塊
      streamRecord.chunks.set(audioData.chunkId, chunkRecord)
      streamRecord.lastSequence = Math.max(streamRecord.lastSequence, audioData.sequenceNumber)
      streamRecord.integrityStats.totalSize += integrityResult.actualSize

      // 更新遺失序列
      this.updateMissingSequences(streamRecord)

      // 發送包含完整性資訊的 ACK
      this.sendDetailedAck(client, chunkRecord)

      // 非同步處理音訊塊
      if (integrityResult.isValid) {
        this.processAudioChunk(client, streamRecord, chunkRecord)
      }

      // 如果是最後一個塊，生成完整性報告
      if (audioData.isLast) {
        this.generateIntegrityReport(client, streamRecord)
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
   * 執行詳細的完整性檢查
   */
  private performIntegrityCheck(audioData: any): {
    expectedSize?: number
    actualSize: number
    checksum: string
    isComplete: boolean
    isValid: boolean
    corruptionDetails?: string
  } {
    const actualSize = Buffer.byteLength(audioData.audioData, 'base64')
    const checksum = crypto.createHash('md5').update(audioData.audioData).digest('hex')

    // 基本完整性檢查
    let isComplete = true
    let isValid = true
    let corruptionDetails: string | undefined

    // 檢查音訊資料是否為空
    if (!audioData.audioData || audioData.audioData.length === 0) {
      isComplete = false
      isValid = false
      corruptionDetails = 'Empty audio data'
    }

    // 檢查 Base64 格式
    try {
      Buffer.from(audioData.audioData, 'base64')
    }
    catch {
      isComplete = false
      isValid = false
      corruptionDetails = 'Invalid Base64 encoding'
    }

    // 檢查音訊時長是否合理
    if (audioData.duration <= 0 || audioData.duration > 10) {
      isValid = false
      corruptionDetails = `Invalid duration: ${audioData.duration}s`
    }

    // 檢查音訊格式
    if (!['mp3', 'wav', 'webm'].includes(audioData.format)) {
      isValid = false
      corruptionDetails = `Unsupported format: ${audioData.format}`
    }

    // 簡單的資料大小合理性檢查（3秒音訊的大小範圍）
    const minExpectedSize = 1000 // 1KB
    const maxExpectedSize = 500000 // 500KB

    if (actualSize < minExpectedSize) {
      isValid = false
      corruptionDetails = `Audio data too small: ${actualSize} bytes`
    }
    else if (actualSize > maxExpectedSize) {
      isValid = false
      corruptionDetails = `Audio data too large: ${actualSize} bytes`
    }

    return {
      actualSize,
      checksum,
      isComplete,
      isValid,
      corruptionDetails,
    }
  }

  /**
   * 發送包含完整性資訊的詳細 ACK
   */
  private sendDetailedAck(client: EnhancedClient, chunkRecord: DetailedAudioChunkRecord) {
    const ackMessage: AckMessage = {
      type: 'ack',
      data: {
        chunkId: chunkRecord.chunkId,
        sequenceNumber: chunkRecord.sequenceNumber,
        status: chunkRecord.status as 'received' | 'processed' | 'error',
        timestamp: Date.now(),
        errorMessage: chunkRecord.errorMessage,
        integrityCheck: {
          isComplete: chunkRecord.integrity.isComplete,
          expectedSize: chunkRecord.integrity.expectedSize,
          actualSize: chunkRecord.integrity.actualSize,
          checksum: chunkRecord.integrity.checksum,
          corruptionDetails: chunkRecord.integrity.corruptionDetails,
        },
      },
      taskId: client.taskId,
    }

    this.sendMessage(client.ws, ackMessage)

    console.log(`📤 Sent detailed ACK for chunk ${chunkRecord.sequenceNumber}: ${chunkRecord.status} (${chunkRecord.integrity.isValid ? 'valid' : 'invalid'})`)
  }

  /**
   * 處理完整性檢查請求
   */
  private handleIntegrityCheckRequest(client: EnhancedClient, request: IntegrityCheckRequest) {
    const taskId = request.taskId || 'default'
    const streamRecord = client.audioStreams.get(taskId)

    if (!streamRecord) {
      console.warn(`⚠️ No stream found for integrity check: ${taskId}`)
      return
    }

    console.log(`🔍 Processing integrity check request: ${request.data.action}`)

    switch (request.data.action) {
      case 'full_report':
        this.generateIntegrityReport(client, streamRecord)
        break
      case 'missing_only':
        this.generateMissingChunksReport(client, streamRecord)
        break
      case 'corrupted_only':
        this.generateCorruptedChunksReport(client, streamRecord)
        break
    }
  }

  /**
   * 生成完整性報告
   */
  private generateIntegrityReport(client: EnhancedClient, streamRecord: DetailedAudioStreamRecord) {
    const chunks = Array.from(streamRecord.chunks.values())
    const completeChunks = chunks.filter(c => c.status === 'processed' && c.integrity.isValid).length
    const corruptedChunks = chunks.filter(c => !c.integrity.isValid).length
    const missingChunks = streamRecord.missingSequences.size

    const overallStatus
      = missingChunks === 0 && corruptedChunks === 0
        ? 'complete'
        : corruptedChunks > 0
          ? 'corrupted'
          : missingChunks > 0 ? 'incomplete' : 'processing'

    const report: IntegrityReport = {
      type: 'integrity_report',
      data: {
        streamId: streamRecord.streamId,
        taskId: streamRecord.taskId,
        reportTimestamp: Date.now(),
        overallStatus,
        totalExpectedChunks: streamRecord.lastSequence,
        summary: {
          completeChunks,
          incompleteChunks: chunks.length - completeChunks - corruptedChunks,
          corruptedChunks,
          missingChunks,
        },
        chunkDetails: chunks.map(chunk => ({
          chunkId: chunk.chunkId,
          sequenceNumber: chunk.sequenceNumber,
          status: chunk.integrity.isValid
            ? (chunk.status === 'processed' ? 'complete' : 'incomplete')
            : 'corrupted',
          size: {
            actual: chunk.integrity.actualSize,
            expected: chunk.integrity.expectedSize,
          },
          integrity: {
            checksum: chunk.integrity.checksum,
            isValid: chunk.integrity.isValid,
            errorDetails: chunk.integrity.corruptionDetails,
          },
          timing: {
            receivedAt: chunk.receivedAt.getTime(),
            processedAt: chunk.processedAt?.getTime(),
            processingDuration: chunk.processingTime,
          },
        })),
        missingSequences: Array.from(streamRecord.missingSequences),
        recommendations: this.generateRecommendations(streamRecord),
      },
      taskId: streamRecord.taskId,
    }

    this.sendMessage(client.ws, report)
    console.log(`📊 Sent integrity report: ${overallStatus} (${completeChunks}/${streamRecord.lastSequence} complete)`)
  }

  /**
   * 生成建議
   */
  private generateRecommendations(streamRecord: DetailedAudioStreamRecord): string[] {
    const recommendations: string[] = []

    if (streamRecord.missingSequences.size > 0) {
      recommendations.push(`Resend missing chunks: ${Array.from(streamRecord.missingSequences).join(', ')}`)
    }

    const corruptedChunks = Array.from(streamRecord.chunks.values())
      .filter(c => !c.integrity.isValid)

    if (corruptedChunks.length > 0) {
      recommendations.push(`Re-encode and resend corrupted chunks: ${corruptedChunks.map(c => c.sequenceNumber).join(', ')}`)
    }

    const totalSize = streamRecord.integrityStats.totalSize
    if (totalSize > 10 * 1024 * 1024) { // 10MB
      recommendations.push('Consider using compression to reduce data size')
    }

    return recommendations
  }

  /**
   * 其他輔助方法...
   */
  private getOrCreateStream(client: EnhancedClient, taskId: string): DetailedAudioStreamRecord {
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
        integrityStats: {
          completeChunks: 0,
          incompleteChunks: 0,
          corruptedChunks: 0,
          totalSize: 0,
        },
      }
      client.audioStreams.set(taskId, streamRecord)
    }

    return streamRecord
  }

  private updateMissingSequences(streamRecord: DetailedAudioStreamRecord) {
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

  private async processAudioChunk(
    client: EnhancedClient,
    streamRecord: DetailedAudioStreamRecord,
    chunkRecord: DetailedAudioChunkRecord,
  ) {
    try {
      const startTime = Date.now()

      // 模擬音訊處理
      await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100))

      const processingTime = Date.now() - startTime

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
    }
    catch (error) {
      console.error(`❌ Error processing chunk ${chunkRecord.chunkId}:`, error)
      chunkRecord.status = 'error'
      chunkRecord.errorMessage = String(error)
    }
  }

  private generateMissingChunksReport(_client: EnhancedClient, _streamRecord: DetailedAudioStreamRecord) {
    // 實現遺失 chunks 報告...
  }

  private generateCorruptedChunksReport(_client: EnhancedClient, _streamRecord: DetailedAudioStreamRecord) {
    // 實現損壞 chunks 報告...
  }

  private sendAck(
    client: EnhancedClient,
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

  private sendMessage(ws: WebSocket, message: any) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message))
    }
  }
}
