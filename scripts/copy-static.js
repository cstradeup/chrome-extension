// small Node script to copy non-TS files from src -> dist
const fs = require('fs');
const path = require('path');


const SRC = path.join(__dirname, '..', 'src');
const DIST = path.join(__dirname, '..', 'dist');


function copyFile(src, dest) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
}


function walkAndCopy(dir) {
    for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
            walkAndCopy(full);
        } else {
            // copy everything that isn't a .ts file
            if (!full.endsWith('.ts')) {
                const rel = path.relative(SRC, full);
                copyFile(full, path.join(DIST, rel));
            }
        }
    }
}


walkAndCopy(SRC);
console.log('copied static assets to dist/');