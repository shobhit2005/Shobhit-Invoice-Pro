import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

function resolveBasePath(command: 'serve' | 'build'): string {
  if (command !== 'build') {
    return '/';
  }
  const raw = (process.env.VITE_BASE_PATH || '').trim();
  if (!raw) {
    // Relative base ensures dist/ works on both root domains and GitHub Pages subpaths
    return './';
  }
  if (raw === '.' || raw === './') {
    return './';
  }
  if (raw === '/') {
    return '/';
  }
  const withLeading = raw.startsWith('/') ? raw : `/${raw}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

export default defineConfig(({command}) => {
  const base = resolveBasePath(command);

  return {
    base,
    plugins: [
      react(),
      tailwindcss(),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds, and writes dist/404.html for GitHub Pages SPA routing.
      {
        name: 'copy-unbundled-src-assets-and-spa-404',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(import.meta.dirname, 'dist');
          const srcAssets = path.resolve(import.meta.dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }

          const indexHtml = path.resolve(distDir, 'index.html');
          const fallback404 = path.resolve(distDir, '404.html');
          if (fs.existsSync(indexHtml)) {
            if (base.startsWith('/')) {
              fs.copyFileSync(indexHtml, fallback404);
            } else {
              // Redirect deep paths back to app root so relative ./assets/ resolve cleanly on GitHub Pages subpaths
              const redirectHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Redirecting...</title>
    <script>
      (function () {
        var l = window.location;
        var segs = l.pathname.split('/').filter(Boolean);
        var baseSegs = segs.length > 0 ? '/' + segs[0] + '/' : '/';
        var target = encodeURIComponent(l.pathname + (l.search ? '&q=' + l.search.slice(1) : ''));
        l.replace(l.protocol + '//' + l.host + baseSegs + '?p=' + target + l.hash);
      })();
    </script>
  </head>
  <body></body>
</html>
`;
              fs.writeFileSync(fallback404, redirectHtml, 'utf8');
            }
          }
        },
      },
    ],
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      emptyOutDir: true,
      sourcemap: false,
    },
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
