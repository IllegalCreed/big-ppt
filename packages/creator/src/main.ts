import { createApp } from 'vue'
import Antd from 'antdv-next'
import XProvider from '@antdv-next/x'
import 'antdv-next/dist/reset.css'
import './styles/tokens.css'
import App from './components/App.vue'
import router from './router'
import { installErrorHandlers } from './composables/logger'

const app = createApp(App)
installErrorHandlers(app)
app.use(Antd)
app.use(XProvider)
app.use(router)
app.mount('#app')
