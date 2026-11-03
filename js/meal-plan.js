// Meal planner (Phase 4, chats 1, 2a and 2b): one file per week in kitchen-data, Plan view, week bar, day buttons,
// four slots, add a recipe item or a food item, pairings, leftovers (also from last week's file), remove, change servings,
// move, copy, copy as leftovers, and the week grid.
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
let planMode = 'day';          // 'day' (one day) | 'week' (the week grid)
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
let planWeeks = {};            // other weeks' files (read only): Monday date -> week data. Used for leftovers that come from last week

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
      if(planPending===0&&!Object.keys(planTimers).length&&ws===planWeekStart&&planView==='plan'){planData=saved;planRender();planLoadLinked(ws,false);}
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
  if(planStatus==='ready') planLoadLinked(ws,true);
}
// Leftovers that come from another week (Sunday dinner eaten on Monday): read that week's file so "Leftover from Sun dinner" can be shown.
async function planLoadLinked(ws,force){
  if(!planData||planData.weekStart!==ws) return;
  const need=new Set();
  planEachList(planData,l=>l.forEach(x=>{if(x.leftoverWeek&&x.leftoverWeek!==ws&&(force||!planWeeks[x.leftoverWeek])) need.add(x.leftoverWeek);}));
  let changed=false;
  for(const w of need){
    try{const {data}=await planGetFile(w); planWeeks[w]=data; changed=true;}catch(e){/* keep what is on screen */}
  }
  if(changed&&planView==='plan'&&planWeekStart===ws) planRender();
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
  if(document.hidden) return;
  if(planView==='plan'&&planPending===0&&!Object.keys(planTimers).length) planLoad({silent:true});
  planScanGobbled();
});

