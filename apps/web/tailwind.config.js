/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
        },
        lime: {
          400: '#C6FF3D',
          500: '#b8f030',
        },
        indigo: {
          500: '#6C5CE7',
          600: '#5848d5',
        },
        violet: {
          500: '#8B5CF6',
        },
        dark: {
          900: '#0D0D0F',
          800: '#151518',
          700: '#1C1D22',
          600: '#232429',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      borderRadius: {
        '2xl': '16px',
        '3xl': '20px',
      },
      boxShadow: {
        'glow-lime': '0 0 20px rgba(198, 255, 61, 0.25)',
        'glow-purple': '0 0 20px rgba(108, 92, 231, 0.25)',
      },
    },
  },
  plugins: [],
}
