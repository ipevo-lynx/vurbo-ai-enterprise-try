import type { RecordingFile } from '../audio/useRecordingManager'
import type { AudioDevice } from '~/service/schema/audio'
import { computed, reactive } from 'vue'
import { useDeviceManager } from '../audio/useDeviceManager'
import { useRecordingManager } from '../audio/useRecordingManager'

// 主要音訊頁面狀態
export interface AudioPageState {
  ui: {
    showDialog: boolean
    selectedTab: 'general' | 'advanced'
    showDeviceDisconnectedPopup: boolean
  }
  loading: {
    isReconnecting: boolean
  }
  errors: {
    lastError: string
  }
  data: {
    finalRecordingFile: RecordingFile | null
  }
}

export function useAudioPage() {
  // 使用設備管理器
  const deviceManager = useDeviceManager()

  // 使用錄音管理器
  const recordingManager = useRecordingManager()

  // 主頁面狀態
  const pageState: AudioPageState = reactive({
    ui: {
      showDialog: false,
      selectedTab: 'general',
      showDeviceDisconnectedPopup: false,
    },
    loading: {
      isReconnecting: false,
    },
    errors: {
      lastError: '',
    },
    data: {
      finalRecordingFile: null,
    },
  })

  // 清除所有錯誤
  const clearErrors = () => {
    pageState.errors.lastError = ''
    deviceManager.deviceState.errors.permissionError = ''
    deviceManager.deviceState.errors.deviceError = ''
    recordingManager.recordingState.errors.recordingError = ''
  }

  // 初始化函數（便於調試和手動初始化）
  const initialize = async () => {
    console.log('🚀 初始化音訊系統...')
    clearErrors()

    try {
      // 預先載入設備列表
      const devices = await deviceManager.getAvailableDevices()
      console.log('✅ 初始化完成，發現', devices.length, '個音訊設備')

      // 如果有設備且沒有預設選擇，自動選擇第一個
      if (devices.length > 0 && !recordingManager.recordingState.data.settings.microphoneDevice) {
        recordingManager.recordingState.data.settings.microphoneDevice = devices[0]
        console.log('🎤 自動選擇預設設備:', devices[0]?.label)
      }

      return devices
    }
    catch (error) {
      console.error('❌ 初始化失敗:', error)
      pageState.errors.lastError = '音訊系統初始化失敗'
      throw error
    }
  } // 對話框控制
  const openDialog = () => {
    console.log('📂 打開錄音設定對話框...')
    pageState.ui.showDialog = true

    // 打開對話框時自動載入設備列表（與原版本行為一致）
    deviceManager.getAvailableDevices()
      .then((devices) => {
        console.log('✅ 設備載入完成，可用設備:', devices.length)
        devices.forEach((device, index) => {
          console.log(`  ${index + 1}. ${device.label} (ID: ${device.deviceId.slice(0, 8)}...)`)
        })
      })
      .catch((error) => {
        console.error('❌ 載入設備列表失敗:', error)
        pageState.errors.lastError = '無法載入音訊設備列表，請檢查麥克風權限'
      })
  }

  const closeDialog = () => {
    pageState.ui.showDialog = false
    clearErrors() // 與原版本行為一致

    // 關閉對話框時停止音量監測
    deviceManager.stopVolumeMonitoring()
  }

  // 切換分頁
  const changeTab = (tab: 'general' | 'advanced') => {
    pageState.ui.selectedTab = tab
  }

  // 選擇麥克風設備
  const selectMicrophoneDevice = (device: AudioDevice) => {
    recordingManager.recordingState.data.settings.microphoneDevice = device
    console.log('已選擇麥克風設備:', device.label)

    // 選擇設備時開始音量監測
    deviceManager.startVolumeMonitoring(device)
      .then(() => {
        console.log('✅ 音量監測已啟動')
      })
      .catch((error) => {
        console.warn('⚠️ 音量監測啟動失敗:', error)
      })
  }

  // 設備斷線處理函數（需要在 startDeviceMonitoring 之前定義）
  const handleDeviceDisconnection = () => {
    console.log('🚨 檢測到設備斷線')

    // 🔥 關鍵修正：將設備斷線視為自動按了暫停按鈕
    if (recordingManager.recordingState.data.currentSession?.status === 'recording') {
      console.log('⏸️ 設備斷線 - 執行正常的暫停錄音邏輯')

      // 直接調用錄音管理器的結束片段方法（等同於 pauseRecording）
      recordingManager.endCurrentSegment()
    }

    // 顯示斷線提示
    pageState.ui.showDeviceDisconnectedPopup = true
    pageState.errors.lastError = '⚠️ 麥克風設備已斷線，錄音已暫停。重新連接後可繼續錄音。'

    console.log('✅ 設備斷線處理完成，錄音狀態已正常暫停')
  }

  const handleDeviceReconnected = () => {
    console.log('✅ 設備重新連接')
    pageState.ui.showDeviceDisconnectedPopup = false

    // 提供更明確的提示訊息
    if (recordingManager.recordingState.data.currentSession?.status === 'paused') {
      pageState.errors.lastError = '✅ 設備已重新連接！點擊「繼續錄音」按鈕恢復錄音。'
    }
    else {
      pageState.errors.lastError = '✅ 設備已重新連接！'
    }
  }

  // 設備監控系統
  const startDeviceMonitoring = () => {
    console.log('🔧 啟動設備監控系統...')

    // 監聽設備變更事件
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      console.log('✅ 設備監控事件監聽器已註冊')

      const deviceChangeHandler = async () => {
        console.log('🔍 檢測到設備變更事件')

        // 檢查當前選擇的設備是否仍然可用
        if (recordingManager.recordingState.data.settings.microphoneDevice) {
          const currentDevice = recordingManager.recordingState.data.settings.microphoneDevice
          console.log('📱 檢查當前設備:', currentDevice.label)

          try {
            const devices = await navigator.mediaDevices.enumerateDevices()
            const deviceStillAvailable = devices.some(
              device => device.deviceId === currentDevice.deviceId || device.label === currentDevice.label,
            )

            console.log('🔍 設備可用性檢查結果:', deviceStillAvailable ? '✅ 設備仍可用' : '❌ 設備不可用')

            if (!deviceStillAvailable) {
              console.warn('⚠️ 當前選擇的設備已不可用:', currentDevice.label)

              // 如果正在錄音中，調用設備斷線處理
              if (recordingManager.recordingState.data.currentSession?.status === 'recording') {
                console.log('🚨 錄音中檢測到設備斷線，執行斷線處理...')
                handleDeviceDisconnection()
              }
            }
            else if (pageState.ui.showDeviceDisconnectedPopup) {
              // 設備重新可用，嘗試恢復
              console.log('✅ 設備重新可用')
              handleDeviceReconnected()
            }
          }
          catch (error) {
            console.error('❌ 檢查設備狀態失敗:', error)
          }
        }
      }

      // 添加事件監聽器
      navigator.mediaDevices.addEventListener('devicechange', deviceChangeHandler)

      // 清理函數（可以在需要時調用）
      return () => {
        navigator.mediaDevices.removeEventListener('devicechange', deviceChangeHandler)
        console.log('🧹 設備監控已停止')
      }
    }
    else {
      console.warn('⚠️ 瀏覽器不支援設備變更監控')
      return () => {}
    }
  }

  // 錄音控制函數
  const startRecording = async () => {
    const device = recordingManager.recordingState.data.settings.microphoneDevice
    if (!device) {
      pageState.errors.lastError = '請先選擇麥克風設備'
      return
    }

    try {
      await recordingManager.startNewRecordingSegment(device)
      closeDialog() // 關閉設定對話框
      console.log('✅ 錄音已開始，對話框已關閉')

      // 🔥 延遲啟動設備監控
      setTimeout(() => {
        startDeviceMonitoring()
        console.log('🔧 設備監控已啟動')
      }, 100)
    }
    catch (error: any) {
      pageState.errors.lastError = error.message || '開始錄音失敗'
    }
  }

  const pauseRecording = () => {
    console.log('⏸️ 暫停錄音，保存當前音訊段落')
    recordingManager.endCurrentSegment()
    // 對話框保持開啟，顯示暫停狀態
  }

  const resumeRecording = async () => {
    console.log('▶️ 繼續錄音，開始新的音訊段落')
    const device = recordingManager.recordingState.data.settings.microphoneDevice
    if (!device) {
      pageState.errors.lastError = '請先選擇麥克風設備'
      return
    }

    try {
      // 🔥 簡化邏輯：不管是正常暫停還是設備斷線暫停，都按正常流程繼續
      await recordingManager.startNewRecordingSegment(device)
      console.log('✅ 新音訊段落錄製已開始')

      // 如果之前有設備斷線彈窗，自動關閉
      if (pageState.ui.showDeviceDisconnectedPopup) {
        pageState.ui.showDeviceDisconnectedPopup = false
        console.log('🔄 繼續錄音成功，自動關閉設備斷線提示')
      }

      // 清除錯誤訊息
      pageState.errors.lastError = ''
    }
    catch (error: any) {
      console.error('❌ 繼續錄音失敗:', error)
      pageState.errors.lastError = error.message || '繼續錄音失敗，請檢查設備連接'

      // 如果繼續錄音失敗，可能是設備仍然不可用
      if (error.name === 'NotFoundError' || error.name === 'NotAllowedError') {
        pageState.errors.lastError = '設備不可用，請重新連接麥克風設備'
        pageState.ui.showDeviceDisconnectedPopup = true
      }
    }
  }

  const stopRecording = async () => {
    console.log('🛑 結束錄音，合併所有音訊段落')

    // 如果當前有錄音會話，先結束它
    if (recordingManager.recordingState.data.currentSession?.mediaRecorder) {
      recordingManager.endCurrentSegment()

      // 等待片段保存完成
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    // 合併所有片段
    const finalFile = await recordingManager.finalizeAllRecordingSegments()
    if (finalFile) {
      pageState.data.finalRecordingFile = finalFile

      // 創建一個處理狀態的會話來顯示下載按鈕
      recordingManager.recordingState.data.currentSession = {
        id: `final_${Date.now()}`,
        status: 'processing',
        startTime: Date.now(),
        duration: finalFile.duration,
        actualRecordingTime: finalFile.duration,
        pausedDuration: 0,
        settings: recordingManager.recordingState.data.settings,
        audioData: [],
        transcription: '',
        captureStatus: 'inactive',
        recordedChunks: [],
        activeStreams: {},
        recordingFile: finalFile,
      }

      console.log('✅ 錄音完成並合併成功，狀態已更新為處理完成')
    }
  }

  const downloadRecording = () => {
    if (!pageState.data.finalRecordingFile) {
      console.warn('沒有可下載的錄音檔案')
      return
    }

    const file = pageState.data.finalRecordingFile
    const link = document.createElement('a')
    link.href = file.url
    link.download = file.filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)

    console.log('已下載錄音檔案:', file.filename)
  }

  const resetRecording = () => {
    recordingManager.resetRecording()
    pageState.data.finalRecordingFile = null
    pageState.ui.showDeviceDisconnectedPopup = false
    clearErrors()
  }

  // 簡化的功能函數（暫時不實作）
  const toggleTranslation = () => {
    console.log('切換翻譯功能（尚未實作）')
  }

  const setTranslationMode = (mode: '句子' | '完整文件') => {
    console.log('設定翻譯模式（尚未實作）:', mode)
  }

  const setSummaryTemplate = (template: '通用' | '會議' | '訪談' | '自訂') => {
    console.log('設定摘要樣板（尚未實作）:', template)
  }

  const captureScreenAudio = async (): Promise<MediaStream | null> => {
    console.log('捕獲螢幕音訊（尚未實作）')
    return null
  }

  const detectVirtualAudioDevices = async (): Promise<AudioDevice[]> => {
    console.log('偵測虛擬音訊設備（尚未實作）')
    return []
  }

  const setSystemAudioSource = (source: any) => {
    console.log('設定系統音訊來源（尚未實作）:', source)
  }

  // 設備斷線處理（舊版本已被新版本替換）
  // handleDeviceDisconnection 和 handleDeviceReconnected 的新版本已在上方定義

  // 設備監控系統（舊版本已被新版本替換）
  // startDeviceMonitoring 的新版本已在上方定義

  // 音量級別計算（用於 UI 顯示）
  const recordingDuration = computed(() => {
    return recordingManager.recordingState.data.currentSession?.duration || 0
  })

  // 統合的錄音統計
  const recordingStats = computed(() => ({
    ...recordingManager.recordingStats.value,
    currentDuration: recordingDuration.value,
    totalDuration: recordingManager.recordingState.data.totalRecordingDuration,
    hasCurrentSession: !!recordingManager.recordingState.data.currentSession,
    hasFinalFile: !!pageState.data.finalRecordingFile,
  }))

  // 已選擇的語言數量
  const selectedLanguagesCount = computed(() => {
    return recordingManager.recordingState.data.settings.transcriptionLanguages
      .filter((lang: any) => lang.selected)
      .length
  })

  // 語言和設定相關函數（簡化版）
  const toggleTranscriptionLanguage = (languageCode: string) => {
    const language = recordingManager.recordingState.data.settings.transcriptionLanguages
      .find((lang: any) => lang.code === languageCode)
    if (language) {
      language.selected = !language.selected
    }
  }

  const selectSttEngine = (engine: 'Azure' | 'OpenAI' | 'Google' | 'Local') => {
    recordingManager.recordingState.data.settings.sttEngine = engine
  }

  // 簡化的返回值，只包含必要的功能
  return {
    // 主要狀態（組合所有狀態）
    pageState: computed(() => ({
      ui: pageState.ui,
      loading: {
        ...pageState.loading,
        isGettingDevices: deviceManager.deviceState.loading.isGettingDevices,
        isRecording: recordingManager.recordingState.loading.isRecording,
      },
      errors: {
        ...pageState.errors,
        permissionError: deviceManager.deviceState.errors.permissionError,
        deviceError: deviceManager.deviceState.errors.deviceError,
        recordingError: recordingManager.recordingState.errors.recordingError,
      },
      data: {
        ...pageState.data,
        availableDevices: deviceManager.deviceState.data.availableDevices,
        currentSession: recordingManager.recordingState.data.currentSession,
        recordingSegments: recordingManager.recordingState.data.recordingSegments,
        settings: recordingManager.recordingState.data.settings,
        // 即時音訊數據（優先使用音量監測數據，否則從錄音會話獲取）
        realTimeAudioData: deviceManager.deviceState.data.isMonitoringVolume
          ? {
              volume: deviceManager.deviceState.data.currentVolumeLevel, // 直接使用百分比值
              frequency: 0,
              timestamp: Date.now(),
            }
          : recordingManager.recordingState.data.currentSession?.audioData?.[0] || null,
      },
    })),

    // 對話框控制
    openDialog,
    closeDialog,
    changeTab,

    // 設備管理（包裝為符合 AudioRecordDialog 期望的簽名）
    getAvailableDevices: async (): Promise<void> => {
      await deviceManager.getAvailableDevices()
    },
    selectMicrophoneDevice,

    // 錄音控制
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    downloadRecording,
    resetRecording,

    // 設備狀態處理
    handleDeviceDisconnection,
    handleDeviceReconnected,

    // 語言和設定
    toggleTranscriptionLanguage,
    selectSttEngine,
    selectedLanguagesCount,

    // AudioRecordDialog 需要的額外功能（簡化實作）
    toggleTranslation,
    setTranslationMode,
    setSummaryTemplate,
    captureScreenAudio,
    detectVirtualAudioDevices,
    setSystemAudioSource,

    // 計算屬性
    recordingStats,
    currentVolumeLevel: recordingManager.currentVolumeLevel,

    // 清理函數
    clearErrors,

    // 初始化函數（便於調試和手動初始化）
    initialize,
  }
}
