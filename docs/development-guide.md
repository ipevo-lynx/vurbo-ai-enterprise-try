# 開發規範指南

> 📖 **重要**：本指南是專案開發的**主要入口**，提供當前實作的開發模板和檢查清單。

## 📋 開發新功能時的核心原則

1. **統一 API 選項** - 使用 `useFetchOptions` 的 `createApiOptions` 處理所有 API 請求
2. **頁面導向架構** - 頁面決定何時載入資料、如何處理操作
3. **職責分離** - useFetch 負責資料、$fetch 負責操作
4. **層級分離** - Store 層級不依賴 page 層級 composable，各層使用適當的底層工具
5. **狀態管理** - Store 是狀態的唯一來源，影響狀態的操作（如登入、登出）應在 Store 中實作
6. **函數 await** - useFetch 包裝函數和 useFetch 本身都要使用 async/await
7. **transform 簡化** - transform 只執行 validateSchema
8. **相對路徑** - 所有 API 調用只傳入相對路徑（如 `'home'`, `'auth/user'`）
9. **回應處理** - 頁面層級使用 `handleResponse` 處理 API 回應，預設使用 'silent' 模式
10. **身份驗證 API** - 需要身份驗證的 API 在頁面層級設定 `server: true, isRetry: true` 觸發 401 token refresh

## 🏷️ 變數命名規範

### Props 命名

所有 props 資料統一加上 `props.` 前綴，確保資料來源清晰：

```typescript
const props = defineProps<{ someValue: string }>()
// 使用時: props.someValue
```

### API 資料命名

API 進入頁面的資料使用 **資料名稱 + ApiData** 後綴：

```typescript
// 正確命名方式
const { data: homeApiData, pending, refresh } = await fetchHomeData()
const { data: loginApiData, pending, refresh } = await fetchLoginUrl()
const { data: userApiData } = await fetchUserData()
```

### 頁面狀態管理

所有頁面狀態統一使用 `pageState` 物件管理，依功能分組：

```typescript
const pageState = reactive({
  ui: {
    showModal: false,
    activeTab: 'personal-info',
    showVerificationCode: false,
  },
  loading: {
    isSendingCode: false,
    isVerifyingCode: false,
    isLoading: false,
  },
  errors: {
    codeError: '',
    emailError: '',
    apiError: '',
  },
  data: {
    selectedItem: null,
    hasData: computed(() => !!apiData.value),
  }
})

// 使用方式
pageState.ui.showModal = true
pageState.loading.isSendingCode = false
pageState.errors.emailError = '電子信箱格式錯誤'
```

## 📋 Schema 設計最佳實踐

所有 API 回應使用 `createApiResponseSchema` 建立，自動支援 data 為指定型別、null 或空陣列：

```typescript
// 在 Schema 文件中定義
import { createApiResponseSchema } from './common'

// 先定義資料結構，再生成 API 回應 Schema
const UserDataSchema = z.object({ id: z.string(), name: z.string() })
export const UserResponseSchema = createApiResponseSchema(UserDataSchema)

// 無資料返回的 API
export const DeleteUserResponseSchema = createApiResponseSchema(z.null())
```

## 🎯 型別定義分工

### Schema 文件 (`app/service/schema/*.ts`)

- **API 請求/回應型別**：所有 API 相關的型別定義
- **頁面和 Composable 共用型別**：在註解中標明使用位置
- **資料結構型別**：如 `User`、`Home` 等

### 組件文件 (`*.vue`)

- **Props 介面**：組件內部定義，可導入 Schema 中的型別來使用
- **組件專用型別**：如事件處理函數型別、內部狀態型別

## 🚀 快速開發模板

### 頁面 Composable

```typescript
import { useFetch } from '#app'
import { useFetchOptions } from '~/composables/useFetchOption'
import { createApiResponseSchema, validateSchema } from '~/service/schema/common'

export function useHomePage() {
  const { createApiOptions } = useFetchOptions()

  const fetchHomeData = async () => {
    const options = createApiOptions({
      key: 'home-page',
      server: true,
      isRetry: true, // 身份驗證 API 設定
      transform: response => validateSchema(HomeResponseSchema, response, '載入首頁資料'),
    })

    return await useFetch('home', options)
  }

  return { fetchHomeData }
}
```

