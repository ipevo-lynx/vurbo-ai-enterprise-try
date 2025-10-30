import { z } from 'zod'

// 音訊引擎類型
export const SttEngineSchema = z.enum(['Azure', 'OpenAI', 'Google', 'Local'])
export type SttEngine = z.infer<typeof SttEngineSchema>

// AudioStreamConfig: 音訊串流設定介面（基於 MediaStreamTrack 和 MediaRecorder 屬性設計）
export const AudioStreamConfigSchema = z.object({
  // === 必要屬性 (Required Properties) ===
  sampleRate: z.number().min(8000).max(192000), // 取樣率 (Hz)，建議: 16000(語音), 44100(音樂), 48000(專業)
  channels: z.number().min(1).max(8), // 聲道數：1(單聲道), 2(立體聲), 6(5.1環繞音效), 8(7.1環繞音效)
  encoding: z.string(), // 編碼格式：'pcm'(無壓縮), 'opus'(WebRTC標準), 'aac'(iOS優化), 'mp3'(通用)
  languageCode: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/), // 語言代碼，格式: 'zh-TW', 'en-US', 'ja-JP'

  // === 音訊處理屬性 (Audio Processing) ===
  echoCancellation: z.boolean().default(true), // 迴音消除：建議開啟，特別是在視訊會議場景
  noiseSuppression: z.boolean().default(true), // 雜音抑制：建議開啟，改善語音品質
  autoGainControl: z.boolean().default(true), // 自動增益控制：自動調整音量，避免過大或過小

  // === 延遲和緩衝設定 (Latency & Buffering) ===
  latency: z.enum(['realtime', 'interactive', 'balanced', 'playback']).default('interactive'), // 延遲模式
  bufferSize: z.number().min(256).max(16384).default(4096), // 緩衝區大小 (bytes)，影響延遲和穩定性

  // === 品質和效能設定 (Quality & Performance) ===
  bitRate: z.number().min(16000).max(320000).optional(), // 位元率 (bps)：16kbps(語音), 128kbps(音樂), 320kbps(高品質)
  codecPreferences: z.array(z.string()).default(['opus', 'aac', 'mp3']), // 編解碼器優先順序

  // === 平台兼容性設定 (Platform Compatibility) ===
  webAudioEnabled: z.boolean().default(true), // 是否使用 Web Audio API 進行分析
  mediaRecorderEnabled: z.boolean().default(true), // 是否使用 MediaRecorder API 錄音

  // === 串流和網路設定 (Streaming & Network) ===
  chunkDuration: z.number().min(100).max(10000).default(1000), // 音訊塊持續時間 (ms)
  maxRetries: z.number().min(0).max(10).default(3), // 失敗重試次數

  // === 中繼資料 (Metadata) ===
  sessionId: z.string().optional(), // 會話識別碼
  userId: z.string().optional(), // 用戶識別碼
  deviceInfo: z.object({
    platform: z.string(), // 平台：'iOS', 'Android', 'Windows', 'macOS', 'Linux'
    browser: z.string(), // 瀏覽器：'Chrome', 'Firefox', 'Safari', 'Edge'
    version: z.string(), // 版本號
  }).optional(),
}).passthrough() // 允許擴展自訂屬性

export type AudioStreamConfig = z.infer<typeof AudioStreamConfigSchema>

// AudioStreamConfig 預設值生成器
export function createDefaultAudioStreamConfig(): AudioStreamConfig {
  return {
    sampleRate: 16000, // 語音辨識最佳取樣率
    channels: 1, // 單聲道節省頻寬
    encoding: 'opus', // WebRTC 標準編碼
    languageCode: 'zh-TW', // 繁體中文
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    latency: 'interactive',
    bufferSize: 4096,
    codecPreferences: ['opus', 'aac', 'mp3'],
    webAudioEnabled: true,
    mediaRecorderEnabled: true,
    chunkDuration: 1000,
    maxRetries: 3,
  }
}

// AudioStreamMessage: 傳送音訊資料的訊息格式
export interface AudioStreamMessage {
  audioContent: ArrayBuffer | Uint8Array | string // 音訊資料本體
  sequenceNumber?: number // 音訊封包序號（可選）
  timestamp?: number // 時間戳記（可選）
  [key: string]: any // 其他自訂屬性
}

