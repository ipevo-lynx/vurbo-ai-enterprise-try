import type { AudioDevice } from '~/service/schema/audio'
import { computed, reactive } from 'vue'

// 設備管理狀態
export interface DeviceManagerState {
  loading: {
    isGettingDevices: boolean
  }
  errors: {
    permissionError: string
    deviceError: string
  }
  data: {
    availableDevices: AudioDevice[]
    deviceConnectionStatus: 'connected' | 'disconnected' | 'reconnecting'
    reconnectAttempts: number
    maxReconnectAttempts: number
    // 音量監測相關
    currentVolumeLevel: number
    isMonitoringVolume: boolean
    selectedDeviceForMonitoring: AudioDevice | null
  }
}

export function useDeviceManager() {
  // 狀態管理
  const deviceState: DeviceManagerState = reactive({
    loading: {
      isGettingDevices: false,
    },
    errors: {
      permissionError: '',
      deviceError: '',
    },
    data: {
      availableDevices: [],
      deviceConnectionStatus: 'connected',
      reconnectAttempts: 0,
      maxReconnectAttempts: 5,
      // 音量監測相關
      currentVolumeLevel: 0,
      isMonitoringVolume: false,
      selectedDeviceForMonitoring: null,
    },
  })

  // 清除錯誤
  const clearErrors = () => {
    deviceState.errors.permissionError = ''
    deviceState.errors.deviceError = ''
  }

  // 獲取可用音訊設備
  const getAvailableDevices = async (): Promise<AudioDevice[]> => {
    deviceState.loading.isGettingDevices = true
    clearErrors()

    try {
      console.log('🔍 開始獲取音訊設備列表...')

      // 請求麥克風權限
      await navigator.mediaDevices.getUserMedia({ audio: true })
        .then((stream) => {
          // 立即停止流，我們只需要權限
          stream.getTracks().forEach(track => track.stop())
        })

      // 獲取設備列表
      const devices = await navigator.mediaDevices.enumerateDevices()

      const audioInputDevices = devices
        .filter(device => device.kind === 'audioinput')
        .map(device => ({
          deviceId: device.deviceId,
          label: device.label || `麥克風 ${device.deviceId.slice(0, 8)}`,
          kind: 'audioinput' as const,
          groupId: device.groupId,
          source: 'microphone' as const,
        }))

      deviceState.data.availableDevices = audioInputDevices
      console.log('✅ 成功獲取音訊設備:', audioInputDevices.length, '個設備')

      return audioInputDevices
    }
    catch (error: any) {
      console.error('❌ 獲取音訊設備失敗:', error)

      if (error.name === 'NotAllowedError') {
        deviceState.errors.permissionError = '請允許訪問麥克風以繼續錄音'
      }
      else if (error.name === 'NotFoundError') {
        deviceState.errors.deviceError = '未找到可用的音訊輸入設備'
      }
      else {
        deviceState.errors.deviceError = '無法獲取音訊設備列表'
      }

      return []
    }
    finally {
      deviceState.loading.isGettingDevices = false
    }
  }

  // 測試麥克風設備
  const testMicrophoneDevice = async (device: AudioDevice): Promise<boolean> => {
    try {
      console.log('🧪 測試麥克風設備:', device.label)

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: device.deviceId },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })

      // 測試音量檢測
      const audioContext = new AudioContext()
      const source = audioContext.createMediaStreamSource(stream)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)

      const dataArray = new Uint8Array(analyser.frequencyBinCount)

      // 短暫測試
      await new Promise(resolve => setTimeout(resolve, 100))
      analyser.getByteFrequencyData(dataArray)

      // 清理資源
      stream.getTracks().forEach(track => track.stop())
      audioContext.close()

      console.log('✅ 設備測試成功:', device.label)
      return true
    }
    catch (error) {
      console.error('❌ 設備測試失敗:', device.label, error)
      return false
    }
  }

  // 檢查設備是否可用
  const checkDeviceAvailability = async (deviceId: string): Promise<boolean> => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      return devices.some(device => device.deviceId === deviceId && device.kind === 'audioinput')
    }
    catch (error) {
      console.error('檢查設備可用性失敗:', error)
      return false
    }
  }

  // 監控設備變化
  const startDeviceMonitoring = (callback: (devices: AudioDevice[]) => void) => {
    navigator.mediaDevices.addEventListener('devicechange', async () => {
      console.log('📱 檢測到設備變化，重新獲取設備列表')
      const newDevices = await getAvailableDevices()
      callback(newDevices)
    })
  }

  // 停止設備監控
  const stopDeviceMonitoring = () => {
    // 移除所有 devicechange 監聽器
    navigator.mediaDevices.removeEventListener('devicechange', () => {})
  }

  // 音量監測相關變數
  let volumeMonitoringStream: MediaStream | null = null
  let volumeMonitoringInterval: number | null = null
  let audioContext: AudioContext | null = null
  let analyser: AnalyserNode | null = null

  // 停止音量監測
  const stopVolumeMonitoring = () => {
    console.log('🛑 停止音量監測')

    if (volumeMonitoringInterval) {
      clearInterval(volumeMonitoringInterval)
      volumeMonitoringInterval = null
    }

    if (volumeMonitoringStream) {
      volumeMonitoringStream.getTracks().forEach(track => track.stop())
      volumeMonitoringStream = null
    }

    if (audioContext) {
      audioContext.close()
      audioContext = null
      analyser = null
    }

    deviceState.data.isMonitoringVolume = false
    deviceState.data.selectedDeviceForMonitoring = null
    deviceState.data.currentVolumeLevel = 0
  }

  // 開始音量監測
  const startVolumeMonitoring = async (device: AudioDevice) => {
    try {
      console.log('🎤 開始監測設備音量:', device.label)

      // 停止之前的監測
      stopVolumeMonitoring()

      // 獲取音訊流
      volumeMonitoringStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: device.deviceId },
          echoCancellation: false, // 關閉回音消除以獲得更真實的音量
          noiseSuppression: false,
          autoGainControl: false,
        },
      })

      // 設置音訊分析
      audioContext = new AudioContext()
      const source = audioContext.createMediaStreamSource(volumeMonitoringStream)
      analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.8
      source.connect(analyser)

      deviceState.data.isMonitoringVolume = true
      deviceState.data.selectedDeviceForMonitoring = device

      // 開始定期檢測音量
      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      volumeMonitoringInterval = window.setInterval(() => {
        if (analyser) {
          analyser.getByteFrequencyData(dataArray)

          // 計算平均音量
          let sum = 0
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i] || 0
          }
          const average = sum / dataArray.length

          // 將 0-255 的範圍轉換為 0-100 的百分比，保留一位小數
          const percentage = Math.round((average / 255) * 1000) / 10 // 保留一位小數
          deviceState.data.currentVolumeLevel = Math.max(0, Math.min(100, percentage))
        }
      }, 50) // 每 50ms 更新一次

      console.log('✅ 音量監測已啟動')
    }
    catch (error: any) {
      console.error('❌ 啟動音量監測失敗:', error)
      deviceState.errors.deviceError = `無法啟動音量監測: ${error.message}`
      stopVolumeMonitoring()
    }
  }

  // 計算屬性
  const hasAudioInputDevices = computed(() => deviceState.data.availableDevices.length > 0)
  const isDeviceConnected = computed(() => deviceState.data.deviceConnectionStatus === 'connected')

  return {
    // 狀態
    deviceState,

    // 計算屬性
    hasAudioInputDevices,
    isDeviceConnected,

    // 方法
    clearErrors,
    getAvailableDevices,
    testMicrophoneDevice,
    checkDeviceAvailability,
    startDeviceMonitoring,
    stopDeviceMonitoring,
    // 音量監測
    startVolumeMonitoring,
    stopVolumeMonitoring,
  }
}
