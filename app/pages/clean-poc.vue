<script setup lang="ts">
import type { AudioChunk } from '~/service/schema/audioStream'
import { computed, onMounted, onUnmounted, reactive, watch } from 'vue'

import { useAudioStream } from '~/composables/poc/useAudioStream'
import { RecordingState } from '~/composables/poc/useRealTimeAudioRecorder'
import { useRealTimeRecording } from '~/composables/poc/useRealTimeRecording'
import { useWebSocketPoc } from '~/composables/poc/useWebSocketPoc'

// WebSocket 配置
const wsConfig = reactive({
  url: 'ws://localhost:8080/poc2',
  reconnectAttempts: 20,
  reconnectInterval: 2000,
  heartbeatInterval: 5000,
  backgroundReconnectEnabled: true,
  minReconnectDelay: 2000,
  maxReconnectDelay: 8000,
  exponentialBackoff: false,
})

// 導入既有的 composables
const {
  connect,
  disconnect,
  send,
  isConnected,
  isConnecting,
  currentTaskId,
  reconnectCount,
  lastMessage,
  onConnectionEstablished: onWsConnectionEstablished,
  onConnectionLost: onWsConnectionLost,
} = useWebSocketPoc(wsConfig)

const {
  startRecording,
  stopRecording,
  pauseRecording,
  recordingState,
  canStart,
  canResume,
  stats,
  clearHistory,
  setConnectionChecker,
  setChunkSender,
} = useRealTimeRecording()

const {
  sendChunk,
  audioState,
  stats: audioStats,
  handleAckMessage,
  resetStats,
  getCategorizedEventHistory,
  clearEventHistory,
  onConnectionLost: onAudioConnectionLost,
  onConnectionRestored,
  downloadCompleteRecording,
  processPendingChunks,
} = useAudioStream()

// 計算屬性
const connectionStatusText = computed(() => {
  if (isConnected.value)
    return '已連接'
  if (isConnecting.value)
    return '連接中'
  return '未連接'
})

const connectionIcon = computed(() => {
  if (isConnected.value)
    return '🟢'
  if (isConnecting.value)
    return '🟡'
  return '🔴'
})

const connectionStatusClass = computed(() => {
  if (isConnected.value)
    return 'bg-green-50 border border-green-200'
  if (isConnecting.value)
    return 'bg-yellow-50 border border-yellow-200'
  return 'bg-red-50 border border-red-200'
})

const recordingStatusText = computed(() => {
  switch (recordingState.value) {
    case RecordingState.RECORDING: return '錄製中'
    case RecordingState.PAUSED: return '已暫停'
    case RecordingState.STOPPED: return '已停止'
    default: return '閒置'
  }
})

const recordingStatusClass = computed(() => {
  switch (recordingState.value) {
    case RecordingState.RECORDING: return 'bg-red-50 border border-red-200'
    case RecordingState.PAUSED: return 'bg-yellow-50 border border-yellow-200'
    default: return 'bg-gray-50 border border-gray-200'
  }
})

const recordingIndicatorClass = computed(() => {
  switch (recordingState.value) {
    case RecordingState.RECORDING: return 'bg-red-400 animate-pulse'
    case RecordingState.PAUSED: return 'bg-yellow-400'
    default: return 'bg-gray-300'
  }
})

// 按鈕狀態
const canStartRecording = computed(() =>
  canStart.value && isConnected.value,
)

const canPauseRecording = computed(() =>
  recordingState.value === RecordingState.RECORDING,
)

const canStopRecording = computed(() =>
  recordingState.value === RecordingState.RECORDING || recordingState.value === RecordingState.PAUSED,
)

const queueLength = computed(() => {
  return audioState.sendQueue?.length || 0
})

// 事件相關
const currentEvents = computed(() => {
  const categorized = getCategorizedEventHistory()
  // 合併所有事件並按時間排序
  const allEvents = [
    ...categorized.outgoing,
    ...categorized.incoming,
  ].sort((a, b) => b.timestamp - a.timestamp)

  return allEvents.slice(0, 50) // 只顯示最新的50個事件
})

// 工具函數
function getEventIcon(eventType: 'outgoing' | 'incoming') {
  return eventType === 'outgoing' ? '↗️' : '↙️'
}

