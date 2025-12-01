import { z } from 'zod'

/**
 * 音訊串流訊息結構 (Client → Server)
 */
export const AudioStreamMessageSchema = z.object({
  type: z.literal('audio_stream'),
  data: z.object({
    chunkId: z.string().uuid('Invalid chunk ID format'),
    sequenceNumber: z.number().int().min(0, 'Sequence number must be non-negative'),
    audioData: z.string().min(1, 'Audio data cannot be empty'), // Base64 encoded audio data
    format: z.enum(['mp3', 'wav', 'webm'], { message: 'Unsupported audio format' }),
    duration: z.number().positive('Duration must be positive'), // 音訊長度（秒）
    timestamp: z.number().int().positive('Invalid timestamp'),
    isLast: z.boolean().default(false), // 是否為最後一段
    metadata: z.object({
      sampleRate: z.number().int().positive().optional(),
      channels: z.number().int().min(1).max(2).optional(),
      bitRate: z.number().int().positive().optional(),
    }).optional(),
  }),
  taskId: z.string().optional(), // 關聯的任務 ID
})

/**
 * 確認訊息結構 (Server ↔ Client)
 */
export const AckMessageSchema = z.object({
  type: z.literal('ack'),
  data: z.object({
    chunkId: z.string().uuid('Invalid chunk ID format'),
    sequenceNumber: z.number().int().min(0),
    status: z.enum(['received', 'processed', 'error'], {
      message: 'Invalid ack status',
    }),
    timestamp: z.number().int().positive(),
    errorMessage: z.string().optional(), // 當 status 為 error 時提供
    processingTime: z.number().positive().optional(), // 處理時間（毫秒）
    // 新增：完整性檢查資訊
    integrityCheck: z.object({
      isComplete: z.boolean(), // 資料是否完整
      expectedSize: z.number().int().positive().optional(), // 預期大小
      actualSize: z.number().int().positive().optional(), // 實際大小
      checksum: z.string().optional(), // 校驗碼
      corruptionDetails: z.string().optional(), // 損壞詳情
    }).optional(),
  }),
  taskId: z.string().optional(),
})

/**
 * 音訊串流狀態查詢 (Client → Server)
 */
export const AudioStreamStatusSchema = z.object({
  type: z.literal('audio_status'),
  data: z.object({
    action: z.enum(['query', 'reset', 'pause', 'resume']),
    chunkIds: z.array(z.string().uuid()).optional(), // 查詢特定 chunk 狀態
  }),
  taskId: z.string().optional(),
})

/**
 * 音訊串流狀態回應 (Server → Client)
 */
export const AudioStreamStatusResponseSchema = z.object({
  type: z.literal('audio_status_response'),
  data: z.object({
    totalChunks: z.number().int().min(0),
    receivedChunks: z.number().int().min(0),
    processedChunks: z.number().int().min(0),
    errorChunks: z.number().int().min(0),
    chunkStatuses: z.array(z.object({
      chunkId: z.string().uuid(),
      sequenceNumber: z.number().int().min(0),
      status: z.enum(['pending', 'received', 'processed', 'error']),
      timestamp: z.number().int().positive(),
      errorMessage: z.string().optional(),
    })).optional(),
  }),
  taskId: z.string().optional(),
})

/**
 * 詳細完整性檢查報告 (Server → Client)
 */
export const IntegrityReportSchema = z.object({
  type: z.literal('integrity_report'),
  data: z.object({
    streamId: z.string(),
    taskId: z.string(),
    reportTimestamp: z.number().int().positive(),
    overallStatus: z.enum(['complete', 'incomplete', 'corrupted', 'processing']),
    totalExpectedChunks: z.number().int().min(0),
    summary: z.object({
      completeChunks: z.number().int().min(0),
      incompleteChunks: z.number().int().min(0),
      corruptedChunks: z.number().int().min(0),
      missingChunks: z.number().int().min(0),
    }),
    chunkDetails: z.array(z.object({
      chunkId: z.string().uuid(),
      sequenceNumber: z.number().int().min(0),
      status: z.enum(['complete', 'incomplete', 'corrupted', 'missing']),
      size: z.object({
        expected: z.number().int().positive().optional(),
        actual: z.number().int().positive().optional(),
      }).optional(),
      integrity: z.object({
        checksum: z.string().optional(),
        isValid: z.boolean(),
        errorDetails: z.string().optional(),
      }).optional(),
      timing: z.object({
        receivedAt: z.number().int().positive().optional(),
        processedAt: z.number().int().positive().optional(),
        processingDuration: z.number().positive().optional(),
      }).optional(),
    })),
    missingSequences: z.array(z.number().int().min(0)),
    recommendations: z.array(z.string()).optional(),
  }),
  taskId: z.string().optional(),
})

/**
 * 完整性檢查請求 (Client → Server)
 */
export const IntegrityCheckRequestSchema = z.object({
  type: z.literal('integrity_check'),
  data: z.object({
    action: z.enum(['full_report', 'missing_only', 'corrupted_only']),
    streamId: z.string().optional(),
    sequenceRange: z.object({
      start: z.number().int().min(0),
      end: z.number().int().min(0),
    }).optional(),
  }),
  taskId: z.string().optional(),
})

// TypeScript 類型導出
export type AudioStreamMessage = z.infer<typeof AudioStreamMessageSchema>
export type AckMessage = z.infer<typeof AckMessageSchema>
export type AudioStreamStatus = z.infer<typeof AudioStreamStatusSchema>
export type AudioStreamStatusResponse = z.infer<typeof AudioStreamStatusResponseSchema>
export type IntegrityReport = z.infer<typeof IntegrityReportSchema>
export type IntegrityCheckRequest = z.infer<typeof IntegrityCheckRequestSchema>

// 聯合類型：所有音訊相關訊息
export const AudioMessageSchema = z.union([
  AudioStreamMessageSchema,
  AckMessageSchema,
  AudioStreamStatusSchema,
  AudioStreamStatusResponseSchema,
  IntegrityReportSchema,
  IntegrityCheckRequestSchema,
])

export type AudioMessage = z.infer<typeof AudioMessageSchema>

// 音訊 Chunk 狀態枚舉
export enum AudioChunkStatus {
  PENDING = 'pending',
  SENT = 'sent',
  RECEIVED = 'received',
  PROCESSED = 'processed',
  ERROR = 'error',
}

// 音訊 Chunk 資料結構（前端使用）
export interface AudioChunk {
  id: string
  sequenceNumber: number
  audioData: string // Base64
  format: 'mp3' | 'wav' | 'webm'
  duration: number
  timestamp: number
  isLast: boolean
  status: AudioChunkStatus
  sentAt?: number
  acknowledgedAt?: number
  errorMessage?: string
  metadata?: {
    sampleRate?: number
    channels?: number
    bitRate?: number
  }
}
