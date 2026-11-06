import http from "node:http";
import { URL } from "node:url";
import { promises as fs, createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const HOST=process.env.HOST||"0.0.0.0";
const PORT=Number(process.env.PORT||3000);
const WORKER_URL=(process.env.YTDLP_WORKER_URL||"http://127.0.0.1:8080").replace(/\/$/,"");
const WORKER_TOKEN=process.env.YTDLP_WORKER_TOKEN||"";
const DIST=new URL("../dist/",import.meta.url);
const STORE=path.resolve(process.env.DOWNLOAD_STORE||path.join(process.env.HOME||".",".downly-downloads"));
const mime={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".svg":"image/svg+xml",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",".ico":"image/x-icon"};

await fs.mkdir(STORE,{recursive:true});

function json(res,status,body){const data=JSON.stringify(body);res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(data);}
function youtubeId(input){try{const u=new URL(String(input||""));const h=u.hostname.toLowerCase();if(!["youtube.com","www.youtube.com","m.youtube.com","youtu.be","www.youtu.be"].includes(h))return null;if(h.includes("youtu.be"))return u.pathname.split("/").filter(Boolean)[0]||null;if(u.pathname==="/watch")return u.searchParams.get("v");return u.pathname.match(/^\/(shorts|embed|live)\/([^/?#]+)/)?.[2]||null;}catch{return null;}}
async function youtubeInfo(url){const id=youtubeId(url);if(!id)return{status:400,body:{ok:false,error:"Valid YouTube URL required",code:"INVALID_URL"}};const canonical="https://www.youtube.com/watch?v="+encodeURIComponent(id);const r=await fetch("https://www.youtube.com/oembed?url="+encodeURIComponent(canonical)+"&format=json");if(r.status===404)return{status:404,body:{ok:false,error:"Video information unavailable",code:"VIDEO_NOT_FOUND",id}};if(!r.ok)return{status:502,body:{ok:false,error:"YouTube metadata service returned an error",code:"UPSTREAM_ERROR",id}};const d=await r.json();return{status:200,body:{ok:true,id,title:d.title,author:d.author_name,thumbnail:"https://i.ytimg.com/vi/"+id+"/hqdefault.jpg",watchUrl:canonical,formats:[{format:"MP4",quality:"Best available",available:true},{format:"MP3",quality:"Audio",available:true}],note:"Downloads are handled by your local Termux yt-dlp worker."}};}

async function startJob(body){
  if(!WORKER_TOKEN) throw new Error("YTDLP_WORKER_TOKEN is not configured");
  const id=crypto.randomBytes(18).toString("hex");
  const dir=path.join(STORE,id);
  await fs.mkdir(dir,{recursive:true});
  const metaPath=path.join(dir,"meta.json");
  await fs.writeFile(metaPath,JSON.stringify({id,status:"preparing",url:body.url,format:body.format||"best",audio_only:Boolean(body.audio_only),createdAt:Date.now(),bytes:0,total:0,filename:"download"}));
  (async()=>{
    try{
      const upstream=await fetch(WORKER_URL+"/v1/media/download",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+WORKER_TOKEN},body:JSON.stringify(body)});
      if(!upstream.ok) throw new Error((await upstream.text().catch(()=>"" )).slice(0,500)||"Worker returned HTTP "+upstream.status);
      const filename=(upstream.headers.get("content-disposition")?.match(/filename="?([^";]+)"?/i)?.[1]||"downly-download").replace(/[\\/]/g,"_");
      const file=path.join(dir,filename);
      const total=Number(upstream.headers.get("content-length"))||0;
      const out=createWriteStream(file);
      let bytes=0;
      if(!upstream.body) throw new Error("Worker returned no body");
      for await(const chunk of upstream.body){const b=Buffer.from(chunk);bytes+=b.length;if(!out.write(b))await new Promise(r=>out.once("drain",r));await fs.writeFile(metaPath,JSON.stringify({id,status:"downloading",url:body.url,format:body.format||"best",audio_only:Boolean(body.audio_only),createdAt:Date.now(),bytes,total,filename}));}
      await new Promise((resolve,reject)=>{out.end(()=>resolve());out.on("error",reject);});
      await fs.writeFile(metaPath,JSON.stringify({id,status:"ready",url:body.url,format:body.format||"best",audio_only:Boolean(body.audio_only),createdAt:Date.now(),bytes,total:bytes,filename}));
    }catch(e){await fs.writeFile(metaPath,JSON.stringify({id,status:"error",error:e?.message||"Download failed",createdAt:Date.now()})).catch(()=>{});}
  })();
  return {id};
}
async function readMeta(id){try{return JSON.parse(await fs.readFile(path.join(STORE,id,"meta.json"),"utf8"));}catch{return null;}}
async function serveJobFile(req,res,id){
  const meta=await readMeta(id);
  if(!meta)return json(res,404,{ok:false,error:"Download job not found"});
  if(meta.status!=="ready")return json(res,409,{ok:false,error:"Download is not ready",status:meta.status,bytes:meta.bytes||0,total:meta.total||0});
  const file=path.join(STORE,id,meta.filename);
  const st=await fs.stat(file);
  const total=st.size;
  const range=req.headers.range;
  const common={"Content-Type":"application/octet-stream","Content-Disposition":'attachment; filename="'+meta.filename.replace(/"/g,"")+'"',"Accept-Ranges":"bytes","Cache-Control":"no-store","Content-Length":String(total)};
  if(!range){res.writeHead(200,common);return createReadStream(file).pipe(res);}
  const m=/bytes=(\d*)-(\d*)/.exec(range);
  if(!m)return json(res,416,{ok:false,error:"Invalid Range"});
  let start=m[1]?Number(m[1]):Math.max(0,total-Number(m[2]||"0"));
  let end=m[2]?Number(m[2]):total-1;
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||start>=total){res.writeHead(416,{"Content-Range":"bytes */"+total});return res.end();}
  end=Math.min(end,total-1);
  res.writeHead(206,{...common,"Content-Length":String(end-start+1),"Content-Range":`bytes ${start}-${end}/${total}`});
  return createReadStream(file,{start,end}).pipe(res);
}
async function staticFile(req,res){const pathname=new URL(req.url,"http://localhost").pathname;if(pathname==="/health")return json(res,200,{ok:true,service:"downly-termux",port:PORT,worker:WORKER_URL,resumable:true});if(pathname.startsWith("/api/"))return json(res,404,{ok:false,error:"API route not found on Termux server"});const clean=pathname.replace(/^\/+/, "");const file=clean&&!clean.includes("..")?new URL(clean,DIST):new URL("index.html",DIST);try{const st=await fs.stat(file);if(!st.isFile())throw 0;const ext=file.pathname.match(/\.[^.]+$/)?.[0].toLowerCase()||"";res.writeHead(200,{"Content-Type":mime[ext]||"application/octet-stream","Cache-Control":ext===".html"?"no-cache":"public, max-age=31536000, immutable"});createReadStream(file).pipe(res);}catch{try{const index=await fs.readFile(new URL("index.html",DIST));res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-cache"});res.end(index);}catch{json(res,500,{ok:false,error:"Run npm run build first"});}}}
const server=http.createServer(async(req,res)=>{try{const u=new URL(req.url,"http://localhost");if(req.method==="OPTIONS")return res.writeHead(204).end();
if(u.pathname==="/api/ytdlp/jobs"&&req.method==="POST"){let raw="";for await(const c of req)raw+=c;if(raw.length>32768)return json(res,413,{ok:false,error:"Request too large"});let body;try{body=JSON.parse(raw)}catch{return json(res,400,{ok:false,error:"Invalid JSON body"})}if(!body?.url)return json(res,400,{ok:false,error:"url is required"});const job=await startJob({url:body.url,format:body.format||"best",audio_only:Boolean(body.audio_only)});return json(res,202,{ok:true,...job});}
const statusMatch=u.pathname.match(/^\/api\/ytdlp\/jobs\/([a-f0-9]+)$/);if(statusMatch&&req.method==="GET"){const meta=await readMeta(statusMatch[1]);return meta?json(res,200,{ok:true,...meta}):json(res,404,{ok:false,error:"Download job not found"});}
const fileMatch=u.pathname.match(/^\/api\/ytdlp\/jobs\/([a-f0-9]+)\/file$/);if(fileMatch&&req.method==="GET")return serveJobFile(req,res,fileMatch[1]);
if(u.pathname==="/api/ytdlp/download"&&(req.method==="GET"||req.method==="POST")){let body;if(req.method==="GET")body={url:u.searchParams.get("url"),format:u.searchParams.get("format")||"best",audio_only:u.searchParams.get("audio_only")==="true"};else{let raw="";for await(const c of req)raw+=c;try{body=JSON.parse(raw)}catch{return json(res,400,{ok:false,error:"Invalid JSON body"})}}if(!body?.url)return json(res,400,{ok:false,error:"url is required"});return workerDownloadLegacy(res,body);}
if(u.pathname==="/api/youtube/info"&&(req.method==="GET"||req.method==="POST")){if(req.method==="GET"){const r=await youtubeInfo(u.searchParams.get("url"));return json(res,r.status,r.body);}let raw="";for await(const c of req)raw+=c;let body;try{body=JSON.parse(raw)}catch{return json(res,400,{ok:false,error:"Invalid JSON body"})}const r=await youtubeInfo(body?.url);return json(res,r.status,r.body);}
return staticFile(req,res);}catch(e){json(res,502,{ok:false,error:e?.message||"Termux server error"});}});
async function workerDownloadLegacy(res,body){if(!WORKER_TOKEN)return json(res,503,{ok:false,error:"YTDLP_WORKER_TOKEN is not configured"});const upstream=await fetch(WORKER_URL+"/v1/media/download",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+WORKER_TOKEN},body:JSON.stringify(body)});const headers={"Content-Type":upstream.headers.get("content-type")||"application/octet-stream","Cache-Control":"no-store"};for(const h of ["content-disposition","content-length"])if(upstream.headers.get(h))headers[h[0].toUpperCase()+h.slice(1)]=upstream.headers.get(h);res.writeHead(upstream.status,headers);if(!upstream.body)return res.end();for await(const chunk of upstream.body)res.write(Buffer.from(chunk));res.end();}
server.listen(PORT,HOST,()=>console.log("Downly Termux frontend: http://127.0.0.1:"+PORT+" | worker: "+WORKER_URL+" | resumable downloads enabled"));