import type { AudioChunk } from '~/service/schema/audioStream'

/**
 * 進階音訊合併 Composable
 * 使用 Web Audio API 進行正確的音訊合併
 */
export function useAdvancedAudioMerger() {
  /**
   * 將 Base64 字串轉換為 ArrayBuffer
   */
  function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = atob(base64)
    const bytes = new Uint8Array(binaryString.length)

    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }

    return bytes.buffer
  }

  /**
   * 使用 Web Audio API 解碼音訊資料
   */
  async function decodeAudioData(audioBuffer: ArrayBuffer): Promise<AudioBuffer> {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()

    try {
      const decoded = await audioContext.decodeAudioData(audioBuffer.slice(0))
      return decoded
    }
    finally {
      audioContext.close()
    }
  }

  /**
   * 合併多個 AudioBuffer 成一個
   */
  function mergeAudioBuffers(buffers: AudioBuffer[]): AudioBuffer {
    if (buffers.length === 0) {
      throw new Error('沒有音訊 buffers 可以合併')
    }

    // 創建新的 AudioContext 來建立合併的 buffer
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()

    // 計算總長度和取得音訊參數
    const totalLength = buffers.reduce((sum, buffer) => sum + buffer.length, 0)
    const firstBuffer = buffers[0]
    if (!firstBuffer) {
      throw new Error('沒有可用的 audio buffer')
    }
    const sampleRate = firstBuffer.sampleRate
    const numberOfChannels = firstBuffer.numberOfChannels

    // 建立合併的 AudioBuffer
    const mergedBuffer = audioContext.createBuffer(numberOfChannels, totalLength, sampleRate)

    // 合併每個聲道的資料
    for (let channel = 0; channel < numberOfChannels; channel++) {
      const channelData = mergedBuffer.getChannelData(channel)
      let offset = 0

      for (const buffer of buffers) {
        const sourceChannelData = buffer.getChannelData(channel)
        channelData.set(sourceChannelData, offset)
        offset += buffer.length
      }
    }

    audioContext.close()
    return mergedBuffer
  }

  /**
   * 將 AudioBuffer 編碼為 WAV 格式
   */
  function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
    const numberOfChannels = buffer.numberOfChannels
    const sampleRate = buffer.sampleRate
    const format = 1 // PCM
    const bitDepth = 16

    const bytesPerSample = bitDepth / 8
    const blockAlign = numberOfChannels * bytesPerSample
    const byteRate = sampleRate * blockAlign
    const dataSize = buffer.length * blockAlign
    const bufferSize = 44 + dataSize

    const arrayBuffer = new ArrayBuffer(bufferSize)
    const view = new DataView(arrayBuffer)

    // WAV header
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i))
      }
    }

    writeString(0, 'RIFF')
    view.setUint32(4, bufferSize - 8, true)
    writeString(8, 'WAVE')
    writeString(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, format, true)
    view.setUint16(22, numberOfChannels, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, byteRate, true)
    view.setUint16(32, blockAlign, true)
    view.setUint16(34, bitDepth, true)
    writeString(36, 'data')
    view.setUint32(40, dataSize, true)

    // 音訊資料
    let offset = 44
    for (let i = 0; i < buffer.length; i++) {
      for (let channel = 0; channel < numberOfChannels; channel++) {
        const channelData = buffer.getChannelData(channel)
        const sampleValue = channelData[i]
        const sample = Math.max(-1, Math.min(1, sampleValue || 0))
        const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF
        view.setInt16(offset, intSample, true)
        offset += 2
      }
    }

    return arrayBuffer
  }

  /**
   * 使用 Web Audio API 合併音訊 chunks
   */
  async function mergeAudioChunksAdvanced(chunks: AudioChunk[]): Promise<{
    blob: Blob
    format: string
    totalDuration: number
    chunkCount: number
    mergedAt: number
    sampleRate: number
    channels: number
  }> {
    if (chunks.length === 0) {
      throw new Error('沒有音訊 chunks 可以合併')
    }

    console.log(`🎵 開始進階合併 ${chunks.length} 個音訊片段`)

    // 按照 sequenceNumber 排序
    const sortedChunks = [...chunks].sort((a, b) => a.sequenceNumber - b.sequenceNumber)

    console.log('📋 處理順序:', sortedChunks.map(c => c.sequenceNumber))

    // 解碼所有音訊 chunks
    const decodedBuffers: AudioBuffer[] = []
    let totalDuration = 0

    for (let i = 0; i < sortedChunks.length; i++) {
      const chunk = sortedChunks[i]
      if (!chunk)
        continue

      console.log(`🔄 解碼 chunk ${chunk.sequenceNumber} (${i + 1}/${sortedChunks.length})`)

      try {
        const arrayBuffer = base64ToArrayBuffer(chunk.audioData)
        console.log(`  📊 ArrayBuffer 大小: ${arrayBuffer.byteLength} bytes`)

        const audioBuffer = await decodeAudioData(arrayBuffer)
        console.log(`  ✅ 解碼成功: ${audioBuffer.duration.toFixed(3)}s, ${audioBuffer.sampleRate}Hz, ${audioBuffer.numberOfChannels}ch`)

        decodedBuffers.push(audioBuffer)
        totalDuration += audioBuffer.duration
      }
      catch (error) {
        console.error(`❌ 解碼 chunk ${chunk.sequenceNumber} 失敗:`, error)
        // 繼續處理其他 chunks
      }
    }

    if (decodedBuffers.length === 0) {
      throw new Error('沒有成功解碼的音訊 chunks')
    }

    console.log(`✅ 成功解碼 ${decodedBuffers.length}/${sortedChunks.length} 個音訊片段`)
    console.log(`📊 計算的總長度: ${totalDuration.toFixed(3)} 秒`)

    // 合併 AudioBuffers
    console.log('🔗 合併音訊 buffers...')
    const mergedBuffer = mergeAudioBuffers(decodedBuffers)

    console.log(`✅ 合併完成: ${mergedBuffer.duration.toFixed(3)}s, ${mergedBuffer.sampleRate}Hz, ${mergedBuffer.numberOfChannels}ch`)

    // 轉換為 WAV 格式
    console.log('🎵 編碼為 WAV 格式...')
    const wavArrayBuffer = audioBufferToWav(mergedBuffer)
    const blob = new Blob([wavArrayBuffer], { type: 'audio/wav' })

    console.log(`🎉 進階合併完成!`)
    console.log(`📊 最終統計:`)
    console.log(`  - 原始片段: ${chunks.length}`)
    console.log(`  - 成功解碼: ${decodedBuffers.length}`)
    console.log(`  - 最終大小: ${blob.size} bytes`)
    console.log(`  - 最終長度: ${mergedBuffer.duration.toFixed(3)} 秒`)
    console.log(`  - 採樣率: ${mergedBuffer.sampleRate} Hz`)
    console.log(`  - 聲道數: ${mergedBuffer.numberOfChannels}`)

    return {
      blob,
      format: 'wav',
      totalDuration: mergedBuffer.duration,
      chunkCount: decodedBuffers.length,
      mergedAt: Date.now(),
      sampleRate: mergedBuffer.sampleRate,
      channels: mergedBuffer.numberOfChannels,
    }
  }

  /**
   * 創建下載連結並觸發下載
   */
  function downloadAdvancedAudio(
    blob: Blob,
    filename?: string,
  ): void {
    console.log(`🔽 準備下載進階合併音訊:`, {
      blobSize: blob.size,
      blobType: blob.type,
      filename: filename || `advanced-merged-audio-${Date.now()}.wav`,
    })

    const url = URL.createObjectURL(blob)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const defaultFilename = `advanced-merged-${timestamp}.wav`

    const link = document.createElement('a')
    link.href = url
    link.download = filename || defaultFilename
    link.style.display = 'none'

    document.body.appendChild(link)
    console.log(`👆 觸發下載`)
    link.click()
    document.body.removeChild(link)

    // 清理 URL
    setTimeout(() => {
      URL.revokeObjectURL(url)
      console.log(`🧹 已清理 URL`)
    }, 100)

    console.log(`💾 進階音訊檔案已下載: ${link.download}`)
  }

  /**
   * 進階合併並下載音訊 chunks
   */
  async function mergeAndDownloadAdvanced(
    chunks: AudioChunk[],
    filename?: string,
  ): Promise<void> {
    try {
      // 過濾有效的 chunks
      const validChunks = chunks.filter(chunk =>
        chunk.audioData && chunk.audioData.length > 0,
      )

      if (validChunks.length === 0) {
        throw new Error('沒有有效的音訊 chunks 可以合併')
      }

      console.log(`🎯 準備進階合併 ${validChunks.length}/${chunks.length} 個音訊片段`)

      // 合併音訊
      const result = await mergeAudioChunksAdvanced(validChunks)

      // 下載檔案
      downloadAdvancedAudio(result.blob, filename)

      console.log(`✅ 進階音訊合併和下載完成!`)
    }
    catch (error) {
      console.error('❌ 進階音訊合併失敗:', error)
      throw error
    }
  }

  return {
    mergeAudioChunksAdvanced,
    mergeAndDownloadAdvanced,
    downloadAdvancedAudio,
    base64ToArrayBuffer,
    decodeAudioData,
    mergeAudioBuffers,
    audioBufferToWav,
  }
}
