import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { hasMycastApi } from './lib/ipc'
import './styles.css'

const root = document.getElementById('root')!

if (!hasMycastApi()) {
  root.innerHTML = `
    <div style="padding:24px;color:#e8e8e8;font-family:system-ui,sans-serif;max-width:520px">
      <h1 style="font-size:18px">myCast 无法连接主进程</h1>
      <p>preload 未注入 <code>window.mycast</code>，界面无法启动。</p>
      <p>请按 Ctrl+Shift+I 打开 DevTools，查看 Console 是否有 preload / 加载失败日志；然后重启：</p>
      <pre style="background:#252528;padding:12px;border-radius:6px">npm run dev</pre>
    </div>
  `
} else {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
