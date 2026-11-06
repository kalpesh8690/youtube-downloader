import {useMemo,useState} from 'react';
import {ArrowRight,Check,Download,FileVideo,Globe,History,Link2,Loader2,Menu,Play,ShieldCheck,Sparkles,TrendingDown,X,Zap} from 'lucide-react';

const formats=['MP4','MP3','WEBM'];
const qualities=['1080p','720p','480p','360p'];
const features=[
 ['Lightning fast','A clean workflow designed to minimize clicks.',Zap],
 ['Multiple formats','Prepare MP4, MP3 and WEBM outputs.',FileVideo],
 ['Quality control','Pick the resolution that fits your needs.',Check],
 ['Responsive','A polished experience on phones and desktops.',Globe]
];

function isYouTube(value){
 try{const u=new URL(value);return /(^|\.)((youtube\.com)|(youtu\.be))$/.test(u.hostname)}catch{return false}
}

export default function App(){
 const[url,setUrl]=useState('');
 const[quality,setQuality]=useState('1080p');
 const[format,setFormat]=useState('MP4');
 const[loading,setLoading]=useState(false);
 const[open,setOpen]=useState(false);
 const[message,setMessage]=useState('');
 const valid=useMemo(()=>isYouTube(url),[url]);

 const submit=()=>{
  setMessage('');
  if(!valid){setMessage('Paste a valid YouTube URL to continue.');return}
  setLoading(true);
  setTimeout(()=>{setLoading(false);setMessage('Ready — connect your backend download endpoint to start the file transfer.')},800);
 };

 return <div className="min-h-screen overflow-hidden bg-[#070b14]">
  <div className="pointer-events-none fixed inset-0 -z-0">
   <div className="absolute left-1/2 top-[-240px] h-[520px] w-[720px] -translate-x-1/2 rounded-full bg-indigo-600/20 blur-[120px]"/>
   <div className="absolute right-[-180px] top-[40%] h-[420px] w-[420px] rounded-full bg-fuchsia-600/10 blur-[120px]"/>
  </div>

  <header className="relative z-20 border-b border-white/5 bg-[#070b14]/70 backdrop-blur-xl">
   <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
    <a href="#" className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 shadow-glow"><Download size={20}/></span><span className="text-lg font-extrabold tracking-tight">Downly</span></a>
    <nav className="hidden items-center gap-7 text-sm text-slate-400 md:flex"><a href="#features" className="hover:text-white">Features</a><a href="#how" className="hover:text-white">How it works</a><a href="#history" className="hover:text-white">History</a></nav>
    <button onClick={()=>setOpen(!open)} className="rounded-xl border border-white/10 p-2 text-slate-300 md:hidden" aria-label="Menu">{open?<X size={20}/>:<Menu size={20}/>}</button>
   </div>
   {open&&<div className="border-t border-white/5 px-5 py-4 md:hidden"><div className="flex flex-col gap-4 text-sm text-slate-300"><a href="#features">Features</a><a href="#how">How it works</a><a href="#history">History</a></div></div>}
  </header>

  <main className="relative z-10">
   <section className="mx-auto max-w-5xl px-5 pb-16 pt-20 text-center sm:px-8 sm:pt-28">
    <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-indigo-400/20 bg-indigo-400/10 px-4 py-2 text-xs font-semibold text-indigo-200"><Sparkles size={14}/> Fast, simple & beautifully designed</div>
    <h1 className="text-4xl font-extrabold leading-tight tracking-[-0.04em] sm:text-6xl">Download videos.<br/><span className="bg-gradient-to-r from-indigo-300 via-violet-300 to-fuchsia-300 bg-clip-text text-transparent">Keep it simple.</span></h1>
    <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-slate-400 sm:text-lg">Paste a video link, choose your format and quality, and get your download ready in seconds.</p>

    <div className="mx-auto mt-10 max-w-3xl rounded-3xl border border-white/10 bg-white/[0.045] p-2 shadow-glow backdrop-blur-xl sm:p-3">
     <div className="flex flex-col gap-2 sm:flex-row">
      <div className="relative flex min-w-0 flex-1 items-center"><Link2 className="absolute left-4 text-slate-500" size={19}/><input value={url} onChange={e=>setUrl(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submit()} placeholder="Paste YouTube URL here..." className="h-14 w-full rounded-2xl border border-white/10 bg-black/20 pl-12 pr-4 text-sm text-white outline-none placeholder:text-slate-600 focus:border-indigo-400/50 focus:ring-4 focus:ring-indigo-500/10"/></div>
      <button onClick={submit} disabled={loading} className="group flex h-14 items-center justify-center gap-2 rounded-2xl bg-white px-6 font-bold text-slate-950 transition hover:bg-indigo-50 disabled:cursor-wait disabled:opacity-70">{loading?<Loader2 className="animate-spin" size={19}/>:<Download size={19}/>} {loading?'Checking...':'Download'}<ArrowRight className="transition group-hover:translate-x-1" size={17}/></button>
     </div>
     {message&&<div className="px-3 pb-1 pt-3 text-left text-sm text-indigo-200">{message}</div>}
    </div>

    <div className="mt-5 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-slate-500"><span className="flex items-center gap-1.5"><ShieldCheck size={14}/> Secure processing</span><span className="flex items-center gap-1.5"><Zap size={14}/> Fast workflow</span><span className="flex items-center gap-1.5"><Globe size={14}/> Cross-device</span></div>
   </section>

   <section className="mx-auto max-w-5xl px-5 pb-20 sm:px-8">
    <div className="grid gap-4 md:grid-cols-3">
     <div className="rounded-3xl border border-white/8 bg-white/[0.035] p-5">
      <div className="mb-8 flex items-center justify-between"><FileVideo className="text-indigo-300" size={24}/><span className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-slate-500">Preview</span></div>
      <div className="aspect-video rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 p-4"><div className="flex h-full items-center justify-center rounded-xl border border-white/5"><Play className="fill-white text-white" size={28}/></div></div>
      <div className="mt-4 h-3 w-4/5 rounded-full bg-white/10"/><div className="mt-2 h-2 w-2/5 rounded-full bg-white/5"/>
     </div>
     <div className="rounded-3xl border border-white/8 bg-white/[0.035] p-5 md:col-span-2">
      <div className="flex items-center justify-between"><div><p className="text-sm font-bold">Download settings</p><p className="mt-1 text-xs text-slate-500">Choose your preferred output.</p></div><TrendingDown className="text-slate-600" size={20}/></div>
      <div className="mt-7 grid gap-4 sm:grid-cols-2">
       <label className="block text-xs font-semibold text-slate-400">FORMAT<select value={format} onChange={e=>setFormat(e.target.value)} className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-white outline-none focus:border-indigo-400/50">{formats.map(x=><option key={x}>{x}</option>)}</select></label>
       <label className="block text-xs font-semibold text-slate-400">QUALITY<select value={quality} onChange={e=>setQuality(e.target.value)} className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-white outline-none focus:border-indigo-400/50">{qualities.map(x=><option key={x}>{x}</option>)}</select></label>
      </div>
      <button onClick={submit} className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-500 font-bold transition hover:bg-indigo-400"><Download size={18}/> Download {format} · {quality}</button>
     </div>
    </div>
   </section>

   <section id="features" className="border-y border-white/5 bg-white/[0.02]"><div className="mx-auto max-w-7xl px-5 py-20 sm:px-8"><div className="max-w-xl"><p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-300">Built for speed</p><h2 className="mt-3 text-3xl font-bold tracking-tight">Everything you need. Nothing you don't.</h2></div><div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{features.map(([title,desc,Icon])=><div key={title} className="rounded-2xl border border-white/8 bg-[#0b101b] p-5"><div className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-500/10 text-indigo-300"><Icon size={18}/></div><h3 className="mt-5 font-bold">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-500">{desc}</p></div>)}</div></div></section>

   <section id="how" className="mx-auto max-w-5xl px-5 py-20 sm:px-8"><div className="text-center"><p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-300">How it works</p><h2 className="mt-3 text-3xl font-bold">Three simple steps</h2></div><div className="mt-10 grid gap-4 md:grid-cols-3">{[['01','Paste your link','Add a supported video URL.'],['02','Choose output','Select format and quality.'],['03','Start download','Your backend handles the media transfer.']].map(([n,t,d])=><div className="rounded-2xl border border-white/8 bg-white/[0.035] p-6" key={n}><span className="text-sm font-bold text-indigo-300">{n}</span><h3 className="mt-8 font-bold">{t}</h3><p className="mt-2 text-sm leading-6 text-slate-500">{d}</p></div>)}</div></section>

   <section id="history" className="mx-auto max-w-7xl px-5 pb-20 sm:px-8"><div className="rounded-3xl border border-white/8 bg-white/[0.035] p-6 sm:p-8"><div className="flex items-center gap-3"><History className="text-indigo-300" size={21}/><div><h2 className="font-bold">Download history</h2><p className="text-xs text-slate-500">Your recent downloads will appear here.</p></div></div><div className="mt-7 flex min-h-32 items-center justify-center rounded-2xl border border-dashed border-white/10 text-sm text-slate-600">No downloads yet</div></div></section>
  </main>

  <footer className="border-t border-white/5"><div className="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-8 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between sm:px-8"><span>© 2026 Downly</span><span>Built with React + Tailwind CSS</span></div></footer>
 </div>
}