import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

const HISTORY = new File(Paths.document, "downly-history.json");
const C = { bg:"#05070d", card:"#0c111b", border:"#202a3a", text:"#f8fafc", muted:"#94a3b8", purple:"#7c3aed", blue:"#6366f1", green:"#34d399", red:"#fb7185" };

const clean = s => String(s || "downly-download").replace(/[\\/:*?"<>|]+/g," ").replace(/\s+/g," ").trim().slice(0,100) || "downly-download";
const size = n => { if(!n) return "0 B"; const u=["B","KB","MB","GB"],i=Math.min(3,Math.floor(Math.log(n)/Math.log(1024))); return `${(n/1024**i).toFixed(i?1:0)} ${u[i]}`; };
const fileName = s => { try { const p=decodeURIComponent(new URL(s).pathname.split("/").pop()||""); return clean(p||"download"); } catch { return "download"; } };
const extension = s => { const m=String(s).match(/\.([a-z0-9]{1,8})$/i); return m?m[1].toLowerCase():""; };
const pageHost = s => { try { return /youtube\.com|youtu\.be|instagram\.com|facebook\.com|tiktok\.com|twitter\.com|x\.com/.test(new URL(s).hostname.toLowerCase()); } catch { return false; } };

export default function App() {
  const [url,setUrl]=useState("");
  const [name,setName]=useState("");
  const [history,setHistory]=useState([]);
  const [busy,setBusy]=useState(false);
  const [written,setWritten]=useState(0);
  const [total,setTotal]=useState(0);
  const [status,setStatus]=useState("Ready");
  const [error,setError]=useState("");
  const task=useRef(null);

  useEffect(()=>{ loadHistory(); Linking.getInitialURL().then(u=>u&&consume(u)); const s=Linking.addEventListener("url",e=>consume(e.url)); return()=>s.remove(); },[]);
  const consume = u => { try { if(u.startsWith("downly://")) { const v=new URL(u).searchParams.get("url"); if(v) setUrl(v); } } catch {} };
  const loadHistory = async()=>{ try { if(HISTORY.exists){ const d=JSON.parse(await HISTORY.text()); if(Array.isArray(d)) setHistory(d); } } catch {} };
  const persist = async next => { setHistory(next); try { if(!HISTORY.exists) HISTORY.create(); await HISTORY.write(JSON.stringify(next)); } catch {} };

  const check = () => {
    setError(""); const v=url.trim();
    if(!/^https?:\/\//i.test(v)) return setError("Enter a complete http(s) direct file URL.");
    if(pageHost(v)) return setError("This is a webpage URL. No-backend mode only downloads direct media/file URLs.");
    const n=fileName(v); if(!name) setName(n); setStatus(`Ready · direct ${extension(n)||"file"}`);
  };

  const download = async()=>{
    const v=url.trim();
    if(!/^https?:\/\//i.test(v)) return setError("Enter a complete http(s) direct file URL.");
    if(pageHost(v)) return setError("No-backend mode cannot resolve YouTube/social page URLs. Use a direct media URL.");
    let n=clean(name.trim()||fileName(v)); const e=extension(fileName(v)); if(!extension(n)&&e) n+=`.${e}`;
    setBusy(true); setError(""); setWritten(0); setTotal(0); setStatus(`Downloading ${n}…`);
    try {
      const destination=new File(Paths.document,n); if(destination.exists) destination.delete();
      const t=File.createDownloadTask(v,destination,{onProgress:({bytesWritten,totalBytes})=>{setWritten(bytesWritten);setTotal(totalBytes>0?totalBytes:0);}});
      task.current=t; const f=await t.downloadAsync(); if(!f) throw new Error("Download cancelled.");
      const item={id:String(Date.now()),name:n,uri:f.uri,size:f.size||written||0,time:new Date().toISOString(),source:v};
      await persist([item,...history].slice(0,50)); setStatus(`Complete · ${size(item.size)}`);
      Alert.alert("Downly",`${n}\\n\\nSaved on this device.`,[{text:"Share / Save",onPress:()=>share(f.uri)},{text:"Open",onPress:()=>open(f)},{text:"OK"}]);
    } catch(e) { setStatus("Download failed"); setError(e?.message||"Download failed."); } finally { task.current=null; setBusy(false); }
  };

  const share=async uri=>{ if(await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri,{dialogTitle:"Save or share with Downly"}); else Alert.alert("Saved",uri); };
  const open=async x=>{ try { const f=x instanceof File?x:new File(x.uri); if(await File.canPreview(f)) await File.preview(f,{title:f.name}); else await share(f.uri); } catch(e){Alert.alert("Open file",e?.message||"No compatible viewer found.");} };
  const cancel=()=>{try{task.current?.cancel();}catch{} setStatus("Cancelled");setBusy(false);};
  const clear=()=>Alert.alert("Clear history","Remove all download history?",[{text:"Cancel",style:"cancel"},{text:"Clear",style:"destructive",onPress:()=>persist([])}]);
  const remove=id=>persist(history.filter(x=>x.id!==id));
  const progress=total?Math.round(written/total*100):0;
  const recent=useMemo(()=>history.slice(0,10),[history]);

  return <SafeAreaView style={styles.safe}>
    <StatusBar barStyle="light-content" backgroundColor={C.bg}/>
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.header}><View style={styles.logo}><Text style={styles.arrow}>↓</Text></View><View><Text style={styles.brand}>Downly</Text><Text style={styles.tag}>PRIVATE • NO BACKEND</Text></View></View>
      <View style={styles.badge}><View style={styles.dot}/><Text style={styles.badgeText}>Device downloader</Text></View>

      <View style={styles.card}>
        <Text style={styles.h1}>Direct download</Text>
        <Text style={styles.sub}>Download public direct media and files straight to this Android device.</Text>
        <TextInput value={url} onChangeText={v=>{setUrl(v);setError("");}} placeholder="https://example.com/video.mp4" placeholderTextColor="#64748b" autoCapitalize="none" autoCorrect={false} keyboardType="url" style={styles.input}/>
        <TextInput value={name} onChangeText={setName} placeholder="Filename (optional)" placeholderTextColor="#64748b" autoCapitalize="none" style={styles.small}/>
        <View style={styles.row}><Pressable style={styles.primary} onPress={check} disabled={busy}><Text style={styles.primaryText}>Check URL</Text></Pressable><Pressable style={styles.secondary} onPress={()=>{setUrl("");setName("");setError("");setStatus("Ready");}} disabled={busy}><Text style={styles.secondaryText}>Clear</Text></Pressable></View>
        <Text style={styles.status}>{status}</Text>
        {!!error&&<Text style={styles.error}>{error}</Text>}
        <Pressable style={styles.download} onPress={download} disabled={busy}>{busy?<ActivityIndicator color="#fff"/>:<Text style={styles.downloadText}>↓  Download to device</Text>}</Pressable>
        {busy&&<View style={styles.progress}><View style={styles.progressTop}><Text style={styles.progressText}>{size(written)}{total?` / ${size(total)}`:""}</Text><Text style={styles.progressText}>{total?`${progress}%`:"LIVE"}</Text></View><View style={styles.track}><View style={[styles.fill,{width:`${total?Math.max(2,progress):35}%`}]}/></View><Pressable onPress={cancel}><Text style={styles.cancel}>Cancel</Text></Pressable></View>}
      </View>

      <View style={styles.card}>
        <View style={styles.historyHead}><Text style={styles.h2}>Downloads</Text>{history.length>0&&<Pressable onPress={clear}><Text style={styles.clear}>Clear</Text></Pressable>}</View>
        {!recent.length?<Text style={styles.empty}>Downloaded files will appear here.</Text>:recent.map(x=><View style={styles.item} key={x.id}><View style={{flex:1}}><Text style={styles.itemName} numberOfLines={2}>{x.name}</Text><Text style={styles.meta}>{size(x.size)} • {new Date(x.time).toLocaleDateString()}</Text></View><Pressable onPress={()=>open(x)}><Text style={styles.action}>Open</Text></Pressable><Pressable onPress={()=>share(x.uri)}><Text style={styles.action}>Share</Text></Pressable><Pressable onPress={()=>remove(x.id)}><Text style={styles.delete}>×</Text></Pressable></View>)}
      </View>

      <View style={styles.note}><Text style={styles.noteTitle}>Fully local app</Text><Text style={styles.noteText}>No Downly backend, API, Cloudflare or Termux is required. The app downloads a direct URL using Android networking and stores the result on-device. Page URLs such as YouTube need a resolver service and are intentionally not extracted in this no-backend build.</Text></View>
    </ScrollView>
  </SafeAreaView>;
}

const styles=StyleSheet.create({
safe:{flex:1,backgroundColor:C.bg},page:{padding:18,paddingBottom:45},header:{flexDirection:"row",alignItems:"center",marginTop:8,marginBottom:14},
logo:{width:54,height:54,borderRadius:17,backgroundColor:C.blue,alignItems:"center",justifyContent:"center",marginRight:12},arrow:{color:"#fff",fontSize:37,fontWeight:"900",marginTop:-3},
brand:{color:C.text,fontSize:29,fontWeight:"900"},tag:{color:"#818cf8",fontSize:9,fontWeight:"800",marginTop:2},badge:{alignSelf:"flex-start",flexDirection:"row",alignItems:"center",paddingHorizontal:11,paddingVertical:7,borderRadius:20,borderWidth:1,borderColor:C.border,backgroundColor:C.card,marginBottom:13},
dot:{width:7,height:7,borderRadius:7,backgroundColor:C.green,marginRight:7},badgeText:{color:"#cbd5e1",fontSize:11,fontWeight:"700"},card:{backgroundColor:C.card,borderWidth:1,borderColor:C.border,borderRadius:22,padding:16,marginBottom:14},
h1:{color:C.text,fontSize:21,fontWeight:"900"},h2:{color:C.text,fontSize:16,fontWeight:"900"},sub:{color:C.muted,fontSize:12,lineHeight:18,marginTop:5,marginBottom:14},
input:{height:56,borderRadius:15,borderWidth:1,borderColor:C.border,backgroundColor:"#080d18",paddingHorizontal:14,color:C.text,fontSize:13},small:{height:48,borderRadius:14,borderWidth:1,borderColor:C.border,backgroundColor:"#080d18",paddingHorizontal:14,color:C.text,fontSize:12,marginTop:8},
row:{flexDirection:"row",gap:8,marginTop:10},primary:{flex:1,height:50,borderRadius:14,backgroundColor:"#f8fafc",alignItems:"center",justifyContent:"center"},primaryText:{color:"#070b13",fontWeight:"900",fontSize:14},
secondary:{height:50,paddingHorizontal:17,borderRadius:14,borderWidth:1,borderColor:C.border,backgroundColor:"#101827",alignItems:"center",justifyContent:"center"},secondaryText:{color:"#cbd5e1",fontWeight:"800"},
status:{color:"#a5b4fc",fontSize:11,textAlign:"center",marginTop:11},error:{color:C.red,backgroundColor:"#2a1018",borderRadius:12,padding:10,marginTop:10,fontSize:11,lineHeight:16},
download:{height:53,borderRadius:15,backgroundColor:C.purple,alignItems:"center",justifyContent:"center",marginTop:13},downloadText:{color:"#fff",fontSize:14,fontWeight:"900"},
progress:{backgroundColor:"#080d18",borderRadius:14,borderWidth:1,borderColor:C.border,padding:12,marginTop:12},progressTop:{flexDirection:"row",justifyContent:"space-between"},progressText:{color:"#cbd5e1",fontSize:10,fontWeight:"700"},
track:{height:8,backgroundColor:"#1e293b",borderRadius:8,overflow:"hidden",marginTop:9},fill:{height:"100%",backgroundColor:C.blue,borderRadius:8},cancel:{color:C.red,fontSize:11,fontWeight:"800",alignSelf:"flex-end",marginTop:9},
historyHead:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},clear:{color:"#a5b4fc",fontSize:11,fontWeight:"800"},empty:{color:C.muted,fontSize:12,marginTop:12},
item:{flexDirection:"row",alignItems:"center",gap:8,borderTopWidth:1,borderTopColor:C.border,paddingVertical:12,marginTop:10},itemName:{color:C.text,fontSize:12,fontWeight:"700"},meta:{color:C.muted,fontSize:9,marginTop:4},action:{color:"#a5b4fc",fontSize:10,fontWeight:"800"},delete:{color:C.red,fontSize:21,fontWeight:"700"},
note:{padding:16,borderRadius:19,borderWidth:1,borderColor:C.border,backgroundColor:"#0a0f1b"},noteTitle:{color:C.text,fontSize:13,fontWeight:"900"},noteText:{color:C.muted,fontSize:10,lineHeight:16,marginTop:7}
});