### API 函數

```typescript
import { $fetch } from 'ofetch'
import { useFetchOptions } from '~/composables/useFetchOption'
import { validateSchema } from '~/service/schema/common'

export async function createUserApi(data: CreateUserInput) {
  const { createApiOptions } = useFetchOptions()

  try {
    const options = createApiOptions({ method: 'POST', body: data })
    const response = await $fetch('users', options)
    const validatedResponse = validateSchema(UserCreateResponseSchema, response, '建立使用者')

    return validatedResponse.success ? validatedResponse.data : null
  }
  catch (error) {
    console.error('[API Error]:', error)
    return null
  }
}
```

### 頁面使用

```vue
<script setup lang="ts">
import { reactive } from 'vue'
import { handleResponse } from '~/composables/useResponseHandler'

// 資料獲取
const { fetchHomeData } = useHomePage()
const { data: homeApiData, pending, refresh } = await fetchHomeData()

// 處理回應
handleResponse(homeApiData.value, 'silent', '載入資料')

// 狀態管理
const pageState = reactive({
  ui: { showModal: false },
  loading: { isLoading: pending },
  errors: { apiError: '' },
  data: {
    hasData: computed(() => !!homeApiData.value),
  }
})
</script>

<template>
  <div>
    <div v-if="pageState.loading.isLoading">
      載入中...
    </div>

    <div v-else-if="pageState.errors.apiError">
      {{ pageState.errors.apiError }}
    </div>

    <div v-else-if="pageState.data.hasData">
      <!-- 頁面內容 -->
    </div>
  </div>
</template>
```

## 📦 常用導入模組

```typescript
// 基礎 Nuxt 模組
import { navigateTo, useFetch } from '#app'
import { $fetch } from 'ofetch'
import { computed, reactive } from 'vue'

// 專案工具
import { useFetchOptions } from '~/composables/useFetchOption'
import { handleResponse } from '~/composables/useResponseHandler'
import { createApiResponseSchema, validateSchema } from '~/service/schema/common'

// Schema (依需求導入)
import { HomeResponseSchema } from '~/service/schema/home'
import { UserResponseSchema } from '~/service/schema/user'
```

## 📋 API 回應處理模式

### handleResponse 三種處理模式

```typescript
import { handleResponse } from '~/composables/useResponseHandler'

// 1. 'silent' - 預設模式，靜默處理錯誤，適用於一般頁面資料
handleResponse(rawData.value, 'silent', '載入資料')

// 2. 'tolerant' - 容錯模式，錯誤時前往有 layout 的錯誤頁面
handleResponse(rawData.value, 'tolerant', '載入內容')

// 3. 'strict' - 嚴格模式，錯誤時前往無 layout 的錯誤頁面（用於關鍵功能如 Layout）
handleResponse(rawData.value, 'strict', '載入佈局資料')
```

### 使用建議

- **'silent'**：一般頁面內容、非關鍵功能
- **'tolerant'**：重要但非核心的功能
- **'strict'**：Layout、核心系統功能

## 🔄 Schema 設計規範

### 統一的 API 回應 Schema

所有 API 回應都應該使用統一的格式，透過 `createApiResponseSchema` 生成：

```typescript
// 在 Schema 文件中定義
import { z } from 'zod'
import { createApiResponseSchema } from './common'

// 1. 先定義資料結構 Schema
const UserDataSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
})

// 2. 使用統一函數生成 API 回應 Schema
export const UserResponseSchema = createApiResponseSchema(UserDataSchema)

// 3. 對於無資料返回的 API（如刪除、更新操作）
export const DeleteUserResponseSchema = createApiResponseSchema(z.null())
```

### data 欄位支援格式

`createApiResponseSchema` 自動支援以下 data 格式，無需額外處理：

- **指定型別**：如 `UserData`、`string`、`number` 等
- **null**：無資料返回
- **空陣列 []**：兼容後端某些 API 回傳空陣列的情況

