import type {
  AudioCaptureStatus,
  AudioDevice,
  AudioRecordingSettings,
  RecordingSession,
  RecordingStatus,
} from '~/service/schema/audio'
import { computed, reactive } from 'vue'

// 錄音片段接口
export interface RecordingSegment {
  id: string
  blob: Blob
  duration: number
  startTime: number
  endTime: number
  mimeType: string
  deviceInfo?: {
    deviceId: string
    label: string
  }
}

// 錄音檔案接口
export interface RecordingFile {
  blob: Blob
  url: string
  filename: string
  mimeType: string
  size: number
  duration: number
  createdAt: number
}

// 錄音管理狀態
export interface RecordingManagerState {
  loading: {
    isRecording: boolean
  }
  errors: {
    recordingError: string
  }
  data: {
    currentSession: RecordingSession | null
    recordingSegments: RecordingSegment[]
    isRecordingInProgress: boolean
    totalRecordingDuration: number
    settings: AudioRecordingSettings
  }
}

export function useRecordingManager() {
  // 計時器
  let durationTimer: NodeJS.Timeout | null = null

  // 狀態管理
  const recordingState: RecordingManagerState = reactive({
    loading: {
      isRecording: false,
    },
    errors: {
      recordingError: '',
    },
    data: {
      currentSession: null,
      recordingSegments: [],
      isRecordingInProgress: false,
      totalRecordingDuration: 0,
      settings: {
        microphoneDevice: undefined,
        sttEngine: 'Azure',
        transcriptionLanguages: [
          { code: 'zh-TW', name: '繁體中文', selected: true },
          { code: 'en-US', name: 'English', selected: false },
        ],
        systemAudioSource: 'none',
        systemAudioDevice: undefined,
        translation: { enabled: false, mode: '句子' },
        summaryTemplate: { template: '通用' },
      },
    },
  })

  // 清除錯誤
  const clearErrors = () => {
    recordingState.errors.recordingError = ''
  }

  // 獲取支援的 MIME 類型
  const getSupportedMimeType = (): string => {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
      'audio/wav',
    ]

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type
      }
    }
    return 'audio/webm'
  }

  // 啟動錄音計時器
  const startDurationTimer = () => {
    if (durationTimer) {
      clearInterval(durationTimer)
    }

    durationTimer = setInterval(() => {
      if (recordingState.data.currentSession?.startTime) {
        const now = Date.now()
        const session = recordingState.data.currentSession

        if (session.status === 'recording') {
          const currentResumeTime = session.lastResumeTime ?? session.startTime
          if (currentResumeTime) {
            const currentSegmentTime = Math.floor((now - currentResumeTime) / 1000)
            session.duration = (session.actualRecordingTime || 0) + currentSegmentTime
          }
        }
      }
    }, 1000)
  }

  // 停止錄音計時器
  const stopDurationTimer = () => {
    if (durationTimer) {
      clearInterval(durationTimer)
      durationTimer = null
    }
  }

  // 設定即時音訊分析
  const setupRealtimeAudioAnalysis = (stream: MediaStream) => {
    try {
      const audioContext = new AudioContext()
      const source = audioContext.createMediaStreamSource(stream)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)

      const dataArray = new Uint8Array(analyser.frequencyBinCount)

      const updateVolume = () => {
        if (recordingState.data.currentSession?.captureStatus === 'active') {
          analyser.getByteFrequencyData(dataArray)
          const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length
          const volume = Math.round((average / 255) * 100)

          if (recordingState.data.currentSession) {
            recordingState.data.currentSession.audioData = [{
              volume,
              frequency: analyser.frequencyBinCount,
              timestamp: Date.now(),
              deviceId: recordingState.data.settings.microphoneDevice?.deviceId || 'unknown',
            }]
          }

          requestAnimationFrame(updateVolume)
        }
      }

      updateVolume()
    }
    catch (error) {
      console.error('設定音訊分析失敗:', error)
    }
  }

  // 清理當前錄音會話
  const cleanupCurrentSession = () => {
    if (recordingState.data.currentSession) {
      // 停止所有媒體流
      if (recordingState.data.currentSession.activeStreams?.microphone) {
        recordingState.data.currentSession.activeStreams.microphone.getTracks().forEach((track: MediaStreamTrack) => track.stop())
      }

      // 清除會話
      recordingState.data.currentSession = null
    }

    // 停止計時器
    stopDurationTimer()

    // 更新狀態
    recordingState.data.isRecordingInProgress = false
  }

  // 保存當前錄音片段到暫存區
  const saveCurrentRecordingSegment = () => {
    if (!recordingState.data.currentSession) {
      console.warn('沒有當前錄音會話可保存')
      return
    }

    const session = recordingState.data.currentSession
    const chunks = session.recordedChunks

    if (chunks.length === 0) {
      console.warn('沒有錄音數據可保存')
      return
    }

    console.log('💾 保存錄音片段:', {
      chunks: chunks.length,
      totalSize: chunks.reduce((sum, chunk) => sum + chunk.size, 0),
    })

    // 創建片段 Blob
    const mimeType = session.mediaRecorder?.mimeType || 'audio/webm'
    const blob = new Blob(chunks, { type: mimeType })

    // 計算片段時長
    const duration = session.actualRecordingTime || Math.floor((Date.now() - session.startTime!) / 1000)

    // 創建錄音片段對象
    const segment: RecordingSegment = {
      id: session.id,
      blob,
      duration,
      startTime: session.startTime!,
      endTime: Date.now(),
      mimeType,
      deviceInfo: recordingState.data.settings.microphoneDevice
        ? {
            deviceId: recordingState.data.settings.microphoneDevice.deviceId,
            label: recordingState.data.settings.microphoneDevice.label,
          }
        : undefined,
    }

    // 添加到片段列表
    recordingState.data.recordingSegments.push(segment)

    // 更新總時長
    recordingState.data.totalRecordingDuration += duration

    console.log('✅ 片段已保存:', {
      segmentId: segment.id,
      duration: `${duration}秒`,
      totalSegments: recordingState.data.recordingSegments.length,
      totalDuration: `${recordingState.data.totalRecordingDuration}秒`,
    })

    // 清理當前會話
    cleanupCurrentSession()
  }

  // 開始新的錄音片段
  const startNewRecordingSegment = async (device: AudioDevice) => {
    recordingState.loading.isRecording = true
    clearErrors()

    try {
      console.log('🎬 開始新的錄音片段...')

      // 創建新的錄音會話
      const sessionId = `segment_${Date.now()}`
      recordingState.data.currentSession = {
        id: sessionId,
        status: 'recording' as RecordingStatus,
        startTime: Date.now(),
        duration: 0,
        actualRecordingTime: 0,
        pausedDuration: 0,
        settings: { ...recordingState.data.settings },
        audioData: [],
        transcription: '',
        captureStatus: 'requesting' as AudioCaptureStatus,
        recordedChunks: [],
        activeStreams: {},
      }

      // 獲取麥克風流
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: device.deviceId },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })

      console.log('✅ 成功獲取麥克風流:', micStream.getAudioTracks()[0]?.label || '未知設備')
      recordingState.data.currentSession.activeStreams!.microphone = micStream

      // 創建 MediaRecorder
      const mimeType = getSupportedMimeType()
      const mediaRecorder = new MediaRecorder(micStream, {
        mimeType,
        audioBitsPerSecond: 128000,
      })

      recordingState.data.currentSession.mediaRecorder = mediaRecorder

      // 設定錄音事件處理
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && recordingState.data.currentSession) {
          recordingState.data.currentSession.recordedChunks.push(event.data)
          console.log('📦 收集音訊數據，大小:', event.data.size)
        }
      }

      mediaRecorder.onstop = () => {
        console.log('📋 MediaRecorder 停止，準備保存片段')
        saveCurrentRecordingSegment()
      }

      mediaRecorder.onerror = (event) => {
        console.error('MediaRecorder 錯誤:', event)
        recordingState.errors.recordingError = '錄音過程中發生錯誤'
      }

      // 開始錄音
      mediaRecorder.start(1000)
      recordingState.data.currentSession.captureStatus = 'active'
      recordingState.data.isRecordingInProgress = true

      // 啟動計時器和音訊分析
      startDurationTimer()
      setupRealtimeAudioAnalysis(micStream)

      console.log('✅ 新錄音片段已開始')
    }
    catch (error: any) {
      console.error('❌ 開始錄音片段失敗:', error)
      recordingState.errors.recordingError = error.message || '無法開始錄音'
      recordingState.data.currentSession = null
    }
    finally {
      recordingState.loading.isRecording = false
    }
  }

  // 結束當前片段（暫停）
  const endCurrentSegment = () => {
    if (!recordingState.data.currentSession?.mediaRecorder) {
      console.warn('沒有活躍的錄音會話可結束')
      return
    }

    console.log('⏸️ 結束當前片段')

    const recorder = recordingState.data.currentSession.mediaRecorder

    if (recorder.state === 'recording') {
      // 計算並保存當前片段的錄音時間
      const session = recordingState.data.currentSession
      if (session.lastResumeTime || session.startTime) {
        const now = Date.now()
        const currentResumeTime = session.lastResumeTime ?? session.startTime!
        const currentSegmentTime = Math.floor((now - currentResumeTime) / 1000)
        session.actualRecordingTime = (session.actualRecordingTime || 0) + currentSegmentTime
      }

      // 停止錄音器（會觸發 onstop 事件，自動保存片段）
      recorder.stop()
      session.status = 'paused'
    }
  }

  // 合併所有錄音片段
  const finalizeAllRecordingSegments = async (): Promise<RecordingFile | null> => {
    console.log('🎉 開始合併所有錄音片段...')

    if (recordingState.data.recordingSegments.length === 0) {
      recordingState.errors.recordingError = '沒有錄音片段可合併'
      return null
    }

    try {
      // 合併所有片段
      const allChunks: Blob[] = []
      let totalDuration = 0

      recordingState.data.recordingSegments.forEach((segment, index) => {
        console.log(`📦 添加片段 ${index + 1}:`, {
          duration: `${segment.duration}秒`,
          size: segment.blob.size,
          mimeType: segment.mimeType,
        })

        allChunks.push(segment.blob)
        totalDuration += segment.duration
      })

      // 創建最終音檔
      const finalMimeType = recordingState.data.recordingSegments[0]?.mimeType || 'audio/webm'
      const finalBlob = new Blob(allChunks, { type: finalMimeType })
      const finalUrl = URL.createObjectURL(finalBlob)

      // 生成檔案名稱
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const extension = finalMimeType.includes('webm') ? 'webm' : 'wav'
      const filename = `recording-${timestamp}.${extension}`

      // 創建最終的錄音檔案資訊
      const finalRecordingFile: RecordingFile = {
        blob: finalBlob,
        url: finalUrl,
        filename,
        mimeType: finalMimeType,
        size: finalBlob.size,
        duration: totalDuration,
        createdAt: Date.now(),
      }

      console.log('🎉 所有片段合併完成:', {
        totalSegments: recordingState.data.recordingSegments.length,
        totalDuration: `${totalDuration}秒`,
        finalSize: finalBlob.size,
        filename,
      })

      return finalRecordingFile
    }
    catch (error) {
      console.error('❌ 合併錄音片段失敗:', error)
      recordingState.errors.recordingError = '合併錄音片段失敗'
      return null
    }
  }

  // 清理所有錄音片段
  const clearRecordingSegments = () => {
    // 釋放 Blob URLs
    recordingState.data.recordingSegments.forEach((segment) => {
      if (segment.blob) {
        URL.revokeObjectURL(URL.createObjectURL(segment.blob))
      }
    })

    // 清空片段列表
    recordingState.data.recordingSegments = []
    recordingState.data.totalRecordingDuration = 0

    console.log('🧹 已清理所有錄音片段暫存')
  }

  // 重置錄音狀態
  const resetRecording = () => {
    console.log('🔄 重置錄音狀態')

    // 停止當前錄音（如果有）
    if (recordingState.data.currentSession?.mediaRecorder) {
      const recorder = recordingState.data.currentSession.mediaRecorder
      if (recorder.state === 'recording') {
        recorder.stop()
      }
    }

    // 清理所有狀態
    cleanupCurrentSession()
    clearRecordingSegments()
    clearErrors()

    console.log('✅ 錄音狀態已重置')
  }

  // 計算屬性
  const recordingStats = computed(() => ({
    segmentCount: recordingState.data.recordingSegments.length,
    totalDuration: recordingState.data.totalRecordingDuration,
    isRecording: recordingState.data.currentSession?.status === 'recording',
    isPaused: recordingState.data.recordingSegments.length > 0 && !recordingState.data.isRecordingInProgress,
    canContinue: recordingState.data.recordingSegments.length > 0 && !recordingState.data.isRecordingInProgress,
    canFinalize: recordingState.data.recordingSegments.length > 0,
    hasRecordedContent: recordingState.data.recordingSegments.length > 0,
  }))

  const currentVolumeLevel = computed(() => {
    if (!recordingState.data.currentSession?.audioData?.[0])
      return 0
    const volume = recordingState.data.currentSession.audioData[0].volume || 0
    return Math.max(1, Math.min(10, Math.ceil(volume / 10)))
  })

  return {
    // 狀態
    recordingState,

    // 計算屬性
    recordingStats,
    currentVolumeLevel,

    // 方法
    clearErrors,
    startNewRecordingSegment,
    endCurrentSegment,
    finalizeAllRecordingSegments,
    clearRecordingSegments,
    resetRecording,
  }
}
