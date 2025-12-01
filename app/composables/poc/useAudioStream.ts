import type {
  AckMessage,
  AudioChunk,
  AudioStreamMessage,
  IntegrityCheckRequest,
  IntegrityReport,
} from '~/service/schema/audioStream'

import { computed, reactive, readonly } from 'vue'
import {
  AudioChunkStatus,
  AudioStreamMessageSchema,
} from '~/service/schema/audioStream'

/**
 * 事件類型定義
 */
export interface ChunkEvent {
  id: string
  timestamp: number
  chunkId: string
  sequenceNumber: number
  eventType: 'outgoing' | 'incoming' // 發出去 | 回來
  action: string // 具體動作：send, receive, process, error
  status: AudioChunkStatus
  duration?: number
  details?: string
  metadata?: any
}

/**
 * 音訊串流管理狀態
 */
interface AudioStreamState {
  chunks: Map<string, AudioChunk>
  sendQueue: AudioChunk[]
  isStreaming: boolean
  currentSequence: number
  totalSent: number
  totalAcknowledged: number
  totalErrors: number
  // 新增：完整性檢查相關
  lastIntegrityReport: IntegrityReport | null
  integrityCheckInProgress: boolean
  // 修改：事件歷史記錄
  eventHistory: ChunkEvent[]
  // 新增：任務ID追蹤
  lastTaskId: string | null
  // 新增：斷線重連相關
  pendingChunks: AudioChunk[]
  isConnectionDown: boolean
  isProcessingPending: boolean // 新增：是否正在處理 pending chunks
  lastConnectionLostTime: number | null
  reconnectAttempts: number
  detailedLogs: Array<{
    timestamp: number
    chunkId: string
    sequenceNumber: number
    action: string
    status: string
    details?: string
  }>
}

/**
 * 音訊串流 Composable
 * 基於現有的 WebSocket 連線提供音訊串流功能
 */
