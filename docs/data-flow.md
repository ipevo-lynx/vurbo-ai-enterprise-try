# 資料流設計總覽

本專案採用現代化的分層資料流架構，基於 **Nuxt 4 + Vue 3 + TypeScript + Zod + Pinia** 技術棧，確保型別安全與維護性。

## 架構概覽

```
Mock API → Zod Schema 驗證 → Page Composable → Vue 頁面 → UI 組件
```

## 專案結構

```
app/
├── service/schema/          # 資料結構定義（統一管理所有型別）
│   ├── common.ts           # 共用工具、基礎 Schema 和通用型別
│   ├── home.ts            # 首頁相關資料結構
│   └── user.ts            # 使用者與身份驗證相關資料結構
├── composables/page/       # 頁面邏輯層
│   ├── useHomePage.ts     # 首頁邏輯與 API 取得
│   └── useLoginPage.ts    # 登入頁邏輯與驗證
├── pages/                 # 頁面檔案（對應路由）
│   ├── index.vue          # 首頁 (/)
│   └── login.vue          # 登入頁 (/login)
├── components/            # UI 組件層
│   ├── HomeFeatureCard.vue
│   ├── HomeDescriptionCard.vue
│   └── HomeWelcomeMessage.vue
└── stores/               # 全域狀態管理 (Pinia)
    └── auth.ts           # 身份驗證狀態
```

## 命名規範

### 資料命名

- **API 回應資料**：`xxxApiData` (第一手資料)
- **業務邏輯資料**：`xxxData` (經過處理的資料)
- **頁面狀態管理**：使用 `pageState` 物件統一管理

### 檔案命名

- **Schema 檔案**：小寫 + 功能名稱 (`home.ts`, `user.ts`)
- **Composable 檔案**：`useXxxPage.ts` 格式
- **組件檔案**：PascalCase 格式 (`HomeFeatureCard.vue`)
- **頁面檔案**：小寫，對應路由 (`index.vue`, `login.vue`)

## 資料流程

1. **API 層**：後端或 Mock API 回傳 JSON 資料
2. **驗證層**：使用 Zod Schema 驗證資料結構，推導 TypeScript 型別
3. **邏輯層**：Composable 負責 API 資料取得與業務邏輯處理
4. **頁面層**：Vue 頁面組織狀態與資料，統一管理 UI 狀態
5. **組件層**：UI 組件專注於呈現，資料透過 props 傳遞

## 核心技術配置

### Zod 驗證 (v4.1.12)

- 使用 `z.infer<>` 推導 TypeScript 型別
- 支援嚴格型別檢查 (`tsconfig.json` 啟用 `strict: true`)
- 提供 `validateSchema` 函數統一處理驗證邏輯

### Nuxt 配置重點

- **禁用自動導入**：確保明確的依賴關係
  - `components: false`
  - `imports.autoImport: false`
- **使用 Pinia**：全域狀態管理
- **Tailwind CSS v4**：樣式系統

### ESLint 配置

- 使用 `@antfu/eslint-config` 統一程式碼風格
- 啟用 `stylistic` 風格檢查
- 支援 `eslint-plugin-format` 格式化工具

## 開發規範

### 1. Schema 定義

```typescript
// 所有 Schema 檔案必須導出型別供共用
export type HomeData = z.infer<typeof HomeDataSchema>
```

### 2. API 資料取得

```typescript
// 使用 useFetch，不可包在 try-catch 內（保持響應式）
const { data: homeApiData, pending } = await useFetch('/api/home')
```

### 3. 頁面狀態管理

```typescript
// 統一使用 pageState 物件，依功能分組
const pageState = reactive({
  ui: { showModal: false },
  loading: { isSubmitting: false },
  errors: { validationError: '' }
})
```

### 4. 組件 Props

```typescript
// 明確標示資料來源
const displayName = props.feature.name // ✅ 清楚來源
```

## 注意事項

- **useFetch 使用**：避免包在 try-catch 內，否則失去響應式與 SSR 機制
- **型別導出**：Schema 檔案務必導出所有型別供共用
- **狀態集中**：頁面狀態統一在 `pageState` 管理，避免分散
- **組件設計**：資料盡量透過 props 傳遞，減少全域依賴
- **檔案組織**：遵循既定的命名與資料夾結構慣例

此設計確保資料流動清晰、型別安全、易於維護和團隊協作。
