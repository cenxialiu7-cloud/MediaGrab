/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        dark: {
          50: '#f0f0f0',
          100: '#d4d4d4',
          200: '#a3a3a3',
          300: '#737373',
          400: '#525252',
          500: '#404040',
          600: '#2a2a2a',
          700: '#1f1f1f',
          800: '#171717',
          900: '#0f0f0f',
        },
        accent: {
          DEFAULT: '#6366f1',
          hover: '#818cf8',
          dark: '#4f46e5',
        }
      }
    }
  },
  plugins: []
};
