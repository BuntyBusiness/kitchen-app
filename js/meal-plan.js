// Meal planner (Phase 4, chats 1 and 2a): one file per week in kitchen-data, Recipes | Plan switch,
// week bar, day buttons, four slots, add a recipe item or a food item, remove, change servings.
// Week files are saved the safe way: fetch a fresh copy, change only the one item, save, retry if the file changed.

const PLAN_SLOTS = [
  {key:'breakfast', label:'Breakfast'},
  {key:'lunch',     label:'Lunch'},
  {key:'dinner',    label:'Dinner'},
  {key:'snacks',    label:'Snacks'},
];
const PLAN_DEFAULT_SERVINGS = 2;   // 2 people; leftovers default to 2 as well (agreed 1 Nov)
const PLAN_DAY_SHORT = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const PLAN_DAY_LONG  = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

let planView = 'recipes';      // 'recipes' | 'plan'
let planMode = 'day';          // 'day' (one day) | 'week' (the seven days as a list)
let planWeekStart = '';        // Monday of the week on screen, YYYY-MM-DD
let planDay = '';              // the day on screen, YYYY-MM-DD
let planData = null;           // the week file as loaded (changed on screen straight away, saved a moment later)
let planStatus = 'idle';       // 'idle' | 'loading' | 'ready' | 'error'
let planError = '';
let planLoadToken = 0;         // so a slow answer for an old week is ignored
let planPending = 0;           // saves waiting or running
let planQueue = Promise.resolve();
const planTimers = {};         // item id -> {t, fn}: servings changes wait 0.8 s so quick taps make one save
let planNames = [];            // food-name suggestions, built from recipe ingredient names

