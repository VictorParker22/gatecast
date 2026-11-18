import {defineConfig} from 'vite';
import motionCanvas from '@motion-canvas/vite-plugin';
import ffmpeg from '@motion-canvas/ffmpeg';

// The fonts are the site's own, read from /vendor/fonts two folders up.
export default defineConfig({
  plugins: [motionCanvas(), ffmpeg()],
  server: {fs: {allow: ['../..']}},
});
