# Clean POC Composables API 參考文檔

## 📚 Composables 概述

Clean POC 系統使用了三個核心 composables 來實現音頻錄製與串流傳輸功能：

- `useWebSocketPoc`: WebSocket 連線管理與心跳機制
- `useRealTimeRecording`: 即時音頻錄製與 chunk 生成
- `useAudioStream`: 音頻串流傳輸與事件管理

## 🔌 useWebSocketPoc

### 配置介面

```typescript
interface WebSocketPocConfig {
  url: string // WebSocket 伺服器 URL
  protocols?: string[] // WebSocket 協定
  reconnectAttempts?: number // 重連嘗試次數 (預設: 10)
  reconnectInterval?: number // 重連間隔 ms (預設: 3000)
  heartbeatInterval?: number // 心跳間隔 ms (預設: 30000)
  backgroundReconnectEnabled?: boolean // 背景重連開關 (預設: true)
  minReconnectDelay?: number // 最小重連延遲 ms (預設: 1000)
  maxReconnectDelay?: number // 最大重連延遲 ms (預設: 5000)
  exponentialBackoff?: boolean // 指數退避算法 (預設: true)
}
```

### 回傳介面

```typescript
interface UseWebSocketPocReturn {
  // === 主要方法 ===
  connect: () => void // 建立連線
  disconnect: () => void // 中斷連線
  send: (message: any) => boolean // 發送訊息
  state: ComputedRef<WebSocketConnectionState> // 連線狀態

  // === 詳細狀態 ===
  isConnecting: ComputedRef<boolean> // 是否連接中
  isConnected: ComputedRef<boolean> // 是否已連接
  isDisconnected: ComputedRef<boolean> // 是否已斷線
  hasError: ComputedRef<boolean> // 是否有錯誤

  // === 訊息與錯誤 ===
  lastError: Ref<string | null> // 最後錯誤訊息
  lastMessage: Ref<WebSocketMessage | null> // 最後接收訊息
  messageHistory: Ref<WebSocketMessage[]> // 訊息歷史

  // === 輔助方法 ===
  clearPocError: () => void // 清除錯誤狀態
  clearMessageHistory: () => void // 清除訊息歷史
  getConnectionStats: () => object // 取得連線統計

  // === 背景重連與任務管理 ===
  startBackgroundReconnect: () => void // 啟動背景重連
  stopBackgroundReconnect: () => void // 停止背景重連
  resetTask: () => void // 重置任務
  backgroundReconnectStatus: ComputedRef<boolean> // 背景重連狀態
  currentTaskId: ComputedRef<string | null> // 當前任務 ID
  isReconnectionStatus: ComputedRef<boolean> // 是否為重連狀態
  reconnectCount: ComputedRef<number> // 重連次數

  // === 測試方法 ===
  toggleAutoReconnect: () => boolean // 切換自動重連

  // === 事件回調註冊 ===
  onConnectionEstablished: (callback: () => void) => void // 連線建立回調
  onConnectionLost: (callback: () => void) => void // 連線中斷回調
}
```

### 使用範例

```typescript
// 基本使用
const {
  connect,
  disconnect,
  send,
  isConnected,
  currentTaskId,
  onConnectionEstablished,
  onConnectionLost
} = useWebSocketPoc({
  url: 'ws://localhost:8080/poc2',
  heartbeatInterval: 5000,
  reconnectAttempts: 20
})

// 註冊事件回調
onConnectionEstablished(() => {
  console.log('連線已建立，任務ID:', currentTaskId.value)
})

onConnectionLost(() => {
  console.log('連線已中斷，將自動重連')
})

// 建立連線
connect()

// 發送訊息
const success = send({
  type: 'test',
  data: { message: 'Hello Server' }
})
```

## 🎙️ useRealTimeRecording

### 回傳介面

```typescript
interface UseRealTimeRecordingReturn {
  // === 錄音控制 ===
  startRecording: () => Promise<void> // 開始錄音
  stopRecording: () => Promise<void> // 停止錄音
  pauseRecording: () => Promise<void> // 暫停錄音

  // === 狀態管理 ===
  recordingState: ComputedRef<RecordingState> // 錄音狀態
  canStart: ComputedRef<boolean> // 可否開始錄音
  canResume: ComputedRef<boolean> // 可否恢復錄音

  // === 統計資料 ===
  stats: ComputedRef<RecordingStats> // 錄音統計

  // === 輔助功能 ===
  clearHistory: () => void // 清除錄音歷史

  // === 系統整合 ===
  setConnectionChecker: (checker: () => boolean) => void // 設置連線檢查器
  setChunkSender: (sender: (chunk: AudioChunk) => void) => void // 設置 chunk 發送器
}

// 錄音狀態枚舉
enum RecordingState {
  IDLE = 'idle', // 閒置
  RECORDING = 'recording', // 錄製中
  PAUSED = 'paused', // 已暫停
  STOPPED = 'stopped' // 已停止
}

// 錄音統計介面
interface RecordingStats {
  sessionId: string // 會話 ID
  totalDuration: number // 總錄音時長（秒）
  chunksGenerated: number // 已生成 chunk 數量
  disconnectionCount: number // 斷線次數
}
```

