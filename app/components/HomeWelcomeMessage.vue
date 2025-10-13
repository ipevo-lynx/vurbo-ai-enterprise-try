<script setup lang="ts">
interface Props {
  userName?: string
  onDismiss?: () => void
}

const props = defineProps<Props>()

// Emit
const emit = defineEmits<{
  dismiss: []
}>()

function handleDismiss() {
  emit('dismiss')
  if (props.onDismiss) {
    props.onDismiss()
  }
}
</script>

<template>
  <div class="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 text-green-800 px-6 py-4 rounded-xl mb-8 flex justify-between items-center shadow-sm">
    <div class="flex items-center space-x-3">
      <div class="flex-shrink-0">
        <div class="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
          <svg
            class="w-5 h-5 text-green-600"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fill-rule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clip-rule="evenodd"
            />
          </svg>
        </div>
      </div>
      <div>
        <p class="font-semibold text-green-900">
          登入成功！
        </p>
        <p class="text-sm text-green-700">
          歡迎回來，{{ props.userName }}！
        </p>
      </div>
    </div>
    <button
      class="text-green-600 hover:text-green-800 hover:bg-green-100 rounded-lg p-2 transition-colors"
      @click="handleDismiss"
    >
      <svg
        class="w-5 h-5"
        fill="currentColor"
        viewBox="0 0 20 20"
      >
        <path
          fill-rule="evenodd"
          d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
          clip-rule="evenodd"
        />
      </svg>
    </button>
  </div>
</template>
