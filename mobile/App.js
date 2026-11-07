import React, { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

const CLOUD = "https://youtube-downloader.chauhankalpesh760.workers.dev";
const LOCAL = "http://127.0.0.1:3000";

const clean = (s) => String(s || "downly-download").replace(/[\\/:*?"<>|]+/g, " ").replace(/\\s+/g, " ").trim().slice(0, 120) || "downly-download";
const size = (n) => { if (!Number.isFinite(n) || n <= 0) return "0 B"; const u=["B","KB","MB","GB"],i=Math.min(Math.floor(Math.log(n)/Math.log(1024)),3); return (n/Math.pow(1024,i)).toFixed(i?1:0)+" "+u[i]; };
const youtube = (s) => { try { return /(^|\\.)((youtube\\.com)|(youtu\\.be))$/i.test(new URL(s).hostname); } catch { return false; } };

async function request(base, path, options) {
  const response = await fetch(base + path, options);
  const data = await response.json().catch(() => null);
  return { response, data };
}

export default function App() {
  const [url,setUrl]=useState("");
  const [info,setInfo]=useState(null);
  const [formats,setFormats]=useState([]);
  const [mode,setMode]=useState("MP4");
  const [quality,setQuality]=useState("");
  const [backend,setBackend]=useState("cloud");
  const [status,setStatus]=useState("Ready");
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [written,setWritten]=useState(0);
  const [total,setTotal]=useState(0);
  const task=useRef(null);

  const choices=useMemo(()=>formats.filter(x=>mode==="MP3"?x?.hasAudio:x?.hasVideo).slice(0,8),[formats,mode]);

  const inspect=async()=>{
    const value=url.trim();
    setError(""); setInfo(null); setFormats([]); setQuality("");
    if(!/^https?:\\/\\//i.test(value)){setError("Paste a complete http(s) URL.");return;}
    setBusy(true); setStatus("Inspecting media…");
    try{
      let r=await request(CLOUD,"/api/media/info",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:value})});
      if((!r.response.ok||!r.data?.ok)&&youtube(value)){
        try{
          const local=await request(LOCAL,"/api/media/info",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:value})});
          if(local.response.ok&&local.data?.ok&&local.data?.formats?.length){r=local;setBackend("local");}
        }catch{}
      }
      if(!r.response.ok||!r.data?.ok) throw new Error(r.data?.error||`Inspection failed (${r.response.status})`);
      const list=Array.isArray(r.data.formats)?r.data.formats:[];
      if(!list.length) throw new Error("No downloadable formats returned.");
      const first=list.find(x=>x.hasVideo)||list[0];
      setInfo(r.data); setFormats(list); setMode(first?.hasVideo?"MP4":"MP3"); setQuality(first?.id||list[0]?.id||"");
      setStatus(`Ready · ${list.length} formats · ${r===undefined?"":backend} worker`);
    }catch(e){setStatus("Inspection failed");setError(e?.message||"Could not inspect this URL.");}
    finally{setBusy(false);}
  };

  const download=async()=>{
    if(!info||!formats.length){setError("Inspect a URL first.");return;}
    const audio=mode==="MP3";
    const selected=formats.find(x=>x.id===quality&&(audio?x.hasAudio:x.hasVideo))||formats.find(x=>audio?x.hasAudio:x.hasVideo)||formats[0];
    const direct=!audio&&selected?.hasAudio&&selected?.directUrl?selected.directUrl:"";
    const params=new URLSearchParams({url:url.trim(),direct_url:direct,referer:info?.webpageUrl||url.trim(),format:audio?"ba/b":(selected?.selector||"bv*+ba/b"),audio_only:String(audio),filename:clean(info?.title)+"."+(audio?"mp3":"mp4")});
    const base=backend==="local"?LOCAL:CLOUD;
    const filename=clean(info?.title)+"."+(audio?"mp3":"mp4");
    setBusy(true);setError("");setWritten(0);setTotal(0);setStatus("Downloading…");
    try{
      const destination=new File(Paths.document,filename);
      if(destination.exists) destination.delete();
      const t=File.createDownloadTask(base+"/api/ytdlp/stream?"+params.toString(),destination,{onProgress:p=>{setWritten(p.bytesWritten);setTotal(p.totalBytes>0?p.totalBytes:0);}});
      task.current=t;
      const file=await t.downloadAsync();
      if(!file) throw new Error("Download cancelled.");
      setStatus("Download complete");
      Alert.alert("Downly",filename,[{text:"Share / Save",onPress:async()=>{if(await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri,{dialogTitle:"Save or share download"});}},{text:"OK"}]);
    }catch(e){setStatus("Download failed");setError(e?.message||"Download failed.");}
    finally{task.current=null;setBusy(false);}
  };

  return <SafeAreaView style={s.safe}><StatusBar barStyle="light-content" backgroundColor="#060914"/>
    <ScrollView contentContainerStyle={s.page}>
      <View style={s.head}><View style={s.logo}><Text style={s.logoText}>↓</Text></View><View><Text style={s.brand}>Downly</Text><Text style={s.tag}>Your media. Your download control.</Text></View></View>
      <View style={s.badge}><View style={s.dot}/><Text style={s.badgeText}>{backend==="local"?"Local Termux worker":"Cloud worker"}</Text></View>
      <View style={s.card}>
        <Text style={s.h1}>Download console</Text><Text style={s.help}>Paste a public media URL to inspect formats.</Text>
        <TextInput value={url} onChangeText={v=>{setUrl(v);setError("");}} placeholder="https://youtube.com/…" placeholderTextColor="#64748b" autoCapitalize="none" autoCorrect={false} keyboardType="url" style={s.input}/>
        <Pressable style={s.primary} onPress={inspect} disabled={busy}><Text style={s.primaryText}>{busy?"Working…":"Inspect media"}</Text></Pressable>
        <Text style={s.status}>{status}</Text>{error?<Text style={s.error}>{error}</Text>:null}
        {info?<View style={s.result}>
          <Text style={s.title}>{info.title||"Media"}</Text>
          <View style={s.row}><Pressable style={[s.choice,mode==="MP4"&&s.active]} onPress={()=>setMode("MP4")}><Text style={s.choiceText}>MP4</Text></Pressable><Pressable style={[s.choice,mode==="MP3"&&s.active]} onPress={()=>setMode("MP3")}><Text style={s.choiceText}>MP3</Text></Pressable></View>
          <Text style={s.label}>Quality</Text><ScrollView horizontal showsHorizontalScrollIndicator={false}>{choices.map(x=><Pressable key={String(x.id)} style={[s.quality,quality===x.id&&s.qactive]} onPress={()=>setQuality(x.id)}><Text style={s.qtext}>{x.label||x.id}</Text></Pressable>)}</ScrollView>
          <Pressable style={s.download} onPress={download} disabled={busy}><Text style={s.downloadText}>↓ Download {mode}</Text></Pressable>
          {busy&&status==="Downloading…"?<View style={s.progress}><View style={s.row}><Text style={s.ptext}>{size(written)}{total?" / "+size(total):""}</Text><Text style={s.ptext}>{total?Math.round(written/total*100)+"%":"LIVE"}</Text></View><View style={s.track}><View style={[s.fill,{width:(total?Math.max(2,Math.min(100,written/total*100)):35)+"%"}]}/></View><Pressable onPress={()=>task.current?.cancel()}><Text style={s.cancel}>Cancel</Text></Pressable></View>:null}
        </View>:null}
      </View>
      <View style={s.info}><Text style={s.infoTitle}>Mobile Downly</Text><Text style={s.infoText}>Cloud is tried first. YouTube automatically falls back to the local Termux worker on this phone when cloud access is blocked.</Text><Pressable onPress={()=>Linking.openURL(CLOUD)}><Text style={s.link}>Open Downly Web</Text></Pressable></View>
    </ScrollView>
  </SafeAreaView>;
}

