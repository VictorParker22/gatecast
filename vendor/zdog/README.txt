zdog 1.1.3 (npm), MIT. The package ships CommonJS files only, so zdog.esm.js is its js/index.js (every module, nothing
changed) wrapped as one minified ES module with esbuild 0.28.2, with the package's own notice as the banner:
  echo "export { default } from 'zdog';" > entry.js
  esbuild entry.js --bundle --minify --format=esm --platform=browser --legal-comments=none --banner:js='/*! Zdog v1.1.3 ... */' --outfile=zdog.esm.js
The npm package has no licence file; LICENSE here carries its notice and the MIT text.
