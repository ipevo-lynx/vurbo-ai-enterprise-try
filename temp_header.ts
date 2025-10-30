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
        const elapsed = Math.floor((now - pageState.data.currentSession.startTime) / 1000)
        pageState.data.currentSession.duration = elapsed
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
