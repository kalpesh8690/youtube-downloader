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

async function workerFetch(pathname, options={}) {
  if(!WORKER_TOKEN) throw new Error("YTDLP_WORKER_TOKEN is not configured");
  const headers={...(options.headers||{}),Authorization:"Bearer "+WORKER_TOKEN};
  return fetch(WORKER_URL+pathname,{...options,headers});
}
async function startJob(body){
  const upstream=await workerFetch("/v1/jobs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const data=await upstream.json().catch(()=>null);
  if(!upstream.ok || !data?.id) throw new Error(data?.error||"Worker could not create download job");
  return {id:data.id};
}
async function readMeta(id){try{return JSON.parse(await fs.readFile(path.join(STORE,id,"meta.json"),"utf8"));}catch{return null;}}
function enrichMeta(meta){
  if(!meta)return null;
  const now=Date.now();
  const elapsed=Math.max(1,(now-(meta.startedAt||meta.createdAt||now))/1000);
  const bytes=Number(meta.bytes)||0;
  const speedBps=meta.status==="downloading" ? Math.round(bytes/elapsed) : Number(meta.speedBps)||0;
  const total=Number(meta.total)||0;
  const progress=total ? Math.min(100,Math.round(bytes/total*100)) : (meta.status==="ready"?100:0);
  const etaSeconds=speedBps>0&&total>bytes ? Math.ceil((total-bytes)/speedBps) : 0;
  const extension=meta.extension || (meta.filename?.includes(".") ? meta.filename.slice(meta.filename.lastIndexOf(".")+1).toLowerCase() : "");
  return {...meta,bytes,total,progress,speedBps,etaSeconds,extension,sizeBytes:meta.status==="ready"?bytes:total||bytes};
}
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
const statusMatch=u.pathname.match(/^\/api\/ytdlp\/jobs\/([a-f0-9]+)(?:\/(pause|resume|cancel))?$/);
if(statusMatch && req.method==="POST" && statusMatch[2]){
  const action=statusMatch[2];
  const upstream=await workerFetch("/v1/jobs/"+statusMatch[1]+"/"+action,{method:"POST"});
  const data=await upstream.json().catch(()=>null);
  if(!upstream.ok) return json(res,upstream.status,{ok:false,error:data?.error||("Worker "+action+" request failed"),code:"WORKER_ACTION_ERROR"});
  return json(res,upstream.status,{ok:true,...(data||{})});
}
if(statusMatch&&req.method==="DELETE"){
  const upstream=await workerFetch("/v1/jobs/"+statusMatch[1]+"/cancel",{method:"POST"});
  const data=await upstream.json().catch(()=>null);
  if(!upstream.ok) return json(res,upstream.status,{ok:false,error:data?.error||"Worker cancel request failed",code:"WORKER_ACTION_ERROR"});
  return json(res,upstream.status,{ok:true,...(data||{})});
}
if(statusMatch&&req.method==="GET"){
  const upstream=await workerFetch("/v1/jobs/"+statusMatch[1]);
  const data=await upstream.json().catch(()=>null);
  if(!upstream.ok) return json(res,upstream.status,{ok:false,error:data?.error||"Could not read worker status",code:"WORKER_STATUS_ERROR"});
  return json(res,upstream.status,{ok:true,...(data||{})});
}
const fileMatch=u.pathname.match(/^\/api\/ytdlp\/jobs\/([a-f0-9]+)\/file$/);if(fileMatch&&(req.method==="GET"||req.method==="HEAD")){
  const jobId=fileMatch[1];
  try {
    const upstream=await workerFetch("/v1/jobs/"+jobId+"/file",{method:req.method,headers:req.headers.range?{Range:req.headers.range}:{}});
    const headers={};
    for(const name of ["content-type","content-disposition","accept-ranges","content-length","content-range","cache-control","x-downly-extension","x-downly-size"]){
      const value=upstream.headers.get(name); if(value) headers[name]=value;
    }
    res.writeHead(upstream.status,headers);
    if(req.method==="HEAD" || !upstream.body) return res.end();
    for await(const chunk of upstream.body) res.write(Buffer.from(chunk));
    return res.end();
  } catch(e) {
    console.error("[file-proxy] job="+jobId+" error="+(e?.stack||e));
    return json(res,502,{ok:false,error:"Worker file service unavailable",code:"WORKER_FILE_PROXY_ERROR",jobId});
  }
}
if(u.pathname==="/api/ytdlp/download"&&(req.method==="GET"||req.method==="POST")){
  let body;
  if(req.method==="GET") body={url:u.searchParams.get("url"),format:u.searchParams.get("format")||"best",audio_only:u.searchParams.get("audio_only")==="true"};
  else {let raw="";for await(const chunk of req)raw+=chunk;try{body=JSON.parse(raw)}catch{return json(res,400,{ok:false,error:"Invalid JSON body"})}}
  if(!body?.url)return json(res,400,{ok:false,error:"url is required"});
  const job=await startJob(body);
  return json(res,202,{ok:true,...job});
}
if(u.pathname==="/api/youtube/info"&&(req.method==="GET"||req.method==="POST")){if(req.method==="GET"){const r=await youtubeInfo(u.searchParams.get("url"));return json(res,r.status,r.body);}let raw="";for await(const c of req)raw+=c;let body;try{body=JSON.parse(raw)}catch{return json(res,400,{ok:false,error:"Invalid JSON body"})}const r=await youtubeInfo(body?.url);return json(res,r.status,r.body);}
return staticFile(req,res);}catch(e){console.error("[api-error]",req.method,req.url,e?.stack||e);json(res,502,{ok:false,error:e?.message||"Termux server error",code:"TERMUX_API_ERROR"});}});
async function workerDownloadLegacy(res,body){if(!WORKER_TOKEN)return json(res,503,{ok:false,error:"YTDLP_WORKER_TOKEN is not configured"});const upstream=await fetch(WORKER_URL+"/v1/media/download",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+WORKER_TOKEN},body:JSON.stringify(body)});const headers={"Content-Type":upstream.headers.get("content-type")||"application/octet-stream","Cache-Control":"no-store"};for(const h of ["content-disposition","content-length"])if(upstream.headers.get(h))headers[h[0].toUpperCase()+h.slice(1)]=upstream.headers.get(h);res.writeHead(upstream.status,headers);if(!upstream.body)return res.end();for await(const chunk of upstream.body)res.write(Buffer.from(chunk));res.end();}
server.listen(PORT,HOST,()=>console.log("[startup] Downly Termux frontend http://127.0.0.1:"+PORT+" | worker="+WORKER_URL+" | token="+(WORKER_TOKEN?"configured":"MISSING")+" | resumable=true"));