// The babel `inline-import` plugin (see babel.config.js) turns an `import x from
// './file.html'` into the file's text content as a string at build time. This
// ambient declaration gives that import a type. Used for the pdfmake WebView harness.
declare module '*.html' {
  const content: string
  export default content
}