### 使用範例

```typescript
const {
  startRecording,
  stopRecording,
  pauseRecording,
  recordingState,
  canStart,
  stats,
  setConnectionChecker,
  setChunkSender
} = useRealTimeRecording()

// 設置連線檢查器
setConnectionChecker(() => isConnected.value)

// 設置 chunk 發送器
setChunkSender((chunk: AudioChunk) => {
  console.log('收到新的音頻 chunk:', chunk.sequenceNumber)
  // 發送到伺服器或進行其他處理
  sendAudioChunk(chunk)
})

// 開始錄音
if (canStart.value) {
  await startRecording()
}

// 監控錄音狀態
watch(recordingState, (state) => {
  console.log('錄音狀態變更:', state)
  console.log('統計資料:', stats.value)
})
```

## 🌊 useAudioStream

### 回傳介面

```typescript
interface UseAudioStreamReturn {
  // === 核心功能 ===
  sendChunk: (chunk: AudioChunk, sendFunc: (message: any) => boolean, taskId?: string) => boolean

  // === 狀態管理 ===
  audioState: ComputedRef<AudioStreamState> // 音頻串流狀態
  stats: ComputedRef<AudioStreamStats> // 音頻串流統計

  // === 訊息處理 ===
  handleAckMessage: (message: AckMessage) => void // 處理 ACK 訊息

  // === 統計與歷史 ===
  resetStats: (taskId?: string) => void // 重置統計資料
  getCategorizedEventHistory: () => CategorizedEventHistory // 取得分類事件歷史
  clearEventHistory: () => void // 清除事件歷史

  // === 連線管理 ===
  onConnectionLost: () => void // 處理連線中斷
  onConnectionRestored: () => void // 處理連線恢復
  processPendingChunks: (sendFunc: (message: any) => boolean, taskId?: string) => Promise<void> // 處理待發送 chunks

  // === 檔案處理 ===
  downloadCompleteRecording: () => Promise<boolean> // 下載完整錄音
}

// 音頻串流狀態
interface AudioStreamState {
  sendQueue: AudioChunk[] // 發送佇列
  pendingChunks: Map<string, AudioChunk> // 待處理 chunks
  acknowledgedChunks: Set<string> // 已確認 chunks
  errorChunks: Set<string> // 錯誤 chunks
}

// 音頻串流統計
interface AudioStreamStats {
  totalChunks: number // 總 chunk 數
  generatedChunks: number // 已生成 chunk 數
  sentChunks: number // 已發送 chunk 數
  acknowledgedChunks: number // 已確認 chunk 數
  pendingChunks: number // 待處理 chunk 數
  errorChunks: number // 錯誤 chunk 數
  legacyStats: { // 舊版統計（相容性）
    acknowledgedChunks: number
    sentChunks: number
    errorChunks: number
  }
}

// 分類事件歷史
interface CategorizedEventHistory {
  outgoing: EventHistory[] // 發出事件
  incoming: EventHistory[] // 接收事件
}
```

### 使用範例

```typescript
const {
  sendChunk,
  audioState,
  stats,
  handleAckMessage,
  resetStats,
  getCategorizedEventHistory,
  onConnectionRestored,
  processPendingChunks,
  downloadCompleteRecording
} = useAudioStream()

// 發送音頻 chunk
const success = sendChunk(audioChunk, websocketSend, taskId)
if (success) {
  console.log('Chunk 發送成功')
}
else {
  console.log('Chunk 發送失敗，已加入佇列')
}

// 處理 ACK 訊息
handleAckMessage({
  type: 'ack',
  data: {
    chunkId: 'uuid-here',
    sequenceNumber: 1,
    status: 'received',
    timestamp: Date.now()
  }
})

// 連線恢復後處理待發送 chunks
onConnectionRestored()
await processPendingChunks(websocketSend, taskId)

// 監控統計資料
watch(stats, (newStats) => {
  console.log('音頻統計:', {
    總數: newStats.totalChunks,
    已發送: newStats.sentChunks,
    已確認: newStats.acknowledgedChunks,
    待處理: newStats.pendingChunks
  })
})

// 下載完整錄音
const downloadSuccess = await downloadCompleteRecording()
```

## 🔄 Composables 整合流程

### 1. 初始化階段

```typescript
// 1. 建立 WebSocket 連線
const wsComposable = useWebSocketPoc(wsConfig)

// 2. 初始化錄音系統
const recordingComposable = useRealTimeRecording()

// 3. 初始化音頻串流
const streamComposable = useAudioStream()

// 4. 建立系統整合
recordingComposable.setConnectionChecker(() => wsComposable.isConnected.value)
recordingComposable.setChunkSender((chunk) => {
  streamComposable.sendChunk(chunk, wsComposable.send, wsComposable.currentTaskId.value)
})
```

### 2. 事件流程整合

