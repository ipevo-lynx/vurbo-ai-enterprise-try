import type { AudioChunk } from '~/service/schema/audioStream'
import { AudioChunkStatus } from '~/service/schema/audioStream'

/**
 * 錄音狀態
 */
export enum RecordingState {
  IDLE = 'idle',
  RECORDING = 'recording',
  PAUSED = 'paused',
  STOPPED = 'stopped',
}

/**
 * 錄音會話資訊
 */
interface RecordingSession {
  sessionId: string
  startTimestamp: number // 錄音開始的絕對時間戳
  totalDuration: number // 總錄音時長（秒）- 不包含暫停時間
  chunkDuration: number // 每個chunk的目標長度（秒）
  lastChunkEndTime: number // 最後一個chunk結束的時間點
  pendingAudioData: Float32Array | null // 未完成的音訊資料
  pendingStartTime: number // 未完成音訊的開始時間
  // 新增暫停相關的時間追蹤
  pausedDuration: number // 累計暫停時長（秒）
  lastResumeTimestamp: number // 最後一次恢復錄音的時間戳
  pauseStartTime?: number // 暫停開始時間（臨時使用）
}

/**
 * 斷線記錄
 */
interface DisconnectionRecord {
  chunkId: string
  timePoint: number // 斷線時的時間點（秒）
  reconnectedAt?: number // 重連時間戳
}

/**
 * 實時音訊錄製與串流管理器
 */
export class RealTimeAudioRecorder {
  private mediaRecorder: MediaRecorder | null = null
  private audioContext: AudioContext | null = null
  private stream: MediaStream | null = null
  private processor: ScriptProcessorNode | null = null
  private analyser: AnalyserNode | null = null

  private state: RecordingState = RecordingState.IDLE
  private session: RecordingSession | null = null
  private disconnectionRecords: DisconnectionRecord[] = []
  private isStopping: boolean = false // 新增：追蹤是否正在停止錄音
  private isPausing: boolean = false // 新增：追蹤是否正在暫停錄音
  private chunkCounter: number = 0 // 新增：追蹤 chunk 序列號

  private chunkTimer: NodeJS.Timeout | null = null
  private audioBuffer: Float32Array[] = []
  private sampleRate: number = 44100

  // 事件回調
  public onChunkReady?: (chunk: AudioChunk) => void
  public onStateChange?: (state: RecordingState) => void
  public onError?: (error: Error) => void
  public onConnectionStateChange?: (isConnected: boolean) => void

  constructor() {
    this.initializeAudioContext()
  }

  /**
   * 初始化音訊上下文
   */
  private async initializeAudioContext(): Promise<void> {
    try {
      // 檢查是否在瀏覽器環境中
      if (typeof window === 'undefined') {
        console.warn('⚠️ Audio context not available in server environment')
        return
      }

      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      this.sampleRate = this.audioContext.sampleRate
      console.log(`🎙️ Audio context initialized: ${this.sampleRate}Hz`)
    }
    catch (error) {
      console.error('❌ Failed to initialize audio context:', error)
      this.onError?.(error as Error)
    }
  }

  /**
   * 開始錄音
   */
  async startRecording(chunkDurationSeconds: number = 3, deviceId?: string): Promise<void> {
    if (this.state === RecordingState.RECORDING) {
      console.warn('⚠️ Already recording')
      return
    }

    try {
      // 重置停止和暫停標記
      this.isStopping = false
      this.isPausing = false

      // 只有在新會話時才重置 chunk 計數器
      const isNewSession = this.state === RecordingState.IDLE
      if (isNewSession) {
        this.chunkCounter = 0
        console.log('🎙️ Starting new recording session, reset chunk counter')
      }
      else {
        console.log(`🎙️ Resuming recording, continuing from chunk ${this.chunkCounter}`)
      }

      // 構建音訊約束
      const audioConstraints: MediaTrackConstraints = {
        sampleRate: this.sampleRate,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      }

      // 如果指定了裝置 ID，加入約束
      if (deviceId) {
        audioConstraints.deviceId = { exact: deviceId }
        console.log(`🎙️ Using audio device: ${deviceId}`)
      }

      // 請求麥克風權限
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
      })

      if (!this.audioContext) {
        throw new Error('Audio context not available')
      }

      // 設置音訊處理
      this.setupAudioProcessing()

