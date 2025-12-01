<script setup lang="ts">
import type { ChunkEvent } from '~/composables/poc/useAudioStream'
import type { AudioChunk } from '~/service/schema/audioStream'

import { computed, reactive, ref, watch } from 'vue'

import { useAdvancedAudioMerger } from '~/composables/audio/useAdvancedAudioMerger'
import { useAudioMerger } from '~/composables/audio/useAudioMerger'
import { useDeviceManager } from '~/composables/audio/useDeviceManager'
import { useAudioStream } from '~/composables/poc/useAudioStream'
import { useRealTimeRecording } from '~/composables/poc/useRealTimeRecording'
import { useWebSocketPoc } from '~/composables/poc/useWebSocketPoc'
import { AudioChunkStatus } from '~/service/schema/audioStream'
import { formatTime } from '~/utils/timeFormatter'

// 頁面標題
// definePageMeta({
//   title: '🎙️ 實時音訊錄製測試',
// })

// 音訊裝置管理
const {
  deviceState,
  getAvailableDevices,
  startVolumeMonitoring,
  stopVolumeMonitoring,
} = useDeviceManager()

// 裝置選擇
const selectedDeviceId = ref<string>('')
const selectedDevice = computed(() => {
  if (!selectedDeviceId.value)
    return null
  return deviceState.data.availableDevices.find(d => d.deviceId === selectedDeviceId.value) || null
})

// WebSocket 配置
const wsConfig = reactive({
  url: 'ws://localhost:8080',
  reconnectAttempts: 20, // 增加重連次數，應對斷線測試
  reconnectInterval: 2000,
  heartbeatInterval: 5000,
  backgroundReconnectEnabled: true,
  minReconnectDelay: 2000, // 增加最小延遲，避免過於頻繁的重連
  maxReconnectDelay: 8000, // 增加最大延遲，給後端恢復更多時間
  exponentialBackoff: false, // 使用固定間隔而非指數退避，適合已知恢復時間的場景
})

// WebSocket 連線
const {
  connect: connectWs,
  disconnect: disconnectWs,
  send,
  state: wsState,
  isConnecting: isWsConnecting,
  isConnected: isWsConnected,
  lastMessage,
  currentTaskId,
  simulateDisconnection: simulateWsDisconnection,
  toggleAutoReconnect,
  backgroundReconnectStatus,
  onConnectionEstablished: onWsConnectionEstablished,
  onConnectionLost: onWsConnectionLost,
} = useWebSocketPoc(wsConfig)

// 實時錄音
const {
  startRecording: startRec,
  pauseRecording: pauseRec,
  stopRecording: stopRec,
  recordingState,
  isRecording,
  canStart,
  currentChunk,
  chunkHistory,
  errorMessage,
  stats,
  clearError,
  clearHistory,
  setConnectionChecker,
  setChunkSender,
  getDisconnectionRecords,
} = useRealTimeRecording()

// 音訊串流管理
const {
  sendChunk,
  stats: audioStats,
  handleAckMessage,
  resetStats,
  getCategorizedEventHistory,
  onConnectionLost,
  onConnectionRestored,
  processPendingChunks,
} = useAudioStream()

// 音訊合併功能
const {
  mergeAndDownload,
  generateMergeStats,
} = useAudioMerger()

// 進階音訊合併功能
const {
  mergeAndDownloadAdvanced,
} = useAdvancedAudioMerger()

// 頁面狀態
const chunkDuration = ref(3)
const logs = ref<Array<{
  type: 'info' | 'error' | 'success' | 'warning'
  message: string
  timestamp: string
}>>([])
// 移除不再使用的 selectedEventTab

// 音訊合併狀態
const mergeState = reactive({
  isProcessing: false,
  lastMergeStats: null as any,
  showMergeStats: false,
})

// 計算屬性
const wsConnectionIndicator = computed(() => {
  switch (wsState.value) {
    case 'connecting':
      return { icon: '🔄', text: '連線中', class: 'bg-yellow-500' }
    case 'connected':
      return { icon: '✅', text: '已連線', class: 'bg-green-500' }
    case 'error':
      return { icon: 'ERROR:', text: '連線錯誤', class: 'bg-red-500' }
    default:
      return { icon: '⚫', text: '已斷線', class: 'bg-gray-500' }
  }
})

const recordingIndicator = computed(() => {
  switch (recordingState.value) {
    case 'recording':
      return { icon: '🔴', text: '錄音中', class: 'bg-red-500 animate-pulse' }
    case 'paused':
      return { icon: '⏸️', text: '已暫停', class: 'bg-yellow-500' }
    case 'stopped':
      return { icon: '⏹️', text: '已停止', class: 'bg-gray-500' }
    default:
      return { icon: '⚫', text: '待機中', class: 'bg-gray-400' }
  }
})

// 按鈕狀態控制
const buttonStates = computed(() => {
  const isPaused = recordingState.value === 'paused'

  return {
    canStart: canStart.value && isWsConnected.value && !isPaused,
    canPause: isRecording.value,
    canResume: isPaused && isWsConnected.value,
    canStop: isRecording.value || isPaused,
  }
})

const disconnectionRecords = computed(() => getDisconnectionRecords())

// 事件歷史
const eventHistory = computed(() => getCategorizedEventHistory())
const currentEvents = computed(() => eventHistory.value.all)

// 設置連線狀態檢查
setConnectionChecker(() => isWsConnected.value)

// 設置 chunk 發送函數 - 這樣錄音系統產生的 chunk 會自動發送到音訊串流系統
setChunkSender((chunk: AudioChunk) => {
  console.log(`🔗 Recording system sending chunk ${chunk.sequenceNumber} to audio stream`)

  const lastIndicator = chunk.isLast ? ' (LAST)' : ''

  // 【重要修復】不管連線狀態如何，都要將 chunk 傳遞到音訊串流系統進行追蹤和處理
  // 音訊串流系統內部會根據連線狀態決定立即發送還是暫存為 pending
  try {
    const success = sendChunk(chunk, send, currentTaskId.value || undefined)
    console.log(`📊 Chunk ${chunk.sequenceNumber} 發送結果: ${success}, 狀態: ${chunk.status}`)

    if (isWsConnected.value) {
      // 連線正常時的處理
      if (success) {
        addLog('success', `發送 Chunk ${chunk.sequenceNumber} (${chunk.duration.toFixed(2)}s)${lastIndicator}`)
      }
      else {
        addLog('error', `發送 Chunk ${chunk.sequenceNumber} 失敗`)
      }
    }
    else {
      // 連線中斷時的處理 - chunk 會被暫存為 pending
      addLog('warning', `WebSocket 未連線，Chunk ${chunk.sequenceNumber} 已暫存等待重連${lastIndicator}`)
    }
  }
  catch (error) {
    console.error('ERROR: sendChunk 執行失敗:', error)
    addLog('error', `發送 Chunk ${chunk.sequenceNumber} 異常: ${error}`)
  }
})

// 設置斷線重連回調
onWsConnectionEstablished(async () => {
  console.log('🔗 WebSocket 連線建立，通知音訊串流系統')
  console.log(`📊 重連時錄音狀態: ${recordingState.value}`)
  console.log(`📊 重連時已生成 chunks 數量: ${stats.value.chunksGenerated}`)

  onConnectionRestored()

  // 處理重連後的 pending chunks
  console.log('🔄 Processing pending chunks after reconnection')
  try {
    await processPendingChunks(send, currentTaskId.value || undefined)
    addLog('success', '重連後待發送 chunks 處理完成')
    console.log(`📊 處理完成後錄音狀態: ${recordingState.value}`)
  }
  catch (error) {
    console.error('處理 pending chunks 時發生錯誤:', error)
    addLog('error', `處理待發送 chunks 失敗: ${error}`)
  }
})

onWsConnectionLost(() => {
  console.log('🔌 WebSocket 連線中斷，通知音訊串流系統')
  onConnectionLost()
})

// 初始化時掃描裝置
if (process.client) {
  refreshDevices()
}