// ── Dates (plain text arithmetic in UTC, so time zones and summer time cannot shift a day) ──
function planParse(s){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s);return Date.UTC(+m[1],+m[2]-1,+m[3]);}
function planFmt(ms){const d=new Date(ms),p=n=>String(n).padStart(2,'0');return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())}`;}
function planAddDays(s,n){return planFmt(planParse(s)+n*86400000);}
function planDow(s){return (new Date(planParse(s)).getUTCDay()+6)%7;}          // Monday = 0
function planMonday(s){return planAddDays(s,-planDow(s));}
function planWeekLabel(ws){
  const a=new Date(planParse(ws)), b=new Date(planParse(planAddDays(ws,6)));
  const ad=a.getUTCDate(), bd=b.getUTCDate(), am=MONTHS[a.getUTCMonth()], bm=MONTHS[b.getUTCMonth()];
  const ay=a.getUTCFullYear(), by=b.getUTCFullYear();
  const yr=(y)=>y===new Date().getFullYear()?'':' '+y;   // the year is shown only when it is not this year
  if(ay!==by) return `${ad} ${am} ${ay} – ${bd} ${bm} ${by}`;
  if(am!==bm) return `${ad} ${am} – ${bd} ${bm}${yr(by)}`;
  return `${ad} – ${bd} ${bm}${yr(by)}`;
}
function planDayLabel(s){
  const d=new Date(planParse(s));
  return `${PLAN_DAY_LONG[planDow(s)]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

// ── Reading and saving the week file (data/meal-plans/<Monday>.json) ──
function planPath(ws){return `data/meal-plans/${ws}.json`;}
function planUrl(ws){return `https://api.github.com/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/contents/${planPath(ws)}`;}
function planEmptyWeek(ws){return {weekStart:ws,days:{},version:1};}

async function planGetFile(ws){
  const token=localStorage.getItem('gh_pat_token');
  if(!token) throw new Error('NO_TOKEN');
  const res=await fetch(`${planUrl(ws)}?ref=${GITHUB_CONFIG.branch}&_=${Date.now()}`,
    {cache:'no-store',headers:{'Authorization':`token ${token}`,'Accept':'application/vnd.github.v3+json'}});
  if(res.status===404) return {data:planEmptyWeek(ws),sha:null};     // nothing planned that week yet
  if(!res.ok) throw new Error(`GitHub GET failed: ${res.status}`);
  const meta=await res.json();
  const bytes=Uint8Array.from(atob(meta.content.replace(/\n/g,'')),c=>c.charCodeAt(0));
  const data=JSON.parse(new TextDecoder('utf-8').decode(bytes));
  if(!data.days||typeof data.days!=='object') data.days={};
  data.weekStart=ws; if(!data.version) data.version=1;
  return {data,sha:meta.sha};
}
async function planPutFile(ws,data,sha){
  const token=localStorage.getItem('gh_pat_token');
  const b64=btoa(unescape(encodeURIComponent(JSON.stringify(data,null,2))));
  const body={message:'Update meal plan via The Kitchen app',content:b64,branch:GITHUB_CONFIG.branch};
  if(sha) body.sha=sha;
  const res=await fetch(planUrl(ws),{method:'PUT',headers:{'Authorization':`token ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!res.ok){const e=await res.json().catch(()=>({}));throw new Error(e.message||`GitHub PUT failed: ${res.status}`);}
}
// Gets the latest week file, lets applyChange change it, saves. applyChange returns false when there is nothing to save.
// If GitHub says the file changed meanwhile (or two people created it at once), it fetches again and retries (up to 4 times).
async function planUpdateWithRetry(ws,applyChange){
  let lastErr;
  for(let attempt=1;attempt<=4;attempt++){
    try{
      const {data,sha}=await planGetFile(ws);
      if(applyChange(data)===false) return data;
      await planPutFile(ws,data,sha);
      return data;
    }catch(e){
      lastErr=e;
      const isMismatch=/does not match|409|422|sha/i.test(String(e.message||''));
      if(!isMismatch||attempt===4) throw e;
      await new Promise(r=>setTimeout(r,600*attempt));
    }
  }
  throw lastErr;
}
// All saves go through one line, one after another, so two quick changes never race each other.
function planSave(ws,applyChange){
  planPending++;
  planQueue=planQueue.then(async()=>{
    try{
      const saved=await planUpdateWithRetry(ws,applyChange);
      planPending--;
      // Once everything is saved, show the file as GitHub now has it (this also picks up the other person's changes)
      if(planPending===0&&!Object.keys(planTimers).length&&ws===planWeekStart&&planView==='plan'){planData=saved;planRender();}
      showToast('Plan saved');
    }catch(e){
      planPending--;
      console.error('Plan save failed:',e);
      showToast('Could not save the plan');
      planLoad({silent:true});
    }
  });
  return planQueue;
}

// ── Week data helpers ──
function planDayOf(wk,date){
  if(!wk.days[date]) wk.days[date]={};
  const d=wk.days[date];
  PLAN_SLOTS.forEach(s=>{if(!Array.isArray(d[s.key])) d[s.key]=[];});
  return d;
}
function planFindIn(wk,id){
  for(const date in wk.days){
    const d=wk.days[date];
    for(const s of PLAN_SLOTS){
      const list=d[s.key]||[];
      const i=list.findIndex(x=>x.id===id);
      if(i!==-1) return {item:list[i],list,index:i,date,slot:s.key};
    }
  }
  return null;
}
function planDayHasItems(date){
  const d=planData&&planData.days[date];
  return !!d&&PLAN_SLOTS.some(s=>(d[s.key]||[]).length);
}
function planNewId(){
  let id;
  do{ id='i-'+Math.random().toString(36).slice(2,7); }while(planData&&planFindIn(planData,id));
  return id;
}
function planRecipeOf(item){return recipes.find(r=>String(r.id)===String(item.recipeId));}

// ── Loading, switching view, moving between weeks ──
async function planLoad(opts){
  const silent=opts&&opts.silent;
  const token=++planLoadToken, ws=planWeekStart;
  planFlushTimers();
  if(!silent||!planData||planData.weekStart!==ws){planStatus='loading';planRender();}
  await planQueue;                                   // let waiting saves finish first, so they are not lost
  if(token!==planLoadToken) return;
  try{
    const {data}=await planGetFile(ws);
    if(token!==planLoadToken) return;
    planData=data; planStatus='ready';
  }catch(e){
    if(token!==planLoadToken) return;
    if(silent&&planData&&planData.weekStart===ws){          // a background refresh failed: keep what is on screen
      planStatus='ready'; showToast('Could not refresh the plan'); return;
    }
    planStatus='error';
    planError=e.message==='NO_TOKEN'?'Tap 🔑 at the top to enter your token.':`Could not load the plan (${e.message}).`;
  }
  planRender();
}
function planFlushTimers(){
  Object.keys(planTimers).forEach(id=>{const t=planTimers[id];clearTimeout(t.t);t.fn();});
}
function setAppView(v){
  planView=v;
  document.getElementById('app').style.display=v==='recipes'?'':'none';
  document.getElementById('planApp').style.display=v==='plan'?'':'none';
  document.getElementById('bnRecipes').classList.toggle('active',v==='recipes');
  document.getElementById('bnPlan').classList.toggle('active',v==='plan');
  window.scrollTo(0,0);
  if(v==='plan'){
    if(!planWeekStart){planDay=todayStr();planWeekStart=planMonday(planDay);}
    planLoad();
  }
}
function planShiftWeek(n){
  planFlushTimers();
  planDay=planAddDays(planDay,7*n); planWeekStart=planMonday(planDay); planData=null;
  planLoad();
}
function planGoToday(){
  const t=todayStr(), ws=planMonday(t);
  planDay=t; planMode='day';
  if(ws!==planWeekStart){planFlushTimers();planWeekStart=ws;planData=null;planLoad();}
  else planRender();
}
function planPickDay(date){planDay=date;planMode='day';planRender();}
function planShowWeek(){planMode='week';planRender();}
function planRefresh(){planLoad({silent:true}).then(()=>{if(planStatus==='ready')showToast('Plan refreshed');});}
// Coming back to the app (for example from the home screen) refreshes the plan if it is on screen
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden&&planView==='plan'&&planPending===0&&!Object.keys(planTimers).length) planLoad({silent:true});
});

// ── Drawing the day view ──
function planAmount(it){
  const q=(it.quantity===null||it.quantity===undefined||it.quantity==='')?null:parseQty(it.quantity);
  if(q===null) return '';
  return formatQty(q)+(it.unit&&it.unit!=='piece'?' '+it.unit:'');   // a count shows as just "2", not "2 piece"
}
function planEachList(wk,fn){
  for(const date in wk.days){
    const d=wk.days[date];
    PLAN_SLOTS.forEach(s=>{if(Array.isArray(d[s.key])) fn(d[s.key],date,s.key);});
  }
}
// The leftover copies of a recipe item
function planLeftoversOf(id){
  const out=[];
  if(planData) planEachList(planData,(l,date,slot)=>l.forEach(x=>{if(x.leftoverOf===id) out.push({item:x,date,slot});}));
  return out;
}
// An item plus everything that hangs off it (its pairings and its leftover copies, and theirs)
function planLinkedIds(wk,id){
  const ids=new Set([id]); let grew=true;
  while(grew){
    grew=false;
    planEachList(wk,l=>l.forEach(x=>{
      if(!ids.has(x.id)&&((x.withItem&&ids.has(x.withItem))||(x.leftoverOf&&ids.has(x.leftoverOf)))){ids.add(x.id);grew=true;}
    }));
  }
  return ids;
}
function planWhen(date,slot){return `${PLAN_DAY_SHORT[planDow(date)]} ${planSlotLabel(slot).toLowerCase()}`;}

function planItemHTML(it){
  if(it.type==='recipe'){
    const r=planRecipeOf(it), n=parseInt(it.servings)||PLAN_DEFAULT_SERVINGS;
    if(!r) return `<div class="pl-item">
      <div class="pl-main"><div class="pl-name pl-gone">${recipes.length?'Recipe no longer exists':'Loading recipes…'}</div></div>
      <button class="pl-more" onclick="planOpenAct('${it.id}')" aria-label="Item options">⋯</button></div>`;
    const isLeft=!!it.leftoverOf;
    let sub='';
    if(isLeft){
      const o=planData&&planFindIn(planData,it.leftoverOf);
      sub=o?`Leftover from ${planWhen(o.date,o.slot)}`:'Leftover';
    }else{
      const lefts=planLeftoversOf(it.id);
      if(lefts.length){
        const total=n+lefts.reduce((a,l)=>a+(parseInt(l.item.servings)||0),0);
        sub=`Cooking ${total} · leftovers: ${lefts.map(l=>`${parseInt(l.item.servings)||0} for ${planWhen(l.date,l.slot)}`).join(', ')}`;
      }
    }
    return `<div class="pl-item${isLeft?' pl-left':''}">
      <div class="pl-main" onclick="planOpenRecipe('${it.id}')"><div class="pl-name">${esc(r.name)}</div>
        ${sub?`<div class="pl-sub">${esc(sub)}</div>`:''}
        <button class="pl-side-link" onclick="event.stopPropagation();planAddSide('${it.id}')">＋ Add a side or pairing</button></div>
      <div class="pl-step"><div class="pl-step-row">
        <button class="pl-step-btn" onclick="planChangeServings('${it.id}',-1)" ${n<=1?'disabled':''} aria-label="Fewer servings">−</button>
        <span class="pl-step-val">${n}</span>
        <button class="pl-step-btn" onclick="planChangeServings('${it.id}',1)" ${n>=99?'disabled':''} aria-label="More servings">+</button>
      </div><div class="pl-step-cap">servings</div></div>
      <button class="pl-more" onclick="planOpenAct('${it.id}')" aria-label="Item options">⋯</button></div>`;
  }
  // food item
  const amount=planAmount(it);
  return `<div class="pl-item">
    <div class="pl-main"><div class="pl-name">${esc(it.name||'')}</div>${amount?`<div class="pl-sub">${esc(amount)}</div>`:''}</div>
    <button class="pl-more" onclick="planOpenAct('${it.id}')" aria-label="Item options">⋯</button></div>`;
}
// A pairing: a food shown under its main recipe as "with Brown Rice · 300 g"
function planPairHTML(it){
  const amount=planAmount(it);
  return `<div class="pl-pair"><div class="pl-pair-txt"><span class="pl-pair-with">with</span> <span class="pl-pair-name">${esc(it.name||'')}</span>${amount?` <span class="pl-pair-amt">· ${esc(amount)}</span>`:''}</div>
    <button class="pl-more pl-more-sm" onclick="planOpenAct('${it.id}')" aria-label="Item options">⋯</button></div>`;
}
// Splits a slot's list into main items, each followed by the items shown "with" it
function planGroups(list){
  const ids=new Set(list.map(x=>x.id));
  const isPair=x=>x.withItem&&ids.has(x.withItem);
  return list.filter(x=>!isPair(x)).map(m=>({main:m,pairs:list.filter(x=>x.withItem===m.id)}));
}
function planSlotHTML(s,day){
  const list=(day&&day[s.key])||[];
  if(s.key==='snacks'&&!list.length)
    return `<button class="pl-snack-empty" onclick="openPlanAdd('snacks')">＋ Add snack</button>`;
  return `<div class="pl-slot">
    <div class="pl-slot-hdr"><span class="pl-slot-name">${s.label}</span>
      <button class="pl-add" onclick="openPlanAdd('${s.key}')" aria-label="Add to ${s.label}">＋</button></div>
    ${list.length?planGroups(list).map(g=>planItemHTML(g.main)+g.pairs.map(planPairHTML).join('')).join(''):'<div class="pl-empty">Nothing planned</div>'}
  </div>`;
}
// Week mode: the seven days as a short list (tap a day to open it). The Mac week grid replaces this in the next chat.
function planBrief(list){
  return planGroups(list).map(g=>{
    const it=g.main;
    let t;
    if(it.type==='recipe'){const r=planRecipeOf(it); t=(it.leftoverOf?'Leftover: ':'')+(r?r.name:'…')+` (${parseInt(it.servings)||PLAN_DEFAULT_SERVINGS})`;}
    else{const a=planAmount(it); t=(it.name||'')+(a?` (${a})`:'');}
    g.pairs.forEach(p=>{const a=planAmount(p); t+=`, with ${p.name||''}`+(a?` (${a})`:'');});
    return t;
  }).join('; ');
}
function planWeekHTML(){
  const today=todayStr();
  return PLAN_DAY_SHORT.map((nm,i)=>{
    const date=planAddDays(planWeekStart,i), d=new Date(planParse(date)), day=planData.days[date];
    const lines=PLAN_SLOTS.map(s=>{
      const list=(day&&day[s.key])||[];
      return list.length?`<div class="pl-wk-line"><span class="pl-wk-slot">${s.label}</span><span class="pl-wk-txt">${esc(planBrief(list))}</span></div>`:'';
    }).join('');
    return `<button class="pl-wk-day" onclick="planOpenDay('${date}')">
      <div class="pl-wk-hdr">${nm} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${date===today?' <span class="pl-wk-today">Today</span>':''}</div>
      ${lines||'<div class="pl-wk-none">Nothing planned</div>'}</button>`;
  }).join('');
}
function planOpenDay(date){planDay=date;planMode='day';planRender();}
function planRender(){
  const el=document.getElementById('planApp');
  if(!el||planView!=='plan') return;
  const today=todayStr();
  let h=`<div class="pl-weekbar">
    <div class="pl-seg">
      <button class="pl-seg-btn${planMode==='day'&&planDay===today?' on':''}" onclick="planGoToday()">Today</button>
      <button class="pl-seg-btn${planMode==='week'?' on':''}" onclick="planShowWeek()">Week</button>
    </div>
    <button class="pl-nav" onclick="planRefresh()" aria-label="Refresh the plan">↻</button>
  </div><div class="pl-days">`;
  for(let i=0;i<7;i++){
    const date=planAddDays(planWeekStart,i), d=new Date(planParse(date));
    h+=`<button class="pl-day${date===planDay&&planMode==='day'?' on':''}${date===today?' today':''}${planDayHasItems(date)?' has':''}" onclick="planPickDay('${date}')">
      <span class="pl-day-n" aria-label="${PLAN_DAY_SHORT[i]}">${PLAN_DAY_SHORT[i][0]}</span><span class="pl-day-d">${d.getUTCDate()}</span><span class="pl-day-dot"></span></button>`;
  }
  h+='</div>';
  if(planStatus==='loading'&&!planData){
    h+='<div class="pl-msg">Loading the plan…</div>';
  }else if(planStatus==='error'){
    h+=`<div class="pl-msg">${esc(planError)}<br><button class="pl-retry" onclick="planLoad()">Try again</button></div>`;
  }else if(planData&&planMode==='week'){
    h+=planWeekHTML();
  }else if(planData){
    const day=planData.days[planDay];
    h+=`<div class="pl-dayhead">${planDay===today?'Today':planDayLabel(planDay)}</div>`;
    h+=PLAN_SLOTS.map(s=>planSlotHTML(s,day)).join('');
    h+='<div class="pl-total"><span>Day total</span><span>— kcal</span></div>';
  }
  el.innerHTML=h;
}
function planOpenRecipe(id){
  const f=planData&&planFindIn(planData,id), r=f&&planRecipeOf(f.item);
  if(r) openModal(r);
}

// ── Changing items ──
function planAddItem(date,slot,item){
  const ws=planWeekStart;
  planDayOf(planData,date)[slot].push(item);
  planRender();
  planSave(ws,wk=>{
    const d=planDayOf(wk,date);
    if(d[slot].some(x=>x.id===item.id)) return false;      // already there
    d[slot].push(item);
  });
}
// Removing an item also removes what hangs off it: its "with" items and its leftover copies (agreed 1 Nov)
function planRemoveItem(id){
  if(!planData||!planFindIn(planData,id)) return;
  const ws=planWeekStart;
  const drop=wk=>{
    const ids=planLinkedIds(wk,id); let n=0;
    planEachList(wk,l=>{for(let i=l.length-1;i>=0;i--) if(ids.has(l[i].id)){l.splice(i,1);n++;}});
    return n;
  };
  planLinkedIds(planData,id).forEach(x=>{if(planTimers[x]){clearTimeout(planTimers[x].t);delete planTimers[x];}});
  drop(planData);
  planRender();
  planSave(ws,wk=>{if(!drop(wk)) return false;});
}
function planChangeServings(id,delta){
  const f=planData&&planFindIn(planData,id); if(!f) return;
  const v=Math.min(99,Math.max(1,(parseInt(f.item.servings)||PLAN_DEFAULT_SERVINGS)+delta));
  f.item.servings=v;
  planRender();
  const ws=planWeekStart;
  if(planTimers[id]) clearTimeout(planTimers[id].t);
  const fn=()=>{
    delete planTimers[id];
    planSave(ws,wk=>{const g=planFindIn(wk,id); if(!g||g.item.servings===v) return false; g.item.servings=v;});
  };
  planTimers[id]={t:setTimeout(fn,800),fn};
}

// ── The ⋯ menu on an item ──
let planActId=null;
function planOpenAct(id){
  const f=planData&&planFindIn(planData,id); if(!f) return;
  planActId=id;
  const r=f.item.type==='recipe'?planRecipeOf(f.item):null;
  document.getElementById('planActTitle').textContent=f.item.type==='recipe'?(r?r.name:'Recipe'):(f.item.name||'Food');
  const extra=planLinkedIds(planData,id).size-1;
  document.getElementById('planActRemoveBtn').textContent=extra?`Remove from plan (and ${extra} linked ${extra===1?'item':'items'})`:'Remove from plan';
  document.getElementById('planActOverlay').style.display='flex';
}
function closePlanAct(){document.getElementById('planActOverlay').style.display='none';planActId=null;}
function planActRemove(){const id=planActId;closePlanAct();if(id)planRemoveItem(id);}

// ── The Add sheet (Recipe tab and Food tab) ──
let planAddSlot='dinner', planAddDate='', planAddTab='recipe', planAddRecipeId=null, planAddServings=PLAN_DEFAULT_SERVINGS, planSuggest=[];
let planAddLeft=false, planAddOrig=null, planAddWithOn=false, planAddWithId='', planAddMains=[];
function planSlotLabel(k){return (PLAN_SLOTS.find(s=>s.key===k)||{}).label||k;}
function openPlanAdd(slot,opts){
  if(!planData) return;
  opts=opts||{};
  planAddSlot=slot; planAddDate=opts.date||planDay; planAddTab=opts.tab||'recipe'; planAddRecipeId=null; planAddServings=PLAN_DEFAULT_SERVINGS;
  planAddLeft=false; planAddOrig=null; planAddWithOn=!!opts.withId; planAddWithId=opts.withId||'';
  const seen=new Map();
  Object.values(ingredients).forEach(list=>list.forEach(i=>{const n=(i.name||'').trim(); if(n&&!seen.has(n.toLowerCase())) seen.set(n.toLowerCase(),n);}));
  planNames=[...seen.values()].sort((a,b)=>a.localeCompare(b));
  document.getElementById('planAddTitle').textContent=`Add to ${planSlotLabel(slot)}`;
  planAddBuild();
  document.getElementById('planAddOverlay').style.display='flex';
}
// "＋ Add a side or pairing" under a recipe item: opens the Food tab with "with <that recipe>" ticked
function planAddSide(id){
  const f=planData&&planFindIn(planData,id); if(!f) return;
  openPlanAdd(f.slot,{tab:'food',withId:id,date:f.date});
}
function closePlanAdd(){document.getElementById('planAddOverlay').style.display='none';}
function planAddSwitch(tab){planAddTab=tab;planAddBuild();}
// Meals already planned that these leftovers could come from: recipe items (not leftovers) on an earlier day or an earlier slot of the same day
function planAddCandidates(){
  const out=[], si=PLAN_SLOTS.findIndex(s=>s.key===planAddSlot);
  planEachList(planData,(l,date,slot)=>{
    const k=PLAN_SLOTS.findIndex(s=>s.key===slot);
    if(!(date<planAddDate||(date===planAddDate&&k<si))) return;
    l.forEach(x=>{
      if(x.type!=='recipe'||x.leftoverOf) return;
      const r=planRecipeOf(x); if(!r) return;
      out.push({id:x.id,name:r.name,date,k,when:`${planWhen(date,slot)} · ${parseInt(x.servings)||PLAN_DEFAULT_SERVINGS} servings`});
    });
  });
  out.sort((a,b)=>a.date<b.date?1:a.date>b.date?-1:b.k-a.k);   // most recent first
  return out;
}
function planAddBuild(){
  const body=document.getElementById('planAddBody'), foot=document.getElementById('planAddFoot');
  document.getElementById('planTabRecipe').classList.toggle('on',planAddTab==='recipe');
  document.getElementById('planTabFood').classList.toggle('on',planAddTab==='food');
  if(planAddTab==='recipe'){
    const cands=planAddCandidates();
    if(!cands.length) planAddLeft=false;
    if(planAddLeft&&!cands.some(c=>c.id===planAddOrig)) planAddOrig=cands[0]?cands[0].id:null;
    let h=cands.length?`<label class="pl-check"><input type="checkbox" ${planAddLeft?'checked':''} onchange="planLeftToggle(this.checked)"><span>These are leftovers from a meal I already planned</span></label>`:'';
    if(planAddLeft){
      h+=`<div class="pk-list">${cands.map(c=>`<button class="pk-item${c.id===planAddOrig?' sel':''}" onclick="planPickOrig('${c.id}')"><span>${esc(c.name)}<span class="pl-cand-sub">${esc(c.when)}</span></span>${c.id===planAddOrig?'<span class="cur">✓</span>':''}</button>`).join('')}</div>`;
    }else{
      h+=`<div style="padding-top:12px"><input class="pk-search" id="planRecipeSearch" name="plan-recipe-search" type="text" autocomplete="off" placeholder="Search recipes…" oninput="planAddRecipeList()"></div>
      <div class="pk-list" id="planRecipeList"></div>`;
    }
    body.innerHTML=h;
    if(!planAddLeft) planAddRecipeList();
    planAddFootRecipe();
  }else{
    // main recipe items of this slot: a food can be shown "with" one of them
    planAddMains=[];
    const list=(planData.days[planAddDate]&&planData.days[planAddDate][planAddSlot])||[];
    list.forEach(x=>{if(x.type==='recipe'){const r=planRecipeOf(x); if(r) planAddMains.push({id:x.id,name:r.name+(x.leftoverOf?' (leftover)':'')});}});
    if(planAddWithOn&&!planAddMains.some(m=>m.id===planAddWithId)) planAddWithId=planAddMains[0]?planAddMains[0].id:'';
    const withRow=planAddMains.length?`<label class="pl-check"><input type="checkbox" id="planWithChk" ${planAddWithOn?'checked':''}><span>Show as “with” ${planAddMains.length===1?`<b>${esc(planAddMains[0].name)}</b>`:`<select class="pl-with-sel" id="planWithSel">${planAddMains.map(m=>`<option value="${m.id}"${m.id===planAddWithId?' selected':''}>${esc(m.name)}</option>`).join('')}</select>`}</span></label>`:'';
    body.innerHTML=`<div class="fs-group-title">Food</div>
      <input class="pk-search" id="planFoodName" name="plan-food-name" type="text" autocomplete="off" placeholder="e.g. Brown Rice, Banana" oninput="planFoodSuggest()">
      <div class="pk-list" id="planFoodSuggest" style="display:none"></div>
      <div class="fs-group-title">Amount (optional)</div>
      <div class="pl-amount-row">
        <input class="pk-search" id="planFoodQty" name="plan-food-amount" type="text" inputmode="decimal" autocomplete="off" placeholder="Amount">
        <select class="pl-unit" id="planFoodUnit" name="plan-food-unit"><option value="">no unit</option>${UNITS.map(u=>`<option value="${u}">${u}</option>`).join('')}</select>
      </div>${withRow}`;
    foot.innerHTML=`<button class="fs-show" onclick="planSubmitFood()">Add to ${planSlotLabel(planAddSlot)}</button>`;
  }
}
function planLeftToggle(on){planAddLeft=on;planAddBuild();}
function planPickOrig(id){planAddOrig=id;planAddBuild();}
function planAddRecipeList(){
  const q=(document.getElementById('planRecipeSearch')||{value:''}).value.toLowerCase().trim();
  const list=recipes.filter(r=>!q||r.name.toLowerCase().includes(q)).slice().sort((a,b)=>a.name.localeCompare(b.name));
  document.getElementById('planRecipeList').innerHTML=list.length
    ?list.map(r=>`<button class="pk-item${String(r.id)===String(planAddRecipeId)?' sel':''}" onclick="planPickRecipe(${r.id})"><span>${esc(r.name)}</span>${String(r.id)===String(planAddRecipeId)?'<span class="cur">✓</span>':''}</button>`).join('')
    :'<div class="fs-empty" style="padding:14px">No recipes match.</div>';
}
function planPickRecipe(id){planAddRecipeId=id;planAddRecipeList();planAddFootRecipe();}
function planAddFootRecipe(){
  const none=planAddLeft?planAddOrig===null:planAddRecipeId===null;
  document.getElementById('planAddFoot').innerHTML=`<div class="pl-foot-row">
      <span class="pl-foot-lbl">Servings</span>
      <div class="pl-foot-step">
        <button class="pl-step-btn" onclick="planAddServ(-1)" ${planAddServings<=1?'disabled':''} aria-label="Fewer servings">−</button>
        <span class="pl-step-val">${planAddServings}</span>
        <button class="pl-step-btn" onclick="planAddServ(1)" ${planAddServings>=99?'disabled':''} aria-label="More servings">+</button>
      </div></div>
    <button class="fs-show" ${none?'disabled':''} onclick="planSubmitRecipe()">${planAddLeft?'Add leftovers to ':'Add to '}${planSlotLabel(planAddSlot)}</button>`;
}
function planAddServ(d){planAddServings=Math.min(99,Math.max(1,planAddServings+d));planAddFootRecipe();}
function planSubmitRecipe(){
  if(planAddLeft){
    const o=planAddOrig&&planFindIn(planData,planAddOrig); if(!o) return;
    planAddItem(planAddDate,planAddSlot,{id:planNewId(),type:'recipe',recipeId:Number(o.item.recipeId),servings:planAddServings,leftoverOf:planAddOrig});
    closePlanAdd(); return;
  }
  if(planAddRecipeId===null) return;
  planAddItem(planAddDate,planAddSlot,{id:planNewId(),type:'recipe',recipeId:Number(planAddRecipeId),servings:planAddServings});
  closePlanAdd();
}
// Food names are suggested from the ingredient names the recipes already use (same names = shopping list can match them later)
function planFoodSuggest(){
  const q=document.getElementById('planFoodName').value.toLowerCase().trim();
  const box=document.getElementById('planFoodSuggest');
  if(!q){planSuggest=[];box.style.display='none';return;}
  const starts=planNames.filter(n=>n.toLowerCase().startsWith(q));
  const has=planNames.filter(n=>!n.toLowerCase().startsWith(q)&&n.toLowerCase().includes(q));
  planSuggest=[...starts,...has].slice(0,8);
  box.innerHTML=planSuggest.map((n,i)=>`<button class="pk-item" onclick="planPickFood(${i})"><span>${esc(n)}</span></button>`).join('');
  box.style.display=planSuggest.length?'':'none';
}
function planPickFood(i){
  document.getElementById('planFoodName').value=planSuggest[i]||'';
  planSuggest=[]; document.getElementById('planFoodSuggest').style.display='none';
}
function planSubmitFood(){
  const name=document.getElementById('planFoodName').value.trim();
  if(!name){showToast('Type a food name first');return;}
  const qt=document.getElementById('planFoodQty').value.trim().replace(',','.');
  const unit=document.getElementById('planFoodUnit').value;
  const item={id:planNewId(),type:'food',name};
  if(qt){
    const q=parseQty(qt);
    if(q===null){showToast('Amount not understood: use a number like 300 or 1/2');return;}
    item.quantity=q;
    if(unit) item.unit=unit;
  }
  const chk=document.getElementById('planWithChk');
  if(chk&&chk.checked){
    const sel=document.getElementById('planWithSel');
    const wid=sel?sel.value:(planAddMains[0]&&planAddMains[0].id);
    if(wid) item.withItem=wid;
  }
  planAddItem(planAddDate,planAddSlot,item);
  closePlanAdd();
}

document.getElementById('planAddOverlay').addEventListener('click',e=>{if(e.target.id==='planAddOverlay')closePlanAdd();});
document.getElementById('planActOverlay').addEventListener('click',e=>{if(e.target.id==='planActOverlay')closePlanAct();});

// ── Moving between weeks: swipe the day strip (touch, mouse drag or trackpad), or the left and right arrow keys ──
(function(){
  const el=document.getElementById('planApp');
  let sx=0,sy=0,down=false,swiped=false,lastWheel=0;
  el.addEventListener('pointerdown',e=>{
    if(!e.target.closest('.pl-days')){down=false;return;}
    down=true;sx=e.clientX;sy=e.clientY;
  });
  el.addEventListener('pointerup',e=>{
    if(!down) return; down=false;
    const dx=e.clientX-sx, dy=e.clientY-sy;
    if(Math.abs(dx)>50&&Math.abs(dx)>1.5*Math.abs(dy)){
      swiped=true; setTimeout(()=>{swiped=false;},400);
      planShiftWeek(dx<0?1:-1);
    }
  });
  el.addEventListener('pointercancel',()=>{down=false;});
  el.addEventListener('click',e=>{if(swiped){e.stopPropagation();e.preventDefault();}},true);
  // Trackpad two-finger swipe: one week per gesture
  el.addEventListener('wheel',e=>{
    if(!e.target.closest('.pl-days')) return;
    if(Math.abs(e.deltaX)>Math.abs(e.deltaY)&&Math.abs(e.deltaX)>4){
      e.preventDefault();
      const now=Date.now(), gap=now-lastWheel; lastWheel=now;
      if(gap>200&&Math.abs(e.deltaX)>12) planShiftWeek(e.deltaX>0?1:-1);
    }
  },{passive:false});
  document.addEventListener('keydown',e=>{
    if(planView!=='plan'||(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')) return;
    const tag=(document.activeElement&&document.activeElement.tagName)||'';
    if(/INPUT|TEXTAREA|SELECT/.test(tag)) return;
    if(document.querySelector('.modal-overlay.open')) return;
    if(['planAddOverlay','planActOverlay','editorOverlay','filterOverlay','pickerOverlay'].some(id=>{const o=document.getElementById(id);return o&&o.style.display==='flex';})) return;
    planShiftWeek(e.key==='ArrowRight'?1:-1);
  });
})();
