import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync } from 'fs';

// Plugin to copy manifest.json and icons to dist/
function copyManifestPlugin(): Plugin {
  return {
    name: 'copy-manifest',
    writeBundle() {
      const dist = resolve(__dirname, 'dist');
      if (!existsSync(dist)) mkdirSync(dist, { recursive: true });

      // Copy manifest
      copyFileSync(resolve(__dirname, 'manifest.json'), resolve(dist, 'manifest.json'));

      // Copy icons
      const iconsDir = resolve(dist, 'icons');
      if (!existsSync(iconsDir)) mkdirSync(iconsDir, { recursive: true });
      const srcIcons = resolve(__dirname, 'icons');
      if (existsSync(srcIcons)) {
        const icons = ['icon16.png', 'icon48.png', 'icon128.png'];
        for (const icon of icons) {
          const srcIcon = resolve(srcIcons, icon);
          if (existsSync(srcIcon)) {
            copyFileSync(srcIcon, resolve(iconsDir, icon));
          }
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [copyManifestPlugin()],
  build: {
    target: 'chrome110',
    outDir: 'dist',
    emptyOutDir: true,
    modulePreload: false,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/popup.html'),
        panel: resolve(__dirname, 'src/panel/panel.html'),
        content: resolve(__dirname, 'src/content/content.ts'),
        background: resolve(__dirname, 'src/background/background.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash][extname]',
        format: 'es',
      },
    },
  },
});
