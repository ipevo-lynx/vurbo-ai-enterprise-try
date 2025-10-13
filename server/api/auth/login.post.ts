/**
 * API 端點：POST /api/auth/login
 * 功能：使用者登入驗證
 *
 * 請求型別：
 * interface LoginRequest {
 *   email: string    // 電子信箱
 *   password: string // 密碼
 * }
 *
 * 回應型別：
 * interface LoginResponse {
 *   success: boolean
 *   data: {
 *     token: string
 *     user: {
 *       id: string
 *       name: string
 *       email: string
 *     }
 *   } | null
 *   message: string[]
 *   notification: null
 *   redirect_url: null
 * }
 *
 * Mock 規則：
 * - 帳號 admin@example.com，密碼 123456 登入成功
 * - 其他帳號密碼組合登入失敗
 * - 成功時設置 token 和 refresh_token cookie
 */

import { defineEventHandler, readBody, setCookie, setHeader } from 'h3'

export default defineEventHandler(async (event) => {
  // 設定 JSON 響應格式
  setHeader(event, 'Content-Type', 'application/json')

  // 模擬 API 延遲
  await new Promise(resolve => setTimeout(resolve, 800))

  try {
    const body = await readBody(event)

    if (!body || typeof body !== 'object') {
      return {
        success: false,
        data: null,
        message: ['請求格式錯誤'],
        notification: null,
        redirect_url: null,
      }
    }

    const { email, password } = body

    if (!email || !password) {
      return {
        success: false,
        data: null,
        message: ['請輸入電子信箱和密碼'],
        notification: null,
        redirect_url: null,
      }
    }

    // Mock 登入驗證：只有特定帳號密碼可以登入
    if (email === 'admin@example.com' && password === '123456') {
      // 生成 JWT token
      const mockToken = `mock-jwt-token-${Date.now()}`

      // 設置認證 cookie
      setCookie(event, 'token', mockToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7, // 7 天
      })

      return {
        success: true,
        data: {
          token: mockToken,
          user: {
            id: 'user-001',
            name: '管理員',
            email: 'admin@example.com',
          },
        },
        message: ['登入成功'],
        notification: null,
        redirect_url: null,
      }
    }
    else {
      return {
        success: false,
        data: null,
        message: ['電子信箱或密碼錯誤'],
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
