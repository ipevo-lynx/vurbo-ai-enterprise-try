import type {
  AudioCaptureStatus,
  AudioData,
  AudioDevice,
  AudioError,
  AudioErrorType,
  AudioRecordingSettings,
  DeviceConnectionStatus,
  PlatformCapabilities,
  RecordingSession,
  RecordingStatus,
  SttEngine,
  SystemAudioSource,
  TranscriptionLanguage,
} from '~/service/schema/audio'
import { computed, reactive } from 'vue'
import {
  AudioRecordingSettingsSchema,
  DEFAULT_TRANSCRIPTION_LANGUAGES,
} from '~/service/schema/audio'

// AudioPageState: 音訊頁面狀態介面定義（擴展版）
export interface AudioPageState {
  ui: {
    showDialog: boolean // 是否顯示對話框
    selectedTab: 'general' | 'advanced' // 選中的分頁標籤
    showDeviceDisconnectedPopup: boolean // 是否顯示設備斷線 popup
  }
  loading: {
    isGettingDevices: boolean // 是否正在取得設備列表
    isRecording: boolean // 是否正在錄音
    isReconnecting: boolean // 是否正在重新連線設備
    isTestingCapabilities: boolean // 是否正在測試平台能力
  }
  errors: {
    permissionError: string // 權限錯誤訊息
    deviceError: string // 設備錯誤訊息
    networkError: string // 網路錯誤訊息
    systemError: string // 系統錯誤訊息
    lastError: AudioError | null // 最後一個結構化錯誤
  }
  data: {
    availableDevices: AudioDevice[] // 可用音訊設備列表
    settings: AudioRecordingSettings // 錄音設定
    currentSession: RecordingSession | null // 當前錄音會話（可為空）
    realTimeAudioData: AudioData | null // 即時音訊數據（可為空）
    previewStream: MediaStream | null // 當前的預覽流（可為空）
    deviceConnectionStatus: DeviceConnectionStatus // 設備連線狀態
    platformCapabilities: PlatformCapabilities | null // 平台能力檢測結果
    reconnectAttempts: number // 重連嘗試次數
    maxReconnectAttempts: number // 最大重連次數
  }
}

