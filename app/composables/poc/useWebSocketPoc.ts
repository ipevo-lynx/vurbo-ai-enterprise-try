import { computed, onUnmounted, ref } from 'vue'

// POC2 WebSocket 連線狀態類型
export type WebSocketConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error'

// POC2 WebSocket 訊息類型
export interface WebSocketMessage {
  type: string
  data: any
  timestamp: number
}

// POC2 WebSocket 配置
export interface WebSocketPocConfig {
  url: string
  protocols?: string[]
  reconnectAttempts?: number
  reconnectInterval?: number
  heartbeatInterval?: number
  // 新增背景重連配置
  backgroundReconnectEnabled?: boolean
  minReconnectDelay?: number
  maxReconnectDelay?: number
  exponentialBackoff?: boolean
}

/**
 * POC2 WebSocket Composable with 智能背景重連和任務管理
 *
 * 這是第二個 POC 的 WebSocket 封裝，避免與現有音訊功能衝突
 * 功能包含：connect, disconnect, send, state
 * 狀態管理：connecting, connected, disconnected, error
 *
 * 新增功能：
 * - 智能背景重連（隨機延遲、指數退避）
 * - 任務代碼管理（重連時恢復任務）
 * - 雙向心跳檢測
 */
export function useWebSocketPoc(config?: WebSocketPocConfig) {
  // POC2 狀態管理
  const pocState = ref<WebSocketConnectionState>('disconnected')
  const lastError = ref<string | null>(null)
  const lastMessage = ref<WebSocketMessage | null>(null)
  const messageHistory = ref<WebSocketMessage[]>([])

  // 新增任務相關狀態
  const currentTaskId = ref<string | null>(null)
  const isReconnection = ref<boolean>(false)
  const backgroundReconnect = ref<boolean>(false)
  const reconnectCount = ref<number>(0)

  // 連線狀態變化回調
  const connectionCallbacks = {
    onConnected: [] as Array<() => void>,
    onDisconnected: [] as Array<() => void>,
  }

  // WebSocket 實例和計時器
  let websocket: WebSocket | null = null
  let reconnectTimer: NodeJS.Timeout | null = null
  let heartbeatTimer: NodeJS.Timeout | null = null
  let pongTimeoutTimer: NodeJS.Timeout | null = null
  let connectionHealthTimer: NodeJS.Timeout | null = null

  // 心跳狀態追蹤
  let lastPongReceived = Date.now()
  let consecutivePongMisses = 0
  const maxConsecutivePongMisses = 2

  // 預設配置
  const pocConfig = {
    url: config?.url || 'ws://localhost:8080',
    protocols: config?.protocols || [],
    reconnectAttempts: config?.reconnectAttempts || 10,
    reconnectInterval: config?.reconnectInterval || 3000,
    heartbeatInterval: config?.heartbeatInterval || 30000,
    backgroundReconnectEnabled: config?.backgroundReconnectEnabled ?? true,
    minReconnectDelay: config?.minReconnectDelay || 1000,
    maxReconnectDelay: config?.maxReconnectDelay || 5000,
    exponentialBackoff: config?.exponentialBackoff ?? true,
  }

  // 計算屬性
  const isConnecting = computed(() => pocState.value === 'connecting')
  const isConnected = computed(() => pocState.value === 'connected')
  const isDisconnected = computed(() => pocState.value === 'disconnected')
  const hasError = computed(() => pocState.value === 'error')
  const state = computed(() => pocState.value)

  /**
   * 停止心跳機制
   */
  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
    if (pongTimeoutTimer) {
      clearTimeout(pongTimeoutTimer)
      pongTimeoutTimer = null
    }
    if (connectionHealthTimer) {
      clearInterval(connectionHealthTimer)
      connectionHealthTimer = null
    }
  }

  /**
   * 處理收到的 pong 回應
   */
  function handlePongReceived() {
    if (pongTimeoutTimer) {
      clearTimeout(pongTimeoutTimer)
      pongTimeoutTimer = null
    }

    // 更新心跳狀態
    lastPongReceived = Date.now()
    consecutivePongMisses = 0

    console.log('💓 WebSocket POC2: 收到伺服器 pong 回應，連線健康')
  }

  /**
   * 檢查連線品質並處理超時
   */
  function checkConnectionHealth() {
    consecutivePongMisses++
    console.warn(`💔 WebSocket POC2: 心跳檢測到連線異常 (連續錯過: ${consecutivePongMisses}/${maxConsecutivePongMisses})`)

    if (consecutivePongMisses >= maxConsecutivePongMisses) {
      console.warn('🚨 WebSocket POC2: 連續錯過心跳達到上限，強制重連')
      lastError.value = '心跳連續超時'
      pocState.value = 'error'

      // 重置心跳狀態
      consecutivePongMisses = 0
      lastPongReceived = Date.now()

      // 關閉當前連線
      if (websocket) {
        websocket.close(4001, '心跳檢測到連線異常')
        websocket = null
      }

      // 心跳檢測到異常時自動觸發重連
      console.log('🔄 心跳檢測到異常，自動啟動重連機制')

      if (!backgroundReconnect.value) {
        console.log('📡 心跳異常自動啟用重連功能')
        backgroundReconnect.value = true
      }

      setTimeout(() => {
        attemptBackgroundReconnect()
      }, 1000)
    }
    else {
      console.log(`⚠️ WebSocket POC2: 心跳異常但未達重連門檻，繼續監控`)
    }
  }

  /**
   * 開始心跳機制 - 智能雙向檢測
   */
  function startHeartbeat() {
    stopHeartbeat()

    heartbeatTimer = setInterval(() => {
      if (websocket && websocket.readyState === WebSocket.OPEN) {
        const pingMessage = {
          type: 'frontend-heartbeat-ping',
          timestamp: Date.now(),
          clientId: `poc_client_${Math.random().toString(36).substr(2, 9)}`,
        }

        const success = send(pingMessage)
        if (success) {
          console.log('🏓 WebSocket POC2: 發送心跳 ping')

          // 設定 pong 超時檢測
          if (pongTimeoutTimer) {
            clearTimeout(pongTimeoutTimer)
          }

          pongTimeoutTimer = setTimeout(() => {
            console.warn('⏰ WebSocket POC2: 心跳超時，檢查連線品質')
            checkConnectionHealth()
          }, 8000)
        }
        else {
          console.warn('⚠️ WebSocket POC2: 心跳發送失敗，檢查連線')
          checkConnectionHealth()
        }
      }
      else {
        // 連線狀態異常，但不停止心跳，而是根據狀態決定行動
        if (pocState.value === 'disconnected' && backgroundReconnect.value) {
          console.log('🔄 WebSocket POC2: 心跳檢測到斷線狀態，嘗試重連')
          attemptBackgroundReconnect()
        }
        else {
          console.warn('⚠️ WebSocket POC2: 連線狀態異常，檢查連線品質')
          checkConnectionHealth()
        }
      }
    }, pocConfig.heartbeatInterval)

    // 啟動持續的連線健康監控（更頻繁檢查）
    startConnectionHealthMonitor()

    console.log(`❤️ WebSocket POC2: 智能心跳機制已啟動 (間隔: ${pocConfig.heartbeatInterval}ms)`)
  }

  /**
   * 啟動持續的連線健康監控
   * 這個機制會獨立於心跳 ping/pong 來檢查連線狀態
   */
  function startConnectionHealthMonitor() {
    if (connectionHealthTimer) {
      clearInterval(connectionHealthTimer)
    }

    const healthCheckInterval = Math.min(pocConfig.heartbeatInterval / 2, 15000) // 最多15秒檢查一次

    connectionHealthTimer = setInterval(() => {
      // 檢查是否太久沒收到 pong
      const timeSinceLastPong = Date.now() - lastPongReceived
      const pongTimeout = pocConfig.heartbeatInterval + 10000 // 心跳間隔 + 10秒容錯

      if (timeSinceLastPong > pongTimeout && pocState.value === 'connected') {
        console.warn(`🕒 WebSocket POC2: 連線健康監控檢測到長時間無回應 (${timeSinceLastPong}ms > ${pongTimeout}ms)`)
        checkConnectionHealth()
      }

      // 檢查 WebSocket 連線狀態
      if (websocket && websocket.readyState !== WebSocket.OPEN && pocState.value === 'connected') {
        console.warn(`📡 WebSocket POC2: WebSocket 狀態異常 (readyState: ${websocket.readyState})`)
        pocState.value = 'error'
        checkConnectionHealth()
      }
    }, healthCheckInterval)

    console.log(`🔍 WebSocket POC2: 連線健康監控已啟動 (間隔: ${healthCheckInterval}ms)`)
  }

  /**
   * 發送訊息到 WebSocket 伺服器
   */
  function send(data: any) {
    if (!websocket || websocket.readyState !== WebSocket.OPEN) {
      console.warn('⚠️ WebSocket POC2: 無法發送訊息，連線未建立')
      lastError.value = '連線未建立，無法發送訊息'
      return false
    }

    try {
      const message = typeof data === 'string' ? data : JSON.stringify(data)
      websocket.send(message)
      console.log('📤 WebSocket POC2: 訊息已發送', data)
      return true
    }
    catch (error) {
      console.error('❌ WebSocket POC2: 發送訊息失敗', error)
      lastError.value = '發送訊息失敗'
      return false
    }
  }

  /**
   * 產生隨機重連延遲，防止多客戶端同時重連
   */
  function getRandomReconnectDelay(attempt: number): number {
    let baseDelay: number

    if (pocConfig.exponentialBackoff) {
      // 指數退避：2^attempt * 基礎延遲 + 隨機數
      baseDelay = Math.min(
        (2 ** attempt) * 1000,
        pocConfig.maxReconnectDelay,
      )
    }
    else {
      baseDelay = pocConfig.reconnectInterval
    }

    // 加入隨機因子，防止多客戶端同時重連
    const randomFactor = Math.random() * 0.5 + 0.75 // 0.75-1.25 倍數
    const delay = Math.max(
      pocConfig.minReconnectDelay,
      Math.min(baseDelay * randomFactor, pocConfig.maxReconnectDelay),
    )

    return Math.round(delay)
  }

  /**
   * 連線到 WebSocket 伺服器
   */
  function connect() {
    console.log(`🔍 WebSocket POC2: 檢查連線狀態 - websocket存在: ${!!websocket}, readyState: ${websocket?.readyState}`)

    if (websocket && (websocket.readyState === WebSocket.CONNECTING || websocket.readyState === WebSocket.OPEN)) {
      console.log('🔄 WebSocket POC2: 已經在連線中，跳過重複連線')
      return
    }

    pocState.value = 'connecting'
    lastError.value = null

    // 構建連線 URL，包含任務代碼（如果是重連）
    let connectUrl = pocConfig.url
    if (currentTaskId.value && backgroundReconnect.value) {
      connectUrl = `${pocConfig.url}?taskId=${currentTaskId.value}`
      console.log(`🔗 WebSocket POC2: 使用任務代碼重連: ${currentTaskId.value}`)
    }

    console.log('🚀 WebSocket POC2: 開始連線到', connectUrl)

    try {
      websocket = new WebSocket(connectUrl, pocConfig.protocols)

      // 連線開啟事件
      websocket.onopen = (event) => {
        console.log('✅ WebSocket POC2: 連線成功', event)
        pocState.value = 'connected'
        reconnectCount.value = 0

        // 重置心跳狀態
        lastPongReceived = Date.now()
        consecutivePongMisses = 0

        // 不要關閉 backgroundReconnect，保持自動重連功能啟用狀態
        startHeartbeat()

        // 觸發連線建立回調
        triggerConnectionEstablishedCallbacks()
      }

      // 接收訊息事件
      websocket.onmessage = (event) => {
        console.log('===== WebSocket 收到原始訊息 =====', event.data)

        try {
          const parsedData = JSON.parse(event.data)
          console.log('===== 解析後的訊息 =====', parsedData)

          // 處理連線建立訊息
          if (parsedData.type === 'connection-established') {
            currentTaskId.value = parsedData.data.taskId
            isReconnection.value = parsedData.data.isReconnection

            console.log(
              `${parsedData.data.isReconnection ? '重新連線' : '新連線'}成功 - 任務代碼: ${parsedData.data.taskId}`,
            )
            return
          }

          // 處理心跳回應
          if (parsedData.type === 'pong' || parsedData.type === 'frontend-heartbeat-pong') {
            handlePongReceived()
            return // 心跳訊息不加入歷史記錄
          }

          const message: WebSocketMessage = {
            type: parsedData.type || 'message',
            data: parsedData, // 保持完整的 parsedData 結構
            timestamp: Date.now(),
          }

          console.log('📋 WebSocket POC2: 處理的訊息格式:', message)
          console.log('📋 訊息類型:', message.type)
          console.log('📋 訊息內容:', message.data)

          lastMessage.value = message
          messageHistory.value.push(message)

          // 限制歷史訊息數量避免記憶體洩漏
          if (messageHistory.value.length > 100) {
            messageHistory.value.shift()
          }
        }
        catch (parseError) {
          console.warn('⚠️ WebSocket POC2: 訊息解析失敗', parseError)
          const rawMessage: WebSocketMessage = {
            type: 'raw',
            data: event.data,
            timestamp: Date.now(),
          }
          lastMessage.value = rawMessage
          messageHistory.value.push(rawMessage)
        }
      }

      // 連線關閉事件
      websocket.onclose = (event) => {
        console.log('🔌 WebSocket POC2: 連線關閉', { code: event.code, reason: event.reason, wasClean: event.wasClean })

        pocState.value = 'disconnected'
        websocket = null

        // 觸發連線中斷回調
        triggerConnectionLostCallbacks()

        // 自動啟動背景重連（如果啟用了自動重連）
        if (backgroundReconnect.value) {
          console.log('🔄 觸發自動重連 - 斷線代碼:', event.code)
          setTimeout(() => {
            attemptBackgroundReconnect()
          }, 500)
        }
        else {
          console.log('⏹️ 自動重連已停用，但保持心跳監控')
          // 不停止心跳，讓心跳繼續監控連線狀態
          // 心跳會檢測到連線異常並自動啟動重連
        }
      }

      // 連線錯誤事件
      websocket.onerror = (error) => {
        console.error('❌ WebSocket POC2: 連線錯誤', error)
        lastError.value = 'WebSocket 連線錯誤'
        pocState.value = 'error'

        // 自動啟動背景重連（如果啟用了自動重連）
        if (backgroundReconnect.value) {
          console.log('🔄 觸發自動重連 - 連線錯誤')
          setTimeout(() => {
            attemptBackgroundReconnect()
          }, 1000)
        }
        else {
          console.log('⏹️ 自動重連已停用，但保持心跳監控')
          // 不停止心跳，讓心跳繼續監控連線狀態
        }
      }
    }
    catch (error) {
      console.error('❌ WebSocket POC2: 建立連線失敗', error)
      lastError.value = `連線失敗: ${error}`
      pocState.value = 'error'
    }
  }

  /**
   * 智能背景重連
   */
  async function attemptBackgroundReconnect(): Promise<void> {
    // 只檢查是否已連線和用戶是否啟用了自動重連
    if (pocState.value === 'connected' || !backgroundReconnect.value) {
      console.log('⏹️ 停止重連：', pocState.value === 'connected' ? '已連線' : '自動重連未啟用')
      return
    }

    // 如果重連次數過多但還在合理範圍內，重置計數器
    // 這是為了處理短期斷線場景（如模擬斷線測試）
    if (reconnectCount.value >= pocConfig.reconnectAttempts) {
      if (reconnectCount.value < pocConfig.reconnectAttempts * 2) {
        console.log(`🔄 WebSocket POC2: 重置重連計數器，繼續嘗試重連 (${reconnectCount.value} -> 0)`)
        reconnectCount.value = 0
      }
      else {
        console.warn(`❌ WebSocket POC2: 背景重連已達絕對最大嘗試次數 (${pocConfig.reconnectAttempts * 2})`)
        backgroundReconnect.value = false
        return
      }
    }

    backgroundReconnect.value = true
    reconnectCount.value++

    const delay = getRandomReconnectDelay(reconnectCount.value)
    console.log(`🔄 WebSocket POC2: 背景重連嘗試 ${reconnectCount.value}/${pocConfig.reconnectAttempts}，${delay}ms後重試`)

    // 隨機延遲
    await new Promise(resolve => setTimeout(resolve, delay))

    if (!backgroundReconnect.value) {
      return // 用戶手動停止
    }

    try {
      connect()
    }
    catch (error) {
      console.error(`❌ WebSocket POC2: 背景重連失敗: ${error}`)

      // 繼續下一次重連
      if (backgroundReconnect.value) {
        // 如果重連次數較多，稍微延長等待時間
        const nextDelay = reconnectCount.value > 5 ? 1000 : 100
        setTimeout(() => {
          if (backgroundReconnect.value) {
            attemptBackgroundReconnect()
          }
        }, nextDelay)
      }
    }
  }

  /**
   * 中斷 WebSocket 連線
   */
  function disconnect() {
    // 不強制關閉自動重連，讓用戶自己控制
    // 注意：不停止心跳機制，讓它繼續監控網路狀態

    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }

    if (websocket) {
      websocket.close(1000, '用戶手動斷線') // 正常關閉代碼
      websocket = null
    }

    pocState.value = 'disconnected'
    reconnectCount.value = 0

    // 重置心跳狀態，但保持心跳機制運行
    lastPongReceived = Date.now()
    consecutivePongMisses = 0

    console.log('🔌 WebSocket POC2: 連線已斷開（自動重連狀態保持：', backgroundReconnect.value, '，心跳監控繼續）')
  }

  /**
   * 清除錯誤狀態
   */
  function clearPocError() {
    lastError.value = null
    if (pocState.value === 'error') {
      pocState.value = 'disconnected'
    }
  }

  /**
   * 清除訊息歷史
   */
  function clearMessageHistory() {
    messageHistory.value = []
    lastMessage.value = null
  }

  /**
   * 註冊連線建立回調
   */
  function onConnectionEstablished(callback: () => void) {
    connectionCallbacks.onConnected.push(callback)
  }

  /**
   * 註冊連線中斷回調
   */
  function onConnectionLost(callback: () => void) {
    connectionCallbacks.onDisconnected.push(callback)
  }

  /**
   * 觸發連線建立回調
   */
  function triggerConnectionEstablishedCallbacks() {
    connectionCallbacks.onConnected.forEach((callback) => {
      try {
        callback()
      }
      catch (error) {
        console.error('❌ Connection established callback error:', error)
      }
    })
  }

  /**
   * 觸發連線中斷回調
   */
  function triggerConnectionLostCallbacks() {
    connectionCallbacks.onDisconnected.forEach((callback) => {
      try {
        callback()
      }
      catch (error) {
        console.error('❌ Connection lost callback error:', error)
      }
    })
  }

  /**
   * 手動啟動背景重連（用於測試）
   */
  function startBackgroundReconnect() {
    if (backgroundReconnect.value) {
      console.log('🔄 WebSocket POC2: 背景重連已在進行中')
      return
    }

    // 啟用自動重連
    backgroundReconnect.value = true
    console.log('🔄 WebSocket POC2: 自動重連已啟用')

    // 啟動心跳機制（即使在斷線狀態下也要運行）
    if (!heartbeatTimer) {
      console.log('❤️ WebSocket POC2: 啟動持續心跳監控')
      startHeartbeat()
    }

    // 如果已經斷線，立即嘗試重連
    if (pocState.value === 'disconnected') {
      reconnectCount.value = 0
      attemptBackgroundReconnect()
    }
  }

  /**
   * 手動停止背景重連
   */
  function stopBackgroundReconnect() {
    backgroundReconnect.value = false
    reconnectCount.value = 0
    console.log('🛑 WebSocket POC2: 背景重連已停止')
  }

  /**
   * 重置任務（強制建立新任務）
   */
  function resetTask() {
    currentTaskId.value = null
    isReconnection.value = false
    console.log('🔄 WebSocket POC2: 任務已重置，下次連線將建立新任務')

    // 如果目前已連線，先斷線再重新連線以建立新任務
    if (pocState.value === 'connected') {
      console.log('🔄 WebSocket POC2: 重新連線以建立新任務')
      disconnect()
      setTimeout(() => {
        connect()
      }, 500) // 給伺服器一點時間處理斷線
    }
  }

  /**
   * 取得連線統計資訊
   */
  function getConnectionStats() {
    return {
      state: pocState.value,
      reconnectAttempts: reconnectCount.value,
      messageCount: messageHistory.value.length,
      lastMessageTime: lastMessage.value?.timestamp || null,
      hasError: !!lastError.value,
    }
  }

  // 元件卸載時清理
  onUnmounted(() => {
    console.log('🧹 WebSocket POC2: 元件卸載，清理連線')
    disconnect()
  })

  /**
   * 模擬網路斷線 - 阻止心跳回應，觸發超時檢測
   */
  function simulateDisconnection() {
    if (!websocket || pocState.value !== 'connected') {
      console.warn('⚠️ 無法模擬斷線：WebSocket 未連線')
      return false
    }

    console.log('🌐 模擬網路斷線：阻止 pong 回應，觸發心跳超時（自動重連狀態：', backgroundReconnect.value, '）')

    // 模擬網路問題：修改 onmessage 處理，忽略 pong 回應
    const originalOnMessage = websocket.onmessage
    websocket.onmessage = (event) => {
      try {
        const parsedData = JSON.parse(event.data)

        // 模擬網路問題：忽略所有 pong 回應
        if (parsedData.type === 'pong' || parsedData.type === 'frontend-heartbeat-pong') {
          console.log('🚫 模擬網路問題：忽略 pong 回應')
          return // 不處理 pong，造成心跳超時
        }

        // 其他訊息正常處理
        if (originalOnMessage && websocket) {
          originalOnMessage.call(websocket, event)
        }
      }
      catch {
        // JSON 解析錯誤時，使用原始處理器
        if (originalOnMessage && websocket) {
          originalOnMessage.call(websocket, event)
        }
      }
    }

    // 設置恢復機制（用於測試）
    setTimeout(() => {
      if (websocket && websocket.onmessage !== originalOnMessage) {
        websocket.onmessage = originalOnMessage
        console.log('🔧 網路模擬已恢復：pong 回應處理已還原')
      }
    }, 15000) // 15秒後恢復 pong 處理

    return true
  }

  /**
   * 切換自動重連功能 - 開關模式
   */
  function toggleAutoReconnect() {
    if (backgroundReconnect.value) {
      // 關閉自動重連
      stopBackgroundReconnect()
      console.log('🔗 自動重連已關閉')
      return false
    }
    else {
      // 開啟自動重連
      startBackgroundReconnect()
      console.log('🔗 自動重連已開啟')
      return true
    }
  }

  // 返回公開介面
  return {
    // 主要方法
    connect,
    disconnect,
    send,
    state,

    // 詳細狀態
    isConnecting,
    isConnected,
    isDisconnected,
    hasError,

    // 錯誤和訊息
    lastError,
    lastMessage,
    messageHistory,

    // 輔助方法
    clearPocError,
    clearMessageHistory,
    getConnectionStats,

    // 新增：背景重連和任務管理
    startBackgroundReconnect,
    stopBackgroundReconnect,
    resetTask,
    backgroundReconnectStatus: computed(() => backgroundReconnect.value),
    currentTaskId: computed(() => currentTaskId.value),
    isReconnectionStatus: computed(() => isReconnection.value),
    reconnectCount: computed(() => reconnectCount.value),

    // 測試方法
    simulateDisconnection,
    toggleAutoReconnect,

    // 連線狀態回調註冊
    onConnectionEstablished,
    onConnectionLost,
  }

  // 初始化：如果啟用了背景重連，立即開始心跳監控
  if (pocConfig.backgroundReconnectEnabled) {
    backgroundReconnect.value = true
    console.log('🚀 WebSocket POC2: 初始化時啟動持續心跳監控')
    startHeartbeat()
  }

  return {
    // 主要方法
    connect,
    disconnect,
    send,
    state,

    // 詳細狀態
    isConnecting,
    isConnected,
    isDisconnected,
    hasError,

    // 錯誤和訊息
    lastError,
    lastMessage,
    messageHistory,

    // 輔助方法
    clearPocError,
    clearMessageHistory,
    getConnectionStats,

    // 新增：背景重連和任務管理
    startBackgroundReconnect,
    stopBackgroundReconnect,
    resetTask,
    backgroundReconnectStatus: computed(() => backgroundReconnect.value),
    currentTaskId: computed(() => currentTaskId.value),
    isReconnectionStatus: computed(() => isReconnection.value),
    reconnectCount: computed(() => reconnectCount.value),

    // 測試方法
    toggleAutoReconnect,

    // 連線狀態回調註冊
    onConnectionEstablished,
    onConnectionLost,
  }
}
