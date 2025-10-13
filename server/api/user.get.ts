/**
 * API 端點：GET /api/user
 * 功能：獲取當前用戶資訊
 *
 * 回應型別：
 * interface UserResponse {
 *   success: boolean
 *   data: {
 *     id: string
 *     name: string
 *     email: string
 *   } | null
 *   message: string[]
 *   notification: null
 *   redirect_url: null
 * }
 *
 * Mock 規則：
 * - 檢查 token cookie 是否存在
 * - 如果存在有效 token，返回用戶資訊
 * - 如果 token 無效或不存在，返回錯誤
 */

import { defineEventHandler, getCookie, setHeader } from 'h3'

export default defineEventHandler(async (event) => {
  // 設定 JSON 響應格式
  setHeader(event, 'Content-Type', 'application/json')

  // 模擬 API 延遲
  await new Promise(resolve => setTimeout(resolve, 300))

  try {
    // 獲取 token cookie
    const token = getCookie(event, 'token')

    if (!token) {
      return {
        success: false,
        data: null,
        message: ['未找到認證資訊'],
        notification: null,
        redirect_url: null,
      }
    }

    // 驗證 token
    if (token.startsWith('mock-jwt-token-')) {
      return {
        success: true,
        data: {
          id: 'user-001',
          name: '管理員',
          email: 'admin@example.com',
        },
        message: ['用戶資訊獲取成功'],
        notification: null,
        redirect_url: null,
      }
    }
    else {
      return {
        success: false,
        data: null,
        message: ['認證資訊無效'],
        notification: null,
        redirect_url: null,
      }
    }
  }
  catch {
    return {
      success: false,
      data: null,
      message: ['伺服器錯誤，請稍後再試'],
      notification: null,
      redirect_url: null,
    }
  }
})
