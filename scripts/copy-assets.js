const fs = require('fs');
const path = require('path');

function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const srcRoot = path.resolve(__dirname, '..', 'nodes');
const destRoot = path.resolve(__dirname, '..', 'dist', 'nodes');

function copySvgs(srcDir) {
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    if (entry.isDirectory()) {
      copySvgs(srcPath);
    } else if (/\.svg$/i.test(entry.name)) {
      const relative = path.relative(srcRoot, srcPath);
      const destPath = path.join(destRoot, relative);
      ensureDirSync(path.dirname(destPath));
      fs.copyFileSync(srcPath, destPath);
      console.log(`Copied ${relative}`);
    }
  }
}

try {
  copySvgs(srcRoot);
  console.log('Asset copy complete.');
} catch (err) {
  console.error('Failed to copy assets:', err);
  process.exit(1);
}