// ── F17: "gobbled" dates come from the plan ──
// Today's recipe items (not leftovers) get a small tick: tap it to record the recipe as gobbled today.
function planGobbleHTML(it,r,date){
  if(it.leftoverOf||date!==todayStr()) return '';
  if(r.lastCooked&&r.lastCooked>=date) return `<span class="pl-gob done">✓ Gobbled</span>`;
  return `<button class="pl-gob" onclick="event.stopPropagation();planMarkGobbled('${it.id}')">✓ Gobbled today?</button>`;
}
let gobbleBusy=false;
async function planMarkGobbled(itemId){
  const f=planData&&planFindIn(planData,itemId);
  if(!f||f.item.type!=='recipe'||f.item.leftoverOf||gobbleBusy) return;
  if(!localStorage.getItem('gh_pat_token')){showToast('Tap the key icon to enter your token');return;}
  const id=String(f.item.recipeId), day=todayStr();
  gobbleBusy=true; showToast('Saving…');
  try{
    await ghUpdateWithRetry(raw=>{
      const rr=raw.recipes.find(x=>String(x.id)===id);
      if(!rr) throw new Error('Recipe not found in the file');
      if(!rr.lastCooked||rr.lastCooked<day) rr.lastCooked=day;      // only ever a newer date
    });
    applyLastCookedLocal(id,day); applyFilters(); planRender(); showToast('Gobbled ✓');
  }catch(e){ showToast('Save failed: '+e.message); }
  finally{ gobbleBusy=false; }
}
// When the app opens (and when you come back to it on a new day): every recipe item on a day BEFORE today sets that recipe's
// lastCooked to that day, but only if that day is newer than the date already stored. Leftovers never count.
// It reads this week's and last week's plan files (further back if the app was not opened for a while, never more than 8 weeks)
// and saves all the changes in one go. It is safe to repeat: the same plan always gives the same result.
let gobbleScanDay='';
async function planScanGobbled(){
  const today=todayStr();
  if(gobbleScanDay===today||!recipes.length||!localStorage.getItem('gh_pat_token')) return;
  gobbleScanDay=today;
  try{
    const thisMon=planMonday(today);
    let from=planAddDays(thisMon,-7);
    const done=localStorage.getItem('gobble_scanned_to')||'';             // the last day that was fully read
    if(/^\d{4}-\d{2}-\d{2}$/.test(done)&&planMonday(done)<from) from=planMonday(done);
    const oldest=planAddDays(thisMon,-56); if(from<oldest) from=oldest;
    const found={};                                                       // recipe id -> newest day before today
    for(let ws=from;ws<=thisMon;ws=planAddDays(ws,7)){
      const {data}=await planGetFile(ws);
      planEachList(data,(list,date)=>{
        if(date>=today) return;
        list.forEach(it=>{
          if(it.type!=='recipe'||it.leftoverOf) return;
          const id=String(it.recipeId);
          if(!found[id]||found[id]<date) found[id]=date;
        });
      });
    }
    const updates=Object.keys(found).filter(id=>{const r=recipes.find(x=>String(x.id)===id);return r&&(!r.lastCooked||r.lastCooked<found[id]);});
    if(updates.length){
      await ghUpdateWithRetry(raw=>{
        updates.forEach(id=>{
          const rr=raw.recipes.find(x=>String(x.id)===id);
          if(rr&&(!rr.lastCooked||rr.lastCooked<found[id])) rr.lastCooked=found[id];
        });
      });
      updates.forEach(id=>applyLastCookedLocal(id,found[id]));
      applyFilters(); if(planView==='plan') planRender();
      showToast(updates.length===1?'1 gobbled date updated from the plan':`${updates.length} gobbled dates updated from the plan`);
    }
    localStorage.setItem('gobble_scanned_to',planAddDays(today,-1));
  }catch(e){
    console.error('Gobbled scan failed:',e);
    gobbleScanDay='';                                                     // try again next time the app is opened or revisited
  }
}

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
// The leftover copies of a recipe item that sit in this week's file (leftovers in another week's file are not counted here)
function planLeftoversOf(id){
  const out=[];
  if(planData) planEachList(planData,(l,date,slot)=>l.forEach(x=>{if(x.leftoverOf===id&&(!x.leftoverWeek||x.leftoverWeek===planWeekStart)) out.push({item:x,date,slot});}));
  return out;
}
// Where a leftover comes from: {item,date,slot}, null when the original has been removed, or 'loading' while last week's file is still being read
function planOriginalOf(it){
  if(it.leftoverWeek&&it.leftoverWeek!==planWeekStart){
    const wk=planWeeks[it.leftoverWeek];
    return wk?(planFindIn(wk,it.leftoverOf)||null):'loading';
  }
  return (planData&&planFindIn(planData,it.leftoverOf))||null;
}
function planSlotIndex(k){return PLAN_SLOTS.findIndex(s=>s.key===k);}
// A day and slot as text that sorts in time order, so "earlier" and "later" are a plain comparison
function planPosKey(date,slot){return date+'|'+planSlotIndex(slot);}
// An item plus everything that hangs off it (its pairings and its leftover copies, and theirs)
function planLinkedIds(wk,id){
  const ids=new Set([id]); let grew=true;
  while(grew){
    grew=false;
    planEachList(wk,l=>l.forEach(x=>{
      const sameWeek=!x.leftoverWeek||x.leftoverWeek===wk.weekStart;
      if(!ids.has(x.id)&&((x.withItem&&ids.has(x.withItem))||(x.leftoverOf&&sameWeek&&ids.has(x.leftoverOf)))){ids.add(x.id);grew=true;}
    }));
  }
  return ids;
}
function planWhen(date,slot){return `${PLAN_DAY_SHORT[planDow(date)]} ${planSlotLabel(slot).toLowerCase()}`;}

