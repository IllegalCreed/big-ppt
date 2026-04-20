import { createApp } from 'vue'
import Antd from 'antdv-next'
import XProvider from '@antdv-next/x'
import 'antdv-next/dist/reset.css'
import App from './components/App.vue'

const app = createApp(App)
app.use(Antd)
app.use(XProvider)
app.mount('#app')
