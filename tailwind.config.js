/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', '"Noto Sans TC"', '"PingFang TC"', '"Microsoft JhengHei"', 'sans-serif']
      },
      colors: {
        ink: '#F4F1FA',
        paper: '#12101A',
        card: '#1C192B',
        brand: '#8B5CF6'
      },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.35), 0 8px 24px rgba(0,0,0,0.35)'
      }
    }
  },
  plugins: []
}