```typescript
// WebSocket 連線建立
wsComposable.onConnectionEstablished(async () => {
  // 通知音頻串流系統
  streamComposable.onConnectionRestored()

  // 處理待發送的 chunks
  await streamComposable.processPendingChunks(
    wsComposable.send,
    wsComposable.currentTaskId.value
  )
})

// WebSocket 連線中斷
wsComposable.onConnectionLost(() => {
  // 通知音頻串流系統
  streamComposable.onConnectionLost()
})

// 處理 WebSocket 訊息
watch(wsComposable.lastMessage, (message) => {
  if (message?.type === 'ack') {
    streamComposable.handleAckMessage(message)
  }
})
```

### 3. 錄音流程整合

```typescript
// 開始錄音
async function startRecording() {
  // 重置統計資料
  streamComposable.resetStats(wsComposable.currentTaskId.value)
  recordingComposable.clearHistory()

  // 開始錄音（會自動通過 setChunkSender 發送 chunks）
  await recordingComposable.startRecording()
}

// 停止錄音
async function stopRecording() {
  await recordingComposable.stopRecording()
  // 錄音器會自動發送最後一個 chunk (isLast=true)
}
```

## 🎛️ 狀態管理最佳實務

### 1. 響應式狀態監控

```typescript
// 連線狀態監控
const connectionStatus = computed(() => ({
  isConnected: wsComposable.isConnected.value,
  taskId: wsComposable.currentTaskId.value,
  reconnectCount: wsComposable.reconnectCount.value
}))

// 錄音狀態監控
const recordingStatus = computed(() => ({
  state: recordingComposable.recordingState.value,
  duration: recordingComposable.stats.value.totalDuration,
  chunksGenerated: recordingComposable.stats.value.chunksGenerated
}))

// 傳輸狀態監控
const transmissionStatus = computed(() => ({
  totalChunks: streamComposable.stats.value.totalChunks,
  sentChunks: streamComposable.stats.value.sentChunks,
  acknowledgedChunks: streamComposable.stats.value.acknowledgedChunks,
  pendingChunks: streamComposable.stats.value.pendingChunks,
  queueLength: streamComposable.audioState.value.sendQueue?.length || 0
}))
```

### 2. 錯誤處理策略

```typescript
// 統一錯誤處理
function handleError(error: Error, context: string) {
  console.error(`[${context}] 錯誤:`, error)

  // 根據錯誤類型採取不同行動
  switch (context) {
    case 'websocket':
      // WebSocket 錯誤：嘗試重連
      if (!wsComposable.isConnected.value) {
        wsComposable.connect()
      }
      break

    case 'recording':
      // 錄音錯誤：停止並重置
      recordingComposable.stopRecording()
      recordingComposable.clearHistory()
      break

    case 'streaming':
      // 串流錯誤：重置統計
      streamComposable.resetStats()
      break
  }
}

// 在各個 composable 中使用
try {
  await recordingComposable.startRecording()
}
catch (error) {
  handleError(error, 'recording')
}
```

### 3. 效能最佳化

```typescript
// 使用 shallowRef 來避免深層響應式監聽
const eventHistory = shallowRef<EventHistory[]>([])

// 使用 computed 來避免重複計算
const eventStats = computed(() => {
  const events = streamComposable.getCategorizedEventHistory()
  return {
    outgoingCount: events.outgoing.length,
    incomingCount: events.incoming.length,
    totalCount: events.outgoing.length + events.incoming.length
  }
})

// 使用 throttle 來限制高頻更新
// import { throttle } from 'lodash-es'

const throttledUpdateStats = throttle(() => {
  // 更新統計資料
  updateStatsDisplay()
}, 1000) // 每秒最多更新一次
```

## 🧪 測試建議

### 單元測試

```typescript
// 測試 WebSocket 連線
describe('useWebSocketPoc', () => {
  it('should connect successfully', async () => {
    const { connect, isConnected } = useWebSocketPoc(mockConfig)
    connect()
    await waitFor(() => expect(isConnected.value).toBe(true))
  })
})

// 測試錄音功能
describe('useRealTimeRecording', () => {
  it('should start recording and generate chunks', async () => {
    const { startRecording, recordingState, setChunkSender } = useRealTimeRecording()

    const chunks: AudioChunk[] = []
    setChunkSender(chunk => chunks.push(chunk))

    await startRecording()
    expect(recordingState.value).toBe(RecordingState.RECORDING)

    // 等待 chunk 生成
    await waitFor(() => expect(chunks.length).toBeGreaterThan(0))
  })
})
```

### 整合測試

```typescript
describe('Clean POC Integration', () => {
  it('should handle complete recording flow', async () => {
    // 設置所有 composables
    const ws = useWebSocketPoc(wsConfig)
    const recording = useRealTimeRecording()
    const stream = useAudioStream()

    // 建立整合
    setupIntegration(ws, recording, stream)

    // 測試完整流程
    ws.connect()
    await waitFor(() => expect(ws.isConnected.value).toBe(true))

    await recording.startRecording()
    await new Promise(resolve => setTimeout(resolve, 5000)) // 錄音5秒
    await recording.stopRecording()

    // 驗證結果
    expect(stream.stats.value.totalChunks).toBeGreaterThan(0)
    expect(stream.stats.value.sentChunks).toEqual(stream.stats.value.acknowledgedChunks)
  })
})
```