      // 初始化或恢復錄音會話
      if (this.state === RecordingState.IDLE) {
        const now = Date.now()
        this.session = {
          sessionId: this.generateSessionId(),
          startTimestamp: now,
          totalDuration: 0,
          chunkDuration: chunkDurationSeconds,
          lastChunkEndTime: 0,
          pendingAudioData: null,
          pendingStartTime: 0,
          pausedDuration: 0,
          lastResumeTimestamp: now,
        }
        console.log(`🎙️ Started new recording session: ${this.session.sessionId}`)
      }
      else if (this.state === RecordingState.PAUSED && this.session) {
        // 恢復錄音時計算暫停時長並累加
        const resumeTime = Date.now()
        if (this.session.pauseStartTime) {
          const pauseDuration = (resumeTime - this.session.pauseStartTime) / 1000
          this.session.pausedDuration += pauseDuration
          console.log(`⏸️ Pause duration: ${pauseDuration.toFixed(2)}s, total paused: ${this.session.pausedDuration.toFixed(2)}s`)
          delete this.session.pauseStartTime // 清除臨時暫停開始時間
        }
        this.session.lastResumeTimestamp = resumeTime
        console.log(`🎙️ Resumed recording session: ${this.session.sessionId}`)
      }

      this.state = RecordingState.RECORDING
      this.onStateChange?.(this.state)