// 方法
function addLog(type: 'info' | 'error' | 'success' | 'warning', message: string) {
  logs.value.unshift({ type, message, timestamp: formatTime(Date.now()) })

  // 限制日誌數量
  if (logs.value.length > 200) {
    logs.value = logs.value.slice(0, 200)
  }
}

function clearLogs() {
  logs.value = []
  addLog('info', '日誌已清除')
}

// 手動清除事件歷史記錄
function manualClearEventHistory() {
  // 使用強制重置參數清除事件歷史
  resetStats(currentTaskId.value, true)
  addLog('info', '🗑️ 事件歷史記錄已手動清除')
}

// 裝置管理方法
async function refreshDevices() {
  try {
    await getAvailableDevices()
    addLog('success', `發現 ${deviceState.data.availableDevices.length} 個音訊裝置`)
  }
  catch (error) {
    addLog('error', `掃描裝置失敗: ${error}`)
  }
}

async function startVolumeMonitoringForDevice() {
  if (!selectedDevice.value)
    return
  try {
    await startVolumeMonitoring(selectedDevice.value)
    addLog('success', `開始監測音量: ${selectedDevice.value.label}`)
  }
  catch (error) {
    addLog('error', `音量監測失敗: ${error}`)
  }
}

function stopVolumeMonitoringForDevice() {
  stopVolumeMonitoring()
  addLog('info', '停止音量監測')
}

async function connectWebSocket() {
  try {
    await connectWs()
    addLog('success', 'WebSocket 連線成功')
  }
  catch (error) {
    addLog('error', `WebSocket 連線失敗: ${error}`)
  }
}

function disconnectWebSocket() {
  disconnectWs()
  addLog('warning', 'WebSocket 連線已斷開')
}

// 前端斷線模擬功能 (保留但不在 UI 中使用)
function _simulateDisconnection() {
  const success = simulateWsDisconnection()
  if (success) {
    addLog('warning', '🔌 模擬斷線：強制關閉 WebSocket 連線')
  }
  else {
    addLog('error', '⚠️ 模擬斷線失敗：WebSocket 未連線')
  }
}

function toggleAutoReconnectFeature() {
  const isEnabled = toggleAutoReconnect()
  if (isEnabled) {
    addLog('success', '🔗 自動重連功能已開啟')
  }
  else {
    addLog('warning', '🔗 自動重連功能已關閉')
  }
}

// 後端斷線模擬功能
function simulateServerDisconnection(delayMs: number = 5000, durationMs?: number) {
  if (!isWsConnected.value) {
    addLog('error', '❌ 無法模擬後端斷線：WebSocket 未連線')
    return
  }

  addLog('info', `💓 心跳機制說明：斷線後心跳會繼續運作，檢測到異常時自動觸發重連`)

  if (!backgroundReconnectStatus.value) {
    addLog('warning', '⚠️ 當前自動重連已關閉，但心跳檢測到異常時仍會自動啟動重連')
  }

  const command: any = {
    action: 'schedule',
    delayMs,
  }

  // 只有當 durationMs 有值時才添加到命令中
  if (durationMs !== undefined) {
    command.durationMs = durationMs
  }

  const message = {
    type: 'disconnection_simulation',
    data: command,
    timestamp: new Date().toISOString(),
  }

  try {
    send(message)
    if (durationMs) {
      addLog('warning', `🚨 已排程後端斷線模擬：${delayMs}ms 後斷線，${durationMs}ms 後恢復`)

      // 添加驗證提示
      setTimeout(() => {
        addLog('info', `⏰ 預計 ${delayMs}ms 後後端將斷線`)
      }, 100)

      setTimeout(() => {
        addLog('info', `⏰ 預計 ${delayMs + durationMs}ms 後後端將恢復接受連線`)
      }, 100)

      setTimeout(() => {
        addLog('info', `⏰ 預計 ${delayMs + durationMs + 2000}ms 後前端將嘗試重連`)
      }, 100)
    }
    else {
      addLog('warning', `🚨 已排程後端斷線模擬：${delayMs}ms 後永久斷線（需手動恢復）`)

      setTimeout(() => {
        addLog('info', `⏰ 預計 ${delayMs}ms 後後端將永久斷線，直到手動恢復`)
      }, 100)
    }
  }
  catch (error) {
    addLog('error', `❌ 發送後端斷線命令失敗: ${error}`)
  }
}

function simulateServerDisconnectionImmediate() {
  if (!isWsConnected.value) {
    addLog('error', '❌ 無法模擬後端斷線：WebSocket 未連線')
    return
  }

  const command = {
    action: 'immediate',
  }

  const message = {
    type: 'disconnection_simulation',
    data: command,
    timestamp: new Date().toISOString(),
  }

  try {
    send(message)
    addLog('warning', '💥 已執行立即後端斷線模擬')
  }
  catch (error) {
    addLog('error', `❌ 發送立即斷線命令失敗: ${error}`)
  }
}

function restoreServerConnection() {
  if (!isWsConnected.value) {
    addLog('error', '❌ 無法恢復後端連線：WebSocket 未連線')
    return
  }

  const command = {
    action: 'restore',
  }

  const message = {
    type: 'disconnection_simulation',
    data: command,
    timestamp: new Date().toISOString(),
  }

  try {
    send(message)
    addLog('success', '🔄 已發送恢復後端連線命令')
  }
  catch (error) {
    addLog('error', `❌ 發送恢復連線命令失敗: ${error}`)
  }
}

function getServerSimulationStatus() {
  if (!isWsConnected.value) {
    addLog('error', '❌ 無法查詢狀態：WebSocket 未連線')
    return
  }

  const command = {
    action: 'status',
  }

  const message = {
    type: 'disconnection_simulation',
    data: command,
    timestamp: new Date().toISOString(),
  }

  try {
    send(message)
    addLog('info', '📊 已查詢後端模擬狀態')
  }
  catch (error) {
    addLog('error', `❌ 查詢狀態失敗: ${error}`)
  }
}

function stopServerSimulation() {
  if (!isWsConnected.value) {
    addLog('error', '❌ 無法停止模擬：WebSocket 未連線')
    return
  }

  const command = {
    action: 'stop',
  }

  const message = {
    type: 'disconnection_simulation',
    data: command,
    timestamp: new Date().toISOString(),
  }

  try {
    send(message)
    addLog('warning', '🛑 已發送停止模擬命令')
  }
  catch (error) {
    addLog('error', `❌ 停止模擬失敗: ${error}`)
  }
}

// 緊急重置功能 - 用於永久斷線後無法連線的情況
async function emergencyResetServer() {
  try {
    addLog('warning', '🚨 嘗試緊急重置後端狀態...')

    // 通過 HTTP API 重置服務器狀態
    const response = await fetch('/api/websocket-reset', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'reset_disconnection_simulation',
      }),
    })

    if (response.ok) {
      await response.json()
      addLog('success', '✅ 後端狀態已重置，請嘗試重新連線')

      // 等待一秒後自動嘗試連線
      setTimeout(() => {
        connectWebSocket()
      }, 1000)
    }
    else {
      addLog('error', '❌ 緊急重置失敗：HTTP 請求失敗')
    }
  }
  catch (error) {
    addLog('error', `❌ 緊急重置失敗: ${error}`)
  }
}

async function startRecording() {
  try {
    // 重置音訊串流狀態，傳入當前任務ID以判斷是否需要清除事件歷史
    resetStats(currentTaskId.value)

    // 清空歷史記錄，避免合併到之前的錄音
    clearHistory()

    const deviceId = selectedDeviceId.value || undefined
    await startRec(chunkDuration.value, deviceId)
    const deviceLabel = selectedDevice.value?.label || '預設裝置'
    addLog('success', `🎙️ 開始新錄音 (${chunkDuration.value}s chunks) - 裝置: ${deviceLabel}`)

    // 只有在任務ID改變時才提示清空歷史記錄
    if (currentTaskId.value) {
      addLog('info', `📋 使用任務ID: ${currentTaskId.value}`)
    }
  }
  catch (error) {
    addLog('error', `開始錄音失敗: ${error}`)
  }
}

function pauseRecording() {
  pauseRec()
  addLog('warning', '⏸️ 錄音已暫停，當前 chunk 已強制輸出')
}

