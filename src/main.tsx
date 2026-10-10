// Phải đứng đầu: gắn `window.cutcam` cho máy trạm trước khi bất kỳ module nào dùng tới nó.
import './platform'

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './styles/global.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
