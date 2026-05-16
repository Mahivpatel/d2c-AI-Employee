/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#f0f4ff',
          100: '#dce7ff',
          200: '#baccff',
          300: '#88a4fc',
          400: '#5578f8',
          500: '#3a57f2',
          600: '#2b3de8',
          700: '#222fd4',
          800: '#2029ab',
          900: '#1f2887',
          950: '#161b55',
        },
        surface: {
          DEFAULT: '#0f1117',
          card:    '#181c2a',
          border:  '#252a3d',
          input:   '#1e2235',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'fade-in':    'fadeIn 0.2s ease-out',
        'slide-up':   'slideUp 0.25s ease-out',
        'pulse-dot':  'pulseDot 1.4s ease-in-out infinite',
      },
      keyframes: {
        fadeIn:   { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp:  { from: { opacity: '0', transform: 'translateY(12px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        pulseDot: {
          '0%, 80%, 100%': { transform: 'scale(0)' },
          '40%':           { transform: 'scale(1)' },
        },
      },
    },
  },
  plugins: [],
};