// AckMessage: 後端確認的回應訊息格式
export interface AckMessage {
  status: 'ok' | 'error' // 狀態
  message?: string // 錯誤或確認的說明訊息（可選）
  receivedSequence?: number // 已收到的序號（可選）
  [key: string]: any // 其他自訂屬性
}

// 音訊設備類型
export const AudioDeviceSchema = z.object({
  deviceId: z.string(), // 設備識別碼
  label: z.string(), // 設備顯示名稱
  kind: z.enum(['audioinput', 'audiooutput']), // 設備種類：輸入或輸出
  groupId: z.string().optional(), // 設備群組識別碼（可選）
  // 新增系統音訊相關欄位
  source: z.enum(['microphone', 'screen-share', 'virtual-cable', 'system']).optional(), // 音訊來源類型
  capabilities: z.object({
    echoCancellation: z.boolean().optional(), // 迴音消除功能
    noiseSuppression: z.boolean().optional(), // 雜音抑制功能
    autoGainControl: z.boolean().optional(), // 自動增益控制
    sampleRate: z.number().optional(), // 取樣率，例如 44100
    channelCount: z.number().optional(), // 聲道數，例如 2（立體聲）
  }).optional(),
})
export type AudioDevice = z.infer<typeof AudioDeviceSchema>

// 螢幕分享音訊設定
export const ScreenCaptureSettingsSchema = z.object({
  includeSystemAudio: z.boolean().default(true), // 是否包含系統音訊
  videoRequired: z.boolean().default(true), // 瀏覽器需要視訊才能取得音訊
  preferredQuality: z.enum(['low', 'medium', 'high']).default('high'), // 偏好品質設定
  echoCancellation: z.boolean().default(false), // 迴音消除（螢幕音訊通常關閉）
  noiseSuppression: z.boolean().default(false), // 雜音抑制（螢幕音訊通常關閉）
  sampleRate: z.number().default(44100), // 取樣率（Hz）
  channelCount: z.number().default(2), // 聲道數（立體聲）
})
export type ScreenCaptureSettings = z.infer<typeof ScreenCaptureSettingsSchema>

// 系統音訊來源類型
export const SystemAudioSourceSchema = z.enum([
  'none', // 無系統音訊
  'screen-share', // 螢幕分享音訊
  'virtual-cable', // 虛擬音訊線
  'browser-tab', // 瀏覽器分頁
  'specific-app', // 特定應用程式
])
export type SystemAudioSource = z.infer<typeof SystemAudioSourceSchema>

// 音訊捕獲狀態
export const AudioCaptureStatusSchema = z.enum([
  'inactive', // 未啟動
  'requesting', // 請求權限中
  'active', // 正在捕獲
  'paused', // 暫停
  'error', // 錯誤狀態
])
export type AudioCaptureStatus = z.infer<typeof AudioCaptureStatusSchema>

// 轉錄語言設定
export const TranscriptionLanguageSchema = z.object({
  code: z.string(), // 語言代碼，例如 'zh-TW', 'en-US'
  name: z.string(), // 語言顯示名稱，例如 '繁體中文 - 中文 (國語，繁體)'
  selected: z.boolean().default(false), // 是否被選中
})
export type TranscriptionLanguage = z.infer<typeof TranscriptionLanguageSchema>

// 翻譯設定
export const TranslationSettingsSchema = z.object({
  enabled: z.boolean().default(false), // 是否啟用翻譯功能
  mode: z.enum(['句子', '完整文件']).default('句子'), // 翻譯模式
})
export type TranslationSettings = z.infer<typeof TranslationSettingsSchema>

// 摘要樣板設定
export const SummaryTemplateSchema = z.object({
  template: z.enum(['通用', '會議', '訪談', '自訂']).default('通用'), // 預設摘要樣板
  customPrompt: z.string().optional(), // 自訂提示詞（可選）
})
export type SummaryTemplate = z.infer<typeof SummaryTemplateSchema>

// === 錯誤處理和診斷相關 Schema ===

