/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', '"Noto Sans TC"', '"PingFang TC"', '"Microsoft JhengHei"', 'sans-serif']
      },
      colors: {
        ink: '#1A1A1A',
        paper: '#F7F4EE',
        brand: '#1F6FEB'
      },
      boxShadow: {
        card: '0 1px 3px rgba(26,26,26,0.06), 0 8px 24px rgba(26,26,26,0.06)'
      }
    }
  },
  plugins: []
}
