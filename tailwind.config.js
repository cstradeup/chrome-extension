const colors = require("tailwindcss/colors");


/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/popup.html",          // scan popup.html for class names
    "./src/**/*.{html,ts}"   // other HTML + TS files
  ],
  theme: {
    colors,
    fontFamily: {
      sans: ["Graphik", "sans-serif"],
      serif: ["Merriweather", "serif"],
    },
    extend: {},
  },
  plugins: [require("daisyui")]
};