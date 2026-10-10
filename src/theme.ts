import { theme, type ThemeConfig } from 'antd'

/** Giao diện tối, cỡ chữ và khoảng cách gọn cho toàn bộ component antd. */
export const appTheme: ThemeConfig = {
  algorithm: [theme.darkAlgorithm, theme.compactAlgorithm],
  token: {
    colorPrimary: '#3b82f6',
    colorBgBase: '#0f1115',
    fontSize: 13,
    borderRadius: 6,
    fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
  },
}
