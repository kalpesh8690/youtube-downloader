import http from "node:http";
import { URL } from "node:url";
import { promises as fs, createReadStream } from "node:fs";

const HOST=process.env.HOST||"127.0.0.1";
const PORT=Number(process.env.PORT||3000);
const WORKER_URL=(process.env.YTDLP_WORKER_URL||"http://127.0.0.1:8080").replace(/\/$/,"");
const WORKER_TOKEN=process.env.YTDLP_WORKER_TOKEN||"";
const DIST=new URL("../dist/",import.meta.url);
const mime={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".svg":"image/svg+xml",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",".ico":"image/x-icon"};
const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; media-src 'self' blob: https:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
};
const rateBuckets = new Map();
function rateAllowed(req, scope, limit=30, windowMs=60000) {
  const ip = String(req.headers["cf-connecting-ip"] || req.socket.remoteAddress || "unknown").slice(0, 80);
  const key = scope + ":" + ip;
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.start >= windowMs) {
    rateBuckets.set(key, {start: now, count: 1});
    if (rateBuckets.size > 5000) {
      for (const [k,v] of rateBuckets) if (now-v.start > windowMs*2) rateBuckets.delete(k);
    }
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}
async function readJsonBody(req, maxBytes=32768) {
  let raw="";
  for await(const chunk of req) {
    raw += chunk;
    if (raw.length > maxBytes) throw Object.assign(new Error("Request body is too large"), {statusCode:413});
  }
  try { return JSON.parse(raw || "{}"); }
  catch { throw Object.assign(new Error("Invalid JSON body"), {statusCode:400}); }
}


function json(res,status,body){if(res.headersSent){res.destroy();return;}const data=JSON.stringify(body);res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...securityHeaders});res.end(data);}
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
  return data;
}
async function inspectMedia(url){
  const upstream=await workerFetch("/v1/inspect",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url})});
  const data=await upstream.json().catch(()=>null);
  if(!upstream.ok || !data?.ok) throw new Error(data?.error||"Worker could not inspect this media URL");
  return data;
}