// 錯誤類型枚舉：基於使用者體驗的錯誤分類
export const AudioErrorTypeSchema = z.enum([
  // 權限相關錯誤
  'permission_denied', // 用戶拒絕麥克風權限
  'permission_dismissed', // 用戶關閉權限對話框
  'permission_unavailable', // 瀏覽器不支援權限 API

  // 設備相關錯誤
  'device_not_found', // 找不到音訊設備
  'device_disconnected', // 設備意外斷線
  'device_busy', // 設備被其他應用程式佔用
  'device_invalid', // 設備 ID 無效或已過期

  // 網路和連線錯誤
  'network_error', // 網路連線問題
  'connection_timeout', // 連線逾時
  'server_unavailable', // 伺服器不可用

  // 瀏覽器兼容性錯誤
  'browser_unsupported', // 瀏覽器不支援所需功能
  'api_unavailable', // 所需 API 不可用
  'codec_unsupported', // 不支援的音訊編解碼器

  // 系統資源錯誤
  'insufficient_resources', // 系統資源不足
  'memory_limit_exceeded', // 記憶體限制超出

  // 其他錯誤
  'unknown_error', // 未知錯誤
  'configuration_error', // 設定錯誤
])
export type AudioErrorType = z.infer<typeof AudioErrorTypeSchema>

// 錯誤訊息結構
export const AudioErrorSchema = z.object({
  type: AudioErrorTypeSchema, // 錯誤類型
  code: z.string(), // 錯誤代碼 (如 'NotAllowedError', 'NotFoundError')
  message: z.string(), // 用戶友善的錯誤訊息
  technicalDetails: z.string().optional(), // 技術詳細資訊（開發者用）
  suggestions: z.array(z.string()).default([]), // 解決建議
  recoverable: z.boolean().default(false), // 是否可自動恢復
  timestamp: z.number().default(() => Date.now()), // 錯誤發生時間
  context: z.object({ // 錯誤上下文
    userAgent: z.string().optional(),
    deviceInfo: z.string().optional(),
    currentSettings: z.any().optional(),
  }).optional(),
})
export type AudioError = z.infer<typeof AudioErrorSchema>

// 設備連線狀態
export const DeviceConnectionStatusSchema = z.enum([
  'connected', // 已連接
  'disconnected', // 已斷線
  'reconnecting', // 重新連線中
  'failed', // 連線失敗
  'unknown', // 未知狀態
])
export type DeviceConnectionStatus = z.infer<typeof DeviceConnectionStatusSchema>

// 平台能力檢測結果
export const PlatformCapabilitiesSchema = z.object({
  getUserMedia: z.object({
    supported: z.boolean(), // 是否支援 getUserMedia
    constraints: z.object({ // 支援的約束條件
      audio: z.boolean(),
      video: z.boolean(),
      echoCancellation: z.boolean(),
      noiseSuppression: z.boolean(),
      autoGainControl: z.boolean(),
    }),
    errors: z.array(z.string()).default([]), // 檢測過程中的錯誤
  }),
  mediaRecorder: z.object({
    supported: z.boolean(), // 是否支援 MediaRecorder
    supportedMimeTypes: z.array(z.string()), // 支援的 MIME 類型
    maxBitRate: z.number().optional(), // 最大位元率
    errors: z.array(z.string()).default([]), // 檢測過程中的錯誤
  }),
  webAudio: z.object({
    supported: z.boolean(), // 是否支援 Web Audio API
    audioContext: z.boolean(), // AudioContext 可用性
    analyser: z.boolean(), // AnalyserNode 可用性
    maxChannels: z.number().optional(), // 最大聲道數
  }),
  platform: z.object({
    os: z.string(), // 作業系統
    browser: z.string(), // 瀏覽器
    version: z.string(), // 版本
    mobile: z.boolean(), // 是否為行動裝置
  }),
})
export type PlatformCapabilities = z.infer<typeof PlatformCapabilitiesSchema>

