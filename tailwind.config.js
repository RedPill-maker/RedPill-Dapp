/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        rp: {
          red: '#FF0000',
          dark: '#0F0F0F',
          light: '#FFFFFF',
          gray: {
            100: '#F9F9F9',
            200: '#E5E5E5',
            300: '#CCCCCC',
            400: '#909090',
            500: '#606060',
            600: '#404040',
            700: '#272727',
            800: '#181818',
            900: '#0F0F0F'
          }
        }
      }
    },
  },
  plugins: [],
}