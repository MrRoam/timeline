import {existsSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const settings=JSON.parse(readFileSync(path.join(dir,'fonts.json'),'utf8'));
const manifest=path.join(dir,'.fonts/manifest.json');
const files=existsSync(manifest)?JSON.parse(readFileSync(manifest,'utf8')).map(f=>path.join(dir,'.fonts',f)):settings.files;
for(const file of files)if(!existsSync(file))throw Error(`字体缺失：${file}`);
export const font={loadSystemFonts:files.length===0,fontFiles:files,defaultFontFamily:settings.defaultFontFamily};