// 錄音設定完整結構
export const AudioRecordingSettingsSchema = z.object({
  // 語音設定
  sttEngine: SttEngineSchema.default('Azure'), // 語音轉文字引擎
  transcriptionLanguages: z.array(TranscriptionLanguageSchema), // 轉錄語言列表

  // 聲音來源
  microphoneDevice: AudioDeviceSchema.optional(), // 麥克風設備（可選）
  systemAudioDevice: AudioDeviceSchema.optional(), // 系統音訊設備（可選）

  // 系統音訊設定
  systemAudioSource: SystemAudioSourceSchema.default('none'), // 系統音訊來源類型
  screenCaptureSettings: ScreenCaptureSettingsSchema.optional(), // 螢幕捕獲設定（可選）

  // 內容設定
  translation: TranslationSettingsSchema.default({ enabled: false, mode: '句子' }), // 翻譯設定
  summaryTemplate: SummaryTemplateSchema.default({ template: '通用' }), // 摘要樣板設定
})
export type AudioRecordingSettings = z.infer<typeof AudioRecordingSettingsSchema>

// 音訊數據結構（用於即時展示音量等）
export const AudioDataSchema = z.object({
  volume: z.number().min(0).max(100), // 音量百分比（0-100）
  frequency: z.number().optional(), // 頻率（可選）
  timestamp: z.number(), // 時間戳記
  deviceId: z.string(), // 設備識別碼
})
export type AudioData = z.infer<typeof AudioDataSchema>

// 錄音狀態
export const RecordingStatusSchema = z.enum(['idle', 'recording', 'paused', 'processing'])
export type RecordingStatus = z.infer<typeof RecordingStatusSchema>

// 錄音檔案資訊
export const RecordingFileSchema = z.object({
  blob: z.any(), // Blob 物件
  url: z.string(), // 物件 URL（用於播放/下載）
  filename: z.string(), // 檔案名稱
  mimeType: z.string(), // MIME 類型
  size: z.number(), // 檔案大小（位元組）
  duration: z.number(), // 持續時間（秒）
  createdAt: z.number(), // 建立時間戳記
})
export type RecordingFile = z.infer<typeof RecordingFileSchema>

// 錄音會話數據
export const RecordingSessionSchema = z.object({
  id: z.string(), // 會話識別碼
  status: RecordingStatusSchema, // 錄音狀態
  startTime: z.number().optional(), // 開始時間（時間戳記）
  endTime: z.number().optional(), // 結束時間（時間戳記）
  duration: z.number().default(0), // 持續時間（秒數）
  actualRecordingTime: z.number().default(0), // 實際錄音時間（不包含暫停時間）
  lastResumeTime: z.number().optional(), // 最後一次恢復錄音的時間
  pausedDuration: z.number().default(0), // 總暫停時間
  settings: AudioRecordingSettingsSchema, // 錄音設定
  audioData: z.array(AudioDataSchema).default([]), // 音訊數據陣列
  transcription: z.string().default(''), // 轉錄文字
  translation: z.string().optional(), // 翻譯文字（可選）
  summary: z.string().optional(), // 摘要（可選）
  // 新增系統音訊相關資訊
  activeStreams: z.object({
    microphone: z.any().optional(), // 麥克風 MediaStream
    systemAudio: z.any().optional(), // 系統音訊 MediaStream
  }).optional(),
  captureStatus: AudioCaptureStatusSchema.default('inactive'), // 捕獲狀態
  // 新增錄音相關資訊
  mediaRecorder: z.any().optional(), // MediaRecorder 實例
  recordingFile: RecordingFileSchema.optional(), // 生成的錄音檔案
  recordedChunks: z.array(z.any()).default([]), // 音訊數據片段
})
export type RecordingSession = z.infer<typeof RecordingSessionSchema>

// 預設的轉錄語言列表
export const DEFAULT_TRANSCRIPTION_LANGUAGES: TranscriptionLanguage[] = [
  { code: 'zh-TW', name: '繁體中文 - 中文 (國語，繁體)', selected: true },
  { code: 'zh-CN', name: '簡體中文 - 中文 (普通話，簡體)', selected: false },
  { code: 'en-US', name: 'English - English (United States)', selected: false },
  { code: 'ja-JP', name: '日本語 - Japanese', selected: false },
  { code: 'ko-KR', name: '한국어 - Korean', selected: false },
]