async function resumeRecording() {
  try {
    const deviceId = selectedDeviceId.value || undefined
    await startRec(chunkDuration.value, deviceId)
    const deviceLabel = selectedDevice.value?.label || '預設裝置'
    addLog('success', `▶️ 錄音已繼續 - 裝置: ${deviceLabel}`)
  }
  catch (error) {
    addLog('error', `繼續錄音失敗: ${error}`)
  }
}

function stopRecording() {
  stopRec()
  addLog('info', '⏹️ 錄音已停止')
}

// 音訊合併功能
async function mergeAndDownloadAudio() {
  if (!chunkHistory.value || chunkHistory.value.length === 0) {
    addLog('warning', '沒有音訊 chunks 可以合併')
    return
  }

  try {
    mergeState.isProcessing = true
    addLog('info', `開始合併 ${chunkHistory.value.length} 個音訊片段...`)

    // 詳細檢查每個 chunk 的狀態
    console.log('🔍 詳細檢查 chunks:')
    chunkHistory.value.forEach((chunk, index) => {
      console.log(`Chunk ${index + 1}:`, {
        sequenceNumber: chunk.sequenceNumber,
        status: chunk.status,
        hasAudioData: !!chunk.audioData,
        audioDataLength: chunk.audioData?.length || 0,
        audioDataPreview: `${chunk.audioData?.substring(0, 20) || ''}...`,
        duration: chunk.duration,
        format: chunk.format,
        isLast: chunk.isLast,
      })
    })

    // 生成合併統計
    const stats = generateMergeStats([...chunkHistory.value])
    mergeState.lastMergeStats = stats

    console.log('🎵 音訊合併統計:', stats)
    addLog('info', `準備合併: ${stats.validChunks}/${stats.totalChunks} 個有效片段`)

    if (stats.validChunks === 0) {
      // 緊急 fallback：嘗試使用所有有音訊資料的 chunks，不管狀態
      const chunksWithAudio = [...chunkHistory.value].filter(chunk =>
        chunk.audioData && chunk.audioData.length > 0,
      )

      if (chunksWithAudio.length > 0) {
        addLog('warning', `使用 fallback 模式：找到 ${chunksWithAudio.length} 個有音訊資料的片段`)
        console.log('🔄 Fallback chunks:', chunksWithAudio.map(c => ({
          seq: c.sequenceNumber,
          status: c.status,
          audioLength: c.audioData.length,
        })))

        // 直接合併這些 chunks
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19)
        const filename = `fallback-recording-${timestamp}.webm`

        try {
          await mergeAndDownload(chunksWithAudio, filename)
          addLog('success', `Fallback 合併成功! 檔案已下載: ${filename}`)
        }
        catch (error) {
          console.error('Fallback 合併失敗:', error)
          addLog('error', `Fallback 合併失敗: ${error}`)
        }
      }
      else {
        addLog('error', '沒有任何包含音訊資料的片段可以合併')
      }
      return
    }

    if (stats.sequenceGaps.length > 0) {
      addLog('warning', `發現 ${stats.sequenceGaps.length} 個遺失的音訊片段: ${stats.sequenceGaps.join(', ')}`)
    }

    // 執行合併和下載
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19)
    const filename = `realtime-recording-${timestamp}.${stats.formats[0] || 'webm'}`

    await mergeAndDownload([...chunkHistory.value], filename)

    addLog('success', `音訊合併完成! 檔案已下載: ${filename}`)
    addLog('info', `合併統計: ${stats.validChunks} 片段, ${stats.totalDuration.toFixed(2)} 秒`)

    // 顯示詳細統計
    mergeState.showMergeStats = true
  }
  catch (error) {
    console.error('音訊合併失敗:', error)
    addLog('error', `音訊合併失敗: ${error instanceof Error ? error.message : error}`)
  }
  finally {
    mergeState.isProcessing = false
  }
}

// 進階音訊合併功能 (使用 Web Audio API)
async function mergeAndDownloadAudioAdvanced() {
  if (!chunkHistory.value || chunkHistory.value.length === 0) {
    addLog('warning', '沒有音訊 chunks 可以合併')
    return
  }

  try {
    mergeState.isProcessing = true
    addLog('info', `🚀 開始進階合併 ${chunkHistory.value.length} 個音訊片段...`)

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19)
    const filename = `advanced-recording-${timestamp}.wav`

    await mergeAndDownloadAdvanced([...chunkHistory.value], filename)

    addLog('success', `🎉 進階音訊合併完成! 檔案已下載: ${filename}`)
    addLog('info', '進階合併使用 Web Audio API，應該有正確的播放時間')
  }
  catch (error) {
    console.error('進階音訊合併失敗:', error)
    addLog('error', `進階音訊合併失敗: ${error instanceof Error ? error.message : error}`)
  }
  finally {
    mergeState.isProcessing = false
  }
}

// 生成合併統計資訊的計算屬性
const chunkMergeStats = computed(() => {
  if (!chunkHistory.value || chunkHistory.value.length === 0) {
    return null
  }
  return generateMergeStats([...chunkHistory.value])
})

// 檢查是否可以合併音訊
const canMergeAudio = computed(() => {
  return chunkHistory.value
    && chunkHistory.value.length > 0
    && !mergeState.isProcessing
    && !isRecording.value
})

function getChunkStatusClass(status: AudioChunkStatus): string {
  switch (status) {
    case AudioChunkStatus.PENDING:
      return 'bg-gray-100 text-gray-700'
    case AudioChunkStatus.SENT:
      return 'bg-blue-100 text-blue-700'
    case AudioChunkStatus.RECEIVED:
      return 'bg-yellow-100 text-yellow-700'
    case AudioChunkStatus.PROCESSED:
      return 'bg-green-100 text-green-700'
    case AudioChunkStatus.ERROR:
      return 'bg-red-100 text-red-700'
    default:
      return 'bg-gray-100 text-gray-700'
  }
}

function getChunkStatusText(status: AudioChunkStatus): string {
  switch (status) {
    case AudioChunkStatus.PENDING:
      return '待處理'
    case AudioChunkStatus.SENT:
      return '已發送'
    case AudioChunkStatus.RECEIVED:
      return '已接收'
    case AudioChunkStatus.PROCESSED:
      return '已處理'
    case AudioChunkStatus.ERROR:
      return '錯誤'
    default:
      return '未知'
  }
}

// 事件相關輔助函數
function getEventIcon(eventType: 'outgoing' | 'incoming', action: string): string {
  // 連線相關事件
  switch (action) {
    case 'connection_lost':
      return '🔌'
    case 'connection_restored':
      return '🔗'
    case 'queued':
    case 'queued_on_failure':
    case 'queued_on_error':
      return '⏳'
    case 'resend':
      return '🔄'
  }

  if (eventType === 'outgoing') {
    switch (action) {
      case 'send':
        return '↗️' // 改為向上箭頭（發送）
      default:
        return '↗️'
    }
  }
  else {
    switch (action) {
      case 'receive':
        return '↙️' // 改為向下箭頭（接收）
      case 'process':
        return '⚙️'
      case 'error':
        return '❌'
      default:
        return '↙️'
    }
  }
}

function getEventCardClass(eventType: 'outgoing' | 'incoming', action: string): string {
  // 連線相關事件
  switch (action) {
    case 'connection_lost':
      return 'border-red-300 bg-red-100'
    case 'connection_restored':
      return 'border-green-300 bg-green-100'
    case 'queued':
    case 'queued_on_failure':
    case 'queued_on_error':
      return 'border-yellow-300 bg-yellow-100'
    case 'resend':
      return 'border-blue-300 bg-blue-100'
  }

  if (eventType === 'outgoing') {
    return 'border-blue-200 bg-blue-50'
  }
  else {
    switch (action) {
      case 'receive':
        return 'border-green-200 bg-green-50'
      case 'process':
        return 'border-purple-200 bg-purple-50'
      case 'error':
        return 'border-red-200 bg-red-50'
      default:
        return 'border-gray-200 bg-gray-50'
    }
  }
}

