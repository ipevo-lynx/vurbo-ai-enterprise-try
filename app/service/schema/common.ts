import type { ZodType } from 'zod'
import { z } from 'zod'

// Zod v4 使用 issues 而不是 errors，移除了舊的類型擴展

// 通知類型枚舉
export const NotificationTypeSchema = z.enum(['none', 'tip', 'warning', 'critical', 'redirect'])
export type NotificationType = z.infer<typeof NotificationTypeSchema>

// API 回應包裝 Schema 生成函數
// 支援 data 為指定型別或 null
export function createApiResponseSchema<T extends ZodType>(dataSchema: T) {
  return z.object({
    success: z.boolean(),
    data: dataSchema.nullable(),
    message: z.array(z.string()),
    notification: NotificationTypeSchema.nullable(),
    redirect_url: z.string().nullable(),
  }).passthrough()
}

// API 回應介面定義
export interface ApiResponse<T = unknown> {
  success: boolean
  data: T | null
  message: string[]
  notification: NotificationType | null
  redirect_url: string | null
}

// 驗證結果接口 (被多個驗證相關模組使用)
export interface ValidationResult {
  success: boolean
  data?: any
  error?: string
  errors?: Array<{
    field: string
    message: string
  }>
  summary?: string
}

// API 狀態相關
export interface ApiState {
  loading: boolean
  error: string | null
  success: boolean
}

// 頁面狀態管理通用介面（簡化版，移除 data）
export interface PageState {
  ui: Record<string, any>
  loading: Record<string, boolean>
  errors: Record<string, string>
}

// 載入狀態
export type LoadingState = 'idle' | 'loading' | 'success' | 'error'

// 詳細驗證 data 欄位的輔助函數（保留供未來使用）
function _tryValidateDataField(originalData: any, schema: ZodType): string[] {
  const detailedErrors: string[] = []

  try {
    // 從 schema 中提取 data 欄位的 schema
    const schemaDef = (schema as any)._def
    if (schemaDef.typeName === 'ZodObject' && schemaDef.shape().data) {
      const dataFieldSchema = schemaDef.shape().data
      const actualData = originalData?.data

      // 檢查 data 欄位是否為 nullable union 類型
      if ((dataFieldSchema as any)._def.typeName === 'ZodNullable') {
        const innerSchema = (dataFieldSchema as any)._def.innerType
        if ((innerSchema as any)._def.typeName === 'ZodUnion') {
          const unionOptions = (innerSchema as any)._def.options

          // 驗證每個 union 選項並收集錯誤
          for (let i = 0; i < unionOptions.length; i++) {
            const option = unionOptions[i]
            const optionResult = option.safeParse(actualData)

            if (!optionResult.success) {
              const optionType = (option as any)._def.typeName === 'ZodArray' ? '陣列格式' : '物件格式'
              detailedErrors.push(`   ➤ 嘗試 ${optionType} 驗證失敗:`)

              optionResult.error.errors.forEach((err: any, errIndex: number) => {
                const fullPath = err.path.length > 0 ? `data.${err.path.join('.')}` : 'data'
                detailedErrors.push(`     ${errIndex + 1}. [${fullPath}] ${err.message}`)
              })
            }
          }
        }
      }
    }
  }
  catch {
    // 詳細驗證失敗時跳過
  }

  return detailedErrors
}

// Schema 驗證函數
// 設計原則：API 結構有問題時，只在開發模式下發出 log 告知，不會阻止資料返回
export function validateSchema<T>(schema: z.ZodType<T>, data: unknown, context?: string): T {
  const result = schema.safeParse(data)

  if (!result.success) {
    // 只在開發模式下輸出詳細錯誤資訊
    if (import.meta.dev) {
      // Zod v4 兼容性：使用 result.error.issues 而不是 result.error.errors
      const issues = result.error.issues || []
      const errorSummary: string[] = []

      issues.forEach((issue, index) => {
        const path = issue.path && issue.path.length > 0 ? issue.path.join('.') : '(根層級)'
        let summary = `${index + 1}. [${path}] ${issue.message}`

        // 添加更多詳細信息（Zod v4 格式）
        if ('received' in issue) {
          summary += ` (收到: ${issue.received})`
        }
        if ('expected' in issue) {
          summary += ` (期望: ${issue.expected})`
        }
        if ('code' in issue) {
          summary += ` (錯誤代碼: ${issue.code})`
        }

        errorSummary.push(summary)
      })

      // 輸出警告資訊（不阻止執行）
      console.warn(`
⚠️ Schema 驗證失敗，繼續使用原始資料 - ${context || '未指定位置'}
─────────────────────────────────────────────────────────────────
共 ${issues.length} 個驗證錯誤：
${errorSummary.join('\n')}
─────────────────────────────────────────────────────────────────
💡 提示：這不會影響應用程式運行，但建議修正 API 資料結構以符合 Schema 定義

原始資料預覽：
${JSON.stringify(data, null, 2).substring(0, 2000)}${JSON.stringify(data, null, 2).length > 2000 ? '...' : ''}
`)
    }
    // 即使驗證失敗，仍然返回原始資料（不阻止資料流動）
    return data as T
  }

  return result.data
}