async function staticFile(req,res){const pathname=new URL(req.url,"http://localhost").pathname;if(pathname==="/health")return json(res,200,{ok:true,service:"downly-termux",port:PORT});if(pathname.startsWith("/api/"))return json(res,404,{ok:false,error:"API route not found on Termux server"});const clean=pathname.replace(/^\/+/, "");const file=clean&&!clean.includes("..")?new URL(clean,DIST):new URL("index.html",DIST);try{const st=await fs.stat(file);if(!st.isFile())throw 0;const ext=file.pathname.match(/\.[^.]+$/)?.[0].toLowerCase()||"";res.writeHead(200,{"Content-Type":mime[ext]||"application/octet-stream","Cache-Control":ext===".html"?"no-cache":"public, max-age=31536000, immutable",...securityHeaders});createReadStream(file).pipe(res);}catch{try{const index=await fs.readFile(new URL("index.html",DIST));res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-cache",...securityHeaders});res.end(index);}catch{json(res,500,{ok:false,error:"Run npm run build first"});}}}
const server=http.createServer(async(req,res)=>{try{const u=new URL(req.url,"http://localhost");if(req.method==="OPTIONS")return res.writeHead(204).end();
if(u.pathname==="/api/detect"&&(req.method==="GET"||req.method==="POST")){
  let pageUrl=u.searchParams.get("url");
  if(req.method==="POST"){
    let body;try{body=await readJsonBody(req,8192);}catch(e){return json(res,e.statusCode||400,{ok:false,error:e.message});}
    pageUrl=body?.url;
  }
  if(!pageUrl)return json(res,400,{ok:false,error:"url is required"});
  if(!rateAllowed(req,"detect",15))return json(res,429,{ok:false,error:"Too many page scans. Please wait and retry.",code:"RATE_LIMITED"});
  try{
    const upstream=await workerFetch("/v1/crawl?"+new URLSearchParams({url:pageUrl}).toString(),{method:"GET"});
    const data=await upstream.json().catch(()=>null);
    if(!upstream.ok||!data?.ok)return json(res,upstream.status,{ok:false,error:data?.error||"Page scan failed"});
    const items=Array.isArray(data.items)?data.items:[];
    const media=items.map(item=>({
      url:item.url,
      type:item.kind==="hls"||item.kind==="dash"?"stream":String(item.mime||"").startsWith("audio/")?"audio":"video",
      ext:item.extension,
      mime:item.mime,
      title:data.title
    }));
    return json(res,200,{
      ok:true,
      title:data.title,
      pageUrl:data.pageUrl||pageUrl,
      media,
      count:media.length,
      directCount:media.filter(item=>item.type!=="stream").length,
      streamCount:media.filter(item=>item.type==="stream").length,
      pagesScanned:Number(data.pagesScanned)||1,
      partial:Boolean(data.partial)
    });
  }catch(e){
    console.error("[media-detect] error="+(e?.stack||e));
    return json(res,502,{ok:false,error:"Page media scan unavailable",code:"MEDIA_DETECT_ERROR"});
  }
}
if(u.pathname==="/api/health"&&req.method==="GET"){
  try{
    const worker=await fetch(WORKER_URL+"/health",{signal:AbortSignal.timeout(3000)});
    const data=await worker.json().catch(()=>null);
    if(!worker.ok||!data?.ok)return json(res,503,{ok:false,service:"downly-termux",worker:"unavailable"});
    return json(res,200,{ok:true,service:"downly-termux",worker:"online",workerVersion:data.version,maxStreams:data.maxStreams||null});
  }catch{
    return json(res,503,{ok:false,service:"downly-termux",worker:"offline"});
  }
}
if(u.pathname==="/api/media/crawl"&&req.method==="GET"){
  const pageUrl=u.searchParams.get("url");
  if(!pageUrl)return json(res,400,{ok:false,error:"url is required"});
  if(!rateAllowed(req,"crawl",15))return json(res,429,{ok:false,error:"Too many page scans. Please wait and retry.",code:"RATE_LIMITED"});
  try{
    const upstream=await workerFetch("/v1/crawl?"+new URLSearchParams({url:pageUrl}).toString(),{method:"GET"});
    const data=await upstream.json().catch(()=>null);
    return json(res,upstream.status,data||{ok:false,error:"Crawler returned an invalid response"});
  }catch(e){
    console.error("[media-crawl] error="+(e?.stack||e));
    return json(res,502,{ok:false,error:"Media crawler unavailable",code:"MEDIA_CRAWL_ERROR"});
  }
}
if(u.pathname==="/api/media/info"&&req.method==="POST"){
  if(!rateAllowed(req,"inspect",20))return json(res,429,{ok:false,error:"Too many inspections. Please wait and retry.",code:"RATE_LIMITED"});
  let body;try{body=await readJsonBody(req,8192);}catch(e){return json(res,e.statusCode||400,{ok:false,error:e.message});}
  if(!body?.url)return json(res,400,{ok:false,error:"url is required"});
  try{
    const data=await inspectMedia(String(body.url).trim());
    return json(res,200,data);
  }catch(e){
    console.error("[media-info] error="+(e?.stack||e));
    return json(res,422,{ok:false,error:e?.message||"Unable to inspect media URL",code:"MEDIA_INSPECT_ERROR"});
  }
}
if(u.pathname==="/api/ytdlp/stream"&&(req.method==="GET"||req.method==="POST")){
  let values;
  if(req.method==="GET"){
    values=Object.fromEntries(u.searchParams.entries());
  }else{
    let raw="";
    for await(const chunk of req){
      raw+=chunk;
      if(raw.length>32768)return json(res,413,{ok:false,error:"Download request is too large"});
    }
    const form=new URLSearchParams(raw);
    values=Object.fromEntries(form.entries());
  }
  const mediaUrl=String(values.url||"").trim();
  if(!mediaUrl)return json(res,400,{ok:false,error:"url is required"});
  if(!rateAllowed(req,"stream",8))return json(res,429,{ok:false,error:"Download start limit reached. Please wait and retry.",code:"RATE_LIMITED"});
  const controller=new AbortController();
  req.on("aborted",()=>controller.abort());
  res.on("close",()=>{if(!res.writableEnded)controller.abort();});
  try{
    const workerValues={
      url:mediaUrl,
      direct_url:String(values.direct_url||""),
      referer:String(values.referer||mediaUrl),
      format:String(values.format||"best"),
      audio_only:values.audio_only==="true"?"true":"false",
      filename:String(values.filename||"")
    };
    const upstream=await workerFetch("/v1/stream?"+new URLSearchParams(workerValues).toString(),{method:"GET",signal:controller.signal});
    const headers={...securityHeaders};
    for(const name of ["content-type","content-disposition","cache-control","accept-ranges","content-length","content-range"]){
      const value=upstream.headers.get(name);if(value)headers[name]=value;
    }
    res.writeHead(upstream.status,headers);
    if(!upstream.body)return res.end();
    for await(const chunk of upstream.body){
      if(!res.write(Buffer.from(chunk))){
        await new Promise((resolve,reject)=>{
          const onDrain=()=>{cleanup();resolve();};
          const onClose=()=>{cleanup();reject(new Error("Download client disconnected"));};
          const cleanup=()=>{res.off("drain",onDrain);res.off("close",onClose);};
          res.once("drain",onDrain);
          res.once("close",onClose);
        });
      }
    }
    return res.end();
  }catch(e){
    if(controller.signal.aborted)return;
    console.error("[stream-proxy] "+(e?.message||"stream failed"));
    if(!res.headersSent)return json(res,502,{ok:false,error:"Direct download stream unavailable",code:"STREAM_PROXY_ERROR"});
    res.destroy();
  }
}
if(u.pathname==="/api/ytdlp/jobs"&&req.method==="POST"){if(!rateAllowed(req,"jobs",8))return json(res,429,{ok:false,error:"Too many download jobs. Please wait and retry.",code:"RATE_LIMITED"});let body;try{body=await readJsonBody(req,8192);}catch(e){return json(res,e.statusCode||400,{ok:false,error:e.message});}if(!body?.url)return json(res,400,{ok:false,error:"url is required"});const job=await startJob({url:body.url,format:body.format||"best",audio_only:Boolean(body.audio_only)});return json(res,202,{ok:true,...job});}
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
if(u.pathname==="/api/youtube/info"&&(req.method==="GET"||req.method==="POST")){
  if(req.method==="GET"){
    const value=u.searchParams.get("url");
    try{return json(res,200,await inspectMedia(value));}
    catch(e){return json(res,422,{ok:false,error:e?.message||"Unable to inspect YouTube URL",code:"MEDIA_INSPECT_ERROR"});}
  }
  let raw="";for await(const c of req)raw+=c;
  let body;try{body=JSON.parse(raw)}catch{return json(res,400,{ok:false,error:"Invalid JSON body"})}
  try{return json(res,200,await inspectMedia(body?.url));}
  catch(e){return json(res,422,{ok:false,error:e?.message||"Unable to inspect YouTube URL",code:"MEDIA_INSPECT_ERROR"});}
}
return staticFile(req,res);}catch(e){console.error("[api-error]",req.method,new URL(req.url,"http://localhost").pathname,e?.stack||e);json(res,502,{ok:false,error:e?.message||"Termux server error",code:"TERMUX_API_ERROR"});}});
async function workerDownloadLegacy(res,body){if(!WORKER_TOKEN)return json(res,503,{ok:false,error:"YTDLP_WORKER_TOKEN is not configured"});const upstream=await fetch(WORKER_URL+"/v1/media/download",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+WORKER_TOKEN},body:JSON.stringify(body)});const headers={"Content-Type":upstream.headers.get("content-type")||"application/octet-stream","Cache-Control":"no-store"};for(const h of ["content-disposition","content-length"])if(upstream.headers.get(h))headers[h[0].toUpperCase()+h.slice(1)]=upstream.headers.get(h);res.writeHead(upstream.status,headers);if(!upstream.body)return res.end();for await(const chunk of upstream.body)res.write(Buffer.from(chunk));res.end();}
server.listen(PORT,HOST,()=>console.log("[startup] Downly Termux frontend http://127.0.0.1:"+PORT+" | worker="+WORKER_URL+" | token="+(WORKER_TOKEN?"configured":"MISSING")+" | resumable=true"));