function getEventStatusClass(status: AudioChunkStatus): string {
  switch (status) {
    case AudioChunkStatus.PENDING:
      return 'bg-gray-100 text-gray-700'
    case AudioChunkStatus.SENT:
      return 'bg-blue-100 text-blue-700'
    case AudioChunkStatus.RECEIVED:
      return 'bg-yellow-100 text-yellow-700'
    case AudioChunkStatus.PROCESSED:
      return 'bg-green-100 text-green-700'
    case AudioChunkStatus.ERROR:
      return 'bg-red-100 text-red-700'
    default:
      return 'bg-gray-100 text-gray-700'
  }
}

function getEventActionText(action: string): string {
  switch (action) {
    case 'send':
      return '發送'
    case 'receive':
      return '接收'
    case 'process':
      return '處理'
    case 'error':
      return '錯誤'
    case 'connection_lost':
      return '連線中斷'
    case 'connection_restored':
      return '連線恢復'
    case 'queued':
      return '加入佇列'
    case 'queued_on_failure':
      return '發送失敗佇列'
    case 'queued_on_error':
      return '異常暫存'
    case 'resend':
      return '重新發送'
    default:
      return action
  }
}

function getLogIcon(type: string): string {
  switch (type) {
    case 'success':
      return '✅'
    case 'error':
      return 'ERROR:'
    case 'warning':
      return '⚠️'
    default:
      return 'ℹ️'
  }
}

function getEventTitle(event: ChunkEvent): string {
  // 檢查是否為連線相關事件
  if (event.sequenceNumber === -1 && event.action === 'connection_lost') {
    return '連線中斷'
  }
  if (event.sequenceNumber === -2 && event.action === 'connection_restored') {
    return '連線恢復'
  }

  // 其他特殊事件
  if (event.sequenceNumber < 0) {
    switch (event.action) {
      case 'queued':
      case 'queued_on_failure':
      case 'queued_on_error':
        return `${event.eventType === 'outgoing' ? '發出' : '回來'} - 佇列暫存`
      case 'resend':
        return `${event.eventType === 'outgoing' ? '發出' : '回來'} - 重新發送`
      default:
        return `${event.eventType === 'outgoing' ? '發出' : '回來'} - 系統事件`
    }
  }

  // 正常的 chunk 事件
  return `${event.eventType === 'outgoing' ? '發出' : '回來'} - Chunk ${event.sequenceNumber}`
}

// 監聽新 chunk 產生（僅用於日誌記錄，實際發送由回呼函數處理）
watch(currentChunk, (newChunk) => {
  if (newChunk) {
    const lastIndicator = newChunk.isLast ? ' (LAST)' : ''
    addLog('info', `新 Chunk 生成: ${newChunk.sequenceNumber} (${newChunk.duration.toFixed(2)}s)${lastIndicator}`)

    // 注意：實際的 chunk 發送由 setChunkSender 設定的回呼函數處理
    // 這裡只負責 UI 日誌記錄，避免重複發送
    console.log(`📋 Chunk ${newChunk.sequenceNumber} 已生成，將由回呼系統自動發送`)
  }
})

// 監聽 WebSocket 訊息
watch(lastMessage, (newMessage) => {
  console.log('DEBUG: Vue收到WebSocket訊息', newMessage)
  console.log('DEBUG: 訊息類型:', newMessage?.type)
  console.log('DEBUG: 訊息資料:', newMessage?.data)

  // 強制顯示所有訊息類型
  if (newMessage) {
    console.log('DEBUG: 所有訊息詳情:', JSON.stringify(newMessage, null, 2))
  }

  // 處理標準 ACK 訊息
  if (newMessage?.type === 'ack') {
    console.log('INFO: 處理 ACK 訊息')
    try {
      // 後端發送的是完整的 ack 物件，不需要再 JSON.parse
      const ackData = newMessage.data

      console.log('LOG: 收到的原始 ACK 訊息:', newMessage)
      console.log('LOG: ACK 資料內容:', ackData)
      console.log('LOG: ACK status:', ackData.status)
      console.log('LOG: ACK chunkId:', ackData.chunkId)

      // 使用 audioStream 的 handleAckMessage
      const ackMessage = {
        type: 'ack' as const,
        data: {
          chunkId: ackData.chunkId,
          sequenceNumber: ackData.sequenceNumber,
          status: ackData.status,
          timestamp: ackData.timestamp,
          errorMessage: ackData.errorMessage,
        },
      }

      console.log('LOG: 傳遞給 handleAckMessage 的資料:', ackMessage)
      handleAckMessage(ackMessage)
      addLog('success', `收到 ACK: Chunk ${ackData.sequenceNumber} - ${ackData.status}`)
    }
    catch (error) {
      console.error('ERROR: 處理 ACK 異常:', error)
      addLog('error', `處理 ACK 失敗: ${error}`)
    }
  }

  // 處理 message-response 類型的訊息（音訊chunk確認）
  else if (newMessage?.type === 'message-response') {
    console.log('INFO: 處理 message-response')
    try {
      console.log('LOG: 收到 message-response:', newMessage)

      // newMessage.data 是完整的 parsedData，包含原始的 WebSocket 訊息結構
      const parsedData = newMessage.data
      const responsePayload = parsedData.data // 這是 message-response 的 data 部分

      console.log('LOG: parsedData:', parsedData)
      console.log('LOG: responsePayload:', responsePayload)

      // 檢查是否為 audio_stream 相關的 message-response
      if (responsePayload?.originalType === 'audio_stream' && responsePayload?.data?.chunkId) {
        console.log('INFO: 這是 audio_stream 的確認訊息')
        const chunkData = responsePayload.data

        console.log(`LOG: 處理音訊 chunk 確認 - chunkId: ${chunkData.chunkId}, sequenceNumber: ${chunkData.sequenceNumber}`)

        // 將 message-response 轉換為 ACK 格式
        const ackMessage = {
          type: 'ack' as const,
          data: {
            chunkId: chunkData.chunkId,
            sequenceNumber: chunkData.sequenceNumber,
            status: 'received' as const, // message-response 表示後端已收到
            timestamp: parsedData.timestamp,
            errorMessage: undefined,
          },
        }

        console.log('LOG: 轉換為 ACK 格式:', ackMessage)
        handleAckMessage(ackMessage)
        addLog('success', `音訊 Chunk ${chunkData.sequenceNumber} 已確認收到`)
      }
      else {
        console.log('LOG: 非 audio_stream 的 message-response，忽略')
      }
    }
    catch (error) {
      console.error('ERROR: 處理 message-response 異常:', error)
      addLog('error', `處理 message-response 失敗: ${error}`)
    }
  }

  // 處理後端斷線模擬回應
  else if (newMessage?.type === 'disconnection_simulation_response') {
    console.log('INFO: 收到後端斷線模擬回應:', newMessage)
    try {
      const response = newMessage.data
      if (response && response.success) {
        const message = response.message || '命令執行成功'
        addLog('success', `🎯 後端斷線模擬: ${message}`)
        if (response.data) {
          console.log('後端模擬狀態:', response.data)
          addLog('info', `模擬狀態: ${JSON.stringify(response.data)}`)
        }
      }
      else {
        const errorMessage = (response && response.message) || '未知錯誤'
        addLog('error', `❌ 後端斷線模擬失敗: ${errorMessage}`)
      }
    }
    catch (error) {
      console.error('ERROR: 處理斷線模擬回應異常:', error)
      addLog('error', `處理斷線模擬回應失敗: ${error}`)
    }
  }
})

// 監聽 WebSocket 連線狀態變化
watch(wsState, (newState, oldState) => {
  if (oldState && newState !== oldState) {
    addLog('info', `WebSocket 狀態: ${oldState} → ${newState}`)

    // 重連後記錄
    if (newState === 'connected' && oldState === 'disconnected') {
      addLog('info', '重連成功')
    }
  }
})

// 初始化
addLog('info', '🎙️ 實時音訊錄製測試頁面已載入')
</script>

