import { createApp } from 'vue'
import Antd from 'antdv-next'
import XProvider from '@antdv-next/x'
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
app.use(Antd)
app.use(XProvider)
app.use(router)
// Phase 10.5：layouts + 公共组件由 unplugin-vue-components 跨包扫描自动注册
// （见 vite.config.ts 的 Components plugin dirs），无需手工 app.component()
app.mount('#app')
