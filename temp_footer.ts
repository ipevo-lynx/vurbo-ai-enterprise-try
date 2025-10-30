        supported: false,
        constraints: {
          audio: false,
          video: false,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        errors: [],
      },
      mediaRecorder: {
        supported: false,
        supportedMimeTypes: [],
        errors: [],
      },
      webAudio: {
        supported: false,
        audioContext: false,
        analyser: false,
      },
      platform: {
        os: 'Unknown',
        browser: 'Unknown',
        version: 'Unknown',
        mobile: false,
      },
    }

    // 檢測平台資訊
    capabilities.platform = detectPlatformInfo()

    // 檢測 getUserMedia 支援度
    capabilities.getUserMedia = await testGetUserMediaCapabilities()

    // 檢測 MediaRecorder 支援度
    capabilities.mediaRecorder = await testMediaRecorderCapabilities()

    // 檢測 Web Audio API 支援度
    capabilities.webAudio = testWebAudioCapabilities()

    pageState.data.platformCapabilities = capabilities
    pageState.loading.isTestingCapabilities = false

    console.log('平台能力檢測完成:', capabilities)
    return capabilities
  }

  return {
    pageState,

    // 對話框控制
    openDialog,
    closeDialog,

    // 設備管理
    getAvailableDevices,
    selectMicrophoneDevice,

    // 系統音訊功能
    captureScreenAudio,
    detectVirtualAudioDevices,
    setSystemAudioSource,

    // UI 控制
    changeTab,

    // 設定管理
    selectSttEngine,
    toggleTranscriptionLanguage,
    addTranscriptionLanguage,
    toggleTranslation,
    setTranslationMode,
    setSummaryTemplate,

    // 錄音控制
    startRecording,
    stopRecording,
    pauseRecording,
    downloadRecording,

    // 計算屬性
    selectedLanguagesCount,
    selectedLanguages,

    // 工具函數
    validateSettings,
    clearErrors,

    // 新增的錯誤處理和檢測功能
    validateVolumeDetection,
    revalidateDeviceSources,
    monitorDeviceConnection,
    handleDeviceReconnected,

    // 平台支援檢測功能
    checkGetUserMediaSupport,
    checkMediaRecorderSupport,
    testPlatformCapabilities,
  }
}
