const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function createPNG(w, h, filepath) {
    function chunk(type, data) {
        const typeB = Buffer.from(type, 'ascii');
        const lenB = Buffer.alloc(4);
        lenB.writeUInt32BE(data.length);
        const combined = Buffer.concat([typeB, data]);
        const crcB = Buffer.alloc(4);
        crcB.writeUInt32BE(zlib.crc32(combined) >>> 0);
        return Buffer.concat([lenB, combined, crcB]);
    }

    // PNG signature
    const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    // IHDR
    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(w, 0);
    ihdrData.writeUInt32BE(h, 4);
    ihdrData[8] = 8;  // bit depth
    ihdrData[9] = 2;  // color type: RGB
    ihdrData[10] = 0; // compression
    ihdrData[11] = 0; // filter
    ihdrData[12] = 0; // interlace
    const ihdrChunk = chunk('IHDR', ihdrData);

    // Raw pixel data: filter byte 0 + RGB triple per pixel
    const rowLen = 1 + w * 3;
    const raw = Buffer.alloc(rowLen * h);
    for (let y = 0; y < h; y++) {
        const offset = y * rowLen;
        raw[offset] = 0; // filter: none
        for (let x = 0; x < w; x++) {
            const px = offset + 1 + x * 3;
            raw[px] = 0xe9;
            raw[px + 1] = 0x45;
            raw[px + 2] = 0x60;
        }
    }
    const idatChunk = chunk('IDAT', zlib.deflateSync(raw));
    const iendChunk = chunk('IEND', Buffer.alloc(0));

    const png = Buffer.concat([header, ihdrChunk, idatChunk, iendChunk]);
    fs.writeFileSync(filepath, png);
}

const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

createPNG(16, 16, path.join(iconsDir, 'icon16.png'));
createPNG(48, 48, path.join(iconsDir, 'icon48.png'));
createPNG(128, 128, path.join(iconsDir, 'icon128.png'));
console.log('Icons created successfully');