// useAudioPage: 音訊頁面主要功能 composable
export function useAudioPage() {
  // 錄音時長計時器變數
  let durationTimer: NodeJS.Timeout | null = null

  // 頁面狀態：使用 reactive 建立響應式狀態物件
  const pageState: AudioPageState = reactive({
    ui: {
      showDialog: false, // 預設不顯示對話框
      selectedTab: 'general', // 預設選中一般設定分頁
      showDeviceDisconnectedPopup: false, // 預設不顯示設備斷線 popup
    },
    loading: {
      isGettingDevices: false, // 預設未在取得設備
      isRecording: false, // 預設未在錄音
      isReconnecting: false, // 預設未在重連
      isTestingCapabilities: false, // 預設未在測試能力
    },
    errors: {
      permissionError: '', // 預設無權限錯誤
      deviceError: '', // 預設無設備錯誤
      networkError: '', // 預設無網路錯誤
      systemError: '', // 預設無系統錯誤
      lastError: null, // 預設無結構化錯誤
    },
    data: {
      availableDevices: [], // 預設空的設備列表
      settings: {
        sttEngine: 'Azure' as SttEngine, // 預設使用 Azure 引擎
        transcriptionLanguages: [...DEFAULT_TRANSCRIPTION_LANGUAGES], // 預設轉錄語言列表
        systemAudioSource: 'none' as SystemAudioSource, // 預設無系統音訊
        translation: { enabled: false, mode: '句子' },
        summaryTemplate: { template: '通用' },
      },
      currentSession: null,
      realTimeAudioData: null,
      previewStream: null as MediaStream | null, // 當前的預覽流
      deviceConnectionStatus: 'unknown' as DeviceConnectionStatus,
      platformCapabilities: null,
      reconnectAttempts: 0,
      maxReconnectAttempts: 3,
    },
  })

  // 清除錯誤訊息：重置所有錯誤狀態
  const clearErrors = () => {
    pageState.errors.permissionError = '' // 清除權限錯誤
    pageState.errors.deviceError = '' // 清除設備錯誤
    pageState.errors.networkError = '' // 清除網路錯誤
    pageState.errors.systemError = '' // 清除系統錯誤
    pageState.errors.lastError = null // 清除結構化錯誤
  }

  // 錄音時長計時器相關函數
  const startDurationTimer = () => {
    if (durationTimer) {
      clearInterval(durationTimer)
    }

    durationTimer = setInterval(() => {
      if (pageState.data.currentSession?.startTime) {
        const now = Date.now()
        const session = pageState.data.currentSession

        if (session.status === 'recording') {
          // 計算實際錄音時間（不包含暫停時間）
          const currentResumeTime = session.lastResumeTime ?? session.startTime
          if (currentResumeTime) {
            const currentSegmentTime = Math.floor((now - currentResumeTime) / 1000)
            session.duration = (session.actualRecordingTime || 0) + currentSegmentTime
          }
        }
      }
    }, 1000) // 每秒更新一次時長
  }

  // 停止錄音時長計時器：清除定時器並重置變數
  const stopDurationTimer = () => {
    if (durationTimer) {
      clearInterval(durationTimer) // 清除定時器
      durationTimer = null // 重置變數
    }
  }

  // 設定即時音訊分析（用於重連後恢復）
  const setupRealtimeAudioAnalysis = (stream: MediaStream) => {
    try {
      const audioContext = new AudioContext()
      const source = audioContext.createMediaStreamSource(stream)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)

      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      const updateVolume = () => {
        if (pageState.data.currentSession?.captureStatus === 'active') {
          analyser.getByteFrequencyData(dataArray)
          const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length
          const volume = Math.round((average / 255) * 100)

          pageState.data.realTimeAudioData = {
            volume,
            frequency: analyser.frequencyBinCount,
            timestamp: Date.now(),
            deviceId: pageState.data.settings.microphoneDevice?.deviceId || 'unknown',
          }

          requestAnimationFrame(updateVolume)
        }
      }
      updateVolume()
      console.log('🎵 即時音訊分析已重啟')
    }
    catch (error) {
      console.error('重啟音訊分析失敗:', error)
    }
  }

  // 啟動設備重連監控（持續監控直到重連成功或超時）
  const _startDeviceReconnectionMonitoring = () => {
    if (pageState.loading.isReconnecting)
      return

    pageState.loading.isReconnecting = true
    pageState.data.deviceConnectionStatus = 'reconnecting'

    console.log('🔄 開始設備重連監控...')

    const maxMonitoringTime = 60000 // 60秒監控時間
    const startTime = Date.now()

    const monitoringInterval = setInterval(async () => {
      const elapsedTime = Date.now() - startTime

      if (elapsedTime > maxMonitoringTime) {
      // 超時停止監控
        clearInterval(monitoringInterval)
        _handleReconnectionTimeout()
        return
      }

      // 檢查原設備是否重新可用
      if (pageState.data.settings.microphoneDevice) {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices()
          const originalDevice = pageState.data.settings.microphoneDevice
          const deviceRestored = devices.find(
            device => device.deviceId === originalDevice.deviceId
              || device.label === originalDevice.label,
          )

          if (deviceRestored) {
            clearInterval(monitoringInterval)
            pageState.loading.isReconnecting = false

            // 調用設備重連處理函數
            await handleDeviceReconnected()
            console.log('✅ 設備重連監控完成')
          }
        }
        catch (error) {
          console.error('重連監控檢查失敗:', error)
        }
      }
    }, 2000) // 每2秒檢查一次
  }

  // 處理重連超時
  const _handleReconnectionTimeout = () => {
    console.log('⏰ 設備重連監控超時')

    pageState.loading.isReconnecting = false
    pageState.data.deviceConnectionStatus = 'failed'

    // 更新錯誤訊息
    pageState.errors.deviceError = `
      ❌ 設備重連超時，請手動處理：
      
      1. 重新連接您的麥克風設備
      2. 點擊「重新選擇設備」按鈕
      3. 或選擇其他可用的麥克風設備
    `

    // 如果有進行中的錄音，建議用戶手動處理
    if (pageState.data.currentSession?.status === 'paused') {
      pageState.errors.deviceError += '\n\n⚠️ 當前錄音已暫停，請盡快重新連接設備以避免數據丟失'
    }
  }

  // 處理設備重連成功
  const handleDeviceReconnection = async () => {
    console.log('✅ 檢測到設備重新連接')

    try {
      pageState.loading.isReconnecting = false
      pageState.data.deviceConnectionStatus = 'connected'
      pageState.data.reconnectAttempts = 0

      // 清除錯誤訊息
      pageState.errors.deviceError = ''

      // 如果有暫停的錄音會話，嘗試恢復
      if (pageState.data.currentSession?.status === 'paused'
        && pageState.data.currentSession.mediaRecorder) {
        console.log('🎙️ 嘗試恢復錄音會話...')

        // 重新獲取麥克風流，使用原本選擇的設備
        console.log('🔄 設備重連後重新獲取麥克風流:', {
          label: pageState.data.settings.microphoneDevice!.label,
          deviceId: pageState.data.settings.microphoneDevice!.deviceId,
        })

        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: pageState.data.settings.microphoneDevice!.deviceId },
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        })

        console.log('✅ 設備重連後成功取得麥克風流:', micStream.getAudioTracks()[0]?.label || '未知設備')

        // 停止舊的音頻流（如果存在）
        if (pageState.data.currentSession.activeStreams?.microphone) {
          console.log('🛑 停止舊的麥克風流')
          pageState.data.currentSession.activeStreams.microphone.getTracks().forEach((track: MediaStreamTrack) => track.stop())
        }

        // 更新活動流
        pageState.data.currentSession.activeStreams!.microphone = micStream

        // 恢復錄音
        const recorder = pageState.data.currentSession.mediaRecorder
        if (recorder.state === 'paused') {
          recorder.resume()
          pageState.data.currentSession.status = 'recording'
          startDurationTimer()

          // 重新啟動音訊分析
          setupRealtimeAudioAnalysis(micStream)

          console.log('✅ 錄音已成功恢復')

          // 顯示成功訊息
          pageState.errors.deviceError = ''
          // 可以考慮顯示一個成功通知
        }
      }
    }
    catch (error) {
      console.error('❌ 設備重連失敗:', error)
      // handleAudioError('device_disconnected', error as Error) // TODO: 修復函數順序問題
      pageState.errors.deviceError = '設備重連失敗'
    }
  }

  // 檢測並處理新設備（可能是重新插入的設備）
  const _detectAndHandleNewDevices = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const audioInputDevices = devices.filter(device => device.kind === 'audioinput')

      // 檢查是否有新的音訊輸入設備
      const newDevices = audioInputDevices.filter(device =>
        !pageState.data.availableDevices.some(existing => existing.deviceId === device.deviceId),
      )

      if (newDevices.length > 0) {
        console.log('🔍 檢測到新的音訊設備:', newDevices)

        // 更新可用設備列表
        // await getAvailableDevices() // TODO: 修復函數順序問題
        console.log('📱 更新設備列表')

        // 如果原始設備名稱相似，可能是同一設備重新插入
        if (pageState.data.settings.microphoneDevice) {
          const originalDeviceLabel = pageState.data.settings.microphoneDevice.label
          const similarDevice = newDevices.find(device =>
            device.label.includes(originalDeviceLabel)
            || originalDeviceLabel.includes(device.label),
          )

          if (similarDevice) {
            console.log('🎯 檢測到相似設備，可能是重新插入的原設備:', similarDevice.label)
            // 自動選擇相似設備並嘗試重連
            pageState.data.settings.microphoneDevice = {
              deviceId: similarDevice.deviceId,
              label: similarDevice.label,
              kind: 'audioinput',
              groupId: similarDevice.groupId,
            }
            await handleDeviceReconnection()
          }
        }
      }
    }
    catch (error) {
      console.error('檢測新設備失敗:', error)
    }
  }

  // 處理錄音過程中的設備斷線
  const _handleRecordingDeviceDisconnection = async () => {
    console.log('🚨 錄音過程中檢測到設備斷線')

    // 1. 立即暫停錄音並停止音訊流
    if (pageState.data.currentSession?.mediaRecorder) {
      const recorder = pageState.data.currentSession.mediaRecorder
      const session = pageState.data.currentSession

      if (recorder.state === 'recording') {
        console.log('⏸️ 立即暫停錄音器並停止音訊流')

        // 暫停前保存當前錄音時間
        if (session.lastResumeTime || session.startTime) {
          const now = Date.now()
          const currentResumeTime = session.lastResumeTime ?? session.startTime!
          const currentSegmentTime = Math.floor((now - currentResumeTime) / 1000)
          session.actualRecordingTime = (session.actualRecordingTime || 0) + currentSegmentTime
          console.log('💾 已保存當前錄音時間:', currentSegmentTime, '秒')
        }

        // 暫停 MediaRecorder
        recorder.pause()
        session.status = 'paused'
        stopDurationTimer()

        // 🔥 關鍵修正：立即停止音訊流以防止繼續錄音
        if (session.activeStreams?.microphone) {
          console.log('🛑 立即停止斷線的麥克風流')
          session.activeStreams.microphone.getTracks().forEach((track: MediaStreamTrack) => {
            track.stop()
            console.log('🛑 已停止音訊軌道:', track.label)
          })
          session.activeStreams.microphone = null as any
        }

        // 停止即時音訊分析
        pageState.data.realTimeAudioData = null

        console.log('⏸️ 錄音已完全暫停，等待設備重連')
      }
    }

    // 2. 更新設備連線狀態
    pageState.data.deviceConnectionStatus = 'disconnected'

    // 3. 顯示設備斷線彈窗
    pageState.ui.showDeviceDisconnectedPopup = true

    // 4. 顯示用戶友善的錯誤提示
    pageState.errors.deviceError = '⚠️ 麥克風設備已斷線，錄音已暫停，正在等待重新連接...'

    // 5. 啟動設備重連監控
    pageState.data.reconnectAttempts = 0
    _startDeviceReconnectionMonitoring()
    console.log('📡 開始監控設備重連...')
  }

  // 處理設備重新連接（使用無縫合併方式）
  const handleDeviceReconnected = async () => {
    try {
      console.log('🔄 嘗試恢復設備連接...')

      // 關閉設備斷線彈窗
      pageState.ui.showDeviceDisconnectedPopup = false

      // 更新設備狀態
      pageState.data.deviceConnectionStatus = 'connected'
      pageState.errors.deviceError = ''

      // 如果有暫停的錄音會話，重新建立音訊流和MediaRecorder
      if (pageState.data.currentSession?.status === 'paused'
        && pageState.data.currentSession.mediaRecorder
        && pageState.data.settings.microphoneDevice) {
        console.log('🎙️ 設備重連後恢復錄音會話...')

        try {
          // 重新獲取麥克風流
          const newMicStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              deviceId: { exact: pageState.data.settings.microphoneDevice.deviceId },
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          })

          console.log('✅ 設備重連後成功取得新的麥克風流:', newMicStream.getAudioTracks()[0]?.label || '未知設備')

          // 更新活動流
          if (pageState.data.currentSession.activeStreams) {
            pageState.data.currentSession.activeStreams.microphone = newMicStream
          }

          // 創建新的 MediaRecorder 來無縫接續錄音
          const supportedMimeTypes = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/mp4',
            'audio/ogg;codecs=opus',
            'audio/ogg',
            'audio/wav',
          ]
          let mimeType = 'audio/webm'
          for (const type of supportedMimeTypes) {
            if (MediaRecorder.isTypeSupported(type)) {
              mimeType = type
              break
            }
          }

          const newRecorder = new MediaRecorder(newMicStream, {
            mimeType,
            audioBitsPerSecond: 128000,
          })

          // 設定新的事件處理器（關鍵：保持原有的音訊片段）
          newRecorder.ondataavailable = (event) => {
            if (event.data.size > 0 && pageState.data.currentSession) {
              // 新的音訊數據會自動追加到現有的 recordedChunks 中
              pageState.data.currentSession.recordedChunks.push(event.data)
              console.log('📦 收集重連後的音訊片段，總片段數:', pageState.data.currentSession.recordedChunks.length)
            }
          }

          newRecorder.onstop = () => {
            console.log('📋 重連後的 MediaRecorder 停止')
            // 內聯的錄音完成處理
            if (!pageState.data.currentSession)
              return

            const chunks = pageState.data.currentSession.recordedChunks
            if (chunks.length === 0) {
              console.warn('No recorded chunks available')
              return
            }

            // 創建最終的錄音檔案
            const finalMimeType = pageState.data.currentSession.mediaRecorder?.mimeType || 'audio/webm'
            const blob = new Blob(chunks, { type: finalMimeType })
            const url = URL.createObjectURL(blob)

            // 生成檔案名稱
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
            const extension = finalMimeType.includes('webm') ? 'webm' : 'wav'
            const filename = `recording-${timestamp}.${extension}`

            // 儲存檔案資訊
            pageState.data.currentSession.recordingFile = {
              blob,
              url,
              filename,
              mimeType: finalMimeType,
              size: blob.size,
              duration: pageState.data.currentSession.actualRecordingTime || 0,
              createdAt: Date.now(),
            }
          }

          newRecorder.onerror = (event) => {
            console.error('重連後的 MediaRecorder 錯誤:', event)
            pageState.errors.deviceError = '設備重連後錄音發生錯誤'
          }

          // 更新會話的 MediaRecorder
          pageState.data.currentSession.mediaRecorder = newRecorder

          // 設備重連後保持暫停狀態，等待用戶手動恢復
          pageState.data.currentSession.status = 'paused'

          // 重新啟動音訊分析
          setupRealtimeAudioAnalysis(newMicStream)

          console.log('✅ 錄音設備重連完成，點擊繼續錄音即可恢復')
          pageState.errors.deviceError = '✅ 設備已重新連接！點擊繼續錄音即可恢復'
        }
        catch (reconnectError) {
          console.error('❌ 設備重連流程失敗:', reconnectError)
          pageState.errors.deviceError = '設備重連失敗，請手動重新選擇設備'
        }
      }
      else {
        console.log('ℹ️ 沒有需要恢復的錄音會話')
        pageState.errors.deviceError = '✅ 設備已重新連接！'
      }
    }
    catch (error) {
      console.error('❌ 設備重連失敗:', error)
      pageState.errors.deviceError = '設備重連失敗，請手動重新選擇設備'
    }
  }

  // === 增強的錯誤處理機制 ===

  // 根據錯誤類型獲取用戶友善的錯誤訊息
  const getErrorMessage = (type: AudioErrorType, error: Error | DOMException): string => {
    switch (type) {
      case 'permission_denied':
        return '請允許網站存取您的麥克風以開始錄音'
      case 'permission_dismissed':
        return '需要麥克風權限才能使用錄音功能，請點擊瀏覽器地址欄的麥克風圖示重新授權'
      case 'device_not_found':
        return '找不到可用的麥克風設備，請確認設備已正確連接'
      case 'device_disconnected':
        return '麥克風設備已斷線，正在嘗試重新連接...'
      case 'device_busy':
        return '麥克風設備正被其他應用程式使用，請關閉其他應用程式後再試'
      case 'network_error':
        return '網路連線發生問題，請檢查網路狀態'
      case 'browser_unsupported':
        return '您的瀏覽器不支援此功能，建議使用 Chrome、Firefox 或 Edge 瀏覽器'
      case 'api_unavailable':
        return '瀏覽器不支援所需的音訊 API，請更新瀏覽器或改用支援的瀏覽器'
      default:
        return error.message || '發生未知錯誤，請重新整理頁面再試'
    }
  }

  // 判斷錯誤是否可自動恢復
  const isRecoverableError = (type: AudioErrorType): boolean => {
    const recoverableTypes: AudioErrorType[] = [
      'device_disconnected',
      'network_error',
      'connection_timeout',
      'device_busy',
    ]
    return recoverableTypes.includes(type)
  }

  // 獲取錯誤解決建議
  const getErrorSuggestions = (type: AudioErrorType): string[] => {
    switch (type) {
      case 'permission_denied':
        return [
          '點擊瀏覽器地址欄的麥克風圖示',
          '選擇「總是允許」此網站存取麥克風',
          '重新整理頁面並再次嘗試',
        ]
      case 'device_not_found':
        return [
          '檢查麥克風是否正確連接電腦',
          '確認麥克風在系統設定中已啟用',
          '嘗試重新插拔麥克風',
          '重新整理頁面',
        ]
      case 'device_disconnected':
        return [
          '檢查麥克風連接線是否鬆脫',
          '系統會自動嘗試重新連接',
          '若問題持續，請重新插拔設備',
        ]
      case 'browser_unsupported':
        return [
          '更新瀏覽器到最新版本',
          '使用 Chrome、Firefox 或 Edge 瀏覽器',
          '確認已啟用瀏覽器的媒體權限',
        ]
      default:
        return ['重新整理頁面', '檢查網路連線', '聯繫技術支援']
    }
  }

  // === 跨平台能力檢測面板 ===

  // 檢測平台資訊
  const detectPlatformInfo = () => {
    const userAgent = navigator.userAgent
    let os = 'Unknown'
    let browser = 'Unknown'
    let version = 'Unknown'
    const mobile = /Mobi|Android/i.test(userAgent)

    // 檢測作業系統
    if (userAgent.includes('Windows'))
      os = 'Windows'
    else if (userAgent.includes('Mac'))
      os = 'macOS'
    else if (userAgent.includes('Linux'))
      os = 'Linux'
    else if (userAgent.includes('Android'))
      os = 'Android'
    else if (userAgent.includes('iPhone') || userAgent.includes('iPad'))
      os = 'iOS'

    // 檢測瀏覽器
    if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) {
      browser = 'Chrome'
      const match = userAgent.match(/Chrome\/([0-9.]+)/)
      version = match?.[1] || 'Unknown'
    }
    else if (userAgent.includes('Firefox')) {
      browser = 'Firefox'
      const match = userAgent.match(/Firefox\/([0-9.]+)/)
      version = match?.[1] || 'Unknown'
    }
    else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) {
      browser = 'Safari'
      const match = userAgent.match(/Version\/([0-9.]+)/)
      version = match?.[1] || 'Unknown'
    }
    else if (userAgent.includes('Edg')) {
      browser = 'Edge'
      const match = userAgent.match(/Edg\/([0-9.]+)/)
      version = match?.[1] || 'Unknown'
    }

    return { os, browser, version, mobile }
  }

  // 詳細檢測 getUserMedia 能力
  const testGetUserMediaCapabilities = async () => {
    const result = {
      supported: false,
      constraints: {
        audio: false,
        video: false,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      errors: [] as string[],
    }

    try {
      // 基本支援檢查
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        result.errors.push('navigator.mediaDevices.getUserMedia 不存在')
        return result
      }

      result.supported = true

      // 檢測音訊支援
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true })
        result.constraints.audio = true
        audioStream.getTracks().forEach(track => track.stop())

        // 檢測音訊約束條件支援
        try {
          const advancedAudioStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          })
          const track = advancedAudioStream.getAudioTracks()[0]
          if (track) {
            const settings = track.getSettings()

            result.constraints.echoCancellation = settings.echoCancellation !== undefined
            result.constraints.noiseSuppression = settings.noiseSuppression !== undefined
            result.constraints.autoGainControl = settings.autoGainControl !== undefined
          }

          advancedAudioStream.getTracks().forEach(track => track.stop())
        }
        catch (advancedError) {
          result.errors.push(`進階音訊約束條件測試失敗: ${advancedError}`)
        }
      }
      catch (audioError) {
        result.errors.push(`音訊存取測試失敗: ${audioError}`)
      }

      // 檢測視訊支援
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({ video: true })
        result.constraints.video = true
        videoStream.getTracks().forEach(track => track.stop())
      }
      catch (videoError) {
        result.errors.push(`視訊存取測試失敗: ${videoError}`)
      }
    }
    catch (error) {
      result.errors.push(`getUserMedia 整體測試失敗: ${error}`)
    }

    return result
  }

  // 詳細檢測 MediaRecorder 能力
  const testMediaRecorderCapabilities = async () => {
    const result = {
      supported: false,
      supportedMimeTypes: [] as string[],
      maxBitRate: undefined as number | undefined,
      errors: [] as string[],
    }

    try {
      if (!window.MediaRecorder) {
        result.errors.push('MediaRecorder API 不存在')
        return result
      }

      result.supported = true

      // 測試常見的 MIME 類型
      const mimeTypesToTest = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/mpeg',
        'audio/wav',
        'audio/ogg;codecs=opus',
        'audio/3gpp',
        'audio/flac',
      ]

      for (const mimeType of mimeTypesToTest) {
        try {
          if (MediaRecorder.isTypeSupported(mimeType)) {
            result.supportedMimeTypes.push(mimeType)
          }
        }
        catch (error) {
          result.errors.push(`MIME 類型測試失敗 ${mimeType}: ${error}`)
        }
      }

      // 嘗試測試最大位元率（需要實際的媒體流）
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const recorder = new MediaRecorder(stream, { audioBitsPerSecond: 320000 })
        result.maxBitRate = 320000
        recorder.stop()
        stream.getTracks().forEach(track => track.stop())
      }
      catch (error) {
        result.errors.push(`位元率測試失敗: ${error}`)
      }
    }
    catch (error) {
      result.errors.push(`MediaRecorder 整體測試失敗: ${error}`)
    }

    return result
  }

  // 檢測 Web Audio API 能力
  const testWebAudioCapabilities = () => {
    const result = {
      supported: false,
      audioContext: false,
      analyser: false,
      maxChannels: undefined as number | undefined,
    }

    try {
      // 檢測 AudioContext
      if (window.AudioContext || (window as any).webkitAudioContext) {
        result.audioContext = true

        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
        const audioContext = new AudioContextClass()

        // 檢測 AnalyserNode
        try {
          audioContext.createAnalyser()
          result.analyser = true
        }
        catch (error) {
          console.warn('AnalyserNode 不支援:', error)
        }

        // 檢測最大聲道數
        try {
          result.maxChannels = audioContext.destination.maxChannelCount
        }
        catch (error) {
          console.warn('無法獲取最大聲道數:', error)
        }

        audioContext.close()
        result.supported = result.audioContext && result.analyser
      }
    }
    catch (error) {
      console.error('Web Audio API 測試失敗:', error)
    }

    return result
  }

  // 創建結構化錯誤對象
  const createAudioError = (
    type: AudioErrorType,
    nativeError: Error | DOMException,
    suggestions: string[] = [],
  ): AudioError => {
    const browserInfo = navigator.userAgent
    const deviceInfo = `Platform: ${navigator.platform}, Language: ${navigator.language}`

    return {
      type,
      code: nativeError.name || 'UnknownError',
      message: getErrorMessage(type, nativeError),
      technicalDetails: nativeError.message,
      suggestions,
      recoverable: isRecoverableError(type),
      timestamp: Date.now(),
      context: {
        userAgent: browserInfo,
        deviceInfo,
        currentSettings: pageState.data.settings,
      },
    }
  }

  // === 設備重連機制 ===

  // 取得可用的音訊設備
  const getAvailableDevices = async () => {
    pageState.loading.isGettingDevices = true
    clearErrors()

    try {
      // 請求麥克風權限
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      // 取得所有音訊設備
      const devices = await navigator.mediaDevices.enumerateDevices()

      // 過濾出音訊輸入設備
      const audioInputDevices: AudioDevice[] = devices
        .filter(device => device.kind === 'audioinput')
        .map(device => ({
          deviceId: device.deviceId,
          label: device.label || `麥克風 ${device.deviceId.slice(0, 8)}`,
          kind: 'audioinput' as const,
          groupId: device.groupId,
        }))

      pageState.data.availableDevices = audioInputDevices

      // 選擇預設設備（第一個可用設備）
      if (audioInputDevices.length > 0 && !pageState.data.settings.microphoneDevice) {
        pageState.data.settings.microphoneDevice = audioInputDevices[0]
      }

      // 停止測試流
      stream.getTracks().forEach(track => track.stop())
    }
    catch (error: any) {
      console.error('Error getting audio devices:', error)

      if (error.name === 'NotAllowedError') {
        pageState.errors.permissionError = '請允許存取麥克風權限以顯示可用設備'
      }
      else if (error.name === 'NotFoundError') {
        pageState.errors.deviceError = '找不到可用的音訊設備'
      }
      else {
        pageState.errors.deviceError = '無法取得音訊設備清單'
      }
    }
    finally {
      pageState.loading.isGettingDevices = false
    }
  }

  // 選擇麥克風設備：設定設備並開始音量監控
  const selectMicrophoneDevice = async (device: AudioDevice) => {
    console.log('👆 選擇麥克風設備:', {
      label: device.label,
      deviceId: device.deviceId,
      kind: device.kind,
    })

    // 停止之前的預覽流
    if (pageState.data.previewStream) {
      console.log('🛑 停止之前的預覽流')
      pageState.data.previewStream.getTracks().forEach(track => track.stop())
      pageState.data.previewStream = null
    }

    pageState.data.settings.microphoneDevice = device

    // 開始預覽音量（用於對話框中的即時顯示）
    try {
      console.log('🎤 嘗試取得麥克風流 - deviceId:', device.deviceId)
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: device.deviceId },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })

      // 儲存預覽流以便後續停止
      pageState.data.previewStream = stream

      console.log('✅ 成功取得麥克風流:', stream.getAudioTracks()[0]?.label || '未知設備')

      // 簡化的音訊分析啟動（避免循環依賴）
      setTimeout(() => {
        try {
          console.log('開始設定音量分析...')
          const audioContext = new AudioContext()
          const source = audioContext.createMediaStreamSource(stream)
          const analyser = audioContext.createAnalyser()
          analyser.fftSize = 256
          source.connect(analyser)

          const dataArray = new Uint8Array(analyser.frequencyBinCount)
          const updateVolume = () => {
            if (pageState.data.settings.microphoneDevice?.deviceId === device.deviceId) {
              analyser.getByteFrequencyData(dataArray)
              const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length
              const volume = Math.round((average / 255) * 100)

              //   console.log(`即時音量更新: ${volume}%`)

              pageState.data.realTimeAudioData = {
                volume,
                frequency: analyser.frequencyBinCount,
                timestamp: Date.now(),
                deviceId: device.deviceId,
              }

              requestAnimationFrame(updateVolume)
            }
            else {
              console.log('設備已變更，停止音量監控')
            }
          }
          updateVolume()
          console.log('音量監控已啟動')
        }
        catch (analysisError) {
          console.error('Audio analysis failed:', analysisError)
        }
      }, 100)

      console.log('Device selected and volume monitoring started:', device.label)
    }
    catch (error) {
      console.error('Failed to start volume monitoring:', error)
      pageState.errors.deviceError = '無法啟動音量監控，請檢查設備權限'
    }
  }

  // 開始設備重連流程
  const startDeviceReconnection = async () => {
    if (pageState.loading.isReconnecting) {
      return // 避免重複重連
    }

    pageState.loading.isReconnecting = true
    pageState.data.deviceConnectionStatus = 'reconnecting'
    pageState.data.reconnectAttempts++

    console.log(`開始第 ${pageState.data.reconnectAttempts} 次設備重連嘗試...`)

    try {
      // 等待一段時間後重試
      const delay = Math.min(1000 * pageState.data.reconnectAttempts, 5000) // 最多等待 5 秒
      await new Promise(resolve => setTimeout(resolve, delay))

      // 重新檢測設備
      await getAvailableDevices()

      // 如果有之前選擇的設備，嘗試重新連接
      if (pageState.data.settings.microphoneDevice) {
        const previousDevice = pageState.data.settings.microphoneDevice
        const availableDevice = pageState.data.availableDevices.find(
          device => device.deviceId === previousDevice.deviceId || device.label === previousDevice.label,
        )

        if (availableDevice) {
          await selectMicrophoneDevice(availableDevice)
          pageState.data.deviceConnectionStatus = 'connected'
          pageState.data.reconnectAttempts = 0 // 重置重連次數
          console.log('設備重連成功')
        }
        else {
          throw new Error('無法找到之前選擇的設備')
        }
      }
    }
    catch (error) {
      console.error('設備重連失敗:', error)

      if (pageState.data.reconnectAttempts >= pageState.data.maxReconnectAttempts) {
        pageState.data.deviceConnectionStatus = 'failed'
        pageState.errors.deviceError = '設備重連失敗，請手動重新選擇設備'
      }
      else {
        // 繼續重試
        setTimeout(startDeviceReconnection, 2000)
      }
    }
    finally {
      pageState.loading.isReconnecting = false
    }
  }

  // 處理錯誤並更新狀態
  const _handleAudioError = (type: AudioErrorType, error: Error | DOMException) => {
    const audioError = createAudioError(type, error, getErrorSuggestions(type))
    pageState.errors.lastError = audioError

    // 根據錯誤類型更新對應的錯誤狀態
    switch (type) {
      case 'permission_denied':
      case 'permission_dismissed':
      case 'permission_unavailable':
        pageState.errors.permissionError = audioError.message
        break
      case 'device_not_found':
      case 'device_disconnected':
      case 'device_busy':
      case 'device_invalid':
        pageState.errors.deviceError = audioError.message
        break
      case 'network_error':
      case 'connection_timeout':
      case 'server_unavailable':
        pageState.errors.networkError = audioError.message
        break
      default:
        pageState.errors.systemError = audioError.message
    }

    // 如果是可恢復的錯誤，啟動自動重連
    if (audioError.recoverable && pageState.data.reconnectAttempts < pageState.data.maxReconnectAttempts) {
      startDeviceReconnection()
    }

    console.error('Audio Error:', audioError)
  }

  // 打開/關閉錄音設定對話框
  const openDialog = () => {
    pageState.ui.showDialog = true
    getAvailableDevices()
  }

  const closeDialog = () => {
    pageState.ui.showDialog = false
    clearErrors()
  }

  // 選擇STT引擎
  const selectSttEngine = (engine: SttEngine) => {
    pageState.data.settings.sttEngine = engine
  }

  // 監控設備連線狀態和錄音中斷線處理
  const monitorDeviceConnection = () => {
    console.log('🔧 初始化設備監控系統...')

    // 監聽設備變更事件
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      console.log('✅ 設備監控事件監聽器已註冊')

      navigator.mediaDevices.addEventListener('devicechange', async () => {
        console.log('🔍 檢測到設備變更事件')

        // 檢查當前選擇的設備是否仍然可用
        if (pageState.data.settings.microphoneDevice) {
          console.log('📱 檢查當前設備:', pageState.data.settings.microphoneDevice.label)

          try {
            const devices = await navigator.mediaDevices.enumerateDevices()
            const currentDevice = pageState.data.settings.microphoneDevice
            const deviceStillAvailable = devices.some(
              device => device.deviceId === currentDevice.deviceId || device.label === currentDevice.label,
            )

            console.log('🔍 設備可用性檢查結果:', deviceStillAvailable ? '✅ 設備仍可用' : '❌ 設備不可用')

            if (!deviceStillAvailable) {
              console.warn('⚠️ 當前選擇的設備已不可用:', currentDevice.label)

              // 如果正在錄音中，調用專門的斷線處理函數
              if (pageState.data.currentSession?.status === 'recording') {
                console.log('🚨 錄音中檢測到設備斷線，執行斷線處理...')
                await _handleRecordingDeviceDisconnection()
              }
              else {
                // 如果沒有錄音，只顯示彈窗通知
                console.log('📱 非錄音狀態下設備斷線，顯示通知彈窗')
                pageState.ui.showDeviceDisconnectedPopup = true
                pageState.data.deviceConnectionStatus = 'disconnected'
                pageState.errors.deviceError = '⚠️ 麥克風設備已斷線，請重新連接設備'
              }
            }
            else if (pageState.data.deviceConnectionStatus === 'disconnected') {
              // 設備重新可用，嘗試恢復錄音
              console.log('✅ 設備重新可用，嘗試恢復錄音')
              await handleDeviceReconnected()
            }
          }
          catch (error) {
            console.error('❌ 檢查設備狀態失敗:', error)
          }
        }
      })
    }
  }

  // 輔助函數：合併多個音訊流為單一串流
  const mergeAudioStreams = async (streams: MediaStream[]): Promise<MediaStream> => {
    const audioContext = new AudioContext() // 建立音訊上下文
    const destination = audioContext.createMediaStreamDestination() // 建立目標串流

    streams.forEach((stream) => {
      const source = audioContext.createMediaStreamSource(stream) // 為每個串流建立來源
      source.connect(destination) // 連接到目標
    })

    return destination.stream // 返回合併後的串流
  }

  // 輔助函數：取得瀏覽器支援的 MIME 類型
  const getSupportedMimeType = (): string => {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
      'audio/ogg',
      'audio/wav',
    ]

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type
      }
    }
    return 'audio/webm' // fallback
  }

  // 輔助函數：完成錄音並生成檔案（支援多片段合併）
  const finalizeRecording = () => {
    if (!pageState.data.currentSession)
      return

    const chunks = pageState.data.currentSession.recordedChunks
    if (chunks.length === 0) {
      console.warn('No recorded chunks available')
      return
    }

    console.log('🎵 合併所有音訊片段:', {
      totalChunks: chunks.length,
      totalSize: chunks.reduce((sum, chunk) => sum + chunk.size, 0),
      chunkSizes: chunks.map(chunk => chunk.size),
    })

    // 創建最終的錄音檔案（自動合併所有片段）
    const mimeType = pageState.data.currentSession.mediaRecorder?.mimeType || 'audio/webm'
    const blob = new Blob(chunks, { type: mimeType })
    const url = URL.createObjectURL(blob)

    // 生成檔案名稱
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const extension = mimeType.includes('webm') ? 'webm' : 'wav'
    const filename = `recording-${timestamp}.${extension}`

    // 使用實際錄音時間作為持續時間
    const duration = pageState.data.currentSession.actualRecordingTime || 0

    // 儲存檔案資訊
    pageState.data.currentSession.recordingFile = {
      blob,
      url,
      filename,
      mimeType,
      size: blob.size,
      duration,
      createdAt: Date.now(),
    }

    console.log('🎉 錄音合併完成:', {
      filename,
      size: blob.size,
      duration: `${duration}秒`,
      chunks: chunks.length,
      mimeType,
      blobUrl: `${url.substring(0, 50)}...`,
    })
  }

  // 切換轉錄語言
  const toggleTranscriptionLanguage = (languageCode: string) => {
    const language = pageState.data.settings.transcriptionLanguages.find(
      lang => lang.code === languageCode,
    )
    if (language) {
      language.selected = !language.selected
    }
  }

  // 新增轉錄語言
  const addTranscriptionLanguage = (language: TranscriptionLanguage) => {
    const existing = pageState.data.settings.transcriptionLanguages.find(
      lang => lang.code === language.code,
    )
    if (!existing) {
      pageState.data.settings.transcriptionLanguages.push(language)
    }
  }

  // 切換翻譯功能
  const toggleTranslation = () => {
    pageState.data.settings.translation.enabled = !pageState.data.settings.translation.enabled
  }

  // 設定翻譯模式
  const setTranslationMode = (mode: '句子' | '完整文件') => {
    pageState.data.settings.translation.mode = mode
  }

  // 設定摘要樣板
  const setSummaryTemplate = (template: '通用' | '會議' | '訪談' | '自訂') => {
    pageState.data.settings.summaryTemplate.template = template
  }

  // 驗證設定
  const validateSettings = (): boolean => {
    try {
      AudioRecordingSettingsSchema.parse(pageState.data.settings)
      return true
    }
    catch (error) {
      console.warn('Settings validation failed:', error)
      return false
    }
  }

  // 開始錄音：主要錄音功能入口點
  const startRecording = async () => {
    if (!validateSettings()) {
      pageState.errors.deviceError = '設定驗證失敗，請檢查所有必填欄位'
      return
    }

    pageState.loading.isRecording = true
    clearErrors()

    try {
      console.log('Starting recording with settings:', pageState.data.settings)

      // 創建錄音會話
      const sessionId = `session_${Date.now()}`
      pageState.data.currentSession = {
        id: sessionId,
        status: 'recording' as RecordingStatus,
        startTime: Date.now(),
        duration: 0,
        actualRecordingTime: 0,
        pausedDuration: 0,
        settings: { ...pageState.data.settings },
        audioData: [],
        transcription: '',
        captureStatus: 'requesting' as AudioCaptureStatus,
        recordedChunks: [],
        activeStreams: {},
      }

      // 收集所有音訊流
      const audioStreams: MediaStream[] = []

      // 1. 取得麥克風音訊
      if (pageState.data.settings.microphoneDevice) {
        try {
          console.log('🎬 開始錄音 - 使用麥克風設備:', {
            label: pageState.data.settings.microphoneDevice.label,
            deviceId: pageState.data.settings.microphoneDevice.deviceId,
          })

          const micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              deviceId: { exact: pageState.data.settings.microphoneDevice.deviceId },
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          })

          console.log('✅ 錄音成功取得麥克風流:', micStream.getAudioTracks()[0]?.label || '未知設備')
          audioStreams.push(micStream)
          pageState.data.currentSession.activeStreams!.microphone = micStream
          console.log('Microphone stream acquired')
        }
        catch (error) {
          console.warn('Failed to get microphone:', error)
          pageState.errors.deviceError = '無法存取麥克風設備'
        }
      }

      // 2. 取得系統音訊（如果已設定）
      if (pageState.data.settings.systemAudioDevice && pageState.data.settings.systemAudioSource === 'screen-share') {
        // 如果已經設定了螢幕分享設備，代表用戶已經完成權限授權
        // 這裡不需要重新請求權限，只需要檢查設備是否仍然可用
        console.log('Screen share device already configured, skipping permission request during recording start')

        // 注意：實際的螢幕分享流會在錄音過程中根據需要處理
        // 這裡只是確認設定已經就緒，避免重複的權限請求
      }

      // 檢查是否有任何音訊流
      if (audioStreams.length === 0) {
        throw new Error('沒有可用的音訊來源')
      }

      // 3. 合併音訊流（如果有多個）
      let finalStream: MediaStream
      if (audioStreams.length === 1) {
        finalStream = audioStreams[0]!
      }
      else {
        // 合併多個音訊流
        finalStream = await mergeAudioStreams(audioStreams)
      }

      // 4. 設定 MediaRecorder
      const mimeType = getSupportedMimeType()
      const mediaRecorder = new MediaRecorder(finalStream, {
        mimeType,
        audioBitsPerSecond: 128000, // 128 kbps
      })

      pageState.data.currentSession.mediaRecorder = mediaRecorder

      // 5. 設定錄音事件處理
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && pageState.data.currentSession) {
          pageState.data.currentSession.recordedChunks.push(event.data)
        }
      }

      mediaRecorder.onstop = () => {
        console.log('MediaRecorder stopped')
        finalizeRecording()
      }

      mediaRecorder.onerror = (event) => {
        console.error('MediaRecorder error:', event)
        pageState.errors.deviceError = '錄音過程中發生錯誤'
      }

      // 6. 開始錄音
      mediaRecorder.start(1000) // 每秒收集數據
      pageState.data.currentSession.captureStatus = 'active'

      // 7. 啟動錄音時長計時器
      startDurationTimer()

      // 8. 啟動設備監控（錄音期間監控設備狀態）
      monitorDeviceConnection()

      // 9. 設定音訊分析（延遲執行避免循環依賴）
      setTimeout(() => {
        try {
          const audioContext = new AudioContext()
          const source = audioContext.createMediaStreamSource(finalStream)
          const analyser = audioContext.createAnalyser()
          analyser.fftSize = 256
          source.connect(analyser)

          const dataArray = new Uint8Array(analyser.frequencyBinCount)
          const updateVolume = () => {
            if (pageState.data.currentSession?.captureStatus === 'active') {
              analyser.getByteFrequencyData(dataArray)
              const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length
              const volume = Math.round((average / 255) * 100)

              pageState.data.realTimeAudioData = {
                volume,
                frequency: analyser.frequencyBinCount,
                timestamp: Date.now(),
                deviceId: pageState.data.settings.microphoneDevice?.deviceId || 'unknown',
              }

              requestAnimationFrame(updateVolume)
            }
          }
          updateVolume()
        }
        catch (analysisError) {
          console.error('Recording audio analysis failed:', analysisError)
        }
      }, 100)

      // 關閉對話框
      closeDialog()
    }
    catch (error: any) {
      console.error('Error starting recording:', error)
      pageState.errors.deviceError = error.message || '無法開始錄音，請檢查設備連線'

      // 清理失敗的會話
      if (pageState.data.currentSession) {
        // stopRecording()
        pageState.data.currentSession = null
      }
    }
    finally {
      pageState.loading.isRecording = false
    }
  }

  // 停止錄音
  const stopRecording = () => {
    if (!pageState.data.currentSession)
      return

    // 停止 MediaRecorder
    if (pageState.data.currentSession.mediaRecorder) {
      const recorder = pageState.data.currentSession.mediaRecorder
      if (recorder.state === 'recording' || recorder.state === 'paused') {
        recorder.stop()
      }
    }

    // 停止所有活動的媒體串流
    if (pageState.data.currentSession.activeStreams?.microphone) {
      pageState.data.currentSession.activeStreams.microphone.getTracks().forEach((track: MediaStreamTrack) => track.stop())
    }
    if (pageState.data.currentSession.activeStreams?.systemAudio) {
      pageState.data.currentSession.activeStreams.systemAudio.getTracks().forEach((track: MediaStreamTrack) => track.stop())
    }

    // 更新會話狀態
    pageState.data.currentSession.status = 'processing' as RecordingStatus
    pageState.data.currentSession.captureStatus = 'inactive' as AudioCaptureStatus
    pageState.data.currentSession.endTime = Date.now()

    // 停止錄音時長計時器
    stopDurationTimer()

    // 計算最終的實際錄音時間
    if (pageState.data.currentSession.startTime) {
      // 如果當前是錄音狀態，需要累加最後一段錄音時間
      if (pageState.data.currentSession.status === 'recording') {
        const currentResumeTime = pageState.data.currentSession.lastResumeTime ?? pageState.data.currentSession.startTime
        const finalSegmentTime = Math.floor((pageState.data.currentSession.endTime! - currentResumeTime) / 1000)
        pageState.data.currentSession.actualRecordingTime = (pageState.data.currentSession.actualRecordingTime || 0) + finalSegmentTime
      }
      // 使用實際錄音時間作為最終時長
      pageState.data.currentSession.duration = pageState.data.currentSession.actualRecordingTime || 0
    }

    pageState.loading.isRecording = false

    // finalizeRecording 會在 MediaRecorder.onstop 中自動調用
  }

  // 下載錄音檔案
  const downloadRecording = () => {
    if (!pageState.data.currentSession?.recordingFile) {
      console.warn('No recording file available for download')
      return
    }

    const file = pageState.data.currentSession.recordingFile
    const link = document.createElement('a')
    link.href = file.url
    link.download = file.filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)

    console.log('Downloaded recording:', file.filename)
  }

  // 暫停錄音
  const pauseRecording = () => {
    if (!pageState.data.currentSession?.mediaRecorder)
      return

    const recorder = pageState.data.currentSession.mediaRecorder
    const session = pageState.data.currentSession

    if (recorder.state === 'recording') {
      recorder.pause()
      session.status = 'paused'

      // 暫停時：累加當前錄音段的時間到 actualRecordingTime
      if (session.lastResumeTime || session.startTime) {
        const now = Date.now()
        const currentResumeTime = session.lastResumeTime ?? session.startTime!
        const currentSegmentTime = Math.floor((now - currentResumeTime) / 1000)
        session.actualRecordingTime = (session.actualRecordingTime || 0) + currentSegmentTime
      }

      // 停止計時器
      stopDurationTimer()
    }
    else if (recorder.state === 'paused') {
      recorder.resume()
      session.status = 'recording'

      // 恢復時：記錄新的恢復時間點
      session.lastResumeTime = Date.now()

      // 重新啟動計時器
      startDurationTimer()
    }
  }

  // 錄音中切換麥克風設備（支援設備重連）
  const switchMicrophoneDuringRecording = async (newDevice: AudioDevice) => {
    if (!pageState.data.currentSession?.mediaRecorder) {
      console.warn('沒有活躍的錄音會話，無法切換麥克風')
      return
    }

    const recorder = pageState.data.currentSession.mediaRecorder
    const session = pageState.data.currentSession

    if (session.status !== 'recording' && session.status !== 'paused') {
      console.warn('錄音狀態不正確，無法切換麥克風')
      return
    }

    try {
      console.log('🔄 錄音中切換麥克風設備:', {
        from: pageState.data.settings.microphoneDevice?.label,
        to: newDevice.label,
        recordingStatus: session.status,
        currentChunks: session.recordedChunks.length,
      })

      // 1. 記錄當前狀態
      const wasRecording = session.status === 'recording'

      // 2. 如果當前有 MediaRecorder，先停止它
      if (recorder.state === 'recording' || recorder.state === 'paused') {
        console.log('🛑 停止當前 MediaRecorder 以保存音訊片段')

        // 累加當前錄音時間（在停止前）
        if (session.lastResumeTime || session.startTime) {
          const now = Date.now()
          const currentResumeTime = session.lastResumeTime ?? session.startTime!
          const currentSegmentTime = Math.floor((now - currentResumeTime) / 1000)
          session.actualRecordingTime = (session.actualRecordingTime || 0) + currentSegmentTime
          console.log('💾 累加錄音時間:', currentSegmentTime, '秒，總計:', session.actualRecordingTime, '秒')
        }

        // 停止錄音器並等待數據收集完成
        recorder.stop()

        // 等待 onstop 事件觸發（確保所有數據都被收集）
        await new Promise<void>((resolve) => {
          const timeoutId = setTimeout(() => {
            console.warn('⚠️ MediaRecorder stop 事件超時')
            resolve()
          }, 3000) // 3秒超時

          const originalOnStop = recorder.onstop
          recorder.onstop = (event: Event) => {
            clearTimeout(timeoutId)
            console.log('✅ MediaRecorder 已停止，數據已收集')
            if (originalOnStop)
              originalOnStop.call(recorder, event)
            resolve()
          }
        })

        stopDurationTimer()
      }

      // 3. 停止舊的音訊流
      if (session.activeStreams?.microphone) {
        console.log('🛑 停止舊的麥克風流')
        session.activeStreams.microphone.getTracks().forEach((track: MediaStreamTrack) => track.stop())
      }

      // 4. 獲取新的麥克風流
      console.log('🎤 獲取新的麥克風流')
      const newMicStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: newDevice.deviceId },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })

      console.log('✅ 成功獲取新的麥克風流:', newMicStream.getAudioTracks()[0]?.label || '未知設備')

      // 5. 更新設備選擇和活動流
      pageState.data.settings.microphoneDevice = newDevice
      if (session.activeStreams) {
        session.activeStreams.microphone = newMicStream
      }

      // 6. 創建新的音訊流組合
      const audioStreams = [newMicStream]

      // 如果有系統音訊流，也要包含進來
      if (session.activeStreams?.systemAudio) {
        audioStreams.push(session.activeStreams.systemAudio)
      }

      // 創建新的混合流
      let finalStream: MediaStream
      if (audioStreams.length === 1) {
        finalStream = audioStreams[0]!
      }
      else {
        finalStream = await mergeAudioStreams(audioStreams)
      }

      // 7. 創建新的 MediaRecorder
      console.log('🎬 創建新的 MediaRecorder，延續錄音會話')
      const mimeType = getSupportedMimeType()
      const newRecorder = new MediaRecorder(finalStream, {
        mimeType,
        audioBitsPerSecond: 128000,
      })

      // 8. 設定新的事件處理器（關鍵：保持原有的音訊片段）
      newRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && pageState.data.currentSession) {
        // 新的音訊數據會自動追加到現有的 recordedChunks 中
          pageState.data.currentSession.recordedChunks.push(event.data)
          console.log('📦 收集新的音訊片段，總片段數:', pageState.data.currentSession.recordedChunks.length)
        }
      }

      newRecorder.onstop = () => {
        console.log('📋 新的 MediaRecorder 停止，準備合併所有音訊片段')
        finalizeRecording() // 這會處理所有累積的音訊片段
      }

      newRecorder.onerror = (event) => {
        console.error('新的 MediaRecorder 錯誤:', event)
        pageState.errors.deviceError = '錄音設備切換後發生錯誤'
      }

      // 9. 更新會話的 MediaRecorder
      session.mediaRecorder = newRecorder

      // 10. 如果之前在錄音，立即開始新的錄音
      if (wasRecording) {
        console.log('▶️ 立即開始新設備錄音，無縫接續')
        newRecorder.start(1000) // 每秒收集數據
        session.status = 'recording'
        session.lastResumeTime = Date.now()
        startDurationTimer()

        // 重新啟動音訊分析
        setupRealtimeAudioAnalysis(newMicStream)
      }
      else {
      // 如果之前是暫停狀態，保持暫停
        session.status = 'paused'
        console.log('⏸️ 保持暫停狀態，等待用戶手動恢復')
      }

      console.log('✅ 成功切換麥克風設備，音訊片段將無縫合併')
    }
    catch (error) {
      console.error('❌ 切換麥克風失敗:', error)
      pageState.errors.deviceError = '切換麥克風失敗，請重試'
    }
  }

  // 設定音訊分析：建立 AnalyserNode 並開始即時音量監控
  const setupAudioAnalysis = (stream: MediaStream) => {
    try {
      const audioContext = new AudioContext() // 建立音訊上下文
      const source = audioContext.createMediaStreamSource(stream) // 建立音訊來源
      const analyser = audioContext.createAnalyser() // 建立分析器

      analyser.fftSize = 256 // 設定 FFT 大小
      source.connect(analyser) // 連接來源到分析器

      // 開始即時音量分析
      const dataArray = new Uint8Array(analyser.frequencyBinCount) // 建立頻率數據陣列

      const updateVolume = () => {
        if (pageState.data.currentSession?.captureStatus === 'active') {
          analyser.getByteFrequencyData(dataArray) // 取得頻率數據

          // 計算平均音量百分比
          const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length
          const volume = Math.round((average / 255) * 100) // 轉換為百分比

          // 更新即時音訊資料
          pageState.data.realTimeAudioData = {
            volume,
            frequency: analyser.frequencyBinCount,
            timestamp: Date.now(),
            deviceId: pageState.data.settings.microphoneDevice?.deviceId || 'unknown',
          }

          // 繼續下一幀分析
          requestAnimationFrame(updateVolume)
        }
      }

      updateVolume() // 開始分析循環
    }
    catch (error) {
      console.error('Audio analysis setup failed:', error)
      pageState.errors.deviceError = '音訊分析設定失敗，請檢查音訊設備'
    }
  }

  // 檢驗音量檢測：檢查是否有實際音量輸入
  const validateVolumeDetection = () => {
    if (pageState.data.realTimeAudioData) {
      const volume = pageState.data.realTimeAudioData.volume
      if (volume === 0) {
        pageState.errors.deviceError = '未檢測到音量，請檢查麥克風權限或音訊來源'
        return false
      }
    }
    return true
  }

  // 設備來源檢驗機制：重新檢查可用設備
  const revalidateDeviceSources = async () => {
    try {
      pageState.loading.isGettingDevices = true
      clearErrors()

      // 重新枚舉設備
      const devices = await navigator.mediaDevices.enumerateDevices()
      const audioDevices = devices.filter(device => device.kind === 'audioinput')

      if (audioDevices.length === 0) {
        pageState.errors.deviceError = '未找到可用的音訊輸入設備'
        return false
      }

      // 檢查當前選擇的設備是否仍然可用
      if (pageState.data.settings.microphoneDevice) {
        const currentDeviceExists = audioDevices.some(
          device => device.deviceId === pageState.data.settings.microphoneDevice?.deviceId,
        )

        if (!currentDeviceExists) {
          pageState.errors.deviceError = '當前選擇的設備已不可用，請重新選擇'
          pageState.data.settings.microphoneDevice = undefined
        }
      }

      return true
    }
    catch (error) {
      console.error('Device revalidation failed:', error)
      pageState.errors.deviceError = '設備檢驗失敗，請重新整理頁面'
      return false
    }
    finally {
      pageState.loading.isGettingDevices = false
    }
  }

  // 捕獲螢幕音訊：使用 getDisplayMedia API 取得螢幕分享音訊
  const captureScreenAudio = async (): Promise<MediaStream | null> => {
    pageState.loading.isGettingDevices = true
    clearErrors()

    try {
      console.log('開始螢幕分享音訊捕獲...')

      // 使用 getDisplayMedia 獲取螢幕分享，包含音訊
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true, // 必須包含視訊才能取得音訊
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 44100,
          channelCount: 2,
        },
      })

      console.log('螢幕分享 stream 取得成功:', stream)

      const audioTracks = stream.getAudioTracks()
      const videoTracks = stream.getVideoTracks()

      console.log('音訊軌道數量:', audioTracks.length)
      console.log('視訊軌道數量:', videoTracks.length)

      if (audioTracks.length > 0) {
        if (audioTracks[0]) {
          console.log('音訊軌道詳細資訊:', audioTracks[0].getSettings())
        }

        // 建立系統音訊設備物件
        const systemAudioDevice: AudioDevice = {
          deviceId: audioTracks[0]?.id || `screen-${Date.now()}`,
          label: '螢幕分享音訊',
          kind: 'audioinput',
          source: 'screen-share',
          capabilities: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            sampleRate: 44100,
            channelCount: 2,
          },
        }

        // 添加到可用設備列表
        const existingIndex = pageState.data.availableDevices.findIndex(
          device => device.source === 'screen-share',
        )
        if (existingIndex >= 0) {
          pageState.data.availableDevices[existingIndex] = systemAudioDevice
        }
        else {
          pageState.data.availableDevices.push(systemAudioDevice)
        }

        // 設定為當前系統音訊設備
        pageState.data.settings.systemAudioDevice = systemAudioDevice
        pageState.data.settings.systemAudioSource = 'screen-share'

        // 建立音訊分析器
        setupAudioAnalysis(stream)

        // 監聽螢幕分享結束事件
        const videoTracks = stream.getVideoTracks()
        const allTracks = [...videoTracks, ...audioTracks]

        const handleStreamEnd = () => {
          console.log('Screen sharing ended, clearing system audio device')

          // 清除系統音訊設備狀態
          pageState.data.settings.systemAudioDevice = undefined
          pageState.data.settings.systemAudioSource = 'none'

          // 從可用設備列表中移除螢幕分享設備
          pageState.data.availableDevices = pageState.data.availableDevices.filter(
            device => device.source !== 'screen-share',
          )

          // 清理實時音訊資料
          if (pageState.data.realTimeAudioData) {
            pageState.data.realTimeAudioData.volume = 0
          }
        }

        // 為所有音軌和視頻軌添加 ended 事件監聽器
        allTracks.forEach((track) => {
          track.addEventListener('ended', handleStreamEnd)
        })

        return stream
      }
      else {
        // 沒有音訊軌道的詳細說明
        console.warn('螢幕分享未包含音訊軌道 - 可能的原因:')
        console.warn('1. 分享的應用程式沒有播放音訊')
        console.warn('2. 分享的是整個螢幕而非特定應用程式')
        console.warn('3. 瀏覽器或作業系統不支援系統音訊捕獲')
        console.warn('4. 分享的應用程式（如 Spotify）不允許音訊捕獲')

        pageState.errors.deviceError = `
          螢幕分享未包含音訊軌道。
          
          💡 建議解決方案：
          • 確保選擇特定應用程式視窗（而非整個螢幕）
          • 確保該應用程式正在播放音訊
          • 對於 Spotify 等獨立應用程式，建議使用 Virtual Audio Cable
          • 嘗試分享瀏覽器分頁（如 YouTube）作為測試
        `
        return null
      }
    }
    catch (error: any) {
      console.error('Screen audio capture failed:', error)

      if (error.name === 'NotAllowedError') {
        pageState.errors.permissionError = '用戶拒絕螢幕分享或螢幕分享被取消'
      }
      else if (error.name === 'NotSupportedError') {
        pageState.errors.deviceError = `
          瀏覽器不支援螢幕音訊捕獲
          
          🔧 替代方案：
          • 使用支援的瀏覽器：Chrome 74+、Edge 79+
          • 安裝 Virtual Audio Cable 軟體
          • 確保作業系統支援音訊分享
        `
      }
      else {
        pageState.errors.deviceError = `
          無法開始螢幕音訊捕獲：${error.message}
          
          🚫 常見問題：
          • Spotify、Apple Music 等獨立應用程式無法直接捕獲
          • 需要額外軟體或硬體支援
          • 嘗試分享瀏覽器分頁進行測試
        `
      }
      return null
    }
    finally {
      pageState.loading.isGettingDevices = false
    }
  }

  // 檢測虛擬音訊設備
  const detectVirtualAudioDevices = async (): Promise<AudioDevice[]> => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()

      const virtualDevices = devices
        .filter(device => device.kind === 'audioinput')
        .filter((device) => {
          const label = device.label.toLowerCase()
          return (
            label.includes('cable')
            || label.includes('blackhole')
            || label.includes('virtual')
            || label.includes('loopback')
            || label.includes('vb-audio')
          )
        })
        .map(device => ({
          deviceId: device.deviceId,
          label: device.label,
          kind: 'audioinput' as const,
          source: 'virtual-cable' as const,
          groupId: device.groupId,
        }))

      return virtualDevices
    }
    catch (error) {
      console.error('Virtual device detection failed:', error)
      return []
    }
  }

  // 設定系統音訊來源
  const setSystemAudioSource = (source: SystemAudioSource) => {
    pageState.data.settings.systemAudioSource = source

    if (source === 'none') {
      pageState.data.settings.systemAudioDevice = undefined
    }
  }

  // 切換對話框分頁
  const changeTab = (tab: 'general' | 'advanced') => {
    pageState.ui.selectedTab = tab
  }

  // 計算已選擇的語言數量
  const selectedLanguagesCount = computed(() => {
    return pageState.data.settings.transcriptionLanguages.filter(lang => lang.selected).length
  })

  // 取得已選擇的語言列表
  const selectedLanguages = computed(() => {
    return pageState.data.settings.transcriptionLanguages.filter(lang => lang.selected)
  })

  // 商務平台錄製功能：檢測 getUserMedia 可用性（簡化版）
  const checkGetUserMediaSupport = async (): Promise<boolean> => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.warn('getUserMedia not supported')
        return false
      }

      // 嘗試取得音訊權限（不實際使用）
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach(track => track.stop()) // 立即停止

      return true
    }
    catch (error) {
      console.error('getUserMedia support check failed:', error)
      return false
    }
  }

  // 商務平台錄製功能：檢驗 MediaRecorder 支援度（30fps 考量）
  const checkMediaRecorderSupport = () => {
    if (!window.MediaRecorder) {
      return {
        supported: false,
        supportedMimeTypes: [] as string[],
        recommendedFrameRate: 0,
      }
    }

    const commonMimeTypes = [
      'audio/webm;codecs=opus', // 最佳品質
      'audio/webm', // 基本 WebM
      'audio/mp4', // MP4 容器
      'audio/mpeg', // MP3
      'audio/wav', // WAV（未壓縮）
    ]

    const supportedMimeTypes = commonMimeTypes.filter(
      mimeType => MediaRecorder.isTypeSupported(mimeType),
    )

    return {
      supported: supportedMimeTypes.length > 0,
      supportedMimeTypes,
      recommendedFrameRate: 30, // 建議 30fps 以利商務平台
    }
  }

  // 完整的平台能力檢測
  const testPlatformCapabilities = async (): Promise<PlatformCapabilities> => {
    pageState.loading.isTestingCapabilities = true
    console.log('開始進行平台能力檢測...')

    const capabilities: PlatformCapabilities = {
      getUserMedia: {
        supported: false,
        constraints: {
          audio: false,
          video: false,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        errors: [],
      },
      mediaRecorder: {
        supported: false,
        supportedMimeTypes: [],
        errors: [],
      },
      webAudio: {
        supported: false,
        audioContext: false,
        analyser: false,
      },
      platform: {
        os: 'Unknown',
        browser: 'Unknown',
        version: 'Unknown',
        mobile: false,
      },
    }

    // 檢測平台資訊
    capabilities.platform = detectPlatformInfo()

    // 檢測 getUserMedia 支援度
    capabilities.getUserMedia = await testGetUserMediaCapabilities()

    // 檢測 MediaRecorder 支援度
    capabilities.mediaRecorder = await testMediaRecorderCapabilities()

    // 檢測 Web Audio API 支援度
    capabilities.webAudio = testWebAudioCapabilities()

    pageState.data.platformCapabilities = capabilities
    pageState.loading.isTestingCapabilities = false

    console.log('平台能力檢測完成:', capabilities)
    return capabilities
  }

  // 測試函數：手動觸發設備斷線通知（用於測試）
  const testDeviceDisconnection = () => {
    console.log('🧪 測試：手動觸發設備斷線通知')
    pageState.ui.showDeviceDisconnectedPopup = true
    pageState.data.deviceConnectionStatus = 'disconnected'
    pageState.errors.deviceError = '⚠️ 測試：麥克風設備已斷線'
  }

  // 測試函數：手動觸發設備重連（用於測試）
  const testDeviceReconnection = () => {
    console.log('🧪 測試：手動觸發設備重連')
    pageState.ui.showDeviceDisconnectedPopup = false
    pageState.data.deviceConnectionStatus = 'connected'
    pageState.errors.deviceError = ''
  }

  // 初始化設備監控（在 composable 創建時立即開始監控）
  // 只在客戶端環境中初始化
  if (typeof window !== 'undefined' && navigator.mediaDevices) {
    monitorDeviceConnection()
  }
  else {
    console.log('⚠️ 非瀏覽器環境或不支援 MediaDevices API，跳過設備監控初始化')
  }

  return {
    pageState,

    // 對話框控制
    openDialog,
    closeDialog,

    // 設備管理
    getAvailableDevices,
    selectMicrophoneDevice,

    // 系統音訊功能
    captureScreenAudio,
    detectVirtualAudioDevices,
    setSystemAudioSource,

    // UI 控制
    changeTab,

    // 設定管理
    selectSttEngine,
    toggleTranscriptionLanguage,
    addTranscriptionLanguage,
    toggleTranslation,
    setTranslationMode,
    setSummaryTemplate,

    // 錄音控制
    startRecording,
    stopRecording,
    pauseRecording,
    switchMicrophoneDuringRecording,
    downloadRecording,

    // 計算屬性
    selectedLanguagesCount,
    selectedLanguages,

    // 工具函數
    validateSettings,
    clearErrors,

    // 新增的錯誤處理和檢測功能
    validateVolumeDetection,
    revalidateDeviceSources,
    monitorDeviceConnection,
    handleDeviceReconnected,

    // 平台支援檢測功能
    checkGetUserMediaSupport,
    checkMediaRecorderSupport,
    testPlatformCapabilities,

    // 測試函數（開發和調試用）
    testDeviceDisconnection,
    testDeviceReconnection,
  }
}
