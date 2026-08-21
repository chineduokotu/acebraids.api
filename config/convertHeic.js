import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import convert from 'heic-convert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const imagesDir = path.join(__dirname, '..', '..', 'images');
const uploadsDir = path.join(__dirname, '..', 'uploads');

async function convertHeicImages() {
  const files = fs.readdirSync(imagesDir);
  for (const file of files) {
    if (file.toLowerCase().endsWith('.heic')) {
      const baseName = path.basename(file, path.extname(file));
      const sourcePath = path.join(imagesDir, file);
      const targetPng = path.join(uploadsDir, `${baseName}.PNG`);
      const targetJpeg = path.join(uploadsDir, `${baseName}.JPG`);

      console.log(`Converting ${file}...`);
      try {
        const inputBuffer = fs.readFileSync(sourcePath);
        const outputBuffer = await convert({
          buffer: inputBuffer,
          format: 'JPEG',
          quality: 0.95,
        });

        fs.writeFileSync(targetJpeg, outputBuffer);
        fs.writeFileSync(targetPng, outputBuffer);
        fs.writeFileSync(path.join(imagesDir, `${baseName}.PNG`), outputBuffer);
        fs.writeFileSync(path.join(imagesDir, `${baseName}.JPG`), outputBuffer);
        console.log(`✅ Converted ${file} -> ${baseName}.JPG and ${baseName}.PNG`);
      } catch (err) {
        console.error(`❌ Error converting ${file}:`, err.message);
      }
    }
  }
}

convertHeicImages();