### Schema 檔案結構範例

```typescript
// app/service/schema/user.ts
import { z } from 'zod'
import { createApiResponseSchema } from './common'

// 頁面和 Composable 使用的型別 - 註解標明使用位置
export const LocationSchema = z.object({
  id: z.number(),
  name: z.string(),
}) // 用於 app/pages/example.vue 的選項

// 資料結構定義
export const UserDataSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
})

// API 回應 Schema
export const UserListResponseSchema = createApiResponseSchema(z.array(UserDataSchema))
export const UserDetailResponseSchema = createApiResponseSchema(UserDataSchema)
export const CreateUserResponseSchema = createApiResponseSchema(UserDataSchema)
export const UpdateUserResponseSchema = createApiResponseSchema(z.null())
export const DeleteUserResponseSchema = createApiResponseSchema(z.null())

// 型別導出 - 標注使用場景
export type Location = z.infer<typeof LocationSchema> // 用於 app/pages/example.vue
export type UserData = z.infer<typeof UserDataSchema>
```

## 🎯 泛型型別約束最佳實踐

### Nuxt useFetch 泛型使用

在 Nuxt 中，`useFetch` 和 `$fetch` 都支援泛型約束，應該充分利用：

```typescript
// ✅ 正確：在 composable 中使用泛型約束
export function useUserPage() {
  const { createApiOptions } = useFetchOptions()

  const fetchUserData = async () => {
    const options = createApiOptions({
      key: 'user-data',
      server: true,
      transform: (response): UserData => validateSchema(UserResponseSchema, response, '載入用戶資料').data!,
    })

    // 明確指定泛型型別，獲得完整型別安全
    return await useFetch<UserData>('user', options)
  }

  return { fetchUserData }
}
```

### API 請求參數 Schema

所有 API 請求參數都應該定義 Schema 進行驗證：

```typescript
// 請求參數 Schema
export const CreateUserRequestSchema = z.object({
  name: z.string().min(1, '姓名不能為空'),
  email: z.string().email('請輸入有效的電子郵件'),
  password: z.string().min(6, '密碼至少需要6個字符'),
})

export const UpdateUserRequestSchema = z.object({
  id: z.string(),
  name: z.string().min(1, '姓名不能為空').optional(),
  email: z.string().email('請輸入有效的電子郵件').optional(),
})

// 型別導出
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>
export type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>
```

## 🛠️ Mock API 開發規範

### Mock API 檔案結構要求

在 `server/api` 目錄下建立 Mock API 時，**必須**在檔案最上方添加 TypeScript 型別定義，方便後端開發者了解 API 的請求和回應結構。

#### 格式範例：

```typescript
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
 */

import { defineEventHandler, readBody, setHeader } from 'h3'

export default defineEventHandler(async (event) => {
  // Mock API 實作...
})
```

#### 型別定義要求：

1. **完整的請求型別**：包含所有請求參數的型別定義
2. **完整的回應型別**：包含所有回應欄位的型別定義
3. **註解說明**：API 端點、功能描述、重要欄位說明
4. **格式一致**：所有 Mock API 都採用相同的註解格式

## ✅ 檢查清單

### 基礎開發規範

- [ ] **API 路徑**：使用相對路徑（如 `'home'` 而非 `'/api/home'` 或 `'/home'`），不要以 `/` 開頭
- [ ] **統一選項**：調用 API 前，使用 `createApiOptions`，確保 API option 預設值一致
- [ ] **身份驗證設定**：需要身份驗證的 API 設定 `server: true, isRetry: true` 觸發 401 token refresh
- [ ] **Schema 統一**：使用 `createApiResponseSchema` 建立所有 API 回應 Schema，自動支援 data 為指定型別、null 或空陣列
- [ ] **Schema 驗證**：使用 `validateSchema` 驗證回應結構
- [ ] **回應處理**：頁面層級使用 `handleResponse` 處理 API 回應，預設使用 'silent' 模式
- [ ] **手動導入**：手動導入所有必要模組（本專案已關閉 Nuxt 的 auto import）
- [ ] **職責分離**：頁面決定執行時機，API 層只處理邏輯
- [ ] **層級分離**：Store 層級不依賴 page 層級 composable，直接使用底層工具實作
- [ ] **狀態管理**：影響全域狀態的操作（如登入、登出）透過 Store 統一管理，避免直接調用 API