const s=StyleSheet.create({
 safe:{flex:1,backgroundColor:"#060914"},page:{padding:18,paddingBottom:40},head:{flexDirection:"row",alignItems:"center",marginBottom:16},logo:{width:52,height:52,borderRadius:17,backgroundColor:"#6366f1",alignItems:"center",justifyContent:"center",marginRight:13},logoText:{color:"#fff",fontSize:34,fontWeight:"900"},brand:{color:"#f8fafc",fontSize:28,fontWeight:"900"},tag:{color:"#94a3b8",fontSize:11},badge:{alignSelf:"flex-start",flexDirection:"row",alignItems:"center",backgroundColor:"#0d1220",borderColor:"#20283a",borderWidth:1,borderRadius:999,paddingHorizontal:12,paddingVertical:7,marginBottom:14},dot:{width:7,height:7,borderRadius:7,backgroundColor:"#34d399",marginRight:7},badgeText:{color:"#cbd5e1",fontSize:11,fontWeight:"700"},card:{backgroundColor:"#0d1220",borderColor:"#20283a",borderWidth:1,borderRadius:24,padding:16},h1:{color:"#f8fafc",fontSize:20,fontWeight:"800"},help:{color:"#94a3b8",fontSize:12,marginTop:5,marginBottom:14},input:{backgroundColor:"#080d18",borderColor:"#20283a",borderWidth:1,borderRadius:15,minHeight:54,paddingHorizontal:14,color:"#f8fafc",fontSize:14},primary:{marginTop:10,minHeight:50,borderRadius:15,backgroundColor:"#f8fafc",alignItems:"center",justifyContent:"center"},primaryText:{color:"#070b13",fontSize:15,fontWeight:"900"},status:{color:"#a5b4fc",fontSize:11,marginTop:12,textAlign:"center"},error:{color:"#fb7185",backgroundColor:"#2a1018",borderRadius:12,padding:10,marginTop:10,fontSize:12},result:{marginTop:16,borderTopWidth:1,borderTopColor:"#20283a",paddingTop:15},title:{color:"#f8fafc",fontSize:16,fontWeight:"800"},row:{flexDirection:"row",gap:8},choice:{flex:1,marginTop:14,borderWidth:1,borderColor:"#20283a",borderRadius:13,alignItems:"center",paddingVertical:11},active:{borderColor:"#8b5cf6",backgroundColor:"#21163c"},choiceText:{color:"#ddd6fe",fontWeight:"800"},label:{color:"#94a3b8",fontSize:11,fontWeight:"800",marginTop:16,marginBottom:8},quality:{borderWidth:1,borderColor:"#20283a",borderRadius:12,paddingHorizontal:12,paddingVertical:9,marginRight:7},qactive:{borderColor:"#6366f1",backgroundColor:"#171d38"},qtext:{color:"#dbeafe",fontSize:11,fontWeight:"700"},download:{marginTop:16,backgroundColor:"#6366f1",minHeight:52,borderRadius:15,alignItems:"center",justifyContent:"center"},downloadText:{color:"#fff",fontSize:15,fontWeight:"900"},progress:{marginTop:14,backgroundColor:"#080d18",borderRadius:15,padding:12},ptext:{color:"#cbd5e1",fontSize:11,fontWeight:"700"},track:{height:8,backgroundColor:"#1e293b",borderRadius:8,overflow:"hidden",marginTop:9},fill:{height:"100%",backgroundColor:"#8b5cf6"},cancel:{color:"#fb7185",fontSize:11,fontWeight:"800",alignSelf:"flex-end",paddingTop:10},info:{marginTop:14,padding:16,borderRadius:20,backgroundColor:"#0a0f1b",borderWidth:1,borderColor:"#20283a"},infoTitle:{color:"#f8fafc",fontWeight:"800",fontSize:14},infoText:{color:"#94a3b8",fontSize:11,lineHeight:17,marginTop:7},link:{color:"#a5b4fc",fontSize:12,fontWeight:"800",marginTop:10}
});