      // 直接啟動 MediaRecorder 錄音
      this.startMediaRecording()
    }
    catch (error) {
      console.error('❌ Failed to start recording:', error)
      this.onError?.(error as Error)
    }
  }

  /**
   * 設置音訊處理管線
   */
  private setupAudioProcessing(): void {
    if (!this.audioContext || !this.stream)
      return

    // 設置 MediaRecorder 進行實際音訊編碼
    const options = {
      mimeType: 'audio/webm;codecs=opus',
    }

    // 檢查支援的音訊格式
    if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
      options.mimeType = 'audio/webm;codecs=opus'
    }
    else if (MediaRecorder.isTypeSupported('audio/mp4')) {
      options.mimeType = 'audio/mp4'
    }
    else if (MediaRecorder.isTypeSupported('audio/wav')) {
      options.mimeType = 'audio/wav'
    }
    else {
      console.warn('⚠️ No supported audio format found, using default')
    }

    console.log(`🎵 Using audio format: ${options.mimeType}`)

    this.mediaRecorder = new MediaRecorder(this.stream, options)

    // 設置 ScriptProcessor 用於音量監測和時間追踪
    const source = this.audioContext.createMediaStreamSource(this.stream)
    this.analyser = this.audioContext.createAnalyser()
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1)

    source.connect(this.analyser)
    this.analyser.connect(this.processor)
    this.processor.connect(this.audioContext.destination)

    // 處理音訊資料（僅用於時間追踪，不做實際錄音）
    this.processor.onaudioprocess = (event) => {
      if (this.state === RecordingState.RECORDING) {
        const inputBuffer = event.inputBuffer.getChannelData(0)
        this.audioBuffer.push(new Float32Array(inputBuffer))
      }
    }
  }

  /**
   * 開始 MediaRecorder 錄音
   */
  private startMediaRecording(): void {
    if (!this.mediaRecorder || !this.session) {
      console.error('❌ Cannot start recording: mediaRecorder or session missing')
      return
    }

    console.log(`🎯 Starting media recording, current state: ${this.mediaRecorder.state}`)

    const recordedChunks: Blob[] = []

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunks.push(event.data)
        console.log(`📊 Audio data received: ${event.data.size} bytes`)
      }
      else {
        console.warn('⚠️ Received empty audio data')
      }
    }

    this.mediaRecorder.onstop = async () => {
      console.log(`🛑 DEBUG: MediaRecorder stopped at ${new Date().toLocaleTimeString()}, recorded ${recordedChunks.length} chunks`)
      console.log(`🛑 DEBUG: isPausing=${this.isPausing}, isStopping=${this.isStopping}`)

      if (recordedChunks.length > 0) {
        const audioBlob = new Blob(recordedChunks, {
          type: this.mediaRecorder?.mimeType || 'audio/webm',
        })

        console.log(`📦 Created audio blob: ${audioBlob.size} bytes, type: ${audioBlob.type}`)

        // 轉換為 Base64
        const base64Data = await this.blobToBase64(audioBlob)

        // 創建音訊 chunk（無論是停止還是暫停都創建）
        const chunk = await this.createRealAudioChunk(audioBlob, base64Data)

        if (this.isPausing) {
          console.log(`📊 DEBUG: Created pause chunk ${chunk.sequenceNumber} (${chunk.duration.toFixed(2)}s) with ID ${chunk.id.substring(0, 8)}... at ${new Date().toLocaleTimeString()}`)
        }
        else if (this.isStopping) {
          console.log(`📊 DEBUG: Created final chunk ${chunk.sequenceNumber} (${chunk.duration.toFixed(2)}s) with ID ${chunk.id.substring(0, 8)}... at ${new Date().toLocaleTimeString()}`)
        }

        this.sendChunk(chunk)

        // 清空緩衝區
        recordedChunks.length = 0
      }
      else {
        console.warn(`⚠️ DEBUG: No audio data recorded for this MediaRecorder session at ${new Date().toLocaleTimeString()}`)
      }

      // 處理暫停後的狀態設置
      if (this.isPausing) {
        this.isPausing = false // 重置標誌
        this.state = RecordingState.PAUSED
        this.onStateChange?.(this.state)
        console.log(`⏸️ Recording state set to PAUSED`)
      }
      else {
        // 如果還在錄音且沒有停止標記，開始下一個 chunk
        if (this.state === RecordingState.RECORDING && !this.isStopping) {
          console.log(`🔄 DEBUG: Continuing recording with next chunk at ${new Date().toLocaleTimeString()}`)
          this.startMediaRecording()
        }
        else {
          console.log(`⏹️ DEBUG: Recording stopped at ${new Date().toLocaleTimeString()}. State: ${this.state}, isStopping: ${this.isStopping}`)
          if (this.isStopping) {
            console.log('✅ Final chunk processed, resetting isStopping flag')
            this.isStopping = false
          }
        }
      }
    }

    // 開始錄音
    this.mediaRecorder.start()
    console.log(`🎙️ MediaRecorder started, setting timer for ${this.session.chunkDuration}s`)

    // 設置定時器強制停止並重新開始（實現切分）
    this.chunkTimer = setTimeout(() => {
      if (this.mediaRecorder && this.mediaRecorder.state === 'recording' && this.session) {
        console.log(`⏰ DEBUG: Timer fired at ${new Date().toLocaleTimeString()}! Stopping chunk after ${this.session.chunkDuration}s`)
        this.mediaRecorder.stop()
      }
      else {
        console.warn(`⚠️ DEBUG: Timer fired at ${new Date().toLocaleTimeString()} but MediaRecorder not in recording state. State: ${this.mediaRecorder?.state}`)
      }
    }, this.session.chunkDuration * 1000)
  }

  /**
   * 將 Blob 轉換為 Base64
   */
  private async blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => {
        const result = reader.result as string
        if (result) {
          // 移除 data URL 前綴
          const base64 = result.split(',')[1]
          resolve(base64 || '')
        }
        else {
          reject(new Error('Failed to read blob'))
        }
      }
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  }

  /**
   * 創建實際音訊 chunk
   */
  private async createRealAudioChunk(audioBlob: Blob, base64Data: string): Promise<AudioChunk> {
    if (!this.session) {
      throw new Error('No active recording session')
    }

    // 增加計數器並使用作為序列號
    this.chunkCounter++
    const sequenceNumber = this.chunkCounter

    const currentTime = this.getCurrentRecordingTime()

    // 計算實際的 chunk 時長
    // 當停止錄音或暫停錄音時，使用實際錄製時長
    const actualDuration = (this.isStopping || this.isPausing)
      ? currentTime % this.session.chunkDuration || this.session.chunkDuration
      : this.session.chunkDuration

    // 獲取音訊格式
    let format: 'mp3' | 'wav' | 'webm' = 'webm'
    if (audioBlob.type.includes('mp4')) {
      format = 'mp3'
    }
    else if (audioBlob.type.includes('wav')) {
      format = 'wav'
    }

    console.log(`📊 Creating chunk #${sequenceNumber}:`)
    console.log(`   - Current time: ${currentTime.toFixed(2)}s`)
    console.log(`   - Actual duration: ${actualDuration.toFixed(2)}s`)
    console.log(`   - isStopping: ${this.isStopping}`)
    console.log(`   - Blob size: ${(audioBlob.size / 1024).toFixed(2)}KB`)
    console.log(`   - Blob type: ${audioBlob.type}`)

    const chunk: AudioChunk = {
      id: this.generateChunkId(),
      sequenceNumber, // 使用簡單的計數器
      audioData: base64Data,
      format,
      duration: actualDuration, // 使用實際時長
      timestamp: this.session.startTimestamp + ((sequenceNumber - 1) * this.session.chunkDuration * 1000),
      isLast: this.isStopping, // 使用 isStopping 狀態來決定是否為最後一個 chunk
      status: AudioChunkStatus.PENDING,
      metadata: {
        sampleRate: this.sampleRate,
        channels: 1,
        bitRate: 64000,
      },
    }

    console.log(`✅ Created real audio chunk: ${chunk.sequenceNumber}, size: ${(audioBlob.size / 1024).toFixed(2)}KB, duration: ${chunk.duration.toFixed(2)}s, isLast: ${chunk.isLast}`)
    return chunk
  }

  /**
   * 暫停錄音
   */
  pauseRecording(): void {
    if (this.state !== RecordingState.RECORDING) {
      console.warn('⚠️ Not currently recording')
      return
    }

    // 記錄暫停開始時間，用於後續計算暫停時長
    if (this.session) {
      const pauseStartTime = Date.now()
      console.log(`⏸️ Pausing recording at ${this.getCurrentRecordingTime().toFixed(2)}s (${pauseStartTime})`)

      // 記錄暫停開始時間到 session 中（臨時存儲）
      this.session.pauseStartTime = pauseStartTime
    }

    // 停止定時器
    if (this.chunkTimer) {
      clearTimeout(this.chunkTimer)
      this.chunkTimer = null
      console.log('⏰ Cleared chunk timer for pause')
    }

    // 使用與停止錄音相同的機制：設置標誌並通過 MediaRecorder.stop() 來切 chunk
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      // 設置暫停標記，讓 chunk 知道這是因為暫停產生的，使用實際時長
      this.isPausing = true
      console.log('⏸️ Setting isPausing flag to force current chunk output')

      // 停止錄音，這會觸發 onstop 事件並創建當前 chunk
      this.mediaRecorder.stop()
    }
    else {
      // 如果 MediaRecorder 已經停止，直接設置狀態
      console.log('⏸️ MediaRecorder already stopped, setting paused state')
      this.state = RecordingState.PAUSED
      this.onStateChange?.(this.state)
    }

    console.log(`✅ Recording paused, current chunk will be output via MediaRecorder.stop()`)
  }

  /**
   * 強制輸出當前 chunk（暫停時使用）
   */
  private forceOutputCurrentChunk(): void {
    if (!this.session) {
      console.warn('⚠️ No active session to force output chunk')
      return
    }

    // 檢查是否有未完成的音訊數據
    const hasBufferedData = this.audioBuffer.length > 0
    const hasPendingData = this.session.pendingAudioData && this.session.pendingAudioData.length > 0

    if (!hasBufferedData && !hasPendingData) {
      console.log('📦 No audio data to force output')
      return
    }

    console.log('🚀 Forcing output of current chunk during pause...')

    // 合併當前緩衝區
    let combinedBuffer: Float32Array

    if (hasBufferedData) {
      const totalSamples = this.audioBuffer.reduce((sum, buffer) => sum + buffer.length, 0)
      combinedBuffer = new Float32Array(totalSamples)

      let offset = 0
      for (const buffer of this.audioBuffer) {
        combinedBuffer.set(buffer, offset)
        offset += buffer.length
      }

      // 清空音訊緩衝區
      this.audioBuffer = []
    }
    else {
      combinedBuffer = new Float32Array(0)
    }

    // 與pending資料合併
    if (this.session.pendingAudioData) {
      const combinedLength = this.session.pendingAudioData.length + combinedBuffer.length
      const mergedBuffer = new Float32Array(combinedLength)
      mergedBuffer.set(this.session.pendingAudioData, 0)
      mergedBuffer.set(combinedBuffer, this.session.pendingAudioData.length)

      combinedBuffer = mergedBuffer
      this.session.pendingAudioData = null // 清空 pending 數據
    }

    if (combinedBuffer.length === 0) {
      console.log('📦 No combined data to output')
      return
    }

    // 計算開始時間和持續時間
    const startTime = this.session.pendingStartTime || this.session.lastChunkEndTime
    const duration = combinedBuffer.length / this.sampleRate

    // 創建並發送 chunk
    const chunk = this.createAudioChunk(combinedBuffer, startTime, duration, false)
    this.sendChunk(chunk)

    // 更新會話狀態
    this.session.lastChunkEndTime = startTime + duration
    this.session.pendingStartTime = 0

    console.log(`✅ Forced output chunk: ${duration.toFixed(2)}s at ${startTime.toFixed(2)}s`)
  }

  /**
   * 處理未完成的chunk（暫停時）
   */
  private processIncompleteChunk(): void {
    if (!this.session || this.audioBuffer.length === 0)
      return

    // 合併當前緩衝區
    const totalSamples = this.audioBuffer.reduce((sum, buffer) => sum + buffer.length, 0)
    const combinedBuffer = new Float32Array(totalSamples)

    let offset = 0
    for (const buffer of this.audioBuffer) {
      combinedBuffer.set(buffer, offset)
      offset += buffer.length
    }

    // 與pending資料合併
    if (this.session.pendingAudioData) {
      const combinedLength = this.session.pendingAudioData.length + combinedBuffer.length
      const mergedBuffer = new Float32Array(combinedLength)
      mergedBuffer.set(this.session.pendingAudioData, 0)
      mergedBuffer.set(combinedBuffer, this.session.pendingAudioData.length)

      this.session.pendingAudioData = mergedBuffer
    }
    else {
      this.session.pendingAudioData = combinedBuffer
      this.session.pendingStartTime = this.session.lastChunkEndTime
    }

    this.audioBuffer = []
    console.log(`📦 Saved incomplete chunk: ${(this.session.pendingAudioData.length / this.sampleRate).toFixed(2)}s`)
  }

  /**
   * 停止錄音
   */
  stopRecording(): void {
    if (this.state === RecordingState.IDLE) {
      console.warn('⚠️ Not recording')
      return
    }

    console.log('🛑 Stopping recording...')

    // 先停止定時器，避免產生新的 chunk
    if (this.chunkTimer) {
      clearTimeout(this.chunkTimer)
      this.chunkTimer = null
      console.log('⏰ Cleared chunk timer')
    }

    // 立即處理最後剩餘的音訊數據
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      // 設置停止標記，讓下一個 chunk 知道這是最後一個
      this.isStopping = true
      console.log('🛑 Setting isStopping flag for final chunk')

      // 停止錄音，這會觸發已設置的 ondataavailable 和 onstop 處理邏輯
      this.mediaRecorder.stop()
    }
    else {
      // 如果 MediaRecorder 已經停止，直接處理清理
      console.log('🛑 MediaRecorder already stopped, cleaning up')
      this.isStopping = false
    }

    this.cleanup()
    this.state = RecordingState.STOPPED
    this.onStateChange?.(this.state)
  }

  /**
   * 創建音訊chunk
   */
  private createAudioChunk(
    audioData: Float32Array,
    startTime: number,
    duration: number,
    isLast: boolean,
  ): AudioChunk {
    if (!this.session) {
      throw new Error('No active recording session')
    }

    // 轉換為Base64（簡化版本）
    const pcmData = new Int16Array(audioData.length)
    for (let i = 0; i < audioData.length; i++) {
      pcmData[i] = Math.max(-32768, Math.min(32767, (audioData[i] || 0) * 32767))
    }
    const uint8Array = new Uint8Array(pcmData.buffer)
    const base64Data = btoa(String.fromCharCode(...uint8Array))

    // 使用 chunkCounter 確保連續的序號
    this.chunkCounter++

    const chunk: AudioChunk = {
      id: this.generateChunkId(),
      sequenceNumber: this.chunkCounter,
      audioData: base64Data,
      format: 'webm',
      duration,
      timestamp: this.session.startTimestamp + (startTime * 1000),
      isLast,
      status: AudioChunkStatus.PENDING,
      metadata: {
        sampleRate: this.sampleRate,
        channels: 1,
        bitRate: 64000, // 假設64kbps
      },
    }

    return chunk
  }

  /**
   * 發送chunk
   */
  private sendChunk(chunk: AudioChunk): void {
    console.log(
      `📤 DEBUG: Sending chunk ${chunk.sequenceNumber}: `
      + `${chunk.duration.toFixed(2)}s ${chunk.isLast ? '(FINAL)' : ''} at ${new Date().toLocaleTimeString()}`,
    )

    // 檢查連線狀態
    const connectionStatus = this.isConnected()
    console.log(`🔍 DEBUG: Connection status for chunk ${chunk.sequenceNumber}: ${connectionStatus}`)

    if (!connectionStatus) {
      console.warn(`⚠️ Disconnected while sending chunk ${chunk.sequenceNumber}`)
      this.recordDisconnection(chunk)
    }
    else {
      console.log(`✅ DEBUG: Connection OK, proceeding with chunk ${chunk.sequenceNumber}`)
    }

    // 更新總錄音時長 - 排除暫停時間
    if (this.session) {
      const currentTime = Date.now()
      const totalElapsed = (currentTime - this.session.startTimestamp) / 1000
      this.session.totalDuration = totalElapsed - this.session.pausedDuration
      console.log(`⏱️ Updated total duration: ${this.session.totalDuration.toFixed(2)}s (elapsed: ${totalElapsed.toFixed(2)}s, paused: ${this.session.pausedDuration.toFixed(2)}s)`)
    }

    console.log(`🎯 DEBUG: About to call onChunkReady for chunk ${chunk.sequenceNumber}`)
    this.onChunkReady?.(chunk)
    console.log(`✅ DEBUG: onChunkReady called for chunk ${chunk.sequenceNumber}`)
  }

  /**
   * 記錄斷線
   */
  private recordDisconnection(chunk: AudioChunk): void {
    const timePoint = (chunk.timestamp - (this.session?.startTimestamp || 0)) / 1000

    this.disconnectionRecords.push({
      chunkId: chunk.id,
      timePoint,
    })

    console.log(`📋 Chunk ${chunk.sequenceNumber} recorded during disconnection (since ${timePoint.toFixed(2)}s)`)
  }

  /**
   * 連線恢復處理
   */
  onConnectionRestored(): void {
    console.log('🔗 Connection restored, checking for pending chunks...')

    // 標記最新的斷線記錄為已重連
    if (this.disconnectionRecords.length > 0) {
      const latestRecord = this.disconnectionRecords[this.disconnectionRecords.length - 1]
      if (latestRecord && !latestRecord.reconnectedAt) {
        latestRecord.reconnectedAt = Date.now()
        console.log(`✅ Marked reconnection at ${latestRecord.timePoint.toFixed(2)}s`)
      }
    }

    this.onConnectionStateChange?.(true)
  }

  /**
   * 連線中斷處理
   */
  onConnectionLost(): void {
    console.log('❌ Connection lost during recording')
    this.onConnectionStateChange?.(false)
  }

  /**
   * 檢查連線狀態（由外部提供）
   */
  private isConnected(): boolean {
    // 這個方法應該由外部設定
    return true // 預設為連線狀態
  }

  /**
   * 獲取當前錄音時間
   */
  private getCurrentRecordingTime(): number {
    if (!this.session)
      return 0
    return (Date.now() - this.session.startTimestamp) / 1000
  }

  /**
   * 生成會話ID
   */
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * 生成chunk ID - 使用 UUID v4 格式
   */
  private generateChunkId(): string {
    // 生成 UUID v4
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0
      const v = c === 'x' ? r : (r & 0x3 | 0x8)
      return v.toString(16)
    })
  }

  /**
   * 清理資源
   */
  private cleanup(): void {
    if (this.chunkTimer) {
      clearTimeout(this.chunkTimer)
      this.chunkTimer = null
    }

    if (this.processor) {
      this.processor.disconnect()
      this.processor = null
    }

    if (this.analyser) {
      this.analyser.disconnect()
      this.analyser = null
    }

    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop())
      this.stream = null
    }

    this.audioBuffer = []
  }

  /**
   * 獲取錄音狀態
   */
  getState(): RecordingState {
    return this.state
  }

  /**
   * 獲取會話資訊
   */
  getSession(): RecordingSession | null {
    return this.session
  }

  /**
   * 獲取斷線記錄
   */
  getDisconnectionRecords(): DisconnectionRecord[] {
    return [...this.disconnectionRecords]
  }

  /**
   * 清除斷線記錄
   */
  clearDisconnectionRecords(): void {
    this.disconnectionRecords = []
  }

  /**
   * 設定連線狀態檢查函數
   */
  setConnectionChecker(checker: () => boolean): void {
    this.isConnected = checker
  }

  /**
   * 銷毀錄音器
   */
  destroy(): void {
    this.stopRecording()
    this.cleanup()

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close()
    }
  }
}
