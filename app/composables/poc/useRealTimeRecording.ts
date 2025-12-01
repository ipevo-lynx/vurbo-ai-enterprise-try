import type { AudioChunk } from '~/service/schema/audioStream'

import { computed, onUnmounted, readonly, ref } from 'vue'
import { RealTimeAudioRecorder, RecordingState } from './useRealTimeAudioRecorder'

/**
 * 實時音訊錄製 Vue Composable
 */
export function useRealTimeRecording() {
  const recorder = new RealTimeAudioRecorder()

  // 音訊串流發送函數 - 由外部設置
  const chunkSenderRef = ref<((chunk: AudioChunk) => void) | null>(null)

  // 響應式狀態
  const recordingState = ref<RecordingState>(RecordingState.IDLE)
  const isConnected = ref(true)
  const currentChunk = ref<AudioChunk | null>(null)
  const chunkHistory = ref<AudioChunk[]>([])
  const errorMessage = ref<string | null>(null)

  // 計算屬性
  const isRecording = computed(() => recordingState.value === RecordingState.RECORDING)
  const isPaused = computed(() => recordingState.value === RecordingState.PAUSED)
  const canResume = computed(() => recordingState.value === RecordingState.PAUSED)
  const canStart = computed(() => recordingState.value === RecordingState.IDLE || recordingState.value === RecordingState.STOPPED)

  // 統計資訊
  const stats = computed(() => {
    const session = recorder.getSession()
    const disconnections = recorder.getDisconnectionRecords()

    return {
      sessionId: session?.sessionId || null,
      totalDuration: session?.totalDuration || 0,
      chunksGenerated: chunkHistory.value.length,
      disconnectionCount: disconnections.length,
      lastDisconnectionTime: disconnections.length > 0
        ? disconnections[disconnections.length - 1]?.timePoint
        : null,
    }
  })

  // 設置事件監聽器
  recorder.onStateChange = (state) => {
    recordingState.value = state
    console.log(`🎙️ Recording state changed to: ${state}`)
  }

  recorder.onChunkReady = (chunk) => {
    currentChunk.value = chunk
    chunkHistory.value.push({ ...chunk })
    console.log(`📦 Chunk ready: ${chunk.sequenceNumber} (${chunk.duration.toFixed(2)}s), isLast: ${chunk.isLast}`)
    console.log(`� Chunk details: ID=${chunk.id.substring(0, 12)}..., Status=${chunk.status}`)
    console.log(`�📊 Total chunks generated so far: ${chunkHistory.value.length}`)
    console.log(`📊 All generated chunks: [${chunkHistory.value.map(c => c.sequenceNumber).join(', ')}]`)

    // 嘗試發送 chunk 到音訊串流系統
    const sendFn = chunkSenderRef.value
    if (sendFn) {
      console.log(`📡 Sending chunk ${chunk.sequenceNumber} to audio stream system`)
      try {
        sendFn(chunk)
        console.log(`✅ Successfully passed chunk ${chunk.sequenceNumber} to audio stream`)
      }
      catch (error) {
        console.error(`❌ Failed to send chunk ${chunk.sequenceNumber}:`, error)
      }
    }
    else {
      console.warn(`⚠️ No chunk send function set - chunk ${chunk.sequenceNumber} not sent`)
    }
  }

  recorder.onError = (error) => {
    errorMessage.value = error.message
    console.error('❌ Recording error:', error)
  }

  recorder.onConnectionStateChange = (connected) => {
    isConnected.value = connected
    console.log(`🔗 Connection state: ${connected ? 'Connected' : 'Disconnected'}`)
  }

  /**
   * 開始錄音
   */
  const startRecording = async (chunkDurationSeconds: number = 3, deviceId?: string) => {
    try {
      errorMessage.value = null
      await recorder.startRecording(chunkDurationSeconds, deviceId)
      console.log(`🎙️ Started recording with ${chunkDurationSeconds}s chunks${deviceId ? ` using device: ${deviceId}` : ''}`)
    }
    catch (error) {
      console.error('❌ Failed to start recording:', error)
      errorMessage.value = error instanceof Error ? error.message : 'Failed to start recording'
    }
  }

  /**
   * 暫停錄音
   */
  function pauseRecording(): void {
    recorder.pauseRecording()
  }

  /**
   * 停止錄音
   */
  function stopRecording(): void {
    recorder.stopRecording()
  }

  /**
   * 設置連線狀態檢查函數
   */
  function setConnectionChecker(checker: () => boolean): void {
    recorder.setConnectionChecker(checker)
  }

  /**
   * 設置 chunk 發送函數
   */
  function setChunkSender(sender: (chunk: AudioChunk) => void): void {
    chunkSenderRef.value = sender
    console.log('📡 Chunk sender function has been set')
  }

  /**
   * 模擬連線中斷
   */
  function simulateDisconnection(): void {
    isConnected.value = false
    recorder.onConnectionLost()
  }

  /**
   * 模擬連線恢復
   */
  function simulateReconnection(): void {
    isConnected.value = true
    recorder.onConnectionRestored()
  }

  /**
   * 清除錯誤
   */
  function clearError(): void {
    errorMessage.value = null
  }

  /**
   * 清除歷史記錄
   */
  function clearHistory(): void {
    chunkHistory.value = []
    currentChunk.value = null
    recorder.clearDisconnectionRecords()
  }

  /**
   * 獲取會話資訊
   */
  function getSessionInfo() {
    return recorder.getSession()
  }

  /**
   * 獲取斷線記錄
   */
  function getDisconnectionRecords() {
    return recorder.getDisconnectionRecords()
  }

  // 清理資源
  onUnmounted(() => {
    recorder.destroy()
  })

  return {
    // 狀態
    recordingState: readonly(recordingState),
    isRecording,
    isPaused,
    canResume,
    canStart,
    isConnected: readonly(isConnected),
    currentChunk: readonly(currentChunk),
    chunkHistory: readonly(chunkHistory),
    errorMessage: readonly(errorMessage),
    stats,

    // 控制方法
    startRecording,
    pauseRecording,
    stopRecording,

    // 連線管理
    setConnectionChecker,
    setChunkSender,
    simulateDisconnection,
    simulateReconnection,

    // 工具方法
    clearError,
    clearHistory,
    getSessionInfo,
    getDisconnectionRecords,

    // 直接存取錄音器（進階使用）
    recorder,
  }
}