### 型別約束檢查

- [ ] **API 泛型約束**：所有 `useFetch` 和 `$fetch` 都明確指定泛型型別
- [ ] **請求參數 Schema**：定義所有 API 請求參數的 Zod Schema 進行驗證
- [ ] **回應型別明確**：使用 `validateSchema` 後的回應型別要明確指定
- [ ] **頁面型別定義**：composable 和頁面需要的型別定義在 `app/service/schema` 中，並註解說明使用位置
- [ ] **組件型別分離**：組件內部使用的 Props 型別定義在組件內部，使用 `props.` 前綴
- [ ] **Schema 完整性**：每個 API 都有對應的請求和回應 Schema
- [ ] **型別導出**：Schema 文件中正確導出所有需要的型別並標注使用場景

### 變數命名規範

- [ ] **Props 命名**：統一使用 `props.propertyName` 格式，清楚標示資料來源
- [ ] **API 資料命名**：使用 `資料名稱 + ApiData` 格式（如 `homeApiData`、`loginApiData`）
- [ ] **頁面狀態管理**：使用 `pageState` 物件統一管理，依功能分組：
  - `pageState.ui.*` - UI 相關狀態（modal、tab、顯示狀態）
  - `pageState.loading.*` - 載入狀態（各種操作的載入狀態）
  - `pageState.errors.*` - 錯誤狀態（各種錯誤訊息）
  - `pageState.data.*` - 資料狀態（選擇項目、計算屬性等）

## 🔄 開發流程

1. 建立 Schema → 2. 建立 Page Composable → 3. 實作頁面 → 4. 建立 Mock API

**層級原則**：

- **頁面層級**：使用 `useXxxPage` composable
- **Store 層級**：直接使用底層工具，不依賴 page composable
- **身份驗證**：透過 `useAuthStore` 統一管理

## 🏗️ 身份驗證架構

### 核心設計原則

1. **職責分離**: 每個組件負責特定功能，避免重複邏輯
2. **狀態一致性**: Store 是身份狀態的唯一來源
3. **統一重定向**: 所有認證中間件統一重定向到登入頁面，帶上過期的 redirect cookie
4. **SSR/CSR 兼容**: 雙重檢查機制避免 hydration 問題
5. **錯誤容錯**: 認證失敗時優雅降級，不阻塞用戶體驗
6. **參數保留**: 完整保留 URL 參數

### Store 作為身份驗證狀態的唯一來源

```typescript
// 頁面中使用 Store 管理身份驗證狀態
import { useAuthStore } from '~/stores/auth'

const authStore = useAuthStore()

// 登入處理 - 透過 Store 統一管理狀態
const result = await authStore.login({ email, password })
if (result) {
  // authStore.currentUser 已自動更新
  await navigateTo('/')
}

// 登出處理 - 透過 Store 統一管理狀態
const success = await authStore.logout()
if (success) {
  // authStore.currentUser 已自動清除
  await navigateTo('/login')
}

// 取得當前用戶 - 直接從 Store 讀取
const user = authStore.currentUser
const isLoggedIn = authStore.isLoggedIn
```

### 中間件使用

#### `auth-only.ts` - 通用認證中間件

**使用場景**: 需要登入的一般頁面

```typescript
// pages/protected-page.vue
definePageMeta({
  middleware: 'auth-only'
})
```

### 重定向流程

```
用戶訪問 /protected-page?ref=123 (未登入)
  ↓
auth-only.ts 檢測：未登入
  ↓
重定向到 /login?redirect=%2Fprotected-page%3Fref%3D123
  ↓
登入頁面：保存 redirect 參數到 cookie
  ↓
用戶完成登入
  ↓
重定向到 /protected-page?ref=123 (保留所有參數)
```

這個開發規範確保了專案的一致性和可維護性，為新加入的開發者提供了清晰的指導原則。
