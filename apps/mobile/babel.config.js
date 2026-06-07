module.exports = function (api) {
  api.cache(true)
  return {
    presets: ['babel-preset-expo'],
    // .sql → drizzle migrations; .html → the pdfmake WebView harness (bundles
    // pdfmake + fonts as one inline HTML string so it ships fully offline).
    plugins: [['inline-import', { extensions: ['.sql', '.html'] }]],
  }
}