function planItemHTML(it,date){
  if(it.type==='recipe'){
    const r=planRecipeOf(it), n=parseInt(it.servings)||PLAN_DEFAULT_SERVINGS;
    if(!r) return `<div class="pl-item">
      <div class="pl-main"><div class="pl-name pl-gone">${recipes.length?'Recipe no longer exists':'Loading recipes…'}</div></div>
      <button class="pl-more" onclick="planOpenAct('${it.id}')" aria-label="Item options">⋯</button></div>`;
    const isLeft=!!it.leftoverOf;
    let sub='';
    if(isLeft){
      const o=planOriginalOf(it);
      sub=o==='loading'?'Leftover':o?`Leftover from ${planWhen(o.date,o.slot)}`:'Leftover · original removed';
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
        <button class="pl-side-link" onclick="event.stopPropagation();planAddSide('${it.id}')">＋ Add a side or pairing</button>${planGobbleHTML(it,r,date)}</div>
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
    ${list.length?planGroups(list).map(g=>planItemHTML(g.main,planDay)+g.pairs.map(planPairHTML).join('')).join(''):'<div class="pl-empty">Nothing planned</div>'}
  </div>`;
}
// Week mode: the week grid. Seven day columns, the four slots as rows, a Day total row (still "— kcal").
// Same code on every screen; on a narrow screen it keeps a minimum column width and scrolls sideways.
function planGridItem(it,pairs){
  const n=parseInt(it.servings)||PLAN_DEFAULT_SERVINGS;
  let name,sub='',left=false;
  if(it.type==='recipe'){
    const r=planRecipeOf(it);
    name=r?r.name:(recipes.length?'Recipe no longer exists':'Loading recipes…');
    left=!!it.leftoverOf;
    sub=left?`Leftover · ${n}`:`${n} servings`;
  }else{
    name=it.name||''; sub=planAmount(it);
  }
  return `<button class="pg-item${left?' pg-left':''}" onclick="planOpenAct('${it.id}')"><span class="pg-name">${esc(name)}</span>${sub?`<span class="pg-sub">${esc(sub)}</span>`:''}</button>`
    +pairs.map(p=>{const a=planAmount(p);return `<button class="pg-pair" onclick="planOpenAct('${p.id}')"><span class="pl-pair-with">with</span> ${esc(p.name||'')}${a?` · ${esc(a)}`:''}</button>`;}).join('');
}
function planGridCell(date,s){
  const day=planData.days[date], list=(day&&day[s.key])||[];
  return `<div class="pg-cell">${planGroups(list).map(g=>planGridItem(g.main,g.pairs)).join('')}
    <button class="pg-add" onclick="openPlanAdd('${s.key}',{date:'${date}'})" aria-label="Add to ${s.label} on ${planDayLabel(date)}">＋</button></div>`;
}
function planWeekHTML(){
  const today=todayStr(), dates=PLAN_DAY_SHORT.map((nm,i)=>planAddDays(planWeekStart,i));
  let h='<div class="pg-scroll"><div class="pg-grid"><div class="pg-corner"></div>';
  dates.forEach((date,i)=>{
    const d=new Date(planParse(date));
    h+=`<button class="pg-dayhead${date===today?' today':''}" onclick="planOpenDay('${date}')"><span>${PLAN_DAY_SHORT[i]}</span><b>${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}</b></button>`;
  });
  PLAN_SLOTS.forEach(s=>{
    h+=`<div class="pg-rowlbl">${s.label}</div>`+dates.map(date=>planGridCell(date,s)).join('');
  });
  h+='<div class="pg-rowlbl">Day total</div>'+dates.map(()=>'<div class="pg-total">— kcal</div>').join('');
  return h+'</div></div>';
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
  const sc=el.querySelector('.pg-scroll'), keepX=sc?sc.scrollLeft:0;
  el.innerHTML=h;
  const sc2=el.querySelector('.pg-scroll'); if(sc2&&keepX) sc2.scrollLeft=keepX;
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
  const isPair=!!f.item.withItem&&f.list.some(x=>x.id===f.item.withItem);   // a pairing travels with its main item
  const isLeft=f.item.type==='recipe'&&!!f.item.leftoverOf;
  document.getElementById('planActMoveBtn').style.display=isPair?'none':'';
  document.getElementById('planActCopyBtn').style.display=isPair?'none':'';
  document.getElementById('planActLeftBtn').style.display=(f.item.type==='recipe'&&!isLeft&&r)?'':'none';
  const extra=planLinkedIds(planData,id).size-1;
  document.getElementById('planActRemoveBtn').textContent=extra?`Remove from plan (and ${extra} linked ${extra===1?'item':'items'})`:'Remove from plan';
  document.getElementById('planActOverlay').style.display='flex';
}
function closePlanAct(){document.getElementById('planActOverlay').style.display='none';planActId=null;}
function planActRemove(){const id=planActId;closePlanAct();if(id)planRemoveItem(id);}

// ── Move, Copy, Copy as leftovers (agreed 2 Nov) ──
// Move: pairings travel with their main item; leftovers stay where they are (their "Leftover from…" label follows the original);
//   an original cannot move to a time on or after one of its leftovers; a leftover cannot move to or before its original.
// All three stay inside the week on screen (moving to another week would mean saving two files at once).
let planDest=null;   // {mode:'move'|'copy'|'left', id, date, slot, servings, err}
function planFreshId(wk){
  let id; do{ id='i-'+Math.random().toString(36).slice(2,7); }while(planFindIn(wk,id));
  return id;
}
function planActOpenDest(mode){
  const id=planActId, f=id&&planData&&planFindIn(planData,id); if(!f) return;
  closePlanAct();
  let date=f.date, slot=f.slot;
  if(mode==='left'){                       // suggest the next slot after the original
    const k=planSlotIndex(f.slot)+1;
    if(k<PLAN_SLOTS.length){slot=PLAN_SLOTS[k].key;}
    else{slot=PLAN_SLOTS[0].key; date=planAddDays(f.date,1);}
    if(date>planAddDays(planWeekStart,6)){date=planAddDays(planWeekStart,6);slot=PLAN_SLOTS[PLAN_SLOTS.length-1].key;}
  }else if(mode==='copy'){date=planDay;}
  planDest={mode,id,date,slot,servings:parseInt(f.item.servings)||PLAN_DEFAULT_SERVINGS,err:''};
  if(mode==='left') planDest.servings=PLAN_DEFAULT_SERVINGS;
  planDestBuild();
  document.getElementById('planDestOverlay').style.display='flex';
}
function closePlanDest(){document.getElementById('planDestOverlay').style.display='none';planDest=null;}
function planDestSet(k,v){if(!planDest) return; planDest[k]=v; planDest.err=''; planDestBuild();}
function planDestServ(d){if(!planDest) return; planDest.servings=Math.min(99,Math.max(1,planDest.servings+d)); planDestBuild();}
function planDestBuild(){
  const D=planDest, f=D&&planData&&planFindIn(planData,D.id);
  if(!f){closePlanDest();return;}
  document.getElementById('planDestTitle').textContent={move:'Move to…',copy:'Copy to…',left:'Copy as leftovers to…'}[D.mode];
  const days=PLAN_DAY_SHORT.map((n,i)=>{const d=planAddDays(planWeekStart,i);return `<option value="${d}"${d===D.date?' selected':''}>${esc(planDayLabel(d))}</option>`;}).join('');
  const slots=PLAN_SLOTS.map(sl=>`<option value="${sl.key}"${sl.key===D.slot?' selected':''}>${sl.label}</option>`).join('');
  const showServ=D.mode!=='move'&&f.item.type==='recipe';
  document.getElementById('planDestBody').innerHTML=`<div class="pl-dest-row"><span class="pl-foot-lbl">Day</span><select class="pl-with-sel" onchange="planDestSet('date',this.value)">${days}</select></div>
    <div class="pl-dest-row"><span class="pl-foot-lbl">Slot</span><select class="pl-with-sel" onchange="planDestSet('slot',this.value)">${slots}</select></div>
    ${showServ?`<div class="pl-dest-row"><span class="pl-foot-lbl">Servings</span><div class="pl-foot-step">
      <button class="pl-step-btn" onclick="planDestServ(-1)" ${D.servings<=1?'disabled':''} aria-label="Fewer servings">−</button>
      <span class="pl-step-val">${D.servings}</span>
      <button class="pl-step-btn" onclick="planDestServ(1)" ${D.servings>=99?'disabled':''} aria-label="More servings">+</button></div></div>`:''}
    ${D.err?`<div class="pl-dest-err">${esc(D.err)}</div>`:''}`;
  document.getElementById('planDestOk').textContent={move:'Move',copy:'Copy',left:'Copy as leftovers'}[D.mode];
}
// Returns text saying why the choice is not allowed, or '' when it is fine
function planDestCheck(){
  const D=planDest, f=planData&&planFindIn(planData,D.id); if(!f) return 'That item is gone.';
  const newPos=planPosKey(D.date,D.slot);
  if(D.mode==='move'&&D.date===f.date&&D.slot===f.slot) return 'It is already there. Pick another day or slot.';
  if(D.mode==='left'){
    if(newPos<=planPosKey(f.date,f.slot)) return `Leftovers have to come after the meal they come from (${planWhen(f.date,f.slot)}).`;
    return '';
  }
  if(f.item.type==='recipe'&&f.item.leftoverOf){                       // a leftover cannot sit on or before its original
    const o=planOriginalOf(f.item);
    if(o&&o!=='loading'&&(!f.item.leftoverWeek||f.item.leftoverWeek===planWeekStart)&&newPos<=planPosKey(o.date,o.slot))
      return `A leftover has to come after its original (${planWhen(o.date,o.slot)}).`;
  }
  if(D.mode==='move'){                                                  // an original cannot move on or after its leftovers
    const lefts=planLeftoversOf(D.id).filter(l=>newPos>=planPosKey(l.date,l.slot)).sort((a,b)=>planPosKey(a.date,a.slot)<planPosKey(b.date,b.slot)?-1:1);
    if(lefts.length) return `Can't move it there: its leftovers are on ${planWhen(lefts[0].date,lefts[0].slot)}. A meal has to come before its leftovers.`;
  }
  return '';
}
function planDestConfirm(){
  const D=planDest; if(!D) return;
  const err=planDestCheck();
  if(err){D.err=err;planDestBuild();return;}
  const ws=planWeekStart, id=D.id, date=D.date, slot=D.slot, servings=D.servings, mode=D.mode;
  closePlanDest();
  if(mode==='move'){
    const apply=wk=>{
      const g=planFindIn(wk,id); if(!g) return false;
      if(g.date===date&&g.slot===slot) return false;
      const moving=[g.item,...g.list.filter(x=>x.withItem===id)];
      moving.forEach(x=>{const i=g.list.indexOf(x); if(i!==-1) g.list.splice(i,1);});
      planDayOf(wk,date)[slot].push(...moving);
    };
    apply(planData); planRender(); planSave(ws,apply);
  }else if(mode==='copy'){
    const src=planFindIn(planData,id); if(!src) return;
    const newId=planNewId(), pairIds={};
    src.list.filter(x=>x.withItem===id).forEach(p=>{pairIds[p.id]=planNewId();});
    const apply=wk=>{
      const g=planFindIn(wk,id); if(!g) return false;
      const target=planDayOf(wk,date)[slot];
      if(target.some(x=>x.id===newId)) return false;                    // this copy is already saved
      const main=JSON.parse(JSON.stringify(g.item)); main.id=newId; delete main.withItem;
      if(main.type==='recipe') main.servings=servings;
      const out=[main];
      g.list.filter(x=>x.withItem===id).forEach(p=>{
        const c=JSON.parse(JSON.stringify(p)); c.id=pairIds[p.id]||planFreshId(wk); c.withItem=newId; out.push(c);
      });
      target.push(...out);
    };
    apply(planData); planRender(); planSave(ws,apply);
  }else{
    const src=planFindIn(planData,id); if(!src) return;
    planAddItem(date,slot,{id:planNewId(),type:'recipe',recipeId:Number(src.item.recipeId),servings,leftoverOf:id});
  }
  if(date!==planDay&&planMode==='day'){planDay=date;planRender();}     // follow the item to its new day
  showToast({move:'Moved',copy:'Copied',left:'Leftovers added'}[mode]);
}

// ── The Add sheet (Recipe tab and Food tab) ──
let planAddSlot='dinner', planAddDate='', planAddTab='recipe', planAddRecipeId=null, planAddServings=PLAN_DEFAULT_SERVINGS, planSuggest=[];
let planAddLeft=false, planAddOrig=null, planAddOrigWeek='', planAddWithOn=false, planAddWithId='', planAddMains=[];
function planSlotLabel(k){return (PLAN_SLOTS.find(s=>s.key===k)||{}).label||k;}
function openPlanAdd(slot,opts){
  if(!planData) return;
  opts=opts||{};
  planAddSlot=slot; planAddDate=opts.date||planDay; planAddTab=opts.tab||'recipe'; planAddRecipeId=null; planAddServings=PLAN_DEFAULT_SERVINGS;
  planAddLeft=false; planAddOrig=null; planAddOrigWeek=''; planAddWithOn=!!opts.withId; planAddWithId=opts.withId||'';
  const seen=new Map();
  Object.values(ingredients).forEach(list=>list.forEach(i=>{const n=(i.name||'').trim(); if(n&&!seen.has(n.toLowerCase())) seen.set(n.toLowerCase(),n);}));
  planNames=[...seen.values()].sort((a,b)=>a.localeCompare(b));
  document.getElementById('planAddTitle').textContent=`Add to ${planSlotLabel(slot)}`;
  planAddBuild();
  document.getElementById('planAddOverlay').style.display='flex';
  planLoadPrevForAdd();
}
// On a Monday, last week's meals can be the source of leftovers (Sunday dinner eaten on Monday): read last week's file, then redraw the sheet
async function planLoadPrevForAdd(){
  if(planDow(planAddDate)!==0) return;
  const prev=planAddDays(planWeekStart,-7);
  try{
    const {data}=await planGetFile(prev); planWeeks[prev]=data;
    if(document.getElementById('planAddOverlay').style.display==='flex'&&planAddTab==='recipe') planAddBuild();
  }catch(e){/* offer this week's meals only */}
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
  const out=[], si=planSlotIndex(planAddSlot);
  planEachList(planData,(l,date,slot)=>{
    const k=planSlotIndex(slot);
    if(!(date<planAddDate||(date===planAddDate&&k<si))) return;
    l.forEach(x=>{
      if(x.type!=='recipe'||x.leftoverOf) return;
      const r=planRecipeOf(x); if(!r) return;
      out.push({id:x.id,week:planWeekStart,name:r.name,date,k,when:`${planWhen(date,slot)} · ${parseInt(x.servings)||PLAN_DEFAULT_SERVINGS} servings`});
    });
  });
  // Monday: last week's meals too (only the previous week, never older)
  const prev=planAddDays(planWeekStart,-7), pw=planWeeks[prev];
  if(planDow(planAddDate)===0&&pw){
    planEachList(pw,(l,date,slot)=>l.forEach(x=>{
      if(x.type!=='recipe'||x.leftoverOf) return;
      const r=planRecipeOf(x); if(!r) return;
      out.push({id:x.id,week:prev,name:r.name,date,k:planSlotIndex(slot),when:`${planWhen(date,slot)} last week · ${parseInt(x.servings)||PLAN_DEFAULT_SERVINGS} servings`});
    }));
  }
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
    if(planAddLeft&&!cands.some(c=>c.id===planAddOrig&&c.week===planAddOrigWeek)){planAddOrig=cands[0]?cands[0].id:null;planAddOrigWeek=cands[0]?cands[0].week:'';}
    let h=cands.length?`<label class="pl-check"><input type="checkbox" ${planAddLeft?'checked':''} onchange="planLeftToggle(this.checked)"><span>These are leftovers from a meal I already planned</span></label>`:'';
    if(planAddLeft){
      h+=`<div class="pk-list">${cands.map(c=>`<button class="pk-item${(c.id===planAddOrig&&c.week===planAddOrigWeek)?' sel':''}" onclick="planPickOrig('${c.id}','${c.week}')"><span>${esc(c.name)}<span class="pl-cand-sub">${esc(c.when)}</span></span>${(c.id===planAddOrig&&c.week===planAddOrigWeek)?'<span class="cur">✓</span>':''}</button>`).join('')}</div>`;
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
function planPickOrig(id,week){planAddOrig=id;planAddOrigWeek=week||planWeekStart;planAddBuild();}
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
    const wk=planAddOrigWeek===planWeekStart?planData:planWeeks[planAddOrigWeek];
    const o=planAddOrig&&wk&&planFindIn(wk,planAddOrig); if(!o) return;
    const item={id:planNewId(),type:'recipe',recipeId:Number(o.item.recipeId),servings:planAddServings,leftoverOf:planAddOrig};
    if(planAddOrigWeek!==planWeekStart) item.leftoverWeek=planAddOrigWeek;      // the original is in last week's file
    planAddItem(planAddDate,planAddSlot,item);
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
document.getElementById('planDestOverlay').addEventListener('click',e=>{if(e.target.id==='planDestOverlay')closePlanDest();});

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
    if(['planAddOverlay','planActOverlay','planDestOverlay','editorOverlay','filterOverlay','pickerOverlay'].some(id=>{const o=document.getElementById(id);return o&&o.style.display==='flex';})) return;
    planShiftWeek(e.key==='ArrowRight'?1:-1);
  });
})();
