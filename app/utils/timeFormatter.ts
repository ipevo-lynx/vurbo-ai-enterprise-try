/**
 * 客戶端安全的時間格式化工具
 * 避免 SSR hydration mismatch 問題
 */
import { readonly, ref } from 'vue'

// 客戶端掛載狀態
const isMounted = ref(false)

// 在客戶端掛載後設置為 true
if (typeof window !== 'undefined') {
  // 延遲到下一個 tick 確保 hydration 完成
  setTimeout(() => {
    isMounted.value = true
  }, 0)
}

/**
 * 安全的時間格式化函數
 * 在 SSR 期間返回固定格式，hydration 後使用本地化格式
 */
export function formatTime(timestamp?: number | string): string {
  if (!timestamp)
    return '-'

  // 處理字符串時間戳
  const numericTimestamp = typeof timestamp === 'string'
    ? Number.parseInt(timestamp, 10)
    : timestamp

  if (Number.isNaN(numericTimestamp) || numericTimestamp <= 0)
    return '-'

  try {
    const date = new Date(numericTimestamp)

    // 檢查日期是否有效
    if (Number.isNaN(date.getTime()))
      return '-'

    // 在 SSR 期間或 hydration 未完成前使用 ISO 格式
    if (!isMounted.value || typeof window === 'undefined') {
      return date.toTimeString().slice(0, 8) // HH:MM:SS 格式
    }

    // 客戶端 hydration 完成後使用本地化格式
    return date.toLocaleTimeString('zh-TW', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }
  catch (error) {
    console.warn('formatTime error:', error)
    return '-'
  }
}

/**
 * 安全的日期時間格式化函數
 */
export function formatDateTime(timestamp?: number): string {
  if (!timestamp)
    return '-'

  const date = new Date(timestamp)

  if (!isMounted.value) {
    return date.toISOString().slice(0, 19).replace('T', ' ')
  }

  return date.toLocaleString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

/**
 * 獲取當前時間戳的安全格式化版本
 */
export function getCurrentTimeString(): string {
  return formatTime(Date.now())
}

/**
 * 客戶端掛載狀態
 */
export function useClientMounted() {
  return {
    isMounted: readonly(isMounted),
  }
}