<template>
  <div class="container mx-auto px-4 py-8">
    <div class="max-w-6xl mx-auto">
      <!-- 頁面標題 -->
      <div class="mb-8">
        <h1 class="text-3xl font-bold text-gray-900 mb-2">
          🎙️ 實時音訊錄製與串流測試
        </h1>
        <p class="text-gray-600">
          測試實時音訊錄製、3秒切分、暫停繼續邏輯、斷線重連機制
        </p>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- 左側：錄音控制與狀態 -->
        <div class="space-y-6">
          <!-- 音訊裝置選擇 -->
          <div class="bg-white rounded-lg shadow-md p-6">
            <h2 class="text-xl font-semibold mb-4 flex items-center">
              <span class="mr-2">🎤</span>
              音訊裝置
            </h2>

            <div class="space-y-4">
              <!-- 刷新裝置按鈕 -->
              <button
                :disabled="deviceState.loading.isGettingDevices"
                class="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                @click="refreshDevices"
              >
                {{ deviceState.loading.isGettingDevices ? '掃描中...' : 'LOG: 掃描音訊裝置' }}
              </button>

              <!-- 錯誤訊息 -->
              <div
                v-if="deviceState.errors.permissionError || deviceState.errors.deviceError"
                class="p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm"
              >
                {{ deviceState.errors.permissionError || deviceState.errors.deviceError }}
              </div>

              <!-- 裝置列表 -->
              <div
                v-if="deviceState.data.availableDevices.length > 0"
                class="space-y-2"
              >
                <label class="block text-sm font-medium text-gray-700">
                  選擇麥克風裝置
                </label>
                <select
                  v-model="selectedDeviceId"
                  class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  :disabled="isRecording"
                >
                  <option value="">
                    預設裝置
                  </option>
                  <option
                    v-for="device in deviceState.data.availableDevices"
                    :key="device.deviceId"
                    :value="device.deviceId"
                  >
                    {{ device.label }}
                  </option>
                </select>
              </div>

              <!-- 音量監測 -->
              <div
                v-if="selectedDevice"
                class="space-y-2"
              >
                <div class="flex items-center justify-between">
                  <span class="text-sm font-medium text-gray-700">音量監測</span>
                  <button
                    v-if="!deviceState.data.isMonitoringVolume"
                    class="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700 transition-colors"
                    @click="startVolumeMonitoringForDevice"
                  >
                    開始監測
                  </button>
                  <button
                    v-else
                    class="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700 transition-colors"
                    @click="stopVolumeMonitoringForDevice"
                  >
                    停止監測
                  </button>
                </div>
                <div class="w-full bg-gray-200 rounded-full h-2">
                  <div
                    class="bg-green-600 h-2 rounded-full transition-all duration-75"
                    :style="{ width: `${deviceState.data.currentVolumeLevel}%` }"
                  />
                </div>
                <div class="text-xs text-gray-500 text-center">
                  {{ deviceState.data.currentVolumeLevel.toFixed(1) }}%
                </div>
              </div>
            </div>
          </div>
          <!-- WebSocket 連線狀態 -->
          <div class="bg-white rounded-lg shadow-md p-6">
            <h2 class="text-xl font-semibold mb-4 flex items-center">
              <span class="mr-2">🔗</span>
              WebSocket 連線狀態
            </h2>

            <div class="flex items-center space-x-4 mb-4">
              <div
                class="w-4 h-4 rounded-full"
                :class="wsConnectionIndicator.class"
              />
              <span class="text-lg font-medium">
                {{ wsConnectionIndicator.icon }} {{ wsConnectionIndicator.text }}
              </span>
              <div
                v-if="backgroundReconnectStatus"
                class="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs"
              >
                🔄 自動重連已啟用
              </div>
            </div>

            <div class="flex space-x-3 mb-4">
              <button
                :disabled="isWsConnecting || isWsConnected"
                class="flex-1 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                @click="connectWebSocket"
              >
                {{ isWsConnecting ? '連線中...' : '開始連線' }}
              </button>
              <button
                :disabled="!isWsConnected"
                class="flex-1 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                @click="disconnectWebSocket"
              >
                斷開連線
              </button>
            </div>

            <!-- 連線測試按鈕 -->
            <div class="flex space-x-3 mb-3">
              <button
                class="w-full px-3 py-2 transition-colors text-sm rounded-md"
                :class="backgroundReconnectStatus ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-green-600 hover:bg-green-700 text-white'"
                @click="toggleAutoReconnectFeature"
              >
                {{ backgroundReconnectStatus ? '🔴 關閉自動重連' : '🔗 開啟自動重連' }}
              </button>
            </div>

            <!-- 後端斷線模擬按鈕 -->
            <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div class="text-sm font-medium text-yellow-800 mb-3">
                🚨 後端斷線模擬測試 (驗證專用)
              </div>

              <!-- 驗證場景按鈕 -->
              <div class="mb-3">
                <div class="text-xs text-yellow-700 mb-2 font-medium">
                  📋 驗證場景測試：
                </div>
                <div class="grid grid-cols-1 gap-2">
                  <button
                    :disabled="!isWsConnected"
                    class="px-3 py-2 bg-orange-500 text-white rounded-md hover:bg-orange-600 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors text-sm"
                    @click="simulateServerDisconnection(5000, 3000)"
                  >
                    📅 驗證場景：5秒後斷線3秒恢復 (測試 chunks 2,3,4 處理)
                  </button>
                  <button
                    :disabled="!isWsConnected"
                    class="px-3 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors text-sm"
                    @click="simulateServerDisconnection(5000)"
                  >
                    🔴 驗證場景：5秒後永久斷線 (測試長期斷線處理)
                  </button>
                </div>
              </div>

              <!-- 手動控制按鈕 -->
              <div class="border-t border-yellow-300 pt-3">
                <div class="text-xs text-yellow-700 mb-2 font-medium">
                  🎛️ 手動控制：
                </div>
                <div class="grid grid-cols-2 gap-2">
                  <button
                    :disabled="!isWsConnected"
                    class="px-3 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors text-sm"
                    @click="simulateServerDisconnectionImmediate()"
                  >
                    💥 立即斷線
                  </button>
                  <button
                    :disabled="!isWsConnected"
                    class="px-3 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors text-sm"
                    @click="restoreServerConnection()"
                  >
                    🔄 恢復連線
                  </button>
                  <button
                    :disabled="!isWsConnected"
                    class="px-3 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors text-sm"
                    @click="getServerSimulationStatus()"
                  >
                    📊 查詢狀態
                  </button>
                  <button
                    :disabled="!isWsConnected"
                    class="px-3 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors text-sm"
                    @click="stopServerSimulation()"
                  >
                    🛑 停止模擬
                  </button>
                </div>
              </div>

              <!-- 緊急重置區域 -->
              <div
                v-if="!isWsConnected"
                class="border-t border-red-300 pt-3 bg-red-50"
              >
                <div class="text-xs text-red-700 mb-2 font-medium">
                  🚨 連線問題排除：
                </div>
                <button
                  class="w-full px-3 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors text-sm"
                  @click="emergencyResetServer()"
                >
                  🆘 緊急重置後端狀態（永久斷線時使用）
                </button>
                <div class="text-xs text-red-600 mt-1">
                  當永久斷線後無法重新連線時使用此功能
                </div>
              </div>

              <div class="text-xs text-yellow-700 mt-2">
                用於驗證 pending chunks 處理和重連機制
              </div>
            </div>

            <!-- 修復原本的結構 -->
            <div class="hidden">
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <!-- 佔位內容 -->
                </div>
              </div>

              <div class="text-xs text-yellow-700 mt-2">
                用於驗證 pending chunks 處理和重連機制
              </div>
            </div>
          </div>

          <!-- 錄音控制 -->
          <div class="bg-white rounded-lg shadow-md p-6">
            <h2 class="text-xl font-semibold mb-4 flex items-center">
              <span class="mr-2">🎙️</span>
              錄音控制
            </h2>

            <!-- 錄音狀態指示器 -->
            <div class="mb-4 p-3 border rounded-lg bg-gray-50">
              <div class="flex items-center space-x-4 mb-2">
                <div
                  class="w-4 h-4 rounded-full"
                  :class="recordingIndicator.class"
                />
                <span class="text-lg font-medium">
                  {{ recordingIndicator.icon }} {{ recordingIndicator.text }}
                </span>
              </div>

              <!-- 錄音統計信息 -->
              <div
                v-if="stats"
                class="text-sm text-gray-600 grid grid-cols-2 gap-2"
              >
                <!-- <div>總時長: {{ Math.floor(stats.totalDuration) }}秒</div> -->
                <div>Chunk數: {{ stats.chunksGenerated }}</div>
                <div
                  v-if="recordingState === 'paused'"
                  class="col-span-2 text-yellow-600"
                >
                  💡 暫停狀態：點擊「繼續」恢復錄音，點擊「停止」結束會話
                </div>
              </div>
            </div>

            <!-- Chunk 時長設定 -->
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                Chunk 時長（秒）
              </label>
              <input
                v-model.number="chunkDuration"
                type="number"
                min="1"
                max="10"
                step="0.5"
                class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                :disabled="isRecording"
              >
            </div>

            <!-- 錄音控制按鈕 -->
            <div class="grid grid-cols-4 gap-2">
              <!-- 開始錄音按鈕 -->
              <button
                :disabled="!buttonStates.canStart"
                class="px-3 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors text-sm"
                @click="startRecording"
              >
                🔴 開始
              </button>

              <!-- 暫停錄音按鈕 -->
              <button
                :disabled="!buttonStates.canPause"
                class="px-3 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors text-sm"
                @click="pauseRecording"
              >
                ⏸️ 暫停
              </button>

              <!-- 繼續錄音按鈕 -->
              <button
                :disabled="!buttonStates.canResume"
                class="px-3 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors text-sm"
                @click="resumeRecording"
              >
                ▶️ 繼續
              </button>

              <!-- 停止錄音按鈕 -->
              <button
                :disabled="!buttonStates.canStop"
                class="px-3 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors text-sm"
                @click="stopRecording"
              >
                ⏹️ 停止
              </button>
            </div>

            <!-- 音訊合併與下載 -->
            <div class="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-md">
              <h4 class="text-sm font-medium text-blue-800 mb-3">
                🎵 音訊合併與驗證
              </h4>

              <!-- 合併統計 -->
              <div
                v-if="chunkMergeStats"
                class="text-xs text-blue-700 mb-3 grid grid-cols-2 gap-2"
              >
                <div>總片段: {{ chunkMergeStats.totalChunks }}</div>
                <div>有效片段: {{ chunkMergeStats.validChunks }}</div>
                <div>總長度: {{ chunkMergeStats.totalDuration.toFixed(1) }}秒</div>
                <div>格式: {{ chunkMergeStats.formats.join(', ') }}</div>
                <div
                  v-if="chunkMergeStats.sequenceGaps.length > 0"
                  class="col-span-2"
                >
                  <span class="text-yellow-600">⚠️ 遺失片段: {{ chunkMergeStats.sequenceGaps.length }}</span>
                </div>
              </div>

              <!-- 合併按鈕 -->
              <div class="grid grid-cols-1 gap-2">
                <button
                  :disabled="!canMergeAudio"
                  class="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
                  @click="mergeAndDownloadAudio"
                >
                  <span
                    v-if="mergeState.isProcessing"
                    class="animate-spin mr-2"
                  >⏳</span>
                  <span v-else>📥</span>
                  {{ mergeState.isProcessing ? '合併中...' : '基本合併 (WebM)' }}
                </button>

                <button
                  :disabled="!canMergeAudio"
                  class="w-full px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
                  @click="mergeAndDownloadAudioAdvanced"
                >
                  <span
                    v-if="mergeState.isProcessing"
                    class="animate-spin mr-2"
                  >⏳</span>
                  <span v-else>🎵</span>
                  {{ mergeState.isProcessing ? '進階合併中...' : '進階合併 (WAV)' }}
                </button>
              </div>

              <!-- 合併說明 -->
              <div class="text-xs text-blue-600 mt-2 space-y-1">
                <div><strong>基本合併:</strong> 直接拼接 chunks (可能有播放時間問題)</div>
                <div><strong>進階合併:</strong> 使用 Web Audio API，正確的播放時間</div>
              </div>
            </div>

            <!-- 錯誤訊息 -->
            <div
              v-if="errorMessage"
              class="mt-4 p-3 bg-red-50 border border-red-200 rounded-md"
            >
              <div class="flex justify-between items-start">
                <span class="text-sm text-red-700">{{ errorMessage }}</span>
                <button
                  class="text-red-500 hover:text-red-700"
                  @click="clearError"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>

          <!-- 錄音統計 -->
          <div class="bg-white rounded-lg shadow-md p-6">
            <h2 class="text-xl font-semibold mb-4 flex items-center">
              <span class="mr-2">📊</span>
              錄音統計
            </h2>

            <div class="grid grid-cols-2 gap-4">
              <div class="text-center">
                <div class="text-2xl font-bold text-blue-600">
                  {{ chunkHistory.length }}
                </div>
                <div class="text-sm text-gray-600">
                  錄音 Chunks
                </div>
              </div>
              <div class="text-center">
                <div class="text-2xl font-bold text-green-600">
                  {{ audioStats.legacyStats.sentChunks }}
                </div>
                <div class="text-sm text-gray-600">
                  已發送 Chunks
                </div>
              </div>
              <div class="text-center">
                <div class="text-2xl font-bold text-purple-600">
                  {{ chunkMergeStats?.validChunks || 0 }}
                </div>
                <div class="text-sm text-gray-600">
                  可合併片段
                </div>
              </div>
              <div class="text-center">
                <div class="text-2xl font-bold text-orange-600">
                  {{ chunkMergeStats?.totalDuration.toFixed(1) || '0.0' }}s
                </div>
                <div class="text-sm text-gray-600">
                  總音訊長度
                </div>
              </div>
              <!-- <div class="text-center">
                <div class="text-2xl font-bold text-purple-600">
                  {{ audioStats.legacyStats.acknowledgedChunks }}
                </div>
                <div class="text-sm text-gray-600">
                  已確認 Chunks
                </div>
              </div>
              <div class="text-center">
                <div class="text-2xl font-bold text-orange-600">
                  {{ audioStats.pendingChunks }}
                </div>
                <div class="text-sm text-gray-600">
                  等待確認
                </div>
              </div> -->
            </div>

            <div class="mt-4 pt-4 border-t border-gray-200">
              <div class="flex justify-between text-sm">
                <span>成功率:</span>
                <span
                  class="font-mono font-bold"
                  :class="parseFloat(audioStats.successRate) >= 90 ? 'text-green-600' : parseFloat(audioStats.successRate) >= 70 ? 'text-yellow-600' : 'text-red-600'"
                >
                  {{ audioStats.successRate }}%
                </span>
              </div>
              <div class="flex justify-between text-sm">
                <span>錯誤 Chunks:</span>
                <span
                  class="font-mono"
                  :class="audioStats.errorChunks > 0 ? 'text-red-600' : 'text-gray-600'"
                >
                  {{ audioStats.errorChunks }}
                </span>
              </div>
            </div>

            <!-- 詳細狀態分解 -->
            <div class="mt-4 pt-4 border-t border-gray-200">
              <div class="text-sm font-medium text-gray-700 mb-2">
                Chunk 狀態分解:
              </div>
              <div class="grid grid-cols-5 gap-2 text-xs">
                <div class="text-center">
                  <div class="text-gray-500 font-medium">
                    {{ audioStats.statusBreakdown.pending }}
                  </div>
                  <div class="text-gray-400">
                    待處理
                  </div>
                </div>
                <div class="text-center">
                  <div class="text-blue-600 font-medium">
                    {{ audioStats.statusBreakdown.sent }}
                  </div>
                  <div class="text-blue-400">
                    已發送
                  </div>
                </div>
                <div class="text-center">
                  <div class="text-yellow-600 font-medium">
                    {{ audioStats.statusBreakdown.received }}
                  </div>
                  <div class="text-yellow-400">
                    已接收
                  </div>
                </div>
                <div class="text-center">
                  <div class="text-green-600 font-medium">
                    {{ audioStats.statusBreakdown.processed }}
                  </div>
                  <div class="text-green-400">
                    已處理
                  </div>
                </div>
                <div class="text-center">
                  <div class="text-red-600 font-medium">
                    {{ audioStats.statusBreakdown.error }}
                  </div>
                  <div class="text-red-400">
                    錯誤
                  </div>
                </div>
              </div>
            </div>

            <div class="mt-4 pt-4 border-t border-gray-200">
              <div class="flex justify-between text-sm">
                <span>會話 ID:</span>
                <span class="font-mono text-xs">{{ stats.sessionId || 'N/A' }}</span>
              </div>
              <div class="flex justify-between text-sm">
                <span>斷線次數:</span>
                <span class="font-mono">{{ stats.disconnectionCount }}</span>
              </div>
            </div>

            <!-- 斷線重連狀態 -->
            <div
              v-if="audioStats.reconnectInfo"
              class="mt-4 pt-4 border-t border-orange-200"
              :class="audioStats.reconnectInfo.isConnectionDown ? 'bg-orange-50' : 'bg-green-50'"
            >
              <div
                class="text-sm font-medium mb-2"
                :class="audioStats.reconnectInfo.isConnectionDown ? 'text-orange-700' : 'text-green-700'"
              >
                🔌 連線狀態: {{ audioStats.reconnectInfo.isConnectionDown ? '連線中斷' : '連線正常' }}
              </div>

              <div
                v-if="audioStats.reconnectInfo.pendingChunksCount > 0"
                class="text-sm space-y-1"
              >
                <div class="flex justify-between">
                  <span>待發送 Chunks:</span>
                  <span class="font-mono font-bold text-orange-600">
                    {{ audioStats.reconnectInfo.pendingChunksCount }}
                  </span>
                </div>
                <div
                  v-if="audioStats.reconnectInfo.lastConnectionLostTime"
                  class="flex justify-between"
                >
                  <span>斷線時間:</span>
                  <span class="font-mono text-xs">
                    {{ formatTime(audioStats.reconnectInfo.lastConnectionLostTime) }}
                  </span>
                </div>
              </div>
            </div>

            <!-- Chunk 詳細列表 -->
            <div class="mt-4 pt-4 border-t border-gray-200">
              <div class="text-sm font-medium text-gray-700 mb-2 flex justify-between items-center">
                <span>📦 產生的 Chunks 列表 ({{ audioStats.generatedChunks }} 個)</span>
                <span class="text-xs text-gray-500">用於驗證事件紀錄一致性</span>
              </div>

              <div
                v-if="audioStats.chunkList && audioStats.chunkList.length > 0"
                class="max-h-32 overflow-y-auto bg-gray-50 rounded border"
              >
                <div class="divide-y divide-gray-200">
                  <div
                    v-for="chunk in audioStats.chunkList"
                    :key="chunk.id"
                    class="px-3 py-2 text-xs hover:bg-gray-100 transition-colors"
                  >
                    <div class="flex justify-between items-center">
                      <div class="flex items-center space-x-2">
                        <span class="font-mono font-bold text-blue-600">
                          #{{ chunk.sequenceNumber }}
                        </span>
                        <span
                          class="px-2 py-1 rounded-full text-xs font-medium"
                          :class="getChunkStatusClass(chunk.status)"
                        >
                          {{ getChunkStatusText(chunk.status) }}
                        </span>
                        <span
                          v-if="chunk.isLast"
                          class="px-1 py-0.5 bg-red-100 text-red-600 rounded text-xs font-bold"
                        >
                          LAST
                        </span>
                      </div>
                      <div class="text-gray-500">
                        {{ chunk.duration.toFixed(2) }}s
                      </div>
                    </div>

                    <div class="mt-1 text-gray-600">
                      <div class="flex justify-between">
                        <span class="font-mono text-xs">{{ chunk.id.substring(0, 12) }}...</span>
                        <span>{{ formatTime(chunk.timestamp) }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div
                v-else
                class="text-center text-gray-500 py-4 bg-gray-50 rounded border"
              >
                尚無 Chunk 資料
              </div>
            </div>

            <!-- 調試資訊面板 -->
            <div
              v-if="audioStats.debug && audioStats.debug.allChunkIds"
              class="mt-4 pt-4 border-t border-gray-200"
            >
              <div class="text-sm font-medium text-gray-700 mb-2">
                調試資訊:
              </div>
              <div class="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <div class="font-medium text-gray-600 mb-1">
                    舊系統計數器:
                  </div>
                  <div>已發送: {{ audioStats.debug.legacyCounters.totalSent }}</div>
                  <div>已確認: {{ audioStats.debug.legacyCounters.totalAcknowledged }}</div>
                  <div>錯誤: {{ audioStats.debug.legacyCounters.totalErrors }}</div>
                </div>
                <div>
                  <div class="font-medium text-gray-600 mb-1">
                    新系統狀態分佈:
                  </div>
                  <div>待處理: {{ audioStats.debug.statusDistribution.pending }}</div>
                  <div>已發送: {{ audioStats.debug.statusDistribution.sent }}</div>
                  <div>已接收: {{ audioStats.debug.statusDistribution.received }}</div>
                  <div>已處理: {{ audioStats.debug.statusDistribution.processed }}</div>
                  <div>錯誤: {{ audioStats.debug.statusDistribution.error }}</div>
                </div>
              </div>
              <div class="text-xs font-mono bg-gray-50 p-2 rounded max-h-24 overflow-y-auto mt-2">
                Chunks: {{ audioStats.debug.allChunkIds || '無資料' }}
              </div>
            </div>
          </div>
        </div>

        <!-- 右側：Chunk 歷史與監控 -->
        <div class="space-y-6">
          <!-- 當前 Chunk 資訊 -->
          <div class="bg-white rounded-lg shadow-md p-6">
            <h2 class="text-xl font-semibold mb-4 flex items-center">
              <span class="mr-2">📦</span>
              當前 Chunk 資訊
            </h2>

            <div
              v-if="currentChunk"
              class="space-y-3"
            >
              <div class="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span class="font-medium">序號:</span>
                  <span class="ml-2 font-mono">{{ currentChunk.sequenceNumber }}</span>
                </div>
                <div>
                  <span class="font-medium">時長:</span>
                  <span class="ml-2 font-mono">{{ currentChunk.duration.toFixed(2) }}s</span>
                </div>
                <div>
                  <span class="font-medium">狀態:</span>
                  <span class="ml-2">
                    <span
                      class="px-2 py-1 rounded-full text-xs"
                      :class="getChunkStatusClass(currentChunk.status)"
                    >
                      {{ getChunkStatusText(currentChunk.status) }}
                    </span>
                  </span>
                </div>
                <div>
                  <span class="font-medium">格式:</span>
                  <span class="ml-2 font-mono">{{ currentChunk.format }}</span>
                </div>
              </div>

              <div class="text-sm">
                <span class="font-medium">Chunk ID:</span>
                <span class="ml-2 font-mono text-xs break-all">{{ currentChunk.id }}</span>
              </div>

              <div class="text-sm">
                <span class="font-medium">時間戳:</span>
                <span class="ml-2 font-mono">{{ formatTime(currentChunk.timestamp) }}</span>
              </div>

              <div
                v-if="currentChunk.isLast"
                class="text-sm text-red-600 font-medium"
              >
                🏁 最後一個 Chunk
              </div>
            </div>

            <div
              v-else
              class="text-center text-gray-500 py-8"
            >
              尚無 Chunk 資料
            </div>
          </div>

          <!-- 事件歷史記錄 -->
          <div class="bg-white rounded-lg shadow-md p-6">
            <div class="flex justify-between items-center mb-4">
              <h2 class="text-xl font-semibold flex items-center">
                <span class="mr-2">📋</span>
                事件歷史記錄
              </h2>
              <button
                class="px-3 py-1 bg-gray-500 text-white rounded text-sm hover:bg-gray-600 transition-colors"
                @click="manualClearEventHistory"
              >
                清除歷史
              </button>
            </div>

            <!-- Chunk 狀態說明 -->
            <div class="mb-6 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg">
              <div class="flex items-center mb-3">
                <span class="text-lg mr-2">🏷️</span>
                <h3 class="font-semibold text-blue-800">
                  Chunk 狀態說明
                </h3>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
                <!-- PENDING 狀態 -->
                <div class="flex items-center space-x-2 p-2 bg-white rounded shadow-sm border-l-4 border-gray-400">
                  <div class="w-3 h-3 bg-gray-400 rounded-full" />
                  <div>
                    <div class="font-medium text-gray-700 text-sm">
                      PENDING
                    </div>
                    <div class="text-xs text-gray-500">
                      待處理
                    </div>
                  </div>
                </div>

                <!-- SENT 狀態 -->
                <div class="flex items-center space-x-2 p-2 bg-white rounded shadow-sm border-l-4 border-blue-400">
                  <div class="w-3 h-3 bg-blue-400 rounded-full" />
                  <div>
                    <div class="font-medium text-blue-700 text-sm">
                      SENT
                    </div>
                    <div class="text-xs text-blue-500">
                      已發送
                    </div>
                  </div>
                </div>

                <!-- RECEIVED 狀態 -->
                <div class="flex items-center space-x-2 p-2 bg-white rounded shadow-sm border-l-4 border-yellow-400">
                  <div class="w-3 h-3 bg-yellow-400 rounded-full" />
                  <div>
                    <div class="font-medium text-yellow-700 text-sm">
                      RECEIVED
                    </div>
                    <div class="text-xs text-yellow-600">
                      已接收
                    </div>
                  </div>
                </div>

                <!-- PROCESSED 狀態 -->
                <div class="flex items-center space-x-2 p-2 bg-white rounded shadow-sm border-l-4 border-green-400">
                  <div class="w-3 h-3 bg-green-400 rounded-full" />
                  <div>
                    <div class="font-medium text-green-700 text-sm">
                      PROCESSED
                    </div>
                    <div class="text-xs text-green-600">
                      已處理
                    </div>
                  </div>
                </div>

                <!-- ERROR 狀態 -->
                <div class="flex items-center space-x-2 p-2 bg-white rounded shadow-sm border-l-4 border-red-400">
                  <div class="w-3 h-3 bg-red-400 rounded-full" />
                  <div>
                    <div class="font-medium text-red-700 text-sm">
                      ERROR
                    </div>
                    <div class="text-xs text-red-500">
                      錯誤
                    </div>
                  </div>
                </div>
              </div>

              <!-- 狀態流程說明 -->
              <div class="mt-4 p-3 bg-white bg-opacity-50 rounded border border-blue-200">
                <div class="flex items-center mb-2">
                  <span class="text-sm mr-2">🔄</span>
                  <span class="font-medium text-blue-800 text-sm">狀態流程：</span>
                </div>
                <div class="flex items-center space-x-2 text-xs text-blue-700">
                  <span class="font-mono bg-white px-2 py-1 rounded border">PENDING</span>
                  <span>→</span>
                  <span class="font-mono bg-white px-2 py-1 rounded border">SENT</span>
                  <span>→</span>
                  <span class="font-mono bg-white px-2 py-1 rounded border">RECEIVED</span>
                  <span>→</span>
                  <span class="font-mono bg-white px-2 py-1 rounded border">PROCESSED</span>
                </div>
                <div class="mt-1 text-xs text-blue-600">
                  ※ 任何階段都可能轉為 ERROR 狀態
                </div>
              </div>
            </div>

            <!-- 事件總數顯示 -->
            <div class="mb-4 p-2 bg-gray-100 rounded-lg">
              <div class="text-sm text-gray-600 text-center">
                📋 事件歷史記錄 ({{ currentEvents.length }})
              </div>
            </div>

            <div class="max-h-96 overflow-y-auto">
              <div
                v-if="currentEvents.length > 0"
                class="space-y-2"
              >
                <div
                  v-for="event in currentEvents"
                  :key="event.id"
                  class="border rounded-lg p-3 text-sm"
                  :class="getEventCardClass(event.eventType, event.action)"
                >
                  <div class="flex justify-between items-start mb-2">
                    <div class="flex items-center space-x-2">
                      <span class="text-lg">{{ getEventIcon(event.eventType, event.action) }}</span>
                      <span class="font-medium">
                        {{ getEventTitle(event) }}
                      </span>
                    </div>
                    <span
                      class="px-2 py-1 rounded-full text-xs font-medium"
                      :class="getEventStatusClass(event.status)"
                    >
                      {{ getEventActionText(event.action) }}
                    </span>
                  </div>

                  <div class="grid grid-cols-2 gap-2 text-xs text-gray-600">
                    <div>時間: {{ formatTime(event.timestamp) }}</div>
                    <div v-if="event.duration">
                      時長: {{ event.duration.toFixed(2) }}s
                    </div>
                    <div>動作: {{ event.action }}</div>
                    <div>狀態: {{ event.status }}</div>
                  </div>

                  <div
                    v-if="event.details"
                    class="mt-2 text-xs text-gray-600"
                  >
                    詳情: {{ event.details }}
                  </div>

                  <div
                    v-if="event.metadata"
                    class="mt-2 text-xs text-gray-500"
                  >
                    Metadata: {{ JSON.stringify(event.metadata, null, 0) }}
                  </div>
                </div>
              </div>

              <div
                v-else
                class="text-center text-gray-500 py-8"
              >
                尚無事件記錄
              </div>
            </div>
          </div>

          <!-- 斷線記錄 -->
          <div class="bg-white rounded-lg shadow-md p-6">
            <h2 class="text-xl font-semibold mb-4 flex items-center">
              <span class="mr-2">🔌</span>
              斷線記錄
            </h2>

            <div
              v-if="disconnectionRecords.length > 0"
              class="space-y-2 max-h-48 overflow-y-auto"
            >
              <div
                v-for="(record, index) in disconnectionRecords"
                :key="index"
                class="border border-orange-200 rounded-lg p-3 text-sm bg-orange-50"
              >
                <div class="flex justify-between items-center">
                  <span class="font-medium">斷線 {{ index + 1 }}</span>
                  <span class="text-xs text-gray-600">
                    {{ record.timePoint.toFixed(2) }}s
                  </span>
                </div>

                <div class="text-xs text-gray-600 mt-1">
                  Chunk ID: {{ record.chunkId }}
                </div>

                <div
                  v-if="record.reconnectedAt"
                  class="text-xs text-green-600 mt-1"
                >
                  ✅ 已重連: {{ formatTime(record.reconnectedAt) }}
                </div>
              </div>
            </div>

            <div
              v-else
              class="text-center text-gray-500 py-4"
            >
              無斷線記錄
            </div>
          </div>
        </div>
      </div>

      <!-- 底部：活動日誌 -->
      <div class="mt-8 bg-white rounded-lg shadow-md p-6">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-xl font-semibold flex items-center">
            <span class="mr-2">📝</span>
            活動日誌
          </h2>
          <button
            class="px-3 py-1 bg-gray-500 text-white rounded text-sm hover:bg-gray-600 transition-colors"
            @click="clearLogs"
          >
            清除日誌
          </button>
        </div>

        <div class="max-h-64 overflow-y-auto bg-gray-50 rounded-lg p-4">
          <div
            v-if="logs.length > 0"
            class="space-y-1"
          >
            <div
              v-for="log in logs.slice().reverse().slice(0, 50)"
              :key="log.timestamp + log.message"
              class="text-sm font-mono flex items-start space-x-2"
            >
              <span class="text-gray-500 text-xs shrink-0">{{ log.timestamp }}</span>
              <span
                class="shrink-0"
                :class="{
                  'text-green-600': log.type === 'success',
                  'text-red-600': log.type === 'error',
                  'text-yellow-600': log.type === 'warning',
                  'text-blue-600': log.type === 'info',
                }"
              >
                {{ getLogIcon(log.type) }}
              </span>
              <span class="break-all">{{ log.message }}</span>
            </div>
          </div>

          <div
            v-else
            class="text-center text-gray-500 py-4"
          >
            尚無日誌記錄
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.animate-pulse {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
</style>
