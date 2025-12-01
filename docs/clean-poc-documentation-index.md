# Clean POC 系統文檔索引

基於 `clean-poc.vue` 的音頻錄製與串流傳輸系統完整文檔。

## 📚 文檔結構

### 1. [功能分類說明](./clean-poc-functional-classification.md) ⭐ **推薦**

**主要內容：**

- 按功能模組分類的完整說明
- 每個功能對應的資料格式定義
- 詳細的功能流程圖解
- 7大核心功能模組覆蓋

**適用對象：** 所有開發者、系統分析師、產品經理

### 2. [資料格式與工作流程](./clean-poc-data-format-and-workflow.md)

**主要內容：**

- 系統架構圖與概述
- 核心資料格式定義 (WebSocket配置、AudioChunk、訊息格式等)
- 完整系統流程 (初始化、錄音傳輸、斷線重連、訊息處理)
- UI 狀態管理與視覺化
- 監控與除錯指南

**適用對象：** 系統架構師、後端開發者、系統管理員

### 3. [Composables API 參考](./clean-poc-composables-api.md)

**主要內容：**

- 三大核心 composables 詳細 API
- 介面定義與回傳值
- 使用範例與整合方式
- 狀態管理最佳實務
- 錯誤處理策略
- 效能最佳化建議
- 測試指南

**適用對象：** 前端開發者、Vue.js 開發者、API 使用者

## 🎯 快速導航

### 🔍 按功能了解系統

如果您想按功能模組了解系統，了解每個功能的資料格式和流程：
→ [功能分類說明文檔](./clean-poc-functional-classification.md) ⭐ **推薦首選**

### 🏗️ 系統架構了解

