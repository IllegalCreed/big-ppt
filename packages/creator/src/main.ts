import { createApp } from 'vue'
import Antd from 'antdv-next'
import XProvider from '@antdv-next/x'
import 'antdv-next/dist/reset.css'
import './styles/tokens.css'
// Phase 10.5 spike：把 slidev 包的两套模板 tokens.css（--bt-* / --jyd-* / --ld-*）
// 拉进 creator 构建，让 spike 的 DeckRenderer 能在 SPA 内复用 layout 视觉。
// global.css 同时 @import 了 beitou-standard + jingyeda-standard 两套 tokens.css，
// 并定义 .slidev-layout 基底字体。导入后体积 ~5KB，spike 验证完按需保留。
import '@big-ppt/slidev/global.css'
import App from './components/App.vue'
import router from './router'
import { installErrorHandlers } from './composables/logger'
import { registerSlidevComponents } from './spike/register-slidev-components'

const app = createApp(App)
installErrorHandlers(app)
app.use(Antd)
app.use(XProvider)
app.use(router)
// Phase 10.5 spike：把 slidev 包公共组件注册成全局，让 layout 内
// <LBeitouCoverLogo /> / <TwoCol /> 等 unimported global 能解析。
registerSlidevComponents(app)
app.mount('#app')
