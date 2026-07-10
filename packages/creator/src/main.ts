import { createApp } from 'vue'
import 'antdv-next/dist/reset.css'
import './styles/tokens.css'
// Phase 10.5：把 slidev 包的两套模板 tokens.css（--bt-* / --jyd-* / --ld-*）
// 拉进 creator 构建，让 DeckRenderer 在 SPA 内复用 layout 视觉。
// global.css 同时 @import 了 beitou-standard + jingyeda-standard 两套 tokens.css，
// 并定义 .slidev-layout 基底字体。
import '@big-ppt/slidev/global.css'
import App from './components/App.vue'
import router from './router'
import { installErrorHandlers } from './composables/logger'

const app = createApp(App)
installErrorHandlers(app)

// DeckRenderer 的 layouts / 图表组件只在编辑器与视觉基线路由使用。
// 路由进入前再加载注册表，避免登录页和 deck 列表首屏携带 Chart.js 等重依赖。
router.beforeEach(async (to) => {
  if (!to.meta.requiresDeckRenderer) return
  const { registerDeckRendererComponents } = await import('./deck-renderer/register-layouts')
  registerDeckRendererComponents(app)
})

app.use(router)
app.mount('#app')