如果您想了解整個系統的架構、資料流向和核心概念：
→ [資料格式與工作流程文檔](./clean-poc-data-format-and-workflow.md#系統架構)

### 📊 資料格式參考

如果您需要了解系統中使用的資料結構：
→ [功能分類說明文檔](./clean-poc-functional-classification.md) (按功能分類)
→ [資料格式與工作流程文檔](./clean-poc-data-format-and-workflow.md#核心資料格式) (統一整理)

### 🔄 流程理解

如果您想了解系統的工作流程：
→ [功能分類說明文檔](./clean-poc-functional-classification.md) (按功能分類)
→ [資料格式與工作流程文檔](./clean-poc-data-format-and-workflow.md#系統流程) (整體流程)

### 🛠️ 開發整合

如果您需要整合或使用這些 composables：
→ [Composables API 參考文檔](./clean-poc-composables-api.md)

### 🎨 UI 實作

如果您要實作使用者介面：
→ [資料格式與工作流程文檔](./clean-poc-data-format-and-workflow.md#使用者介面狀態)

### 🐛 除錯與監控

如果您需要除錯或監控系統：
→ [資料格式與工作流程文檔](./clean-poc-data-format-and-workflow.md#監控與除錯)

## 🚀 快速開始

### 基本使用流程

1. **設置 WebSocket 連線**

   ```typescript
   const wsConfig = {
     url: 'ws://localhost:8080/poc2',
     heartbeatInterval: 5000,
     reconnectAttempts: 20
   }

   const { connect, isConnected, send } = useWebSocketPoc(wsConfig)
   ```

2. **初始化錄音系統**

   ```typescript
   const {
     startRecording,
     stopRecording,
     setConnectionChecker,
     setChunkSender
   } = useRealTimeRecording()
   ```

3. **設置音頻串流**

   ```typescript
   const { sendChunk, handleAckMessage } = useAudioStream()
   ```

4. **系統整合**

   ```typescript
   // 建立連線檢查
   setConnectionChecker(() => isConnected.value)

   // 設置 chunk 發送
   setChunkSender((chunk) => {
     sendChunk(chunk, send, taskId)
   })
   ```

### 核心資料流

```
用戶操作 → 錄音器 → AudioChunk → 音頻串流 → WebSocket → 伺服器
         ↑                                              ↓
    UI 反饋 ← 事件歷史 ← 狀態更新 ← ACK 處理 ← WebSocket ← ACK 回應
```

## 🔍 關鍵概念

### AudioChunk（音頻塊）

系統的核心資料單位，每3秒生成一個，包含：

- 唯一 ID、序列號、Base64 音頻資料
- 格式資訊、時長、時間戳記
- 狀態追蹤（pending → sent → acknowledged）

### 斷線重連機制

- **心跳檢測**：每5秒發送 ping，10秒內無回應則判定斷線
- **自動重連**：支援指數退避、最多20次嘗試
- **資料恢復**：重連後自動發送暫存的 pending chunks

### 事件歷史追蹤

記錄所有音頻處理事件，包含：

- 發送事件（send）、接收確認（receive）
- 連線狀態變化（connection_lost/restored）
- 錯誤事件（error）

## 📋 系統需求

### 技術要求

- **前端**：Vue 3 + Composition API + TypeScript
- **WebSocket**：支援 WebSocket 的伺服器
- **瀏覽器**：支援 MediaRecorder API、WebSocket
- **權限**：麥克風存取權限

### 部署要求

- **Node.js**：16+ 版本
- **WebSocket 伺服器**：監聽 `localhost:8080/poc2`
- **HTTPS**（生產環境）：麥克風權限需要

## 🎛️ 配置參考

### 建議的生產配置

```typescript
const productionConfig = {
  // WebSocket 配置
  url: 'wss://your-domain.com/poc2',
  heartbeatInterval: 30000, // 30秒心跳
  reconnectAttempts: 10, // 10次重連
  minReconnectDelay: 2000, // 2秒最小延遲
  maxReconnectDelay: 30000, // 30秒最大延遲

  // 音頻配置
  chunkDuration: 3000, // 3秒一個 chunk
  audioFormat: 'webm', // WebM 格式
  sampleRate: 44100, // 44.1kHz 採樣率
}
```

### 開發與測試配置

```typescript
const developmentConfig = {
  // WebSocket 配置
  url: 'ws://localhost:8080/poc2',
  heartbeatInterval: 5000, // 5秒心跳（快速檢測）
  reconnectAttempts: 20, // 更多重連次數
  minReconnectDelay: 1000, // 1秒最小延遲
  maxReconnectDelay: 5000, // 5秒最大延遲

  // 除錯選項
  enableDetailedLogging: true,
  showAllEvents: true,
}
```

## 🔧 常見問題

### Q: 如何處理長時間錄音？

A: 系統會自動將長錄音切分為3秒的 chunks，每個 chunk 獨立處理，支援無限時長錄音。

### Q: 網路不穩定時如何保證資料完整性？

A: 系統具備完整的斷線重連機制，所有未確認的 chunks 會在重連後自動重傳。

### Q: 如何監控系統狀態？

A: 可透過統計資料面板、事件歷史和瀏覽器開發者工具的 Console 日誌。

### Q: 支援哪些音頻格式？

A: 目前支援 MP3、WAV、WebM 格式，建議使用 WebM 以獲得最佳相容性。

### Q: 如何自定義 UI？

A: 所有 UI 狀態都透過 computed 屬性提供，可自由定制外觀而不影響核心邏輯。

## 📞 支援與貢獻

### 問題回報

如遇到問題，請提供：

1. 錯誤訊息與 Console 日誌
2. 瀏覽器版本與作業系統
3. WebSocket 伺服器配置
4. 重現步驟

### 功能建議

歡迎提出改進建議，特別是：

- 效能最佳化
- 新的音頻格式支援
- UI/UX 改進
- 更好的錯誤處理

---

## 📖 延伸閱讀

- [Vue 3 Composition API 官方文檔](https://vuejs.org/guide/extras/composition-api-faq.html)
- [WebSocket API MDN 文檔](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- [MediaRecorder API MDN 文檔](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)
- [TypeScript 官方文檔](https://www.typescriptlang.org/docs/)

---

_最後更新：2025年12月1日_