function getStatusColor(status: string) {
  switch (status) {
    case 'sent': return 'text-blue-600'
    case 'acknowledged': return 'text-green-600'
    case 'error': return 'text-red-600'
    default: return 'text-gray-600'
  }
}

function getEventBackgroundClass(event: any) {
  // 根據事件動作類型決定底色
  switch (event.action) {
    case 'send':
      return 'bg-blue-50 border-l-4 border-blue-200'
    case 'receive':
      return 'bg-green-50 border-l-4 border-green-200'
    case 'process':
      return 'bg-purple-50 border-l-4 border-purple-200'
    case 'queued':
      return 'bg-yellow-50 border-l-4 border-yellow-200'
    case 'connection_lost':
      return 'bg-red-50 border-l-4 border-red-300'
    case 'connection_restored':
      return 'bg-emerald-50 border-l-4 border-emerald-300'
    case 'error':
      return 'bg-red-100 border-l-4 border-red-400'
    default:
      return 'bg-gray-50 border-l-4 border-gray-200'
  }
}

// 事件處理函數
async function handleStartRecording() {
  try {
    // 重置音訊串流狀態和清空歷史記錄
    resetStats(currentTaskId.value)
    clearHistory()
    clearEventHistory()

    await startRecording()
    console.log('🎙️ 開始新錄音，已清除前次統計數據')
  }
  catch (error) {
    console.error('開始錄音失敗:', error)
  }
}

async function handleResumeRecording() {
  try {
    // 由於 useRealTimeRecording 沒有 resumeRecording，我們直接使用 startRecording
    await startRecording()
  }
  catch (error) {
    console.error('恢復錄音失敗:', error)
  }
}

async function handleDownloadRecording() {
  try {
    const success = await downloadCompleteRecording()
    if (!success) {
      console.warn('下載失敗：沒有可用的錄音數據')
    }
  }
  catch (error) {
    console.error('下載錄音檔案時發生錯誤:', error)
  }
}

function handleResetStats() {
  resetStats()
  clearHistory()
}

// WebSocket 訊息處理 - 使用與 realtime-audio-test.vue 相同的成熟邏輯
watch(lastMessage, (newMessage) => {
  if (!newMessage)
    return

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
      console.log(`✅ 收到 ACK: Chunk ${ackData.sequenceNumber} - ${ackData.status}`)
    }
    catch (error) {
      console.error('ERROR: 處理 ACK 異常:', error)
      console.error(`❌ 處理 ACK 失敗: ${error}`)
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
        console.log(`✅ 音訊 Chunk ${chunkData.sequenceNumber} 已確認收到`)
      }
      else {
        console.log('LOG: 非 audio_stream 的 message-response，忽略')
      }
    }
    catch (error) {
      console.error('ERROR: 處理 message-response 異常:', error)
      console.error(`❌ 處理 message-response 失敗: ${error}`)
    }
  }
})

// 生命週期設置
onMounted(() => {
  // 設置連接檢查器
  setConnectionChecker(() => isConnected.value)

  // 設置 chunk 發送函數 - 這樣錄音系統產生的 chunk 會自動發送到音訊串流系統
  setChunkSender((chunk: AudioChunk) => {
    console.log(`🔗 Recording system sending chunk ${chunk.sequenceNumber} to audio stream`)

    const lastIndicator = chunk.isLast ? ' (LAST)' : ''

    // 【重要修復】不管連線狀態如何，都要將 chunk 傳遞到音訊串流系統進行追蹤和處理
    // 音訊串流系統內部會根據連線狀態決定立即發送還是暫存為 pending
    try {
      const success = sendChunk(chunk, send, currentTaskId.value || undefined)
      console.log(`📊 Chunk ${chunk.sequenceNumber} 發送結果: ${success}, 狀態: ${chunk.status}`)

      if (isConnected.value) {
        // 連線正常時的處理
        if (success) {
          console.log(`✅ 發送 Chunk ${chunk.sequenceNumber} (${chunk.duration.toFixed(2)}s)${lastIndicator}`)
        }
        else {
          console.log(`❌ 發送 Chunk ${chunk.sequenceNumber} 失敗`)
        }
      }
      else {
        // 連線中斷時的處理 - chunk 會被暫存為 pending
        console.log(`⚠️ WebSocket 未連線，Chunk ${chunk.sequenceNumber} 已暫存等待重連${lastIndicator}`)
      }
    }
    catch (error) {
      console.error('ERROR: sendChunk 執行失敗:', error)
      console.log(`❌ 發送 Chunk ${chunk.sequenceNumber} 異常: ${error}`)
    }
  })

  // 設置斷線重連回調
  onWsConnectionEstablished(async () => {
    console.log('🔗 WebSocket 連線建立，通知音訊串流系統')
    console.log(`📊 重連時錄音狀態: ${recordingState.value}`)
    console.log(`📊 重連時已生成 chunks 數量: ${audioStats.value.totalChunks}`)

    onConnectionRestored()

    // 處理重連後的 pending chunks
    console.log('🔄 Processing pending chunks after reconnection')
    try {
      await processPendingChunks(send, currentTaskId.value || undefined)
      console.log('✅ 重連後待發送 chunks 處理完成')
      console.log(`📊 處理完成後錄音狀態: ${recordingState.value}`)
    }
    catch (error) {
      console.error('處理 pending chunks 時發生錯誤:', error)
      console.log(`❌ 處理 pending chunks 時發生錯誤: ${error}`)
    }
  })

  onWsConnectionLost(() => {
    console.log('WebSocket 連接已斷開')
    onAudioConnectionLost()
  })

  // 自動連接
  if (!isConnected.value) {
    connect()
  }
})