export function useAudioStream() {
  // 音訊串流狀態
  const audioState = reactive<AudioStreamState>({
    chunks: new Map(),
    sendQueue: [],
    isStreaming: false,
    currentSequence: 0,
    totalSent: 0,
    totalAcknowledged: 0,
    totalErrors: 0,
    lastIntegrityReport: null,
    integrityCheckInProgress: false,
    eventHistory: [],
    lastTaskId: null,
    // 斷線重連相關
    pendingChunks: [],
    isConnectionDown: false,
    isProcessingPending: false,
    lastConnectionLostTime: null,
    reconnectAttempts: 0,
    detailedLogs: [],
  })

  // 統計資訊 - 根據實際 chunk 狀態計算
  const stats = computed(() => {
    const allChunks = Array.from(audioState.chunks.values())

    // 按狀態分類統計
    const pendingChunks = allChunks.filter(c => c.status === AudioChunkStatus.PENDING).length
    const sentChunks = allChunks.filter(c => c.status === AudioChunkStatus.SENT).length
    const receivedChunks = allChunks.filter(c => c.status === AudioChunkStatus.RECEIVED).length
    const processedChunks = allChunks.filter(c => c.status === AudioChunkStatus.PROCESSED).length
    const errorChunks = allChunks.filter(c => c.status === AudioChunkStatus.ERROR).length

    // 計算統計 - 修正邏輯
    const totalGenerated = allChunks.length
    const totalSent = sentChunks + receivedChunks + processedChunks // 已發送的（包含各階段）
    const totalAcknowledged = receivedChunks + processedChunks // 已確認的（RECEIVED 或 PROCESSED）
    const totalPending = pendingChunks + sentChunks // 等待確認的（PENDING 或 SENT）

    return {
      // 基本統計
      totalChunks: totalGenerated,
      generatedChunks: totalGenerated,
      sentChunks: totalSent,
      acknowledgedChunks: totalAcknowledged,
      pendingChunks: totalPending,
      errorChunks,

      // 舊系統兼容（用於上方顯示）
      legacyStats: {
        acknowledgedChunks: audioState.totalAcknowledged,
        sentChunks: audioState.totalSent,
        errorChunks: audioState.totalErrors,
      },

      // 詳細狀態統計
      statusBreakdown: {
        pending: pendingChunks,
        sent: sentChunks,
        received: receivedChunks,
        processed: processedChunks,
        error: errorChunks,
      },

      // 成功率計算
      successRate: totalSent > 0
        ? (totalAcknowledged / totalSent * 100).toFixed(1)
        : '0.0',

      // 斷線重連相關
      reconnectInfo: {
        isConnectionDown: audioState.isConnectionDown,
        pendingChunksCount: audioState.pendingChunks.length,
        lastConnectionLostTime: audioState.lastConnectionLostTime,
        reconnectAttempts: audioState.reconnectAttempts,
      },

      // Chunk 詳細列表 - 按序號排序
      chunkList: allChunks.sort((a, b) => a.sequenceNumber - b.sequenceNumber),

      // 調試資訊
      debug: {
        allChunkIds: allChunks.map(c => `${c.sequenceNumber}:${c.status}`).join(', '),
        chunkCount: allChunks.length,
        pendingQueueIds: audioState.pendingChunks.map(c => c.sequenceNumber).join(', '),
        statusDistribution: {
          pending: pendingChunks,
          sent: sentChunks,
          received: receivedChunks,
          processed: processedChunks,
          error: errorChunks,
        },
        legacyCounters: {
          totalSent: audioState.totalSent,
          totalAcknowledged: audioState.totalAcknowledged,
          totalErrors: audioState.totalErrors,
        },
      },
    }
  })

  // 生成 UUID v4
  function generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0
      const v = c === 'x' ? r : (r & 0x3 | 0x8)
      return v.toString(16)
    })
  }

  /**
   * 下載完整錄音檔案
   * 使用 Web Audio API 重新合成所有 chunks 為可播放的音頻檔案
   */
  async function downloadCompleteRecording(filename?: string): Promise<boolean> {
    try {
      const allChunks = Array.from(audioState.chunks.values())

      // 按序號排序
      const sortedChunks = allChunks.sort((a, b) => a.sequenceNumber - b.sequenceNumber)

      if (sortedChunks.length === 0) {
        console.warn('📥 沒有可下載的音頻數據')
        return false
      }

      console.log(`📥 準備下載 ${sortedChunks.length} 個音頻區塊`)

      // 創建音頻上下文
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      const audioBuffers: AudioBuffer[] = []

      // 處理每個 chunk
      for (let i = 0; i < sortedChunks.length; i++) {
        const chunk = sortedChunks[i]
        if (!chunk || !chunk.audioData)
          continue

        try {
          // 移除 Base64 前綴並解碼
          const cleanBase64 = chunk.audioData.replace(/^data:audio\/[^;]+;base64,/, '')
          const binaryString = atob(cleanBase64)
          const arrayBuffer = new ArrayBuffer(binaryString.length)
          const uint8Array = new Uint8Array(arrayBuffer)

          for (let j = 0; j < binaryString.length; j++) {
            uint8Array[j] = binaryString.charCodeAt(j)
          }

          // 解碼音頻數據
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
          audioBuffers.push(audioBuffer)
          console.log(`📥 成功解碼 chunk ${chunk.sequenceNumber}: ${audioBuffer.duration.toFixed(2)}s`)
        }
        catch (error) {
          console.warn(`📥 跳過無法解碼的 chunk ${chunk.sequenceNumber}:`, error)
        }
      }

      if (audioBuffers.length === 0) {
        console.warn('📥 沒有成功解碼的音頻區塊')
        return false
      }

      // 計算總長度和創建合併的音頻緩衝區
      const totalDuration = audioBuffers.reduce((sum, buffer) => sum + buffer.duration, 0)
      const sampleRate = audioBuffers[0]?.sampleRate || 44100
      const numberOfChannels = audioBuffers[0]?.numberOfChannels || 1

      console.log(`📥 合併音頻: ${totalDuration.toFixed(2)}s, ${sampleRate}Hz, ${numberOfChannels} channels`)

      // 創建新的音頻緩衝區
      const mergedBuffer = audioContext.createBuffer(numberOfChannels, totalDuration * sampleRate, sampleRate)

      // 合併所有音頻數據
      let currentOffset = 0
      for (const buffer of audioBuffers) {
        for (let channel = 0; channel < numberOfChannels; channel++) {
          const sourceData = buffer.getChannelData(channel)
          const targetData = mergedBuffer.getChannelData(channel)

          for (let i = 0; i < sourceData.length; i++) {
            targetData[currentOffset + i] = sourceData[i]
          }
        }
        currentOffset += buffer.length
      }

      // 轉換為 WAV 格式
      const wavBuffer = audioBufferToWav(mergedBuffer)
      const blob = new Blob([wavBuffer], { type: 'audio/wav' })

      // 創建下載連結
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')

      const defaultFilename = `recording_${new Date().toISOString().replace(/[:.]/g, '-')}.wav`
      link.href = url
      link.download = filename || defaultFilename

      // 觸發下載
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      // 清理資源
      URL.revokeObjectURL(url)
      await audioContext.close()

      console.log(`📥 錄音檔案下載完成: ${link.download}`)
      console.log(`📊 下載統計: ${audioBuffers.length} 個有效區塊, 總時長: ${totalDuration.toFixed(2)}s, 檔案大小: ${(blob.size / 1024).toFixed(2)} KB`)

      return true
    }
    catch (error) {
      console.error('📥 下載錄音檔案失敗:', error)
      return false
    }
  }

  /**
   * 將 AudioBuffer 轉換為 WAV 格式的 ArrayBuffer
   */
  function audioBufferToWav(audioBuffer: AudioBuffer): ArrayBuffer {
    const numberOfChannels = audioBuffer.numberOfChannels
    const sampleRate = audioBuffer.sampleRate
    const length = audioBuffer.length * numberOfChannels * 2

    const buffer = new ArrayBuffer(44 + length)
    const view = new DataView(buffer)

    // WAV 檔案頭
    let offset = 0

    // "RIFF" chunk descriptor
    view.setUint32(offset, 0x52494646, false); offset += 4 // "RIFF"
    view.setUint32(offset, 36 + length, true); offset += 4 // file length - 8
    view.setUint32(offset, 0x57415645, false); offset += 4 // "WAVE"

    // "fmt " sub-chunk
    view.setUint32(offset, 0x666D7420, false); offset += 4 // "fmt "
    view.setUint32(offset, 16, true); offset += 4 // subchunk1Size
    view.setUint16(offset, 1, true); offset += 2 // audioFormat (PCM)
    view.setUint16(offset, numberOfChannels, true); offset += 2 // numChannels
    view.setUint32(offset, sampleRate, true); offset += 4 // sampleRate
    view.setUint32(offset, sampleRate * numberOfChannels * 2, true); offset += 4 // byteRate
    view.setUint16(offset, numberOfChannels * 2, true); offset += 2 // blockAlign
    view.setUint16(offset, 16, true); offset += 2 // bitsPerSample

    // "data" sub-chunk
    view.setUint32(offset, 0x64617461, false); offset += 4 // "data"
    view.setUint32(offset, length, true); offset += 4 // subchunk2Size

    // 寫入音頻數據
    const channels: Float32Array[] = []
    for (let i = 0; i < numberOfChannels; i++) {
      channels.push(audioBuffer.getChannelData(i))
    }

    let sampleIndex = 0
    for (let i = 0; i < audioBuffer.length; i++) {
      for (let channel = 0; channel < numberOfChannels; channel++) {
        const sample = Math.max(-1, Math.min(1, channels[channel][i]))
        view.setInt16(offset + sampleIndex * 2, sample * 0x7FFF, true)
        sampleIndex++
      }
    }

    return buffer
  }

  /**
   * 生成事件 ID
   */
  function generateEventId(): string {
    return `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * 添加事件記錄
   */
  function addEventRecord(
    chunkId: string,
    sequenceNumber: number,
    eventType: 'outgoing' | 'incoming',
    action: string,
    status: AudioChunkStatus,
    duration?: number,
    details?: string,
    metadata?: any,
  ) {
    const event: ChunkEvent = {
      id: generateEventId(),
      timestamp: Date.now(),
      chunkId,
      sequenceNumber,
      eventType,
      action,
      status,
      duration,
      details,
      metadata,
    }

    audioState.eventHistory.unshift(event)

    // 限制事件數量，保留最近 200 條
    if (audioState.eventHistory.length > 200) {
      audioState.eventHistory = audioState.eventHistory.slice(0, 200)
    }

    console.log(`📋 Event recorded: ${eventType} - ${action} (Chunk ${sequenceNumber})`)
  }

  /**
   * 連線中斷處理
   */
  function onConnectionLost() {
    console.log('🔌 Audio Stream: Connection lost, entering offline mode')
    console.log(`📋 Current pending chunks before connection lost: ${audioState.pendingChunks.length}`)
    if (audioState.pendingChunks.length > 0) {
      console.log(`📋 Existing pending chunks:`, audioState.pendingChunks.map(c =>
        `#${c.sequenceNumber}(${c.id.substring(0, 8)}...)`,
      ).join(', '))
    }

    audioState.isConnectionDown = true
    audioState.lastConnectionLostTime = Date.now()

    // 記錄連線中斷事件
    addEventRecord(
      `connection-lost-${Date.now()}`,
      -1, // 使用 -1 表示非 chunk 事件
      'outgoing',
      'connection_lost',
      AudioChunkStatus.ERROR,
      0,
      'WebSocket connection lost',
      { timestamp: Date.now() },
    )
  }

  /**
   * 連線恢復處理
   */
  function onConnectionRestored() {
    console.log('🔌 Audio Stream: Connection restored')
    audioState.isConnectionDown = false
    audioState.reconnectAttempts = 0

    // 記錄連線恢復事件
    const downtime = audioState.lastConnectionLostTime
      ? Date.now() - audioState.lastConnectionLostTime
      : 0

    addEventRecord(
      `connection-restored-${Date.now()}`,
      -2, // 使用 -2 表示連線恢復事件
      'incoming',
      'connection_restored',
      AudioChunkStatus.PROCESSED,
      0,
      `Connection restored after ${downtime}ms`,
      { downtime, pendingChunks: audioState.pendingChunks.length },
    )

    // 注意：pending chunks 的處理由外部調用 processPendingChunks() 進行
    console.log(`📋 Connection restored with ${audioState.pendingChunks.length} pending chunks`)
  }

  /**
   * 處理待發送的 chunks
   */
  function processPendingChunks(
    sendFunction?: (message: any) => boolean,
    taskId?: string,
  ) {
    if (audioState.pendingChunks.length === 0) {
      return Promise.resolve()
    }

    console.log(`📤 Audio Stream: Processing ${audioState.pendingChunks.length} pending chunks`)
    console.log(`📋 Pending chunks details:`, audioState.pendingChunks.map(c =>
      `#${c.sequenceNumber}(${c.id.substring(0, 8)}...)`,
    ).join(', '))

    // 設置處理標記，阻止新 chunks 直接發送
    audioState.isProcessingPending = true

    const chunks = [...audioState.pendingChunks]
    audioState.pendingChunks = []

    // 按序號順序重新發送
    const sortedChunks = chunks.sort((a, b) => a.sequenceNumber - b.sequenceNumber)
    console.log(`📋 Sorted chunks for processing:`, sortedChunks.map(c =>
      `#${c.sequenceNumber}(${c.id.substring(0, 8)}...)`,
    ).join(', '))

    return new Promise<void>((resolve) => {
      let completedCount = 0

      sortedChunks.forEach((chunk, index) => {
        // 添加小延遲避免瞬間大量請求，確保按順序發送
        setTimeout(() => {
          console.log(`📤 Resending chunk ${chunk.sequenceNumber} after reconnection`)

          // 如果有發送函數，直接發送但不重複記錄事件
          if (sendFunction) {
            console.log(`📤 Directly resending chunk ${chunk.sequenceNumber} (bypassing normal sendChunk event recording)`)

            // 直接發送邏輯，避免 sendChunk 中的重複事件記錄
            try {
              const message = createAudioStreamMessage(chunk, taskId)
              const sendSuccess = sendFunction(message)

              if (sendSuccess) {
                chunk.status = AudioChunkStatus.SENT
                chunk.sentAt = Date.now()
                audioState.totalSent++

                // 關鍵修復：更新 Map 中的 chunk 狀態
                audioState.chunks.set(chunk.id, chunk)
                console.log(`✅ Successfully resent chunk ${chunk.sequenceNumber}, updated tracking`)

                // 記錄重發成功事件 - 使用正確的 SENT 狀態
                console.log(`📋 [DEBUG] Recording successful resend event for chunk ${chunk.sequenceNumber}`)
                addEventRecord(
                  chunk.id,
                  chunk.sequenceNumber,
                  'outgoing',
                  'resend',
                  AudioChunkStatus.SENT,
                  chunk.duration,
                  'Resending after reconnection',
                  { originalSentAt: chunk.sentAt, resendDelay: index * 200 },
                )
              }
              else {
                console.warn(`❌ Failed to resend chunk ${chunk.sequenceNumber}`)

                // 發送失敗時也要更新 Map
                audioState.chunks.set(chunk.id, chunk)

                // 記錄重發失敗事件
                addEventRecord(
                  chunk.id,
                  chunk.sequenceNumber,
                  'outgoing',
                  'resend',
                  AudioChunkStatus.ERROR,
                  chunk.duration,
                  'Resend failed after reconnection',
                  { originalSentAt: chunk.sentAt, resendDelay: index * 200, error: 'Send function returned false' },
                )
              }
            }
            catch (error) {
              console.error(`💥 Error resending chunk ${chunk.sequenceNumber}:`, error)

              // 異常時也要更新 Map
              chunk.status = AudioChunkStatus.ERROR
              audioState.chunks.set(chunk.id, chunk)

              // 記錄重發異常事件
              addEventRecord(
                chunk.id,
                chunk.sequenceNumber,
                'outgoing',
                'resend',
                AudioChunkStatus.ERROR,
                chunk.duration,
                `Resend error: ${error}`,
                { originalSentAt: chunk.sentAt, resendDelay: index * 200, error: String(error) },
              )
            }
          }
          else {
            console.log(`📤 Adding chunk ${chunk.sequenceNumber} to send queue`)
            audioState.sendQueue.push(chunk)
          }

          completedCount++
          if (completedCount === sortedChunks.length) {
            console.log(`✅ All ${sortedChunks.length} pending chunks processed`)

            // 檢查是否還有新的 pending chunks 需要處理
            if (audioState.pendingChunks.length > 0) {
              console.log(`🔄 Found ${audioState.pendingChunks.length} more pending chunks, continuing...`)
              // 遞歸處理剩餘的 pending chunks
              processPendingChunks(sendFunction, taskId).then(resolve)
            }
            else {
              // 清除處理標記，允許新 chunks 正常發送
              audioState.isProcessingPending = false
              console.log(`🎉 All pending chunks processing completed`)
              resolve()
            }
          }
        }, index * 200) // 200ms 延遲確保順序
      })
    })
  }

  /**
   * 添加詳細日誌記錄
   */
  function addDetailedLog(
    chunkId: string,
    sequenceNumber: number,
    action: string,
    status: string,
    details?: string,
  ) {
    audioState.detailedLogs.unshift({
      timestamp: Date.now(),
      chunkId,
      sequenceNumber,
      action,
      status,
      details,
    })

    // 限制日誌數量，保留最近 100 條
    if (audioState.detailedLogs.length > 100) {
      audioState.detailedLogs = audioState.detailedLogs.slice(0, 100)
    }
  }

  /**
   * 創建音訊 Chunk
   */
  function createAudioChunk(
    audioData: string,
    format: 'mp3' | 'wav' | 'webm',
    duration: number,
    isLast: boolean = false,
    metadata?: AudioChunk['metadata'],
  ): AudioChunk {
    const chunk: AudioChunk = {
      id: generateUUID(),
      sequenceNumber: ++audioState.currentSequence,
      audioData,
      format,
      duration,
      timestamp: Date.now(),
      isLast,
      status: AudioChunkStatus.PENDING,
      metadata,
    }

    audioState.chunks.set(chunk.id, chunk)
    return chunk
  }

  /**
   * 添加 Chunk 到發送佇列
   */
  function addToSendQueue(chunk: AudioChunk) {
    audioState.sendQueue.push(chunk)
    chunk.status = AudioChunkStatus.PENDING
    console.log(`🎵 Audio Stream: Chunk ${chunk.sequenceNumber} added to queue`)
  }

  /**
   * 創建音訊串流訊息
   */
  function createAudioStreamMessage(
    chunk: AudioChunk,
    taskId?: string,
  ): AudioStreamMessage {
    return {
      type: 'audio_stream',
      data: {
        chunkId: chunk.id,
        sequenceNumber: chunk.sequenceNumber,
        audioData: chunk.audioData,
        format: chunk.format,
        duration: chunk.duration,
        timestamp: chunk.timestamp,
        isLast: chunk.isLast,
        metadata: chunk.metadata,
      },
      taskId,
    }
  }

  /**
   * 處理 ACK 訊息
   */
  function handleAckMessage(ackMessage: AckMessage) {
    console.log('🔍 handleAckMessage 被調用，收到:', ackMessage)
    const { chunkId, status, errorMessage, processingTime, integrityCheck } = ackMessage.data
    console.log(`🔍 處理 ACK - chunkId: ${chunkId}, status: ${status}`)

    const chunk = audioState.chunks.get(chunkId)
    console.log(`🔍 找到的 chunk:`, chunk)

    if (!chunk) {
      console.warn(`⚠️ Audio Stream: Received ACK for unknown chunk: ${chunkId}`)
      console.warn(`⚠️ 當前追蹤的 chunks:`, Array.from(audioState.chunks.keys()))
      addDetailedLog(chunkId, 0, 'ACK_RECEIVED', 'WARNING', 'Unknown chunk ID')
      return
    }

    console.log(`🔍 處理前 chunk 狀態: ${chunk.status}`)

    chunk.acknowledgedAt = Date.now()

    // 處理完整性檢查資訊
    if (integrityCheck) {
      const integrityStatus = integrityCheck.isComplete ? 'COMPLETE' : 'INCOMPLETE'
      let details = `Integrity: ${integrityStatus}`

      if (integrityCheck.expectedSize && integrityCheck.actualSize) {
        details += ` | Size: ${integrityCheck.actualSize}/${integrityCheck.expectedSize} bytes`
      }

      if (integrityCheck.checksum) {
        details += ` | Checksum: ${integrityCheck.checksum.slice(0, 8)}...`
      }

      if (integrityCheck.corruptionDetails) {
        details += ` | Error: ${integrityCheck.corruptionDetails}`
      }

      addDetailedLog(chunkId, chunk.sequenceNumber, 'INTEGRITY_CHECK', integrityStatus, details)
    }

    switch (status) {
      case 'received': {
        console.log(`🔍 設定狀態前: ${chunk.status}`)
        console.log(`🔍 準備設定為: ${AudioChunkStatus.RECEIVED}`)

        // 創建一個新的響應式chunk物件來確保狀態更新被追蹤
        const updatedChunk = {
          ...chunk,
          status: AudioChunkStatus.RECEIVED,
          acknowledgedAt: Date.now(),
        }

        console.log(`🔍 創建新chunk後狀態: ${updatedChunk.status}`)

        // 用新的chunk物件替換原來的
        audioState.chunks.set(chunkId, updatedChunk)
        console.log(`🔍 設定到Map後，再次檢查: ${audioState.chunks.get(chunkId)?.status}`)

        addDetailedLog(chunkId, chunk.sequenceNumber, 'RECEIVED', 'SUCCESS', integrityCheck ? `Complete: ${integrityCheck.isComplete}` : undefined)

        // 記錄接收事件
        addEventRecord(
          chunkId,
          chunk.sequenceNumber,
          'incoming',
          'receive',
          AudioChunkStatus.RECEIVED,
          chunk.duration,
          integrityCheck ? `Integrity: ${integrityCheck.isComplete ? 'Complete' : 'Incomplete'}` : 'Received confirmation',
          { integrityCheck },
        )

        console.log(`✅ Audio Stream: Chunk ${chunk.sequenceNumber} received by server${
          integrityCheck ? ` (${integrityCheck.isComplete ? 'complete' : 'incomplete'})` : ''
        }`)
        break
      }
      case 'processed': {
        const updatedChunk = {
          ...chunk,
          status: AudioChunkStatus.PROCESSED,
          acknowledgedAt: Date.now(),
        }
        audioState.chunks.set(chunkId, updatedChunk)
        audioState.totalAcknowledged++
        addDetailedLog(chunkId, chunk.sequenceNumber, 'PROCESSED', 'SUCCESS', processingTime ? `Processed in ${processingTime}ms` : undefined)

        // 記錄處理完成事件
        addEventRecord(
          chunkId,
          chunk.sequenceNumber,
          'incoming',
          'process',
          AudioChunkStatus.PROCESSED,
          chunk.duration,
          processingTime ? `Processed in ${processingTime}ms` : 'Processing completed',
          { processingTime },
        )

        console.log(
          `🎯 Audio Stream: Chunk ${chunk.sequenceNumber} processed${processingTime ? ` in ${processingTime}ms` : ''}`,
        )
        break
      }
      case 'error': {
        const updatedChunk = {
          ...chunk,
          status: AudioChunkStatus.ERROR,
          errorMessage,
          acknowledgedAt: Date.now(),
        }
        audioState.chunks.set(chunkId, updatedChunk)
        audioState.totalErrors++
        addDetailedLog(chunkId, chunk.sequenceNumber, 'ERROR', 'FAILED', errorMessage)

        // 記錄錯誤事件
        addEventRecord(
          chunkId,
          chunk.sequenceNumber,
          'incoming',
          'error',
          AudioChunkStatus.ERROR,
          chunk.duration,
          errorMessage || 'Processing error occurred',
          { errorMessage },
        )

        console.error(`❌ Audio Stream: Chunk ${chunk.sequenceNumber} error: ${errorMessage}`)
        break
      }
    }

    console.log(`🔍 處理後 chunk 狀態: ${audioState.chunks.get(chunkId)?.status}`)
  }

  /**
   * 發送單個 Chunk
   */
  function sendChunk(
    chunk: AudioChunk,
    sendFunction: (message: any) => boolean,
    taskId?: string,
  ): boolean {
    try {
      // 檢查連線狀態和是否正在處理 pending chunks
      if (audioState.isConnectionDown || audioState.isProcessingPending) {
        const reason = audioState.isConnectionDown ? 'connection down' : 'processing pending chunks'
        console.warn(`🔌 Audio Stream: ${reason}, adding chunk ${chunk.sequenceNumber} to pending queue`)

        // 確保 chunk 被追蹤（關鍵修復：即使是 pending 的 chunk 也要加入 Map）
        if (!audioState.chunks.has(chunk.id)) {
          audioState.chunks.set(chunk.id, chunk)
          console.log(`📋 Audio Stream: Added pending chunk ${chunk.sequenceNumber} to tracking`)
        }

        // 避免重複加入待發送佇列
        if (!audioState.pendingChunks.find(c => c.id === chunk.id)) {
          audioState.pendingChunks.push({ ...chunk })
          console.log(`📋 Added chunk ${chunk.sequenceNumber} to pending queue. Total pending: ${audioState.pendingChunks.length}`)
          console.log(`📋 Current pending chunks:`, audioState.pendingChunks.map(c =>
            `#${c.sequenceNumber}(${c.id.substring(0, 8)}...)`,
          ).join(', '))

          // 記錄暫存事件
          addEventRecord(
            chunk.id,
            chunk.sequenceNumber,
            'outgoing',
            'queued',
            AudioChunkStatus.PENDING,
            chunk.duration,
            `Added to pending queue due to ${reason}`,
            { queueLength: audioState.pendingChunks.length },
          )
        }
        else {
          console.log(`⚠️ Chunk ${chunk.sequenceNumber} already in pending queue, skipping`)
        }

        return false
      }

      // 確保 chunk 被追蹤（如果是外部創建的 chunk）
      if (!audioState.chunks.has(chunk.id)) {
        audioState.chunks.set(chunk.id, chunk)
        console.log(`📋 Audio Stream: Added external chunk ${chunk.sequenceNumber} to tracking`)
      }

      // 驗證音訊串流訊息格式
      const message = createAudioStreamMessage(chunk, taskId)
      const validationResult = AudioStreamMessageSchema.safeParse(message)

      if (!validationResult.success) {
        console.error('❌ Audio Stream: Invalid message format:', validationResult.error)
        chunk.status = AudioChunkStatus.ERROR
        chunk.errorMessage = 'Invalid message format'
        return false
      }

      // 發送訊息並檢查結果
      console.log(`🚀 準備發送 chunk ${chunk.sequenceNumber}`)
      const sendSuccess = sendFunction(message)
      console.log(`📡 發送結果:`, sendSuccess)

      if (sendSuccess) {
        chunk.status = AudioChunkStatus.SENT
        chunk.sentAt = Date.now()
        audioState.totalSent++

        console.log(`📤 Audio Stream: Sent chunk ${chunk.sequenceNumber} (${chunk.id})`)
        addDetailedLog(chunk.id, chunk.sequenceNumber, 'SEND', 'SUCCESS', `Sent chunk size: ${chunk.audioData.length} chars`)

        // 記錄發送事件
        addEventRecord(
          chunk.id,
          chunk.sequenceNumber,
          'outgoing',
          'send',
          AudioChunkStatus.SENT,
          chunk.duration,
          `Sent ${chunk.audioData.length} chars`,
          { taskId, format: chunk.format },
        )

        return true
      }
      else {
        // WebSocket 發送失敗，可能是連線問題，加入待發送佇列
        console.warn(`🔌 Audio Stream: Send failed for chunk ${chunk.sequenceNumber}, adding to pending queue`)

        // 標記連線可能有問題
        audioState.isConnectionDown = true

        // 確保失敗的 chunk 也被追蹤
        if (!audioState.chunks.has(chunk.id)) {
          audioState.chunks.set(chunk.id, chunk)
          console.log(`📋 Audio Stream: Added failed chunk ${chunk.sequenceNumber} to tracking`)
        }

        // 加入待發送佇列
        if (!audioState.pendingChunks.find(c => c.id === chunk.id)) {
          audioState.pendingChunks.push({ ...chunk })

          // 記錄暫存事件
          addEventRecord(
            chunk.id,
            chunk.sequenceNumber,
            'outgoing',
            'queued_on_failure',
            AudioChunkStatus.PENDING,
            chunk.duration,
            'Added to pending queue due to send failure',
            { queueLength: audioState.pendingChunks.length },
          )
        }

        addDetailedLog(chunk.id, chunk.sequenceNumber, 'SEND', 'QUEUED', 'WebSocket send failed, added to pending queue')
        return false
      }
    }
    catch (error) {
      console.error('❌ Audio Stream: Failed to send chunk:', error)

      // 確保異常的 chunk 也被追蹤
      if (!audioState.chunks.has(chunk.id)) {
        audioState.chunks.set(chunk.id, chunk)
        console.log(`📋 Audio Stream: Added error chunk ${chunk.sequenceNumber} to tracking`)
      }

      // 異常情況也加入待發送佇列
      if (!audioState.pendingChunks.find(c => c.id === chunk.id)) {
        audioState.pendingChunks.push({ ...chunk })

        addEventRecord(
          chunk.id,
          chunk.sequenceNumber,
          'outgoing',
          'queued_on_error',
          AudioChunkStatus.ERROR,
          chunk.duration,
          `Exception during send: ${String(error)}`,
          { error: String(error), queueLength: audioState.pendingChunks.length },
        )
      }

      addDetailedLog(chunk.id, chunk.sequenceNumber, 'SEND', 'EXCEPTION', String(error))
      return false
    }
  }

  /**
   * 處理佇列中的下一個 Chunk
   */
  function sendNextInQueue(sendFunction: (message: any) => boolean, taskId?: string): boolean {
    if (audioState.sendQueue.length === 0) {
      console.log('📭 Audio Stream: Send queue is empty')
      return false
    }

    const chunk = audioState.sendQueue.shift()!
    return sendChunk(chunk, sendFunction, taskId)
  }

  /**
   * 批量發送佇列中的所有 Chunks
   */
  async function sendAllInQueue(
    sendFunction: (message: any) => boolean,
    taskId?: string,
    delayMs: number = 100,
  ): Promise<void> {
    audioState.isStreaming = true
    console.log(`🚀 Audio Stream: Starting batch send (${audioState.sendQueue.length} chunks)`)

    while (audioState.sendQueue.length > 0 && audioState.isStreaming) {
      sendNextInQueue(sendFunction, taskId)

      if (delayMs > 0 && audioState.sendQueue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }
    }

    audioState.isStreaming = false
    console.log('✅ Audio Stream: Batch send completed')
  }

  /**
   * 停止串流
   */
  function stopStreaming() {
    audioState.isStreaming = false
    console.log('🛑 Audio Stream: Streaming stopped')
  }

  /**
   * 清空佇列
   */
  function clearQueue() {
    audioState.sendQueue.length = 0
    console.log('🗑️ Audio Stream: Send queue cleared')
  }

  /**
   * 清除事件歷史
   */
  function clearEventHistory() {
    audioState.eventHistory = []
    console.log('🗑️ Audio Stream: Event history cleared')
  }

  /**
   * 獲取事件歷史
   */
  function getEventHistory() {
    return [...audioState.eventHistory]
  }

  /**
   * 獲取分類的事件歷史
   */
  function getCategorizedEventHistory() {
    const outgoingEvents = audioState.eventHistory.filter(e => e.eventType === 'outgoing')
    const incomingEvents = audioState.eventHistory.filter(e => e.eventType === 'incoming')

    return {
      outgoing: outgoingEvents,
      incoming: incomingEvents,
      all: audioState.eventHistory,
    }
  }

  /**
   * 重置統計資料
   * @param currentTaskId 當前任務ID，用於判斷是否需要清除事件歷史
   * @param forceResetHistory 是否強制清除事件歷史
   */
  function resetStats(currentTaskId?: string | null, forceResetHistory: boolean = false) {
    audioState.chunks.clear()
    audioState.sendQueue.length = 0
    audioState.currentSequence = 0
    audioState.totalSent = 0
    audioState.totalAcknowledged = 0
    audioState.totalErrors = 0
    audioState.isStreaming = false
    audioState.pendingChunks = []
    audioState.isConnectionDown = false
    audioState.lastConnectionLostTime = null
    audioState.reconnectAttempts = 0
    audioState.detailedLogs = []

    // 只有在任務ID改變或強制重置時才清除事件歷史
    let shouldClearHistory = forceResetHistory

    // 檢查任務ID是否真的改變了
    if (!forceResetHistory && currentTaskId !== undefined) {
      // 如果之前沒有任務ID，現在有了，不算改變（首次設定）
      // 如果之前有任務ID，現在也有，但值不同，才算改變
      const hasTaskIdChanged = audioState.lastTaskId !== null && audioState.lastTaskId !== currentTaskId
      shouldClearHistory = hasTaskIdChanged
    }

    if (shouldClearHistory) {
      audioState.eventHistory = []
      console.log('🗑️ Audio Stream: Event history cleared due to task change or force reset', {
        reason: forceResetHistory ? 'force reset' : 'task ID changed',
        oldTaskId: audioState.lastTaskId,
        newTaskId: currentTaskId,
      })
    }

    // 更新最後的任務ID
    if (currentTaskId !== undefined) {
      audioState.lastTaskId = currentTaskId
    }

    console.log('🔄 Audio Stream: Stats reset', {
      taskId: currentTaskId,
      historyCleared: shouldClearHistory,
    })
  }

  /**
   * 取得 Chunk 狀態
   */
  function getChunkStatus(chunkId: string): AudioChunkStatus | null {
    return audioState.chunks.get(chunkId)?.status || null
  }

  /**
   * 取得所有 Chunks
   */
  function getAllChunks(): AudioChunk[] {
    return Array.from(audioState.chunks.values()).sort(
      (a, b) => a.sequenceNumber - b.sequenceNumber,
    )
  }

  /**
   * 取得佇列中的 Chunks
   */
  function getQueuedChunks(): AudioChunk[] {
    return [...audioState.sendQueue]
  }

  /**
   * 處理完整性報告
   */
  function handleIntegrityReport(report: IntegrityReport) {
    audioState.lastIntegrityReport = report
    audioState.integrityCheckInProgress = false

    console.log(`📊 Integrity Report: ${report.data.overallStatus}`)
    console.log(`   Complete: ${report.data.summary.completeChunks}/${report.data.totalExpectedChunks}`)
    console.log(`   Missing: ${report.data.summary.missingChunks}`)
    console.log(`   Corrupted: ${report.data.summary.corruptedChunks}`)

    if (report.data.missingSequences.length > 0) {
      console.warn(`   Missing sequences: ${report.data.missingSequences.join(', ')}`)
    }

    // 添加到詳細日誌
    addDetailedLog(
      report.data.streamId,
      0,
      'INTEGRITY_REPORT',
      report.data.overallStatus.toUpperCase(),
      `${report.data.summary.completeChunks}/${report.data.totalExpectedChunks} complete, ${report.data.summary.missingChunks} missing`,
    )
  }

  /**
   * 請求完整性檢查
   */
  function requestIntegrityCheck(
    sendFunction: (message: any) => boolean,
    action: 'full_report' | 'missing_only' | 'corrupted_only' = 'full_report',
    taskId?: string,
    sequenceRange?: { start: number, end: number },
  ) {
    const request: IntegrityCheckRequest = {
      type: 'integrity_check',
      data: {
        action,
        sequenceRange,
      },
      taskId,
    }

    audioState.integrityCheckInProgress = true
    sendFunction(request)

    addDetailedLog(
      taskId || 'unknown',
      0,
      'INTEGRITY_CHECK_REQUEST',
      'SENT',
      `Action: ${action}${sequenceRange ? `, Range: ${sequenceRange.start}-${sequenceRange.end}` : ''}`,
    )

    console.log(`🔍 Requested integrity check: ${action}`)
  }

  /**
   * 獲取詳細日誌
   */
  function getDetailedLogs(limit?: number): typeof audioState.detailedLogs {
    return limit ? audioState.detailedLogs.slice(0, limit) : [...audioState.detailedLogs]
  }

  /**
   * 清除詳細日誌
   */
  function clearDetailedLogs() {
    audioState.detailedLogs.length = 0
    console.log('🗑️ Audio Stream: Detailed logs cleared')
  }

  /**
   * 獲取完整性統計
   */
  function getIntegrityStats() {
    const chunks = getAllChunks()
    const completeChunks = chunks.filter(c => c.status === AudioChunkStatus.PROCESSED).length
    const incompleteChunks = chunks.filter(c =>
      c.status === AudioChunkStatus.PENDING
      || c.status === AudioChunkStatus.SENT,
    ).length
    const errorChunks = chunks.filter(c => c.status === AudioChunkStatus.ERROR).length

    return {
      totalChunks: chunks.length,
      completeChunks,
      incompleteChunks,
      errorChunks,
      completionRate: chunks.length > 0 ? (completeChunks / chunks.length * 100).toFixed(1) : '0.0',
      lastIntegrityReport: audioState.lastIntegrityReport,
      integrityCheckInProgress: audioState.integrityCheckInProgress,
    }
  }

  return {
    // 狀態
    audioState: readonly(audioState),
    stats,

    // Chunk 管理
    createAudioChunk,
    addToSendQueue,
    getAllChunks,
    getQueuedChunks,
    getChunkStatus,

    // 發送功能
    sendChunk,
    sendNextInQueue,
    sendAllInQueue,
    stopStreaming,

    // 訊息處理
    handleAckMessage,
    handleIntegrityReport,

    // 完整性檢查
    requestIntegrityCheck,
    getIntegrityStats,

    // 詳細日誌
    getDetailedLogs,
    clearDetailedLogs,

    // 事件歷史
    getEventHistory,
    getCategorizedEventHistory,
    clearEventHistory,

    // 斷線重連管理
    onConnectionLost,
    onConnectionRestored,
    processPendingChunks,

    // 工具函數
    clearQueue,
    resetStats,
    generateUUID,

    // 音頻下載功能
    downloadCompleteRecording,
  }
}
