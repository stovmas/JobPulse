import { useState, useEffect, useRef, useCallback } from "react";

const SK = "jobpulse-v2";
function lsGet(k) { try { const v=localStorage.getItem(k); return v?JSON.parse(v):null; } catch { return null; } }
function lsSet(k,v) { try { localStorage.setItem(k,JSON.stringify(v)); return true; } catch { return false; } }

const DEFAULT = {
  tabs: [
    { id:"tab-1", name:"Sales", sources:[],
      keywords:["account executive","AE","SDR","BDR","sales development","business development","inside sales","enterprise sales","commission","pipeline","CRM","cold calling","OTE"] },
    { id:"tab-2", name:"Film & Entertainment", sources:[],
      keywords:["entertainment marketing","film marketing","studio","theatrical","content marketing","brand partnerships","box office","streaming","film campaign","major studio"] },
  ],
  notifications:{ email:"",emailjsServiceId:"",emailjsTemplateId:"",emailjsPublicKey:"",emailEnabled:false,phone:"",textbeltKey:"textbelt",smsEnabled:false },
  pollIntervalMinutes:30, seenJobIds:[], initializedSrcIds:[], alertHistory:[],
};

async function fetchGreenhouse(slug) {
  const res=await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`);
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  const d=await res.json();
  return (d.jobs||[]).map(j=>{
    const pay=j.pay_input_ranges?.[0];
    const salary=pay?`$${Math.round((pay.min_cents||0)/100000)}k–$${Math.round((pay.max_cents||0)/100000)}k`:"";
    return {id:`gh-${j.id}`,title:j.title||"",company:slug,location:j.location?.name||"",description:j.content?j.content.replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim():"",url:j.absolute_url||"",postedAt:j.updated_at||new Date().toISOString(),ats:"greenhouse",salary};
  });
}
async function fetchLever(slug) {
  const res=await fetch(`https://api.lever.co/v0/postings/${slug}?mode=json`);
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  const d=await res.json();
  return (Array.isArray(d)?d:[]).map(j=>({id:`lv-${j.id}`,title:j.text||"",company:slug,location:j.categories?.location||"",description:j.descriptionPlain||"",url:j.hostedUrl||"",postedAt:j.createdAt?new Date(j.createdAt).toISOString():new Date().toISOString(),ats:"lever",salary:j.salaryRange?`${j.salaryRange.min||""}–${j.salaryRange.max||""}`:""}));
}
async function fetchAshby(slug) {
  const res=await fetch(`https://api.ashbyhq.com/posting-api/job-board/${slug}`);
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  const d=await res.json();
  return (d.jobPostings||[]).map(j=>({id:`ash-${j.id}`,title:j.title||"",company:slug,location:j.locationName||"",description:(j.descriptionSocial||j.descriptionHtml||"").replace(/<[^>]+>/g," "),url:j.jobPostingUrl||"",postedAt:j.publishedAt||new Date().toISOString(),ats:"ashby",salary:j.compensationTierSummary||""}));
}
async function fetchSmartRecruiters(slug) {
  const res=await fetch(`https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100`);
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  const d=await res.json();
  return (d.content||[]).map(j=>{
    const comp=j.compensation;
    const salary=comp?`$${Math.round((comp.min||0)/1000)}k–$${Math.round((comp.max||0)/1000)}k`:"";
    return {id:`sr-${j.uuid}`,title:j.name||"",company:slug,location:[j.location?.city,j.location?.country].filter(Boolean).join(", "),description:(j.jobAd?.sections?.jobDescription?.text||"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim(),url:`https://jobs.smartrecruiters.com/${slug}/${j.uuid}`,postedAt:j.releasedDate||new Date().toISOString(),ats:"smartrecruiters",salary};
  });
}
async function fetchRecruitee(slug) {
  const res=await fetch(`https://${slug}.recruitee.com/api/offers/?scope=published`);
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  const d=await res.json();
  return (d.offers||[]).map(j=>({id:`re-${j.id}`,title:j.title||"",company:slug,location:j.city||j.country||"",description:(j.description||"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim(),url:j.careers_url||`https://${slug}.recruitee.com/o/${j.slug}`,postedAt:j.published_at||new Date().toISOString(),ats:"recruitee",salary:j.salary||""}));
}
async function fetchWorkable(slug) {
  const res=await fetch(`https://apply.workable.com/api/v1/widget/jobs/${slug}`);
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  const d=await res.json();
  return (d.jobs||[]).map(j=>({id:`wk-${j.shortcode}`,title:j.title||"",company:slug,location:[j.city,j.country].filter(Boolean).join(", "),description:(j.description||"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim(),url:j.url||`https://apply.workable.com/${slug}/j/${j.shortcode}`,postedAt:j.published_on||new Date().toISOString(),ats:"workable",salary:""}));
}
async function fetchScrape(sourceUrl) {
  const res=await fetch(`/api/scrape?url=${encodeURIComponent(sourceUrl)}`);
  if(!res.ok) throw new Error(`Scrape API HTTP ${res.status}`);
  const d=await res.json();
  if(d.error && (!d.jobs || d.jobs.length===0)) throw new Error(d.error);
  return (d.jobs||[]);
}
async function fetchSourceJobs(s) {
  if(s.atsType==="greenhouse") return fetchGreenhouse(s.slug);
  if(s.atsType==="lever") return fetchLever(s.slug);
  if(s.atsType==="ashby") return fetchAshby(s.slug);
  if(s.atsType==="smartrecruiters") return fetchSmartRecruiters(s.slug);
  if(s.atsType==="recruitee") return fetchRecruitee(s.slug);
  if(s.atsType==="workable") return fetchWorkable(s.slug);
  if(s.atsType==="scrape") return fetchScrape(s.slug);
  throw new Error(`${s.atsType} not supported`);
}

// ── ATS auto-detection ────────────────────────────────────────────────────────
// 1. If input looks like a URL, parse the hostname + path to extract ATS + slug
// 2. Otherwise treat input as a slug and race all three APIs to see which responds
async function autoDetectATS(raw) {
  const input = raw.trim();

  // ── URL parsing ──
  let maybeUrl = input;
  if (!/^https?:\/\//i.test(maybeUrl)) maybeUrl = "https://" + maybeUrl;
  try {
    const u = new URL(maybeUrl);
    const host = u.hostname.toLowerCase();
    const parts = u.pathname.replace(/^\//, "").split("/").filter(Boolean);

    if (host.includes("greenhouse.io")) {
      const slug = host.includes("api") ? parts[2] : parts[0];
      if (slug) return { atsType:"greenhouse", slug, label:"" };
    }
    if (host.includes("lever.co")) {
      const slug = host.includes("api") ? parts[2] : parts[0];
      if (slug) return { atsType:"lever", slug, label:"" };
    }
    if (host.includes("ashbyhq.com")) {
      const slug = host.includes("api") ? parts[2] : parts[0];
      if (slug) return { atsType:"ashby", slug, label:"" };
    }
    if (host.includes("smartrecruiters.com")) {
      // jobs.smartrecruiters.com/SLUG or smartrecruiters.com/SLUG
      const slug = parts[0];
      if (slug) return { atsType:"smartrecruiters", slug, label:"" };
    }
    if (host.includes("recruitee.com")) {
      // SLUG.recruitee.com
      const slug = host.split(".")[0];
      if (slug && slug !== "recruitee") return { atsType:"recruitee", slug, label:"" };
    }
    if (host.includes("workable.com") || host.includes("apply.workable.com")) {
      // apply.workable.com/SLUG or SLUG.workable.com
      const slug = host.startsWith("apply") ? parts[0] : host.split(".")[0];
      if (slug) return { atsType:"workable", slug, label:"" };
    }

    // ── Known scrape-able custom job boards ──
    const SCRAPE_BOARDS = [
      { match: h => h === "jobs.netflix.com", label:"Netflix" },
    ];
    for (const board of SCRAPE_BOARDS) {
      if (board.match(host)) return { atsType:"scrape", slug:maybeUrl, label:board.label };
    }
  } catch {}

  // ── Slug probe: race all supported ATS in parallel ──
  const slug = input.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  const tries = await Promise.allSettled([
    fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`).then(r => r.ok ? "greenhouse" : Promise.reject()),
    fetch(`https://api.lever.co/v0/postings/${slug}?mode=json`).then(async r => { if(!r.ok) throw new Error(); const d=await r.json(); if(!Array.isArray(d)||d.length===0) throw new Error(); return "lever"; }),
    fetch(`https://api.ashbyhq.com/posting-api/job-board/${slug}`).then(async r => { if(!r.ok) throw new Error(); const d=await r.json(); if(!(d.jobPostings?.length>0)) throw new Error(); return "ashby"; }),
    fetch(`https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=1`).then(async r => { if(!r.ok) throw new Error(); const d=await r.json(); if(!(d.totalFound>0)) throw new Error(); return "smartrecruiters"; }),
    fetch(`https://${slug}.recruitee.com/api/offers/?scope=published`).then(async r => { if(!r.ok) throw new Error(); const d=await r.json(); if(!(d.offers?.length>0)) throw new Error(); return "recruitee"; }),
    fetch(`https://apply.workable.com/api/v1/widget/jobs/${slug}`).then(async r => { if(!r.ok) throw new Error(); const d=await r.json(); if(!(d.jobs?.length>0)) throw new Error(); return "workable"; }),
  ]);

  for (const t of tries) {
    if (t.status === "fulfilled") return { atsType: t.value, slug, label: "" };
  }
  return null;
}

function matchJob(job, kws) {
  const t=job.title.toLowerCase(), d=job.description.toLowerCase();
  const titleMatches=kws.filter(k=>t.includes(k.toLowerCase()));
  const descMatches=kws.filter(k=>!t.includes(k.toLowerCase())&&d.includes(k.toLowerCase()));
  return {titleMatches, descMatches, matched:titleMatches.length>0||descMatches.length>0};
}

async function sendEmail(n,subject,body) {
  if(!n.emailjsPublicKey||!n.emailjsServiceId||!n.emailjsTemplateId) throw new Error("EmailJS not configured");
  const res=await fetch("https://api.emailjs.com/api/v1.0/email/send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({service_id:n.emailjsServiceId,template_id:n.emailjsTemplateId,user_id:n.emailjsPublicKey,template_params:{to_email:n.email,subject,message:body}})});
  if(!res.ok) throw new Error(`EmailJS ${res.status}`);
}
async function sendSMS(n,msg) {
  if(!n.phone) throw new Error("No phone");
  const res=await fetch("https://textbelt.com/text",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:n.phone,message:msg.slice(0,160),key:n.textbeltKey||"textbelt"})});
  const d=await res.json(); if(!d.success) throw new Error(d.error||"SMS failed");
}
function bNotify(title,body) { if(typeof Notification!=="undefined"&&Notification.permission==="granted") new Notification(title,{body}); }

function extractPay(job) {
  if(job.salary) return job.salary;
  const txt = (job.title+" "+job.description).replace(/,/g,"");
  const m = txt.match(/\$\s*([\d.]+)\s*[kK]?\s*[-–—to]+\s*\$?\s*([\d.]+)\s*[kK]?/);
  if(m) {
    let lo=parseFloat(m[1]), hi=parseFloat(m[2]);
    if(lo<1000) lo*=1000; if(hi<1000) hi*=1000;
    return `$${Math.round(lo/1000)}k–$${Math.round(hi/1000)}k`;
  }
  const s = txt.match(/\$\s*([\d.]+)\s*[kK]/);
  if(s) return `$${s[1]}k`;
  const hr = txt.match(/\$\s*([\d.]+)\s*[-–—to\/]+\s*\$?\s*([\d.]+)\s*(?:per\s*hour|\/\s*hr|\/\s*hour|hr)/i);
  if(hr) return `$${hr[1]}–$${hr[2]}/hr`;
  return "";
}

function parsePay(s) {
  if(!s) return 0;
  const m=s.match(/\$\s*([\d.]+)\s*k/i);
  if(m) return parseFloat(m[1])*1000;
  const h=s.match(/\$\s*([\d.]+)/);
  return h?parseFloat(h[1]):0;
}

function ago(iso) {
  const d=Date.now()-new Date(iso).getTime(),m=Math.floor(d/60000),h=Math.floor(d/3600000),dy=Math.floor(d/86400000);
  if(m<1) return "just now"; if(m<60) return `${m}m ago`; if(h<24) return `${h}h ago`; return `${dy}d ago`;
}
function fmt(iso) { return new Date(iso).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}); }

// ── XP primitives ─────────────────────────────────────────────────────────────
const F = "Tahoma,'MS Sans Serif',sans-serif";

function Btn({children,onClick,disabled,primary,danger,small,style={}}) {
  const [p,setP]=useState(false);
  const h=small?20:23, pd=small?"1px 8px":"3px 14px";
  const base={fontFamily:F,fontSize:11,cursor:disabled?"default":"pointer",padding:pd,height:h,border:"none",outline:"none",display:"inline-flex",alignItems:"center",justifyContent:"center",gap:4,userSelect:"none",opacity:disabled?.55:1,...style};
  const norm={background:p?"linear-gradient(to bottom,#b8d0e8,#dce8f8)":"linear-gradient(to bottom,#f8f8f8,#e0e0e0)",boxShadow:p?"inset 1px 1px 3px rgba(0,0,0,.35),inset -1px -1px 0 rgba(255,255,255,.6)":"inset -1px -1px 0 #7a7a7a,inset 1px 1px 0 #fff,inset -2px -2px 0 #a0a0a0,inset 2px 2px 0 #e8e8e8",color:danger?"#aa0000":"#000"};
  const prim={background:p?"linear-gradient(to bottom,#1060b8,#2070cc)":"linear-gradient(to bottom,#4090d0,#1c68c0)",boxShadow:p?"inset 1px 1px 3px rgba(0,0,0,.4)":"inset -1px -1px 0 #0a3880,inset 1px 1px 0 #70c0f0,inset -2px -2px 0 #1048a0,inset 2px 2px 0 #a0d8f8",color:"#fff",fontWeight:"bold"};
  const s=primary?prim:norm;
  return <button style={{...base,...s}} onClick={disabled?undefined:onClick} onMouseDown={()=>!disabled&&setP(true)} onMouseUp={()=>setP(false)} onMouseLeave={()=>setP(false)}>{children}</button>;
}

function Inp({value,onChange,placeholder,type="text",style={}}) {
  return <input type={type} value={value} onChange={onChange} placeholder={placeholder} style={{fontFamily:F,fontSize:11,padding:"2px 5px",border:"2px solid",borderColor:"#7a7a7a #e0e0e0 #e0e0e0 #7a7a7a",background:"#fff",color:"#000",outline:"none",width:"100%",boxSizing:"border-box",...style}}/>;
}
function Sel({value,onChange,children,style={}}) {
  return <select value={value} onChange={onChange} style={{fontFamily:F,fontSize:11,padding:"2px 2px",border:"2px solid",borderColor:"#7a7a7a #e0e0e0 #e0e0e0 #7a7a7a",background:"#fff",color:"#000",outline:"none",width:"100%",...style}}>{children}</select>;
}
function Grp({title,children,style={}}) {
  return <fieldset style={{border:"1px solid",borderColor:"#7a7a7a #e8e8e8 #e8e8e8 #7a7a7a",padding:"8px 10px",marginBottom:10,...style}}><legend style={{fontFamily:F,fontSize:11,padding:"0 4px"}}>{title}</legend>{children}</fieldset>;
}
function Divider() { return <div style={{width:1,background:"#7a7a7a",margin:"0 3px",alignSelf:"stretch"}}/>; }

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [state,setState]   = useState(()=>lsGet(SK)||DEFAULT);
  const [tabId,setTabId]   = useState(()=>(lsGet(SK)||DEFAULT).tabs[0]?.id);
  const [view,setView]     = useState("listings");
  const [addSrc,setAddSrc] = useState(false);
  const [addTab,setAddTab] = useState(false);
  const [editKw,setEditKw] = useState(false);
  const [matchFilter,setMatchFilter] = useState("all"); // "all" | "title" | "desc"
  const [locationKeywords,setLocationKeywords] = useState([]); // location filter keywords
  const [editLocKw,setEditLocKw] = useState(false); // editing location keywords
  const [companyFilter,setCompanyFilter] = useState(new Set()); // column dropdown filter
  const [locationColFilter,setLocationColFilter] = useState(new Set()); // column dropdown filter
  const [showCompanyDd,setShowCompanyDd] = useState(false); // dropdown visibility
  const [showLocationDd,setShowLocationDd] = useState(false); // dropdown visibility
  const [locInput,setLocInput] = useState(""); // location filter input value
  const [paySort,setPaySort] = useState(""); // "" | "asc" | "desc"
  const [page,setPage] = useState(0);
  const PAGE_SIZE = 50;
  const [newSrc,setNewSrc] = useState({input:"",label:"",detecting:false,detected:null,error:null});
  const [newTab,setNewTab] = useState({name:""});
  const [live,setLive]     = useState({});
  const [poll,setPoll]     = useState({running:false,last:null,next:null,errors:[]});
  const [perm,setPerm]     = useState(typeof Notification!=="undefined"?Notification.permission:"default");
  const [testSt,setTestSt] = useState(null);
  const [time,setTime]     = useState(new Date());
  const stRef=useRef(null); stRef.current=state;
  const timer=useRef(null);

  useEffect(()=>{const t=setInterval(()=>setTime(new Date()),1000);return()=>clearInterval(t);},[]);

  const save=useCallback(ns=>{setState(ns);lsSet(SK,ns);},[]);

  const runPoll=useCallback(async()=>{
    const st=stRef.current; if(!st) return;
    setPoll(p=>({...p,running:true,errors:[]}));
    const srcs=[...new Map(st.tabs.flatMap(t=>t.sources).map(s=>[s.id,s])).values()];
    const fetched={},errs=[];
    await Promise.all(srcs.map(async s=>{try{fetched[s.id]=await fetchSourceJobs(s);}catch(e){errs.push({id:s.id,msg:e.message});}}));
    setLive(p=>({...p,...fetched}));
    const seen=new Set(st.seenJobIds||[]);
    const initialized=new Set(st.initializedSrcIds||[]);
    const alerts=[];
    for(const tab of st.tabs) for(const src of tab.sources) for(const job of (fetched[src.id]||[])) {
      const isNew=!seen.has(job.id);
      const srcReady=initialized.has(src.id);
      if(isNew && srcReady){
        const {titleMatches,descMatches,matched}=matchJob(job,tab.keywords||[]);
        if(matched&&titleMatches.length>0) alerts.push({job,tab,titleMatches,descMatches});
      }
    }
    const allIds=Object.values(fetched).flat().map(j=>j.id);
    const newInitialized=[...initialized,...srcs.map(s=>s.id)];
    save({...st,
      seenJobIds:[...new Set([...(st.seenJobIds||[]),...allIds])],
      initializedSrcIds:[...new Set(newInitialized)],
      alertHistory:[...alerts.map(a=>({id:`a-${Date.now()}-${Math.random().toString(36).slice(2)}`,jobTitle:a.job.title,company:a.job.company,location:a.job.location,url:a.job.url,tabName:a.tab.name,titleMatches:a.titleMatches,descMatches:a.descMatches,alertedAt:new Date().toISOString()})),...(st.alertHistory||[])].slice(0,200)});
    for(const a of alerts){
      const mt=a.titleMatches.length>0?"TITLE MATCH":"DESC MATCH",kws=[...a.titleMatches,...a.descMatches].join(", ");
      const subj=`[JobPulse · ${a.tab.name} · ${mt}] ${a.job.title}`;
      const body=`New match!\n\n${a.job.title}\n${a.job.company} · ${a.job.location}\n\nMatch: ${mt}\nKeywords: ${kws}\n\nView: ${a.job.url}`;
      bNotify(subj,`${a.job.company} · ${kws}`);
      if(st.notifications.emailEnabled&&st.notifications.email) try{await sendEmail(st.notifications,subj,body)}catch(e){errs.push({msg:`Email: ${e.message}`});}
      if(st.notifications.smsEnabled&&st.notifications.phone) try{await sendSMS(st.notifications,`[JobPulse ${a.tab.name}] ${mt}: "${a.job.title}" @ ${a.job.company}. KWs: ${kws}`)}catch(e){errs.push({msg:`SMS: ${e.message}`});}
    }
    const now=new Date();
    setPoll({running:false,last:now.toISOString(),next:new Date(now.getTime()+(st.pollIntervalMinutes||30)*60000).toISOString(),errors:errs});
  },[save]);

  useEffect(()=>{if(timer.current) clearInterval(timer.current);timer.current=setInterval(runPoll,(state.pollIntervalMinutes||30)*60000);return()=>clearInterval(timer.current);},[state?.pollIntervalMinutes,runPoll]);
  useEffect(()=>{if(state.tabs.some(t=>t.sources.length>0)) runPoll();},[]);

  const activeTab=state.tabs.find(t=>t.id===tabId)||state.tabs[0];
  const tabJobs=(activeTab?.sources||[]).flatMap(s=>live[s.id]||[]);
  const matched=tabJobs.map(j=>({...j,...matchJob(j,activeTab?.keywords||[])})).filter(j=>j.matched).sort((a,b)=>new Date(b.postedAt)-new Date(a.postedAt));

  const matchFiltered = matchFilter==="title" ? matched.filter(j=>j.titleMatches.length>0)
                      : matchFilter==="desc"  ? matched.filter(j=>j.descMatches.length>0&&j.titleMatches.length===0)
                      : matched;
  // All unique locations from matched jobs (for autocomplete suggestions)
  const allLocations = [...new Set(matched.map(j=>j.location||"").filter(Boolean))].sort();
  // Location keyword filter (left sidebar)
  const locFiltered = locationKeywords.length
    ? matchFiltered.filter(j=>locationKeywords.some(tok=>(j.location||"").toLowerCase().includes(tok.toLowerCase())))
    : matchFiltered;
  // Column dropdown filters (Company, Location)
  const colFiltered = locFiltered
    .filter(j=>companyFilter.size===0||companyFilter.has(j.company))
    .filter(j=>locationColFilter.size===0||locationColFilter.has(j.location||""));
  const filtered = paySort ? [...colFiltered].sort((a,b)=>{
    const pa=parsePay(extractPay(a)), pb=parsePay(extractPay(b));
    return paySort==="asc" ? pa-pb : pb-pa;
  }) : colFiltered;

  // Unique values for dropdown filters
  const uniqueCompanies = [...new Set(locFiltered.map(j=>j.company))].sort();
  const uniqueLocations = [...new Set(locFiltered.map(j=>j.location||""))].sort();

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages-1);
  const paginated = filtered.slice(safePage*PAGE_SIZE, (safePage+1)*PAGE_SIZE);

  // Reset page when tab or filter changes
  useEffect(()=>setPage(0),[tabId, matchFilter, locationKeywords.length, companyFilter.size, locationColFilter.size]);
  // Close dropdowns on outside click
  useEffect(()=>{
    const handler=e=>{
      if(!e.target.closest('.col-dropdown')){setShowCompanyDd(false);setShowLocationDd(false);}
    };
    document.addEventListener("mousedown",handler);
    return()=>document.removeEventListener("mousedown",handler);
  },[]);

  const upTab=(f,v)=>save({...state,tabs:state.tabs.map(t=>t.id===tabId?{...t,[f]:v}:t)});
  const upNotif=p=>save({...state,notifications:{...state.notifications,...p}});

  const detectSrc=async()=>{
    if(!newSrc.input.trim()) return;
    setNewSrc(s=>({...s,detecting:true,detected:null,error:null}));
    const result=await autoDetectATS(newSrc.input.trim());
    if(result) setNewSrc(s=>({...s,detecting:false,detected:result,error:null}));
    else setNewSrc(s=>({...s,detecting:false,detected:null,error:"Not found on Greenhouse, Lever, Ashby, SmartRecruiters, Recruitee, Workable, or any supported custom board. The company may use Workday or iCIMS which require credentials and can't be auto-fetched."}));
  };
  const resetSrcDialog=()=>setNewSrc({input:"",label:"",detecting:false,detected:null,error:null});
  const doAddSrc=()=>{
    if(!newSrc.detected) return;
    const s={id:`s${Date.now()}`,...newSrc.detected,label:newSrc.label||newSrc.detected.label||newSrc.detected.slug,addedAt:new Date().toISOString()};
    upTab("sources",[...(activeTab?.sources||[]),s]);
    resetSrcDialog();setAddSrc(false);setTimeout(runPoll,400);
  };
  const doAddTab=()=>{
    if(!newTab.name) return;
    const t={id:`tab-${Date.now()}`,name:newTab.name,sources:[],keywords:[]};
    save({...state,tabs:[...state.tabs,t]});setTabId(t.id);setNewTab({name:""});setAddTab(false);
  };
  const rmTab=id=>{if(state.tabs.length<=1) return;const ns={...state,tabs:state.tabs.filter(t=>t.id!==id)};save(ns);setTabId(ns.tabs[0].id);};

  const doTest=async()=>{
    setTestSt("sending");const errs=[];const subj="[JobPulse TEST] Working ✓";
    bNotify(subj,"Your alerts are configured correctly!");
    if(state.notifications.emailEnabled&&state.notifications.email) try{await sendEmail(state.notifications,subj,"Test from JobPulse!")}catch(e){errs.push(`Email: ${e.message}`);}
    if(state.notifications.smsEnabled&&state.notifications.phone) try{await sendSMS(state.notifications,"[JobPulse TEST] Working ✓")}catch(e){errs.push(`SMS: ${e.message}`);}
    setTestSt(errs.length?errs.join(" | "):"sent");setTimeout(()=>setTestSt(null),7000);
  };

  const lsKB=(()=>{try{const r=localStorage.getItem(SK)||"";return `${(new Blob([r]).size/1024).toFixed(1)} KB`;}catch{return "?"}})();

  return (
    <div style={{height:"100vh",background:"#ece9d8",fontFamily:F,fontSize:11,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0;}
        body{overflow:hidden;}
        ::-webkit-scrollbar{width:17px;}
        ::-webkit-scrollbar-track{background:#d4d0c8;border-left:1px solid #a0a0a0;}
        ::-webkit-scrollbar-thumb{background:linear-gradient(to right,#e8e4dc,#c8c4bc);border:1px solid;border-color:#fff #808080 #808080 #fff;}
        ::-webkit-scrollbar-button:single-button{background:#d4d0c8;border:1px solid;border-color:#fff #808080 #808080 #fff;height:17px;display:block;}
        input,select{font-family:Tahoma,'MS Sans Serif',sans-serif;font-size:11px;}
        button{font-family:Tahoma,'MS Sans Serif',sans-serif;font-size:11px;}
        .inset{border:2px solid;border-color:#808080 #e8e8e8 #e8e8e8 #808080;background:#fff;}
        .raised{border:2px solid;border-color:#e8e8e8 #808080 #808080 #e8e8e8;}
        .row-even{background:#fff;} .row-odd{background:#f4f2ec;}
        .row-even:hover,.row-odd:hover{background:#316ac5;color:#fff;}
        a{color:#0000ee;}
        @keyframes xpBar{0%{left:-40%}100%{left:110%}}
      `}</style>

      {/* ── Title bar ── */}
      <div style={{background:"linear-gradient(to right,#0a246a 0%,#3a6fc8 40%,#a6caf0 100%)",padding:"4px 6px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:7}}>
          <span style={{fontSize:15}}>🎯</span>
          <span style={{fontWeight:"bold",color:"#fff",textShadow:"1px 1px 2px rgba(0,0,0,.7)",fontSize:12}}>JobPulse — Job Alert Monitor</span>
        </div>
        <div style={{display:"flex",gap:2}}>
          {[{ch:"─",title:"Minimize"},{ch:"□",title:"Maximize"},{ch:"✕",title:"Close"}].map(({ch,title})=>(
            <button key={ch} title={title} style={{width:21,height:21,background:"linear-gradient(to bottom,#e0e8f8,#7090b8)",border:"1px solid",borderColor:"#fff #404060 #404060 #fff",color:"#000",fontWeight:"bold",cursor:"pointer",fontSize:ch==="✕"?10:12,display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>{ch}</button>
          ))}
        </div>
      </div>

      {/* ── Menu bar ── */}
      <div style={{background:"#ece9d8",borderBottom:"1px solid #a0a0a0",padding:"2px 4px",display:"flex",gap:0,flexShrink:0}}>
        {["File","Edit","View","Alerts","Help"].map(m=>(
          <button key={m} style={{background:"none",border:"none",padding:"2px 8px",cursor:"pointer",color:"#000"}}
            onMouseEnter={e=>{e.target.style.background="#316ac5";e.target.style.color="#fff";}}
            onMouseLeave={e=>{e.target.style.background="none";e.target.style.color="#000";}}>{m}</button>
        ))}
      </div>

      {/* ── Toolbar ── */}
      <div style={{background:"#ece9d8",borderBottom:"1px solid #a0a0a0",padding:"3px 4px",display:"flex",gap:3,alignItems:"center",flexShrink:0}}>
        <Btn onClick={runPoll} disabled={poll.running}>{poll.running?"⏳ Polling…":"🔄 Refresh Now"}</Btn>
        <Divider/>
        <Btn onClick={()=>setAddSrc(true)}>📡 Add Company</Btn>
        <Btn onClick={()=>setAddTab(true)}>📁 New Category</Btn>
        {state.tabs.length>1&&<Btn danger onClick={()=>rmTab(tabId)}>✕ Remove Tab</Btn>}
        <Divider/>
        <Btn onClick={()=>{const b=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download="jobpulse.json";a.click();}}>💾 Export</Btn>
        <Btn onClick={async()=>setPerm(await Notification.requestPermission())}>{perm==="granted"?"🔔 Notifs: ON":"🔕 Enable Notifs"}</Btn>
        <div style={{flex:1}}/>
        {/* Poll status */}
        <div style={{display:"flex",alignItems:"center",gap:8,paddingRight:4}}>
          {poll.running&&(
            <div style={{width:100,height:14,border:"1px solid",borderColor:"#808080 #e8e8e8 #e8e8e8 #808080",overflow:"hidden",background:"#fff",position:"relative"}}>
              <div style={{position:"absolute",width:"40%",height:"100%",background:"linear-gradient(to right,#1a6fd8,#5ab4f8)",animation:"xpBar 1.2s infinite linear"}}/>
            </div>
          )}
          {poll.errors.length>0&&<span style={{color:"#cc0000"}}>⚠ {poll.errors.length} error{poll.errors.length>1?"s":""}</span>}
          {poll.last&&!poll.running&&<span style={{color:"#444"}}>Last: {ago(poll.last)}{poll.next?` · Next: ${fmt(poll.next)}`:""}</span>}
          <span style={{color:"#444",borderLeft:"1px solid #a0a0a0",paddingLeft:8}}>{time.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</span>
        </div>
      </div>

      {/* ── Address bar ── */}
      <div style={{background:"#ece9d8",borderBottom:"1px solid #a0a0a0",padding:"2px 4px",display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
        <span style={{color:"#000",whiteSpace:"nowrap"}}>Address:</span>
        <div className="inset" style={{flex:1,padding:"1px 5px",lineHeight:"18px"}}>
          C:\JobPulse\{activeTab?.name || ""}\{view}
        </div>
        <Btn small>Go</Btn>
      </div>

      {/* ── Category tabs ── */}
      <div style={{background:"#ece9d8",borderBottom:"2px solid #808080",display:"flex",alignItems:"flex-end",paddingLeft:4,paddingTop:4,flexShrink:0}}>
        {state.tabs.map(tab=>{
          const active=tab.id===tabId;
          const cnt=(state.alertHistory||[]).filter(a=>a.tabName===tab.name).length;
          return (
            <button key={tab.id} onClick={()=>{setTabId(tab.id);setView("listings");}} style={{
              fontFamily:F,fontSize:11,cursor:"pointer",padding:"4px 14px 3px",border:"1px solid",marginRight:2,
              borderColor:active?"#e8e8e8 #808080 #ece9d8 #e8e8e8":"#e8e8e8 #808080 #808080 #e8e8e8",
              background:active?"#ece9d8":"linear-gradient(to bottom,#d8d4cc,#c8c4bc)",
              fontWeight:active?"bold":"normal",position:"relative",bottom:active?-2:0,zIndex:active?2:1,
            }}>
              {tab.name}
              {cnt>0&&<span style={{marginLeft:5,background:"#cc0000",color:"#fff",borderRadius:9,padding:"0 5px",fontSize:10,fontWeight:"bold"}}>{cnt}</span>}
            </button>
          );
        })}
      </div>

      {/* ── Sub-nav tabs ── */}
      <div style={{background:"#ece9d8",borderBottom:"1px solid #a0a0a0",display:"flex",alignItems:"flex-end",paddingLeft:4,paddingTop:3,flexShrink:0}}>
        {[["listings","📋 Job Listings"],["history","🕐 Alert History"],["settings","⚙ Settings"]].map(([v,label])=>{
          const active=view===v;
          return (
            <button key={v} onClick={()=>setView(v)} style={{
              fontFamily:F,fontSize:11,cursor:"pointer",padding:"3px 12px 2px",border:"1px solid",marginRight:2,
              borderColor:active?"#e8e8e8 #808080 #ece9d8 #e8e8e8":"#e8e8e8 #808080 #808080 #e8e8e8",
              background:active?"#ece9d8":"linear-gradient(to bottom,#d8d4cc,#c8c4bc)",
              fontWeight:active?"bold":"normal",position:"relative",bottom:active?-1:0,
            }}>{label}</button>
          );
        })}
      </div>

      {/* ── Main content ── */}
      <div style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column"}}>

        {/* ═══ LISTINGS ═══ */}
        {view==="listings"&&(
          <div style={{display:"grid",gridTemplateColumns:"270px 1fr",flex:1,overflow:"hidden"}}>

            {/* Left panel */}
            <div style={{borderRight:"1px solid #a0a0a0",padding:8,overflowY:"auto",background:"#ece9d8"}}>

              <Grp title={`📡 Sources (${(activeTab?.sources||[]).length})`}>
                <Btn onClick={()=>setAddSrc(true)} style={{width:"100%",marginBottom:6}}>➕ Add Company</Btn>
                {(activeTab?.sources||[]).length===0?(
                  <div className="inset" style={{padding:10,textAlign:"center",color:"#808080"}}>No companies added yet</div>
                ):(activeTab?.sources||[]).map(s=>{
                  const jobs=live[s.id],cnt=jobs?.filter(j=>matchJob(j,activeTab.keywords||[]).matched).length??null;
                  const err=poll.errors.find(e=>e.id===s.id);
                  const ATS_COLORS={greenhouse:"#3a7a3a",lever:"#1a4fa0",ashby:"#a04040",smartrecruiters:"#c87800",recruitee:"#5a3a8a",workable:"#1a7a7a",scrape:"#b00010"};
                  const col=ATS_COLORS[s.atsType]||"#808080";
                  const displayName=s.label||s.companyName||s.slug;
                  return (
                    <div key={s.id} className="raised" style={{padding:"5px 7px",marginBottom:4,background:"#f8f6f0"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                        <div>
                          <b>{displayName}</b>
                          <span style={{marginLeft:5,background:col,color:"#fff",padding:"0 5px",fontSize:9,fontWeight:"bold"}}>{s.atsType}</span>
                        </div>
                        <Btn small danger onClick={()=>upTab("sources",(activeTab?.sources||[]).filter(x=>x.id!==s.id))}>✕</Btn>
                      </div>
                      <div style={{color:err?"#cc0000":cnt>0?"#008000":"#808080",marginTop:2}}>
                        {err?`⚠ ${err.msg.slice(0,34)}`:jobs===undefined?"Pending…":`${jobs.length} jobs · ${cnt} matched`}
                      </div>
                    </div>
                  );
                })}
              </Grp>

              <Grp title="🔍 Keywords">
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                  <span style={{color:"#555",fontSize:10}}>Matched against job title and description</span>
                  <Btn small onClick={()=>setEditKw(!editKw)}>{editKw?"✓ Done":"✏ Edit"}</Btn>
                </div>
                <div className="inset" style={{padding:5,minHeight:48,background:"#fff",marginBottom:editKw?6:0}}>
                  <div style={{display:"flex",flexWrap:"wrap",gap:3}}>
                    {(activeTab?.keywords||[]).map((kw,i)=>(
                      <span key={i} style={{background:"#316ac5",color:"#fff",padding:"1px 7px",display:"inline-flex",alignItems:"center",gap:3,fontSize:11}}>
                        {kw}
                        {editKw&&<button onClick={()=>upTab("keywords",(activeTab.keywords||[]).filter((_,j)=>j!==i))} style={{background:"none",border:"none",color:"#ffcccc",cursor:"pointer",padding:0,fontSize:12,lineHeight:1}}>✕</button>}
                      </span>
                    ))}
                    {!(activeTab?.keywords||[]).length&&<span style={{color:"#a0a0a0",fontStyle:"italic"}}>No keywords — click Edit to add</span>}
                  </div>
                  {editKw&&<input className="inset" placeholder="Type keyword + Enter to add" style={{marginTop:6,width:"100%",padding:"2px 5px"}}
                    onKeyDown={e=>{if(e.key==="Enter"&&e.target.value.trim()){upTab("keywords",[...(activeTab.keywords||[]),e.target.value.trim()]);e.target.value="";}}}/>}
                </div>
              </Grp>

              <Grp title="📍 Location Filter">
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                  <span style={{color:"#555",fontSize:10}}>Filter results by location keywords</span>
                  <Btn small onClick={()=>setEditLocKw(!editLocKw)}>{editLocKw?"✓ Done":"✏ Edit"}</Btn>
                </div>
                <div className="inset" style={{padding:5,minHeight:36,background:"#fff",marginBottom:editLocKw?6:0}}>
                  <div style={{display:"flex",flexWrap:"wrap",gap:3}}>
                    {locationKeywords.map((kw,i)=>(
                      <span key={i} style={{background:"#3a7a3a",color:"#fff",padding:"1px 7px",display:"inline-flex",alignItems:"center",gap:3,fontSize:11}}>
                        {kw}
                        {editLocKw&&<button onClick={()=>setLocationKeywords(locationKeywords.filter((_,j)=>j!==i))} style={{background:"none",border:"none",color:"#ccffcc",cursor:"pointer",padding:0,fontSize:12,lineHeight:1}}>✕</button>}
                      </span>
                    ))}
                    {!locationKeywords.length&&<span style={{color:"#a0a0a0",fontStyle:"italic"}}>No filter — showing all locations</span>}
                  </div>
                  {editLocKw&&<div style={{position:"relative",marginTop:6}}>
                    <input className="inset" placeholder="e.g. Remote, New York + Enter" style={{width:"100%",padding:"2px 5px"}}
                      value={locInput} onChange={e=>setLocInput(e.target.value)}
                      onKeyDown={e=>{if(e.key==="Enter"&&locInput.trim()){setLocationKeywords([...locationKeywords,locInput.trim()]);setLocInput("");}
                        if(e.key==="Escape")setLocInput("");}}/>
                    {locInput.trim().length>0&&(()=>{
                      const suggestions=allLocations.filter(l=>l.toLowerCase().includes(locInput.toLowerCase())&&!locationKeywords.includes(l));
                      return suggestions.length>0&&(
                        <div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:60,background:"#fff",border:"1px solid #808080",boxShadow:"2px 2px 4px rgba(0,0,0,.2)",maxHeight:160,overflowY:"auto"}}>
                          {suggestions.slice(0,20).map(s=>(
                            <div key={s} style={{padding:"3px 8px",cursor:"pointer",fontSize:11,borderBottom:"1px solid #f0f0f0"}}
                              onMouseEnter={e=>e.currentTarget.style.background="#e8e4dc"}
                              onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                              onMouseDown={e=>{e.preventDefault();setLocationKeywords([...locationKeywords,s]);setLocInput("");}}>
                              {s}
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>}
                </div>
              </Grp>
            </div>

            {/* Right: job results */}
            <div style={{display:"flex",flexDirection:"column",overflow:"hidden"}}>

              {/* Filter bar */}
              <div style={{background:"#ece9d8",borderBottom:"1px solid #a0a0a0",padding:"3px 6px",display:"flex",alignItems:"center",gap:8,flexShrink:0,flexWrap:"wrap"}}>
                <span style={{color:"#444",marginRight:2}}>Show:</span>
                {[["all","All Matches"],["title","🏷 Title Match Only"],["desc","📄 Desc Match Only"]].map(([val,label])=>(
                  <label key={val} style={{display:"flex",alignItems:"center",gap:4,cursor:"pointer"}}>
                    <input type="radio" name="mfilter" checked={matchFilter===val} onChange={()=>setMatchFilter(val)}/>
                    {label}
                  </label>
                ))}
                <div style={{flex:1}}/>
                <span style={{color:"#555"}}>
                  {filtered.length} result{filtered.length!==1?"s":""}
                  {(matchFilter!=="all"||locationKeywords.length||companyFilter.size||locationColFilter.size)&&<span style={{color:"#808080"}}> (filtered from {matched.length})</span>}
                </span>
              </div>

              {/* Column headers with Excel-style dropdown filters */}
              <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 120px 140px 80px",background:"linear-gradient(to bottom,#f0ede4,#dedad0)",borderBottom:"1px solid #a0a0a0",flexShrink:0}}>
                <div style={{padding:"3px 8px",borderRight:"1px solid #a0a0a0",fontWeight:"bold",overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>Job Title</div>

                {/* Company dropdown filter */}
                <div className="col-dropdown" style={{padding:"3px 8px",borderRight:"1px solid #a0a0a0",fontWeight:"bold",position:"relative",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between"}}
                  onClick={()=>{setShowCompanyDd(!showCompanyDd);setShowLocationDd(false);}}>
                  <span style={{overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>Company{companyFilter.size>0?` (${companyFilter.size})`:""}</span>
                  <span style={{fontSize:8,marginLeft:4,color:companyFilter.size>0?"#316ac5":"#808080"}}>▼</span>
                  {showCompanyDd&&(
                    <div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:50,background:"#fff",border:"1px solid #808080",boxShadow:"2px 2px 4px rgba(0,0,0,.2)",maxHeight:240,overflowY:"auto",minWidth:160}}
                      onClick={e=>e.stopPropagation()}>
                      <div style={{padding:"4px 8px",borderBottom:"1px solid #e0e0e0",display:"flex",justifyContent:"space-between",alignItems:"center",background:"#f0ede4"}}>
                        <span style={{fontSize:10,color:"#555"}}>{uniqueCompanies.length} companies</span>
                        <span style={{display:"flex",gap:6}}>
                          <button onClick={()=>setCompanyFilter(new Set())} style={{background:"none",border:"none",color:"#316ac5",cursor:"pointer",fontSize:10,textDecoration:"underline"}}>All</button>
                          <button onClick={()=>setCompanyFilter(new Set(["__none__"]))} style={{background:"none",border:"none",color:"#316ac5",cursor:"pointer",fontSize:10,textDecoration:"underline"}}>None</button>
                        </span>
                      </div>
                      {uniqueCompanies.map(c=>(
                        <label key={c} style={{display:"flex",alignItems:"center",gap:5,padding:"3px 8px",cursor:"pointer",fontSize:11,borderBottom:"1px solid #f0f0f0"}}
                          onMouseEnter={e=>e.currentTarget.style.background="#e8e4dc"}
                          onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                          <input type="checkbox" checked={companyFilter.size===0||companyFilter.has(c)}
                            onChange={e=>{
                              const next=new Set(companyFilter);
                              next.delete("__none__");
                              if(companyFilter.size===0||(companyFilter.size===1&&companyFilter.has("__none__"))){uniqueCompanies.forEach(x=>next.add(x));next.delete(c);}
                              else if(e.target.checked){next.add(c);if(next.size===uniqueCompanies.length)setCompanyFilter(new Set());else setCompanyFilter(next);return;}
                              else{next.delete(c);if(next.size===0)next.add("__none__");}
                              setCompanyFilter(next);
                            }}/>
                          {c}
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {/* Location dropdown filter */}
                <div className="col-dropdown" style={{padding:"3px 8px",borderRight:"1px solid #a0a0a0",fontWeight:"bold",position:"relative",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between"}}
                  onClick={()=>{setShowLocationDd(!showLocationDd);setShowCompanyDd(false);}}>
                  <span style={{overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>Location{locationColFilter.size>0?` (${locationColFilter.size})`:""}</span>
                  <span style={{fontSize:8,marginLeft:4,color:locationColFilter.size>0?"#316ac5":"#808080"}}>▼</span>
                  {showLocationDd&&(
                    <div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:50,background:"#fff",border:"1px solid #808080",boxShadow:"2px 2px 4px rgba(0,0,0,.2)",maxHeight:240,overflowY:"auto",minWidth:160}}
                      onClick={e=>e.stopPropagation()}>
                      <div style={{padding:"4px 8px",borderBottom:"1px solid #e0e0e0",display:"flex",justifyContent:"space-between",alignItems:"center",background:"#f0ede4"}}>
                        <span style={{fontSize:10,color:"#555"}}>{uniqueLocations.length} locations</span>
                        <span style={{display:"flex",gap:6}}>
                          <button onClick={()=>setLocationColFilter(new Set())} style={{background:"none",border:"none",color:"#316ac5",cursor:"pointer",fontSize:10,textDecoration:"underline"}}>All</button>
                          <button onClick={()=>setLocationColFilter(new Set(["__none__"]))} style={{background:"none",border:"none",color:"#316ac5",cursor:"pointer",fontSize:10,textDecoration:"underline"}}>None</button>
                        </span>
                      </div>
                      {uniqueLocations.map(loc=>(
                        <label key={loc||"(blank)"} style={{display:"flex",alignItems:"center",gap:5,padding:"3px 8px",cursor:"pointer",fontSize:11,borderBottom:"1px solid #f0f0f0"}}
                          onMouseEnter={e=>e.currentTarget.style.background="#e8e4dc"}
                          onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                          <input type="checkbox" checked={locationColFilter.size===0||locationColFilter.has(loc)}
                            onChange={e=>{
                              const next=new Set(locationColFilter);
                              next.delete("__none__");
                              if(locationColFilter.size===0||(locationColFilter.size===1&&locationColFilter.has("__none__"))){uniqueLocations.forEach(x=>next.add(x));next.delete(loc);}
                              else if(e.target.checked){next.add(loc);if(next.size===uniqueLocations.length)setLocationColFilter(new Set());else setLocationColFilter(next);return;}
                              else{next.delete(loc);if(next.size===0)next.add("__none__");}
                              setLocationColFilter(next);
                            }}/>
                          {loc||"(blank)"}
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{padding:"3px 8px",borderRight:"1px solid #a0a0a0",fontWeight:"bold",overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between"}}
                  onClick={()=>setPaySort(paySort===""?"desc":paySort==="desc"?"asc":"")}>
                  <span>Pay Range</span>
                  <span style={{fontSize:8,marginLeft:4,color:paySort?"#316ac5":"#808080"}}>{paySort==="asc"?"▲":paySort==="desc"?"▼":"▼"}</span>
                </div>
                <div style={{padding:"3px 8px",borderRight:"1px solid #a0a0a0",fontWeight:"bold",overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>Match Type</div>
                <div style={{padding:"3px 8px",fontWeight:"bold",overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>Age</div>
              </div>

              {/* Scrollable rows */}
              <div style={{flex:1,overflowY:"auto",overflowX:"hidden"}}>
                {(activeTab?.sources||[]).length===0?(
                  <div style={{padding:40,textAlign:"center",color:"#808080"}}><div style={{fontSize:48,marginBottom:10}}>🏢</div>Add companies to start monitoring jobs.</div>
                ):filtered.length===0?(
                  <div style={{padding:40,textAlign:"center",color:"#808080"}}><div style={{fontSize:48,marginBottom:10}}>{poll.running?"⏳":"🔍"}</div>{poll.running?"Fetching jobs…":matched.length>0?"No jobs match the current filters. Try clearing location keywords, column filters, or changing the match type.":"No matches found. Try broader keywords or click Refresh."}</div>
                ):paginated.map((job,i)=>{
                  const pay=extractPay(job);
                  return (
                  <div key={job.id} style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 120px 140px 80px",borderBottom:"1px solid #e8e4dc",background:i%2===0?"#fff":"#f4f2ec",cursor:"default"}}
                    onMouseEnter={e=>e.currentTarget.style.background="#316ac5"}
                    onMouseLeave={e=>e.currentTarget.style.background=i%2===0?"#fff":"#f4f2ec"}>
                    <div style={{padding:"4px 8px",borderRight:"1px solid #e0dcd4",overflow:"hidden"}}>
                      <div style={{fontWeight:"bold",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{job.title}</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:2,marginTop:2}}>
                        {job.titleMatches.map(k=><span key={k} style={{background:"#316ac5",color:"#fff",padding:"0 5px",fontSize:10}}>🏷 {k}</span>)}
                        {job.descMatches.map(k=><span key={k} style={{background:"#808080",color:"#fff",padding:"0 5px",fontSize:10}}>📄 {k}</span>)}
                      </div>
                    </div>
                    <div style={{padding:"4px 8px",borderRight:"1px solid #e0dcd4",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{job.company}</div>
                    <div style={{padding:"4px 8px",borderRight:"1px solid #e0dcd4",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",color:"#555"}}>{job.location}</div>
                    <div style={{padding:"4px 8px",borderRight:"1px solid #e0dcd4",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",color:pay?"#008000":"#c0c0c0",fontSize:pay?11:10}}>{pay||"—"}</div>
                    <div style={{padding:"4px 8px",borderRight:"1px solid #e0dcd4",overflow:"hidden"}}>
                      {job.titleMatches.length>0&&<span style={{background:"#ddeeff",border:"1px solid #316ac5",color:"#316ac5",padding:"0 5px",fontSize:10,fontWeight:"bold",marginRight:3}}>TITLE</span>}
                      {job.descMatches.length>0&&<span style={{background:"#eee",border:"1px solid #808080",color:"#555",padding:"0 5px",fontSize:10}}>DESC</span>}
                      {job.url&&<a href={job.url} target="_blank" rel="noopener noreferrer" style={{marginLeft:4,fontSize:10}}>Open →</a>}
                    </div>
                    <div style={{padding:"4px 8px",color:"#808080",whiteSpace:"nowrap"}}>{ago(job.postedAt)}</div>
                  </div>
                  );
                })}
              </div>

              {/* Pagination footer */}
              {filtered.length > PAGE_SIZE && (
                <div style={{borderTop:"1px solid #a0a0a0",background:"#ece9d8",padding:"3px 8px",display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
                  <Btn small onClick={()=>setPage(0)} disabled={safePage===0}>⏮ First</Btn>
                  <Btn small onClick={()=>setPage(p=>Math.max(0,p-1))} disabled={safePage===0}>◀ Prev</Btn>
                  <span style={{margin:"0 6px"}}>
                    Page <b>{safePage+1}</b> of <b>{totalPages}</b>
                    &nbsp;·&nbsp;
                    Showing {safePage*PAGE_SIZE+1}–{Math.min((safePage+1)*PAGE_SIZE, filtered.length)} of {filtered.length}
                  </span>
                  <Btn small onClick={()=>setPage(p=>Math.min(totalPages-1,p+1))} disabled={safePage>=totalPages-1}>Next ▶</Btn>
                  <Btn small onClick={()=>setPage(totalPages-1)} disabled={safePage>=totalPages-1}>Last ⏭</Btn>
                </div>
              )}

            </div>
          </div>
        )}

        {/* ═══ HISTORY ═══ */}
        {view==="history"&&(
          <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",padding:8,background:"#ece9d8"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <span><b>Alert History</b> — {(state.alertHistory||[]).length} total · localStorage · {lsKB}</span>
              {(state.alertHistory||[]).length>0&&<Btn danger onClick={()=>save({...state,alertHistory:[]})}>🗑 Clear All</Btn>}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"120px 2fr 1fr 1fr 100px",background:"linear-gradient(to bottom,#f0ede4,#dedad0)",borderBottom:"1px solid #a0a0a0",flexShrink:0}}>
              {["Category","Job Title","Company","Keywords","Time"].map((h,i)=>(
                <div key={h} style={{padding:"3px 8px",borderRight:i<4?"1px solid #a0a0a0":"none",fontWeight:"bold"}}>{h}</div>
              ))}
            </div>
            <div style={{flex:1,overflowY:"auto"}}>
              {(state.alertHistory||[]).length===0?(
                <div style={{padding:40,textAlign:"center",color:"#808080"}}><div style={{fontSize:48,marginBottom:10}}>📭</div>No alerts yet. They'll appear here when new matching jobs are found.</div>
              ):(state.alertHistory||[]).map((a,i)=>(
                <div key={a.id} style={{display:"grid",gridTemplateColumns:"120px 2fr 1fr 1fr 100px",borderBottom:"1px solid #e8e4dc",background:i%2===0?"#fff":"#f4f2ec"}}
                  onMouseEnter={e=>e.currentTarget.style.background="#316ac5"}
                  onMouseLeave={e=>e.currentTarget.style.background=i%2===0?"#fff":"#f4f2ec"}>
                  <div style={{padding:"4px 8px",borderRight:"1px solid #e0dcd4"}}>
                    <span style={{background:"#316ac5",color:"#fff",padding:"0 6px",fontSize:10,fontWeight:"bold"}}>{a.tabName}</span>
                    <div style={{marginTop:2}}>
                      {(a.titleMatches||[]).length>0&&<span style={{background:"#ddeeff",border:"1px solid #316ac5",color:"#316ac5",padding:"0 4px",fontSize:9,fontWeight:"bold"}}>TITLE</span>}
                      {(a.descMatches||[]).length>0&&<span style={{background:"#eee",border:"1px solid #808080",color:"#555",padding:"0 4px",fontSize:9,marginLeft:2}}>DESC</span>}
                    </div>
                  </div>
                  <div style={{padding:"4px 8px",borderRight:"1px solid #e0dcd4",overflow:"hidden"}}>
                    <b style={{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",display:"block"}}>{a.jobTitle}</b>
                    {a.url&&<a href={a.url} target="_blank" rel="noopener noreferrer" style={{fontSize:10}}>Open →</a>}
                  </div>
                  <div style={{padding:"4px 8px",borderRight:"1px solid #e0dcd4",color:"#555"}}>{a.company}</div>
                  <div style={{padding:"4px 8px",borderRight:"1px solid #e0dcd4",overflow:"hidden"}}>
                    <div style={{display:"flex",flexWrap:"wrap",gap:2}}>
                      {[...(a.titleMatches||[]),...(a.descMatches||[])].map(k=><span key={k} style={{background:"#e8e4dc",border:"1px solid #c0bab0",padding:"0 4px",fontSize:10}}>{k}</span>)}
                    </div>
                  </div>
                  <div style={{padding:"4px 8px",color:"#808080"}}>{ago(a.alertedAt)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══ SETTINGS ═══ */}
        {view==="settings"&&(
          <div style={{flex:1,overflowY:"auto",padding:12,background:"#ece9d8"}}>
            <div style={{maxWidth:560}}>

              <Grp title="⏱ Poll Interval">
                <div style={{display:"flex",gap:16,marginBottom:6}}>
                  {[15,30,60,120].map(m=>(
                    <label key={m} style={{display:"flex",alignItems:"center",gap:5,cursor:"pointer"}}>
                      <input type="radio" name="interval" checked={state.pollIntervalMinutes===m} onChange={()=>save({...state,pollIntervalMinutes:m})}/>
                      {m<60?`${m} minutes`:`${m/60} hour`}
                    </label>
                  ))}
                </div>
                <p style={{color:"#808080"}}>⚠ Tab must stay open. Right-click tab → "Pin Tab" to keep it running.</p>
              </Grp>

              <Grp title="🔔 Browser Notifications (free, no setup)">
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                  <span>Status: <b style={{color:perm==="granted"?"#008000":"#cc0000"}}>{perm==="granted"?"✅ Enabled":"⭕ Not enabled"}</b></span>
                  {perm!=="granted"&&<Btn primary onClick={async()=>setPerm(await Notification.requestPermission())}>Enable Now</Btn>}
                </div>
                <p style={{color:"#808080"}}>Instant desktop popups when new matches are found, even if tab is backgrounded.</p>
              </Grp>

              <Grp title="📧 Email via EmailJS (free · 200/month)">
                <label style={{display:"flex",alignItems:"center",gap:5,marginBottom:8,cursor:"pointer"}}>
                  <input type="checkbox" checked={state.notifications.emailEnabled} onChange={e=>upNotif({emailEnabled:e.target.checked})}/>
                  Enable email alerts
                </label>
                <div style={{background:"#fffce0",border:"1px solid #c8b800",padding:"6px 8px",marginBottom:8,lineHeight:1.6}}>
                  <b>Setup:</b> emailjs.com → account → Add Email Service → Create Template with <code>to_email</code>, <code>subject</code>, <code>message</code> → paste IDs below.
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  <label>Recipient Email<br/><Inp value={state.notifications.email} onChange={e=>upNotif({email:e.target.value})} type="email" placeholder="you@email.com"/></label>
                  <label>Public Key<br/><Inp value={state.notifications.emailjsPublicKey} onChange={e=>upNotif({emailjsPublicKey:e.target.value})} placeholder="user_xxxxxxxxxxxx"/></label>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                    <label>Service ID<br/><Inp value={state.notifications.emailjsServiceId} onChange={e=>upNotif({emailjsServiceId:e.target.value})} placeholder="service_xxxxxxx"/></label>
                    <label>Template ID<br/><Inp value={state.notifications.emailjsTemplateId} onChange={e=>upNotif({emailjsTemplateId:e.target.value})} placeholder="template_xxxxxxx"/></label>
                  </div>
                </div>
              </Grp>

              <Grp title="📱 SMS via Textbelt ($0.01/text)">
                <label style={{display:"flex",alignItems:"center",gap:5,marginBottom:8,cursor:"pointer"}}>
                  <input type="checkbox" checked={state.notifications.smsEnabled} onChange={e=>upNotif({smsEnabled:e.target.checked})}/>
                  Enable SMS alerts
                </label>
                <div style={{background:"#fffce0",border:"1px solid #c8b800",padding:"6px 8px",marginBottom:8,lineHeight:1.6}}>
                  <b>No signup needed:</b> use key <code>"textbelt"</code> for 1 free SMS/day. Buy credits at textbelt.com (~$10 = 1,000 texts).
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  <label>Phone Number (E.164 format)<br/><Inp value={state.notifications.phone} onChange={e=>upNotif({phone:e.target.value})} type="tel" placeholder="+15551234567"/></label>
                  <label>Textbelt API Key<br/><Inp value={state.notifications.textbeltKey} onChange={e=>upNotif({textbeltKey:e.target.value})} placeholder="textbelt"/></label>
                </div>
              </Grp>

              <Grp title="💾 Data & Storage">
                <p style={{marginBottom:8}}>Stored in <b>localStorage</b> · {lsKB} used · persists until you clear browser data.</p>
                <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                  <Btn primary onClick={doTest} disabled={testSt==="sending"}>{testSt==="sending"?"Sending…":"🔔 Send Test Alert"}</Btn>
                  <Btn danger onClick={()=>{if(window.confirm("Clear ALL JobPulse data? Cannot be undone.")){localStorage.removeItem(SK);setState(DEFAULT);setTabId(DEFAULT.tabs[0].id);}}}>🗑 Clear All Data</Btn>
                  {testSt&&testSt!=="sending"&&<span style={{color:testSt==="sent"?"#008000":"#cc0000"}}>{testSt==="sent"?"✅ Sent!":"⚠ "+testSt}</span>}
                </div>
              </Grp>

            </div>
          </div>
        )}
      </div>

      {/* ── Status bar ── */}
      <div style={{background:"#ece9d8",borderTop:"1px solid #a0a0a0",padding:"2px 4px",display:"flex",gap:6,flexShrink:0}}>
        <div style={{border:"1px solid",borderColor:"#808080 #e8e8e8 #e8e8e8 #808080",padding:"1px 8px",flex:1}}>
          {poll.running?"🔄 Fetching jobs from all sources…":poll.last?`✅ Last polled: ${ago(poll.last)}`:"Ready — add companies and click Refresh Now"}
        </div>
        <div style={{border:"1px solid",borderColor:"#808080 #e8e8e8 #e8e8e8 #808080",padding:"1px 8px"}}>{(activeTab?.sources||[]).length} source{(activeTab?.sources||[]).length!==1?"s":""}</div>
        <div style={{border:"1px solid",borderColor:"#808080 #e8e8e8 #e8e8e8 #808080",padding:"1px 8px"}}>{matched.length} match{matched.length!==1?"es":""}{(matchFilter!=="all"||locationKeywords.length||companyFilter.size||locationColFilter.size)?` · ${filtered.length} shown`:""}</div>
        <div style={{border:"1px solid",borderColor:"#808080 #e8e8e8 #e8e8e8 #808080",padding:"1px 8px"}}>💾 {lsKB}</div>
        <div style={{border:"1px solid",borderColor:"#808080 #e8e8e8 #e8e8e8 #808080",padding:"1px 8px"}}>{perm==="granted"?"🔔 Notifications on":"🔕 Notifications off"}</div>
      </div>

      {/* ── Add Source dialog ── */}
      {addSrc&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.35)",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#ece9d8",border:"3px solid",borderColor:"#0a246a #808080 #808080 #0a246a",width:480}}>
            <div style={{background:"linear-gradient(to right,#0a246a,#a6caf0)",padding:"4px 6px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <span style={{color:"#fff",fontWeight:"bold",fontSize:12}}>📡 Add Company to "{activeTab?.name}"</span>
              <button onClick={()=>{setAddSrc(false);resetSrcDialog();}} style={{width:21,height:21,background:"linear-gradient(to bottom,#e0e8f8,#7090b8)",border:"1px solid",borderColor:"#fff #404060 #404060 #fff",cursor:"pointer",fontWeight:"bold",fontSize:10}}>✕</button>
            </div>
            <div style={{padding:16,display:"flex",flexDirection:"column",gap:10}}>

              <label>
                <b>Paste the careers URL or type the company name:</b>
                <div style={{display:"flex",gap:6,marginTop:4}}>
                  <Inp value={newSrc.input} onChange={e=>setNewSrc(s=>({...s,input:e.target.value,detected:null,error:null}))} placeholder="e.g. jobs.lever.co/netflix  or  anthropic" style={{flex:1}}/>
                  <Btn primary onClick={detectSrc} disabled={!newSrc.input.trim()||newSrc.detecting}>{newSrc.detecting?"…":"Detect"}</Btn>
                </div>
                <div style={{color:"#808080",marginTop:4}}>Auto-detects: Greenhouse · Lever · Ashby · SmartRecruiters · Recruitee · Workable · Custom (Netflix…)</div>
              </label>

              {newSrc.detecting&&(
                <div style={{background:"#fffce0",border:"1px solid #c8b800",padding:"6px 10px",display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:80,height:12,border:"1px solid",borderColor:"#808080 #e0e0e0 #e0e0e0 #808080",overflow:"hidden",background:"#fff",position:"relative",flexShrink:0}}>
                    <div style={{position:"absolute",width:"40%",height:"100%",background:"linear-gradient(to right,#1a6fd8,#5ab4f8)",animation:"xpBar 1.2s infinite linear"}}/>
                  </div>
                  Checking all 6 platforms simultaneously…
                </div>
              )}

              {newSrc.error&&(
                <div style={{background:"#fff0f0",border:"1px solid #cc0000",padding:"8px 10px",color:"#555",lineHeight:1.6}}>
                  <b style={{color:"#cc0000"}}>⚠ Not found on any supported platform.</b><br/>
                  This company likely uses Workday or iCIMS, which require credentials and have no public API. Supported custom boards: Netflix (jobs.netflix.com). Try setting up a job alert directly on their careers page or on LinkedIn.
                </div>
              )}

              {newSrc.detected&&(
                <div style={{background:"#f0fff0",border:"1px solid #008000",padding:"8px 10px"}}>
                  <div style={{color:"#008000",fontWeight:"bold",marginBottom:6}}>✅ Found on {newSrc.detected.atsType}!</div>
                  <div style={{marginBottom:8,color:"#555"}}>Slug: <b>{newSrc.detected.slug}</b></div>
                  <label>Display name (optional):<br/>
                    <Inp value={newSrc.label} onChange={e=>setNewSrc(s=>({...s,label:e.target.value}))} placeholder={newSrc.detected.slug}/>
                  </label>
                </div>
              )}

              <div style={{display:"flex",justifyContent:"center",gap:8,marginTop:4}}>
                <Btn onClick={()=>{setAddSrc(false);resetSrcDialog();}}>Cancel</Btn>
                <Btn primary onClick={doAddSrc} disabled={!newSrc.detected}>Add Company</Btn>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* ── Add Tab dialog ── */}
      {addTab&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.35)",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#ece9d8",border:"3px solid",borderColor:"#0a246a #808080 #808080 #0a246a",width:360}}>
            <div style={{background:"linear-gradient(to right,#0a246a,#a6caf0)",padding:"4px 6px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <span style={{color:"#fff",fontWeight:"bold",fontSize:12}}>📁 New Alert Category</span>
              <button onClick={()=>setAddTab(false)} style={{width:21,height:21,background:"linear-gradient(to bottom,#e0e8f8,#7090b8)",border:"1px solid",borderColor:"#fff #404060 #404060 #fff",cursor:"pointer",fontWeight:"bold",fontSize:10}}>✕</button>
            </div>
            <div style={{padding:16,display:"flex",flexDirection:"column",gap:10}}>
              <label>Category Name<br/>
                <Inp value={newTab.name} onChange={e=>setNewTab({name:e.target.value})} placeholder="e.g. Product Marketing, Finance…"/>
              </label>
              <div style={{display:"flex",justifyContent:"center",gap:8}}>
                <Btn onClick={()=>setAddTab(false)}>Cancel</Btn>
                <Btn primary onClick={doAddTab} disabled={!newTab.name}>OK</Btn>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
