import { copyFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const webFiles = [
  'index.html',
  'styles.css',
  'editorial.css',
  'player-stage.css',
  'app.js',
  'player-ui.js',
  'api-config.js',
];
const libraryFiles = ['scoring.js', 'thumbnails.js'];

await rm('www', { recursive: true, force: true });
await mkdir(join('www', 'lib'), { recursive: true });
for (const file of webFiles) await copyFile(file, join('www', file));
for (const file of libraryFiles) await copyFile(join('lib', file), join('www', 'lib', file));

console.log(`Prepared ${webFiles.length + libraryFiles.length} web assets in www/.`);
