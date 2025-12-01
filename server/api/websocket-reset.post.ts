/**
 * API 端點：POST /api/websocket-reset
 * 功能：緊急重置 WebSocket 伺服器的斷線模擬狀態
 *
 * 用途：當永久斷線模擬導致無法重新連線時，
 * 通過 HTTP API 重置後端狀態
 */

import { defineEventHandler, readBody, setHeader } from 'h3'

// 全域重置標記（簡單的重置機制）
let needReset = false

// 獲取重置狀態
export function getNeedReset() {
  return needReset
}

// 清除重置標記
export function clearResetFlag() {
  needReset = false
}

export default defineEventHandler(async (event) => {
  // 設定 JSON 響應格式
  setHeader(event, 'Content-Type', 'application/json')

  // 只允許 POST 請求
  if (event.node.req.method !== 'POST') {
    return {
      success: false,
      message: '僅支援 POST 請求',
    }
  }

  try {
    const body = await readBody(event)

    if (body?.action === 'reset_disconnection_simulation') {
      // 設置重置標記
      needReset = true

      console.log('[API] 🔄 設置重置標記，WebSocket 插件將在下次檢查時重置狀態')

      return {
        success: true,
        message: '重置請求已處理，請稍後嘗試重新連線',
        timestamp: new Date().toISOString(),
      }
    }

    return {
      success: false,
      message: '未知的重置動作',
    }
  }
  catch (error) {
    console.error('[API] WebSocket 重置 API 錯誤:', error)

    return {
      success: false,
      message: `重置失敗: ${error}`,
    }
  }
})
