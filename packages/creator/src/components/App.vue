<script setup lang="ts">
import { ConfigProvider, theme, type ThemeConfig } from 'antdv-next'
import { RouterView } from 'vue-router'

const antdTheme: ThemeConfig = {
  algorithm: theme.defaultAlgorithm,
  token: {
    colorPrimary: '#C15F3C',
    colorPrimaryHover: '#A94E2E',
    colorPrimaryActive: '#A94E2E',
    colorSuccess: '#6B8E4E',
    colorWarning: '#C98A2B',
    colorError: '#B4472C',
    colorInfo: '#C15F3C',
    colorTextBase: '#1F1E1B',
    colorBgBase: '#FBF9F2',
    colorBorder: '#E3DCC8',
    borderRadius: 8,
    borderRadiusSM: 4,
    borderRadiusLG: 12,
    fontFamily:
      "'Inter', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif",
    fontSize: 14,
  },
}
</script>

<template>
  <ConfigProvider :theme="antdTheme">
    <RouterView />
  </ConfigProvider>
</template>
