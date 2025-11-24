const colors = require("tailwindcss/colors");


/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,ts}"   // scan popup.html, other HTML + TS files
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