onUnmounted(() => {
  if (isConnected.value) {
    disconnect()
  }
})
</script>

<template>
  <div class="min-h-screen bg-gray-50 p-6">
    <div class="max-w-6xl mx-auto space-y-6">
      <!-- 頁面標題 -->
      <div class="text-center mb-8">
        <h1 class="text-3xl font-bold text-gray-800 mb-2">
          Clean POC - 音頻錄製與傳輸
        </h1>
        <p class="text-gray-600">
          直接使用既有功能的乾淨實作
        </p>
      </div>

      <!-- 連接狀態區域 -->
      <div class="bg-white rounded-lg shadow-md p-6">
        <h2 class="text-xl font-semibold mb-4">
          連接狀態
        </h2>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div
            class="text-center p-4 rounded-lg"
            :class="connectionStatusClass"
          >
            <div class="text-2xl mb-2">
              {{ connectionIcon }}
            </div>
            <div class="font-semibold">
              {{ connectionStatusText }}
            </div>
            <div
              v-if="reconnectCount > 0"
              class="text-sm text-gray-600 mt-1"
            >
              重連次數: {{ reconnectCount }}
            </div>
          </div>
          <div class="text-center p-4 bg-blue-50 rounded-lg">
            <div class="text-lg font-semibold text-blue-600">
              {{ currentTaskId || 'N/A' }}
            </div>
            <div class="text-sm text-gray-600">
              任務ID
            </div>
          </div>
          <div
            class="text-center p-4 rounded-lg"
            :class="recordingStatusClass"
          >
            <div
              class="w-4 h-4 rounded-full mx-auto mb-2"
              :class="recordingIndicatorClass"
            />
            <div class="font-semibold">
              {{ recordingStatusText }}
            </div>
            <div
              v-if="recordingState !== RecordingState.IDLE"
              class="text-sm"
            >
              {{ Math.round(stats.totalDuration) }}秒
            </div>
          </div>
        </div>
      </div>

      <!-- 控制按鈕區域 -->
      <div class="bg-white rounded-lg shadow-md p-6">
        <h2 class="text-xl font-semibold mb-4">
          控制面板
        </h2>
        <div class="flex flex-wrap gap-4 justify-center">
          <!-- WebSocket 連接控制 -->
          <button
            :disabled="isConnected || isConnecting"
            class="px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
            @click="connect"
          >
            {{ isConnecting ? '連接中...' : '連接' }}
          </button>

          <button
            :disabled="!isConnected"
            class="px-6 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
            @click="disconnect"
          >
            斷線
          </button>

          <!-- 錄音控制 -->
          <button
            :disabled="!canStartRecording"
            class="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
            @click="handleStartRecording"
          >
            開始錄音
          </button>

          <button
            :disabled="!canPauseRecording"
            class="px-6 py-3 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 disabled:opacity-50 disabled:cursor-not-allowed"
            @click="pauseRecording"
          >
            暫停錄音
          </button>

          <button
            :disabled="!canResume"
            class="px-6 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed"
            @click="handleResumeRecording"
          >
            繼續錄音
          </button>

          <button
            :disabled="!canStopRecording"
            class="px-6 py-3 bg-purple-500 text-white rounded-lg hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed"
            @click="stopRecording"
          >
            停止錄音
          </button>

          <!-- 其他控制 -->
          <button
            :disabled="audioStats.totalChunks === 0"
            class="px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
            @click="handleDownloadRecording"
          >
            下載錄音
          </button>

          <button
            class="px-6 py-3 bg-gray-500 text-white rounded-lg hover:bg-gray-600"
            @click="handleResetStats"
          >
            重置統計
          </button>
        </div>
      </div>

      <!-- 統計信息區域 -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- 錄音統計 -->
        <div class="bg-white rounded-lg shadow-md p-6">
          <h2 class="text-xl font-semibold mb-4">
            錄音統計
          </h2>
          <div class="space-y-3">
            <div>會話ID: {{ stats.sessionId || 'N/A' }}</div>
            <div>錄音時長: {{ Math.round(stats.totalDuration) }} 秒</div>
            <div>生成區塊數: {{ stats.chunksGenerated }}</div>
            <div>斷線次數: {{ stats.disconnectionCount }}</div>
          </div>
        </div>

        <!-- 音頻串流統計 -->
        <div class="bg-white rounded-lg shadow-md p-6">
          <h2 class="text-xl font-semibold mb-4">
            傳輸統計
          </h2>
          <div class="grid grid-cols-2 gap-4">
            <div class="text-center p-3 bg-gray-50 rounded">
              <div class="text-2xl font-bold text-gray-600">
                {{ audioStats.totalChunks }}
              </div>
              <div class="text-sm">
                總區塊
              </div>
            </div>
            <div class="text-center p-3 bg-blue-50 rounded">
              <div class="text-2xl font-bold text-blue-600">
                {{ audioStats.sentChunks }}
              </div>
              <div class="text-sm">
                已發送
              </div>
            </div>
            <div class="text-center p-3 bg-green-50 rounded">
              <div class="text-2xl font-bold text-green-600">
                {{ audioStats.acknowledgedChunks }}
              </div>
              <div class="text-sm">
                已確認
              </div>
            </div>
            <div class="text-center p-3 bg-red-50 rounded">
              <div class="text-2xl font-bold text-red-600">
                {{ audioStats.errorChunks }}
              </div>
              <div class="text-sm">
                錯誤數
              </div>
            </div>
            <div class="text-center p-3 bg-yellow-50 rounded">
              <div class="text-2xl font-bold text-yellow-600">
                {{ audioStats.pendingChunks }}
              </div>
              <div class="text-sm">
                待處理
              </div>
            </div>
            <div class="text-center p-3 bg-purple-50 rounded">
              <div class="text-2xl font-bold text-purple-600">
                {{ queueLength }}
              </div>
              <div class="text-sm">
                佇列長度
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 事件歷史區域 -->
      <div class="bg-white rounded-lg shadow-md p-6">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-xl font-semibold">
            事件歷史
          </h2>
          <button
            class="px-4 py-2 bg-gray-400 text-white rounded hover:bg-gray-500"
            @click="clearEventHistory"
          >
            清除歷史
          </button>
        </div>

        <div class="max-h-80 overflow-y-auto">
          <div
            v-if="currentEvents.length === 0"
            class="text-center text-gray-500 py-8"
          >
            尚無事件記錄
          </div>
          <div
            v-else
            class="space-y-2"
          >
            <div
              v-for="event in currentEvents"
              :key="event.id"
              class="flex items-center justify-between p-3 rounded-lg"
              :class="getEventBackgroundClass(event)"
            >
              <div class="flex items-center space-x-3">
                <span class="text-lg">{{ getEventIcon(event.eventType) }}</span>
                <div>
                  <div class="font-medium">
                    {{ event.action }}
                  </div>
                  <div class="text-sm text-gray-500">
                    Chunk: {{ event.chunkId }} | Seq: {{ event.sequenceNumber }}
                  </div>
                </div>
              </div>
              <div class="text-right">
                <div
                  class="text-sm font-medium"
                  :class="getStatusColor(event.status)"
                >
                  {{ event.status }}
                </div>
                <div class="text-xs text-gray-500">
                  {{ new Date(event.timestamp).toLocaleTimeString() }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 自定義樣式 */
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
