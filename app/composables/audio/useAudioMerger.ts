import type { AudioChunk } from '~/service/schema/audioStream'
import { AudioChunkStatus } from '~/service/schema/audioStream'

/**
 * 音訊合併 Composable
 * 用於將多個音訊 chunks 合併成單一音檔
 */
export function useAudioMerger() {
  /**
   * 將 Base64 字串轉換為 Blob
   */
  function base64ToBlob(base64: string, mimeType: string): Blob {
    const byteCharacters = atob(base64)
    const byteNumbers = Array.from({ length: byteCharacters.length }, (_, i) =>
      byteCharacters.charCodeAt(i))

    const byteArray = new Uint8Array(byteNumbers)
    return new Blob([byteArray], { type: mimeType })
  }

  /**
   * 獲取音訊格式的 MIME 類型
   */
  function getAudioMimeType(format: string): string {
    switch (format) {
      case 'mp3':
        return 'audio/mp3'
      case 'wav':
        return 'audio/wav'
      case 'webm':
        return 'audio/webm'
      default:
        return 'audio/webm' // 預設
    }
  }

  /**
   * 合併音訊 chunks 成單一 Blob
   */
  async function mergeAudioChunks(chunks: AudioChunk[]): Promise<{
    blob: Blob
    format: string
    totalDuration: number
    chunkCount: number
    mergedAt: number
  }> {
    if (chunks.length === 0) {
      throw new Error('沒有音訊 chunks 可以合併')
    }

    // 按照 sequenceNumber 排序
    const sortedChunks = [...chunks].sort((a, b) => a.sequenceNumber - b.sequenceNumber)

    // 檢查是否有遺失的 chunks
    const expectedSequences = Array.from({ length: sortedChunks.length }, (_, i) => i + 1)
    const actualSequences = sortedChunks.map(chunk => chunk.sequenceNumber)
    const missingSequences = expectedSequences.filter(seq => !actualSequences.includes(seq))

    if (missingSequences.length > 0) {
      console.warn('⚠️ 發現遺失的音訊片段:', missingSequences)
    }

    // 使用第一個 chunk 的格式作為合併格式
    const format = sortedChunks[0]?.format || 'webm'
    const mimeType = getAudioMimeType(format)

    console.log(`🎵 開始合併 ${sortedChunks.length} 個音訊片段 (格式: ${format})`)

    // 將所有 Base64 資料轉換為 Blob
    const audioBlobs = sortedChunks.map((chunk) => {
      try {
        const blob = base64ToBlob(chunk.audioData, mimeType)
        console.log(`✅ Chunk ${chunk.sequenceNumber} 轉換成功: ${blob.size} bytes`)
        return blob
      }
      catch (error) {
        console.error(`❌ Chunk ${chunk.sequenceNumber} 轉換失敗:`, error)
        throw new Error(`無法轉換 chunk ${chunk.sequenceNumber}: ${error}`)
      }
    })

    // 合併所有 Blobs
    const mergedBlob = new Blob(audioBlobs, { type: mimeType })
    const totalDuration = sortedChunks.reduce((sum, chunk) => sum + chunk.duration, 0)

    console.log(`🎉 音訊合併完成!`)
    console.log(`📊 合併統計:`)
    console.log(`  - 片段數量: ${sortedChunks.length}`)
    console.log(`  - 總大小: ${mergedBlob.size} bytes`)
    console.log(`  - 總長度: ${totalDuration.toFixed(2)} 秒`)
    console.log(`  - 格式: ${format}`)

    if (missingSequences.length > 0) {
      console.log(`  - 遺失片段: ${missingSequences.join(', ')}`)
    }

    return {
      blob: mergedBlob,
      format,
      totalDuration,
      chunkCount: sortedChunks.length,
      mergedAt: Date.now(),
    }
  }

  /**
   * 創建下載連結並觸發下載
   */
  function downloadMergedAudio(
    blob: Blob,
    filename?: string,
    format: string = 'webm',
  ): void {
    console.log(`🔽 準備下載音訊檔案:`, {
      blobSize: blob.size,
      blobType: blob.type,
      filename: filename || `merged-audio-${Date.now()}.${format}`,
      format,
    })

    if (blob.size === 0) {
      console.error('❌ Blob 大小為 0，無法下載')
      throw new Error('合併的音訊檔案大小為 0')
    }

    const url = URL.createObjectURL(blob)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const defaultFilename = `merged-audio-${timestamp}.${format}`

    const link = document.createElement('a')
    link.href = url
    link.download = filename || defaultFilename
    link.style.display = 'none'

    console.log(`🔗 創建下載連結:`, {
      url: `${url.substring(0, 50)}...`,
      downloadName: link.download,
    })

    document.body.appendChild(link)
    console.log(`👆 觸發下載點擊`)
    link.click()
    document.body.removeChild(link)

    // 清理 URL
    setTimeout(() => {
      URL.revokeObjectURL(url)
      console.log(`🧹 已清理 URL`)
    }, 100)

    console.log(`💾 音訊檔案已下載: ${link.download}`)
  }

  /**
   * 過濾有效的音訊 chunks
   */
  function filterValidChunks(chunks: AudioChunk[]): AudioChunk[] {
    return chunks.filter((chunk) => {
      // 檢查是否有音訊資料（放寬狀態限制）
      const hasAudioData = chunk.audioData && chunk.audioData.length > 0

      // 更寬鬆的狀態檢查 - 包括 PENDING 狀態，因為在錄音結束時可能還是 PENDING
      const hasValidStatus = chunk.status === AudioChunkStatus.PENDING
        || chunk.status === AudioChunkStatus.SENT
        || chunk.status === AudioChunkStatus.RECEIVED
        || chunk.status === AudioChunkStatus.PROCESSED

      const isValid = hasAudioData && hasValidStatus

      if (!isValid) {
        console.warn(`⚠️ 跳過無效 chunk: ${chunk.sequenceNumber}`, {
          status: chunk.status,
          hasAudioData,
          audioDataLength: chunk.audioData?.length || 0,
        })
      }
      else {
        console.log(`✅ 有效 chunk: ${chunk.sequenceNumber}`, {
          status: chunk.status,
          audioDataLength: chunk.audioData?.length || 0,
          duration: chunk.duration,
        })
      }

      return isValid
    })
  }

  /**
   * 合併並下載音訊 chunks
   */
  async function mergeAndDownload(
    chunks: AudioChunk[],
    filename?: string,
  ): Promise<void> {
    try {
      // 過濾有效的 chunks
      const validChunks = filterValidChunks(chunks)

      if (validChunks.length === 0) {
        throw new Error('沒有有效的音訊 chunks 可以合併')
      }

      console.log(`🎯 準備合併 ${validChunks.length}/${chunks.length} 個有效音訊片段`)

      // 合併音訊
      const result = await mergeAudioChunks(validChunks)

      // 下載檔案
      downloadMergedAudio(result.blob, filename, result.format)

      console.log(`✅ 音訊合併和下載完成!`)
    }
    catch (error) {
      console.error('❌ 音訊合併失敗:', error)
      throw error
    }
  }

  /**
   * 生成合併統計資訊
   */
  function generateMergeStats(chunks: AudioChunk[]): {
    totalChunks: number
    validChunks: number
    invalidChunks: number
    totalDuration: number
    formats: string[]
    sequenceGaps: number[]
    statusBreakdown: Record<string, number>
  } {
    const validChunks = filterValidChunks(chunks)
    const formats = [...new Set(chunks.map(c => c.format))]

    // 檢查序列號間隙
    const sortedSequences = validChunks
      .map(c => c.sequenceNumber)
      .sort((a, b) => a - b)

    const sequenceGaps: number[] = []
    for (let i = 1; i < sortedSequences.length; i++) {
      const current = sortedSequences[i]
      const previous = sortedSequences[i - 1]
      if (current !== undefined && previous !== undefined) {
        const gap = current - previous
        if (gap > 1) {
          sequenceGaps.push(...Array.from(
            { length: gap - 1 },
            (_, idx) => previous + idx + 1,
          ))
        }
      }
    }

    // 狀態分布統計
    const statusBreakdown: Record<string, number> = {}
    chunks.forEach((chunk) => {
      statusBreakdown[chunk.status] = (statusBreakdown[chunk.status] || 0) + 1
    })

    return {
      totalChunks: chunks.length,
      validChunks: validChunks.length,
      invalidChunks: chunks.length - validChunks.length,
      totalDuration: validChunks.reduce((sum, chunk) => sum + chunk.duration, 0),
      formats,
      sequenceGaps,
      statusBreakdown,
    }
  }

  return {
    mergeAudioChunks,
    downloadMergedAudio,
    mergeAndDownload,
    filterValidChunks,
    generateMergeStats,
    base64ToBlob,
    getAudioMimeType,
  }
}
