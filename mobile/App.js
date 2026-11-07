import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as Clipboard from "expo-clipboard";

const API_BASE = "https://youtube-downloader.chauhankalpesh760.workers.dev";
const LOCAL_API = "http://127.0.0.1:3000";
const HISTORY = Platform.OS === "web" ? null : new File(Paths.document, "downly-history.json");
const C={bg:"#05070d",card:"#0c111b",border:"#202a3a",text:"#f8fafc",muted:"#94a3b8",purple:"#7c3aed",blue:"#6366f1",green:"#34d399",red:"#fb7185"};

const clean=s=>String(s||"downly-download").replace(/[\\/:*?"<>|]+/g," ").replace(/\s+/g," ").trim().slice(0,120)||"downly-download";
const bytes=n=>{n=Number(n)||0;if(!n)return"0 B";const u=["B","KB","MB","GB"],i=Math.min(3,Math.floor(Math.log(n)/Math.log(1024)));return `${(n/1024**i).toFixed(i?1:0)} ${u[i]}`;};
const host=s=>{try{return new URL(s).hostname}catch{return""}};
const isYT=s=>/youtube\.com|youtu\.be/.test(host(s).toLowerCase());
const ext=s=>{try{const m=new URL(s).pathname.match(/\.([a-z0-9]{2,8})$/i);return m?m[1].toLowerCase():""}catch{return""}};
const safeUrl=s=>{try{const u=new URL(s);return u.origin+u.pathname}catch{return String(s||"").slice(0,500)}};

export default function App(){
 const [url,setUrl]=useState(""),[format,setFormat]=useState("MP4"),[quality,setQuality]=useState("best"),[info,setInfo]=useState(null),[formats,setFormats]=useState([]),[media,setMedia]=useState([]),[selected,setSelected]=useState(""),[history,setHistory]=useState([]);
 const [busy,setBusy]=useState(false),[status,setStatus]=useState("Ready"),[error,setError]=useState(""),[progress,setProgress]=useState(0),[written,setWritten]=useState(0),[total,setTotal]=useState(0),[backend,setBackend]=useState("Cloud worker");
 const task=useRef(null);

 useEffect(()=>{loadHistory()},[]);
 const loadHistory=async()=>{if(!HISTORY)return;try{if(HISTORY.exists){const x=JSON.parse(await HISTORY.text());if(Array.isArray(x))setHistory(x)}}catch{}};
 const saveHistory=async item=>{const next=[item,...history.filter(x=>x.url!==item.url)].slice(0,20);setHistory(next);if(!HISTORY)return;try{if(!HISTORY.exists)HISTORY.create();await HISTORY.write(JSON.stringify(next))}catch{}};

 const api=async(path,options={},base=API_BASE)=>{const r=await fetch(base+path,options);return r};
 const inspect=async()=>{
   const v=url.trim(); setError(""); setInfo(null); setFormats([]); setMedia([]); setSelected(""); setProgress(0);
   if(!/^https?:\/\//i.test(v)){setError("Enter a complete http(s) URL.");return}
   setBusy(true);setStatus("Inspecting page…");
   try{
     let r=await api("/api/media/info",{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({url:v})});
     let d=await r.json().catch(()=>null);
     if(r.ok&&d?.ok&&Array.isArray(d.formats)&&d.formats.length){
       applyFormats(d);setBackend("Cloud worker");return;
     }
     if(r.status===429||r.status>=500){
       try{const lr=await api("/api/media/info",{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({url:v})},LOCAL_API);const ld=await lr.json().catch(()=>null);if(lr.ok&&ld?.ok&&ld.formats?.length){applyFormats(ld);setBackend("Local Termux worker");return}}catch{}
     }
     r=await api("/api/media/crawl",{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({url:v})});
     d=await r.json().catch(()=>null);
     if(!r.ok||!d?.ok)throw new Error(d?.error||"The page could not be scanned.");
     const items=(d.items||[]).filter(x=>x?.url).map(x=>({url:x.url,type:x.kind==="hls"||x.kind==="dash"?"stream":String(x.mime||"").startsWith("audio/")?"audio":"video",ext:x.extension,mime:x.mime}));
     setInfo({title:d.title||host(v),author:host(v),thumbnail:d.thumbnail||null});
     setMedia(items);setSelected(items.find(x=>x.type==="video"||x.type==="audio")?.url||items[0]?.url||"");
     setBackend("Cloud worker");setStatus(`Found ${items.length} media source(s)`);
   }catch(e){setError(e?.message||"Inspection failed.");setStatus("Inspection failed")}finally{setBusy(false)}
 };
 const applyFormats=d=>{const first=(d.formats||[]).find(x=>x.hasVideo)||d.formats?.[0];setInfo(d);setFormats(d.formats||[]);setFormat(first?.hasVideo?"MP4":"MP3");setQuality(first?.id||"best");setStatus(`Ready · ${d.formats.length} formats`);};
 const download=async()=>{
   const v=url.trim();setError("");
   const chosen=media.find(x=>x.url===selected)||media.find(x=>x.type==="video"||x.type==="audio");
   if(!formats.length&&!chosen){setError("Inspect the URL first.");return}
   setBusy(true);setWritten(0);setTotal(0);setProgress(0);setStatus("Preparing download…");
   try{
     let streamUrl,filename;
     if(formats.length){
       const audio=format==="MP3";
       const f=formats.find(x=>x.id===quality&&(audio?x.hasAudio:x.hasVideo))||formats.find(x=>audio?x.hasAudio:x.hasVideo)||formats[0];
       const direct=!audio&&f?.hasAudio&&f?.directUrl?f.directUrl:"";
       const selector=audio?"ba/b":(f?.selector||"bv*+ba/b");
       const title=clean(info?.title||"downly-download");
       filename=`${title}.${audio?"mp3":direct&&/^[a-z0-9]{2,5}$/i.test(f?.ext||"")?f.ext.toLowerCase():"mp4"}`;
       const q=new URLSearchParams({url:v,direct_url:direct,referer:info?.webpageUrl||v,format:selector,audio_only:audio?"true":"false",filename});
       streamUrl=API_BASE+"/api/ytdlp/stream?"+q.toString();
       if(backend==="Local Termux worker")streamUrl=LOCAL_API+"/api/ytdlp/stream?"+q.toString();
     }else{
       const e=(chosen.ext||ext(chosen.url)||"mp4").toLowerCase();
       filename=`${clean(info?.title||"downly-download")}.${e==="m3u8"||e==="mpd"?"mp4":e}`;
       const q=new URLSearchParams({url:v,direct_url:chosen.url,referer:v,format:"b",audio_only:chosen.type==="audio"?"true":"false",filename});
       streamUrl=API_BASE+"/api/ytdlp/stream?"+q.toString();
     }
     const destination=new File(Paths.document,clean(filename));
     if(destination.exists)destination.delete();
     const t=File.createDownloadTask(streamUrl,destination,{onProgress:p=>{const tw=Number(p.totalBytes)||0;setWritten(p.bytesWritten);setTotal(tw);setProgress(tw>0?p.bytesWritten/tw*100:0);setStatus(tw>0?`Downloading · ${Math.round(p.bytesWritten/tw*100)}%`:`Downloading · ${bytes(p.bytesWritten)}`)},headers:{Accept:"*/*"}});
     task.current=t;const file=await t.downloadAsync();if(!file)throw new Error("Download cancelled.");
     const item={id:String(Date.now()),url:safeUrl(v),title:info?.title||filename,filename,size:file.size||written,uri:file.uri,time:new Date().toISOString(),format};
     await saveHistory(item);setProgress(100);setStatus(`Complete · ${bytes(item.size)}`);
     Alert.alert("Downly",`${filename}\\n\\nDownload complete.`,[{text:"Share",onPress:()=>share(file.uri)},{text:"Open",onPress:()=>open(file)},{text:"OK"}]);
   }catch(e){if(!/cancel/i.test(e?.message||""))setError(e?.message||"Download failed.");setStatus("Download stopped")}finally{task.current=null;setBusy(false)}
 };
 const cancel=()=>{try{task.current?.cancel()}catch{}setStatus("Cancelled");setBusy(false)};
 const share=async uri=>{if(await Sharing.isAvailableAsync())await Sharing.shareAsync(uri,{dialogTitle:"Save or share with Downly"});else Alert.alert("Saved",uri)};
 const open=async f=>{try{if(await File.canPreview(f))await File.preview(f,{title:f.name});else await share(f.uri)}catch(e){Alert.alert("Open",e?.message||"No compatible viewer found.")}};
 const clear=()=>{setUrl("");setInfo(null);setFormats([]);setMedia([]);setSelected("");setError("");setStatus("Ready")};
 const clearHistory=async()=>{setHistory([]);if(!HISTORY)return;try{if(HISTORY.exists)HISTORY.delete()}catch{}};

 const options=useMemo(()=>formats.filter(x=>format==="MP3"?x.hasAudio:x.hasVideo).slice(0,80),[formats,format]);

 return <SafeAreaView style={s.safe}><StatusBar barStyle="light-content" backgroundColor={C.bg}/><ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
  <View style={s.header}><View style={s.logo}><Text style={s.logoText}>D</Text></View><View><Text style={s.brand}>Downly</Text><Text style={s.tag}>MEDIA DOWNLOADER</Text></View></View>
  <View style={s.badge}><View style={s.dot}/><Text style={s.badgeText}>{backend}</Text></View>
  <View style={s.card}>
   <Text style={s.h1}>Download anything public</Text><Text style={s.sub}>Paste a webpage URL or a direct media URL. Downly inspects the page, finds formats, then streams the result to your phone.</Text>
   <View style={s.inputRow}><TextInput value={url} onChangeText={setUrl} placeholder="https://youtube.com/watch?... or website URL" placeholderTextColor="#64748b" autoCapitalize="none" autoCorrect={false} keyboardType="url" style={s.input}/><Pressable style={s.paste} onPress={async()=>setUrl((await Clipboard.getStringAsync()).trim())}><Text style={s.pasteText}>Paste</Text></Pressable></View>
   <View style={s.row}><Pressable style={s.primary} onPress={inspect} disabled={busy}><Text style={s.primaryText}>{busy?"Working…":"Inspect URL"}</Text></Pressable><Pressable style={s.secondary} onPress={clear} disabled={busy}><Text style={s.secondaryText}>Clear</Text></Pressable></View>
   {info&&<View style={s.info}><Text style={s.infoTitle} numberOfLines={2}>{info.title||"Media"}</Text><Text style={s.meta}>{info.author||host(url)}{info.durationString?" · "+info.durationString:""}{info.extractor?" · "+info.extractor:""}</Text></View>}
   {!!error&&<Text style={s.error}>{error}</Text>}
  </View>

  {formats.length>0&&<View style={s.card}><Text style={s.h2}>Download settings</Text><View style={s.row}>{["MP4","MP3"].map(x=><Pressable key={x} style={[s.choice,format===x&&s.choiceOn]} onPress={()=>{setFormat(x);const f=formats.find(y=>x==="MP3"?y.hasAudio:y.hasVideo);if(f)setQuality(f.id)}}><Text style={[s.choiceText,format===x&&s.choiceTextOn]}>{x}</Text></Pressable>)}</View><Text style={s.label}>QUALITY / SOURCE</Text><ScrollView horizontal showsHorizontalScrollIndicator={false}>{options.map(x=><Pressable key={x.id} style={[s.q,s.qOn&&quality===x.id]} onPress={()=>setQuality(x.id)}><Text style={s.qText}>{x.label||x.id}{x.filesize?" · "+bytes(x.filesize):""}</Text></Pressable>)}</ScrollView><Pressable style={s.download} onPress={download} disabled={busy}>{busy?<ActivityIndicator color="#fff"/>:<Text style={s.downloadText}>↓ Download {format}</Text>}</Pressable></View>}

  {media.length>0&&<View style={s.card}><Text style={s.h2}>Detected media</Text>{media.slice(0,30).map((x,i)=><Pressable key={x.url+i} style={[s.media,s.selected===x.url&&s.selected]} onPress={()=>setSelected(x.url)}><View style={{flex:1}}><Text style={s.mediaName}>{(x.type||"media").toUpperCase()} · {x.ext||"stream"}</Text><Text style={s.meta} numberOfLines={1}>{host(x.url)}</Text></View><Text style={s.action}>{selected===x.url?"Selected":"Select"}</Text></Pressable>)}<Pressable style={s.download} onPress={download} disabled={busy||!selected}>{busy?<ActivityIndicator color="#fff"/>:<Text style={s.downloadText}>↓ Download selected</Text>}</Pressable></View>}

  {busy&&<View style={s.card}><Text style={s.h2}>{status}</Text><View style={s.track}><View style={[s.fill,{width:`${Math.max(2,progress)}%`}]}/></View><Text style={s.progress}>{bytes(written)}{total?` / ${bytes(total)} · ${Math.round(progress)}%`:""}</Text><Pressable style={s.cancel} onPress={cancel}><Text style={s.cancelText}>Cancel</Text></Pressable></View>}

  <View style={s.card}><View style={s.historyHead}><Text style={s.h2}>Download history</Text>{history.length>0&&<Pressable onPress={clearHistory}><Text style={s.clear}>Clear</Text></Pressable>}</View>{!history.length?<Text style={s.empty}>No downloads yet.</Text>:history.map(x=><View style={s.item} key={x.id}><View style={{flex:1}}><Text style={s.itemName} numberOfLines={1}>{x.title}</Text><Text style={s.meta}>{x.filename} · {bytes(x.size)}</Text></View><Pressable onPress={()=>open(new File(x.uri))}><Text style={s.action}>Open</Text></Pressable></View>)}</View>

  <View style={s.note}><Text style={s.noteTitle}>Web app features on Android</Text><Text style={s.noteText}>Page inspection, format selection, MP4/MP3, media crawling, progress, cancel, history and sharing are now native. The app uses the same Downly worker APIs as the web app. YouTube availability still depends on the worker's upstream access; if cloud YouTube is blocked, the app automatically attempts the local Termux worker.</Text></View>
 </ScrollView></SafeAreaView>
}

const s=StyleSheet.create({safe:{flex:1,backgroundColor:C.bg},page:{padding:18,paddingBottom:40},header:{flexDirection:"row",alignItems:"center",marginTop:8,marginBottom:14},logo:{width:54,height:54,borderRadius:17,backgroundColor:C.blue,alignItems:"center",justifyContent:"center",marginRight:12},logoText:{color:"#fff",fontSize:29,fontWeight:"900"},brand:{color:C.text,fontSize:29,fontWeight:"900"},tag:{color:"#818cf8",fontSize:9,fontWeight:"800",marginTop:2},badge:{alignSelf:"flex-start",flexDirection:"row",alignItems:"center",paddingHorizontal:11,paddingVertical:7,borderRadius:20,borderWidth:1,borderColor:C.border,backgroundColor:C.card,marginBottom:13},dot:{width:7,height:7,borderRadius:7,backgroundColor:C.green,marginRight:7},badgeText:{color:"#cbd5e1",fontSize:11,fontWeight:"700"},card:{backgroundColor:C.card,borderWidth:1,borderColor:C.border,borderRadius:22,padding:16,marginBottom:14},h1:{color:C.text,fontSize:21,fontWeight:"900"},h2:{color:C.text,fontSize:16,fontWeight:"900"},sub:{color:C.muted,fontSize:12,lineHeight:18,marginTop:5,marginBottom:14},inputRow:{flexDirection:"row",alignItems:"center",gap:8},input:{height:56,flex:1,borderRadius:15,borderWidth:1,borderColor:C.border,backgroundColor:"#080d18",paddingHorizontal:14,color:C.text,fontSize:12},paste:{height:44,paddingHorizontal:13,borderRadius:13,backgroundColor:"#111827",justifyContent:"center"},pasteText:{color:"#cbd5e1",fontWeight:"800",fontSize:11},row:{flexDirection:"row",gap:8,marginTop:10},primary:{flex:1,height:50,borderRadius:14,backgroundColor:"#f8fafc",alignItems:"center",justifyContent:"center"},primaryText:{color:"#070b13",fontWeight:"900"},secondary:{height:50,paddingHorizontal:17,borderRadius:14,borderWidth:1,borderColor:C.border,backgroundColor:"#101827",alignItems:"center",justifyContent:"center"},secondaryText:{color:"#cbd5e1",fontWeight:"800"},info:{marginTop:12,padding:12,borderRadius:14,backgroundColor:"#080d18",borderWidth:1,borderColor:C.border},infoTitle:{color:C.text,fontSize:13,fontWeight:"800"},meta:{color:C.muted,fontSize:10,marginTop:4},error:{color:C.red,backgroundColor:"#2a1018",borderRadius:12,padding:10,marginTop:10,fontSize:11,lineHeight:16},choice:{flex:1,height:45,borderRadius:12,borderWidth:1,borderColor:C.border,alignItems:"center",justifyContent:"center",marginTop:12},choiceOn:{backgroundColor:"#312e81",borderColor:"#6366f1"},choiceText:{color:C.muted,fontWeight:"800"},choiceTextOn:{color:"#fff"},label:{color:C.muted,fontSize:9,fontWeight:"800",marginTop:15,marginBottom:7},q:{paddingHorizontal:12,paddingVertical:10,borderRadius:12,borderWidth:1,borderColor:C.border,backgroundColor:"#080d18",marginRight:7},qOn:{backgroundColor:"#312e81",borderColor:"#6366f1"},qText:{color:"#cbd5e1",fontSize:10,fontWeight:"700"},download:{height:52,borderRadius:14,backgroundColor:C.purple,alignItems:"center",justifyContent:"center",marginTop:13},downloadText:{color:"#fff",fontWeight:"900",fontSize:14},media:{flexDirection:"row",alignItems:"center",padding:12,borderRadius:13,borderWidth:1,borderColor:C.border,marginTop:8,backgroundColor:"#080d18"},selected:{borderColor:"#6366f1",backgroundColor:"#111044"},mediaName:{color:C.text,fontSize:11,fontWeight:"800"},action:{color:"#a5b4fc",fontSize:10,fontWeight:"800"},track:{height:9,backgroundColor:"#1e293b",borderRadius:9,overflow:"hidden",marginTop:12},fill:{height:"100%",backgroundColor:C.blue},progress:{color:C.muted,fontSize:10,marginTop:8},cancel:{alignSelf:"flex-end",paddingHorizontal:12,paddingVertical:8,marginTop:7},cancelText:{color:C.red,fontSize:11,fontWeight:"800"},historyHead:{flexDirection:"row",justifyContent:"space-between"},clear:{color:"#a5b4fc",fontSize:11,fontWeight:"800"},empty:{color:C.muted,fontSize:11,marginTop:12},item:{flexDirection:"row",alignItems:"center",gap:9,paddingVertical:11,borderTopWidth:1,borderTopColor:C.border,marginTop:9},itemName:{color:C.text,fontSize:11,fontWeight:"800"},note:{padding:16,borderRadius:19,borderWidth:1,borderColor:C.border,backgroundColor:"#0a0f1b"},noteTitle:{color:C.text,fontSize:13,fontWeight:"900"},noteText:{color:C.muted,fontSize:10,lineHeight:16,marginTop:7}});
