import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.mp4':'video/mp4'};
const server=http.createServer(async(req,res)=>{
  try{
    const url=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=path.resolve(root,'.'+(url==='/'?'/preview.html':url));
    const relative=path.relative(root,file);
    if(relative.startsWith('..')||path.isAbsolute(relative)||relative.split(path.sep).some(x=>['node_modules','.fonts'].includes(x))){res.writeHead(403);res.end();return}
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(await readFile(file));
  }catch{res.writeHead(404);res.end('未找到文件')}
});
server.listen(0,'127.0.0.1',()=>console.log(`预览：http://127.0.0.1:${server.address().port}/`));
