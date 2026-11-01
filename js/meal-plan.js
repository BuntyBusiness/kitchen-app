// Meal planner (Phase 4, chat 1): one file per week in kitchen-data, Recipes | Plan switch,
// week bar, day buttons, four slots, add a recipe item or a food item, remove, change servings.
// Week files are saved the safe way: fetch a fresh copy, change only the one item, save, retry if the file changed.

const PLAN_SLOTS = [
  {key:'breakfast', label:'Breakfast'},
  {key:'lunch',     label:'Lunch'},
  {key:'dinner',    label:'Dinner'},
  {key:'snacks',    label:'Snacks'},
];
const PLAN_DEFAULT_SERVINGS = 4;
const PLAN_DAY_SHORT = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const PLAN_DAY_LONG  = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

let planView = 'recipes';      // 'recipes' | 'plan'
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
  document.getElementById('vsRecipes').classList.toggle('active',v==='recipes');
  document.getElementById('vsPlan').classList.toggle('active',v==='plan');
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
  planDay=t;
  if(ws!==planWeekStart){planFlushTimers();planWeekStart=ws;planData=null;planLoad();}
  else planRender();
}
function planPickDay(date){planDay=date;planRender();}
function planRefresh(){planLoad({silent:true}).then(()=>{if(planStatus==='ready')showToast('Plan refreshed');});}
// Coming back to the app (for example from the home screen) refreshes the plan if it is on screen
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden&&planView==='plan'&&planPending===0&&!Object.keys(planTimers).length) planLoad({silent:true});
});

// ── Drawing the day view ──
function planItemHTML(it){
  if(it.type==='recipe'){
    const r=planRecipeOf(it), n=parseInt(it.servings)||PLAN_DEFAULT_SERVINGS;
    if(!r) return `<div class="pl-item">
      <div class="pl-main"><div class="pl-name pl-gone">${recipes.length?'Recipe no longer exists':'Loading recipes…'}</div></div>
      <button class="pl-more" onclick="planOpenAct('${it.id}')" aria-label="Item options">⋯</button></div>`;
    return `<div class="pl-item">
      <div class="pl-main" onclick="planOpenRecipe('${it.id}')"><div class="pl-name">${esc(r.name)}</div></div>
      <div class="pl-step"><div class="pl-step-row">
        <button class="pl-step-btn" onclick="planChangeServings('${it.id}',-1)" ${n<=1?'disabled':''} aria-label="Fewer servings">−</button>
        <span class="pl-step-val">${n}</span>
        <button class="pl-step-btn" onclick="planChangeServings('${it.id}',1)" ${n>=99?'disabled':''} aria-label="More servings">+</button>
      </div><div class="pl-step-cap">servings</div></div>
      <button class="pl-more" onclick="planOpenAct('${it.id}')" aria-label="Item options">⋯</button></div>`;
  }
  // food item
  const q=(it.quantity===null||it.quantity===undefined||it.quantity==='')?null:parseQty(it.quantity);
  const amount=q===null?'':(formatQty(q)+(it.unit?' '+it.unit:''));
  return `<div class="pl-item">
    <div class="pl-main"><div class="pl-name">${esc(it.name||'')}</div>${amount?`<div class="pl-sub">${esc(amount)}</div>`:''}</div>
    <button class="pl-more" onclick="planOpenAct('${it.id}')" aria-label="Item options">⋯</button></div>`;
}
function planSlotHTML(s,day){
  const list=(day&&day[s.key])||[];
  if(s.key==='snacks'&&!list.length)
    return `<button class="pl-snack-empty" onclick="openPlanAdd('snacks')">＋ Add snack</button>`;
  return `<div class="pl-slot">
    <div class="pl-slot-hdr"><span class="pl-slot-name">${s.label}</span>
      <button class="pl-add" onclick="openPlanAdd('${s.key}')" aria-label="Add to ${s.label}">＋</button></div>
    ${list.length?list.map(planItemHTML).join(''):'<div class="pl-empty">Nothing planned</div>'}
  </div>`;
}
function planRender(){
  const el=document.getElementById('planApp');
  if(!el||planView!=='plan') return;
  const today=todayStr();
  let h=`<div class="pl-weekbar">
    <button class="pl-nav" onclick="planShiftWeek(-1)" aria-label="Previous week">‹</button>
    <div class="pl-weeklbl">${planWeekLabel(planWeekStart)}</div>
    <button class="pl-nav" onclick="planShiftWeek(1)" aria-label="Next week">›</button>
    <button class="pl-nav pl-today" onclick="planGoToday()">Today</button>
    <button class="pl-nav" onclick="planRefresh()" aria-label="Refresh the plan">↻</button>
  </div><div class="pl-days">`;
  for(let i=0;i<7;i++){
    const date=planAddDays(planWeekStart,i), d=new Date(planParse(date));
    h+=`<button class="pl-day${date===planDay?' on':''}${date===today?' today':''}${planDayHasItems(date)?' has':''}" onclick="planPickDay('${date}')">
      <span class="pl-day-n" aria-label="${PLAN_DAY_SHORT[i]}">${PLAN_DAY_SHORT[i][0]}</span><span class="pl-day-d">${d.getUTCDate()}</span><span class="pl-day-dot"></span></button>`;
  }
  h+='</div>';
  if(planStatus==='loading'&&!planData){
    h+='<div class="pl-msg">Loading the plan…</div>';
  }else if(planStatus==='error'){
    h+=`<div class="pl-msg">${esc(planError)}<br><button class="pl-retry" onclick="planLoad()">Try again</button></div>`;
  }else if(planData){
    const day=planData.days[planDay];
    h+=`<div class="pl-dayhead">${planDayLabel(planDay)}${planDay===today?' <span class="pl-today-tag">Today</span>':''}</div>`;
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
function planRemoveItem(id){
  const f=planData&&planFindIn(planData,id); if(!f) return;
  if(planTimers[id]){clearTimeout(planTimers[id].t);delete planTimers[id];}
  const ws=planWeekStart;
  f.list.splice(f.index,1);
  planRender();
  planSave(ws,wk=>{
    const g=planFindIn(wk,id); if(!g) return false;
    g.list.splice(g.index,1);
  });
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
  document.getElementById('planActOverlay').style.display='flex';
}
function closePlanAct(){document.getElementById('planActOverlay').style.display='none';planActId=null;}
function planActRemove(){const id=planActId;closePlanAct();if(id)planRemoveItem(id);}

// ── The Add sheet (Recipe tab and Food tab) ──
let planAddSlot='dinner', planAddDate='', planAddTab='recipe', planAddRecipeId=null, planAddServings=PLAN_DEFAULT_SERVINGS, planSuggest=[];
function planSlotLabel(k){return (PLAN_SLOTS.find(s=>s.key===k)||{}).label||k;}
function openPlanAdd(slot){
  if(!planData) return;
  planAddSlot=slot; planAddDate=planDay; planAddTab='recipe'; planAddRecipeId=null; planAddServings=PLAN_DEFAULT_SERVINGS;
  const seen=new Map();
  Object.values(ingredients).forEach(list=>list.forEach(i=>{const n=(i.name||'').trim(); if(n&&!seen.has(n.toLowerCase())) seen.set(n.toLowerCase(),n);}));
  planNames=[...seen.values()].sort((a,b)=>a.localeCompare(b));
  document.getElementById('planAddTitle').textContent=`Add to ${planSlotLabel(slot)}`;
  planAddBuild();
  document.getElementById('planAddOverlay').style.display='flex';
}
function closePlanAdd(){document.getElementById('planAddOverlay').style.display='none';}
function planAddSwitch(tab){planAddTab=tab;planAddBuild();}
function planAddBuild(){
  const body=document.getElementById('planAddBody'), foot=document.getElementById('planAddFoot');
  document.getElementById('planTabRecipe').classList.toggle('on',planAddTab==='recipe');
  document.getElementById('planTabFood').classList.toggle('on',planAddTab==='food');
  if(planAddTab==='recipe'){
    body.innerHTML=`<div style="padding-top:12px"><input class="pk-search" id="planRecipeSearch" name="plan-recipe-search" type="text" autocomplete="off" placeholder="Search recipes…" oninput="planAddRecipeList()"></div>
      <div class="pk-list" id="planRecipeList"></div>`;
    planAddRecipeList(); planAddFootRecipe();
  }else{
    body.innerHTML=`<div class="fs-group-title">Food</div>
      <input class="pk-search" id="planFoodName" name="plan-food-name" type="text" autocomplete="off" placeholder="e.g. Brown Rice, Banana" oninput="planFoodSuggest()">
      <div class="pk-list" id="planFoodSuggest" style="display:none"></div>
      <div class="fs-group-title">Amount (optional)</div>
      <div class="pl-amount-row">
        <input class="pk-search" id="planFoodQty" name="plan-food-amount" type="text" inputmode="decimal" autocomplete="off" placeholder="Amount">
        <select class="pl-unit" id="planFoodUnit" name="plan-food-unit"><option value="">no unit</option>${UNITS.map(u=>`<option value="${u}">${u}</option>`).join('')}</select>
      </div>`;
    foot.innerHTML=`<button class="fs-show" onclick="planSubmitFood()">Add to ${planSlotLabel(planAddSlot)}</button>`;
  }
}
function planAddRecipeList(){
  const q=(document.getElementById('planRecipeSearch')||{value:''}).value.toLowerCase().trim();
  const list=recipes.filter(r=>!q||r.name.toLowerCase().includes(q)).slice().sort((a,b)=>a.name.localeCompare(b.name));
  document.getElementById('planRecipeList').innerHTML=list.length
    ?list.map(r=>`<button class="pk-item${String(r.id)===String(planAddRecipeId)?' sel':''}" onclick="planPickRecipe(${r.id})"><span>${esc(r.name)}</span>${String(r.id)===String(planAddRecipeId)?'<span class="cur">✓</span>':''}</button>`).join('')
    :'<div class="fs-empty" style="padding:14px">No recipes match.</div>';
}
function planPickRecipe(id){planAddRecipeId=id;planAddRecipeList();planAddFootRecipe();}
function planAddFootRecipe(){
  document.getElementById('planAddFoot').innerHTML=`<div class="pl-foot-row">
      <span class="pl-foot-lbl">Servings</span>
      <div class="pl-foot-step">
        <button class="pl-step-btn" onclick="planAddServ(-1)" ${planAddServings<=1?'disabled':''} aria-label="Fewer servings">−</button>
        <span class="pl-step-val">${planAddServings}</span>
        <button class="pl-step-btn" onclick="planAddServ(1)" ${planAddServings>=99?'disabled':''} aria-label="More servings">+</button>
      </div></div>
    <button class="fs-show" ${planAddRecipeId===null?'disabled':''} onclick="planSubmitRecipe()">Add to ${planSlotLabel(planAddSlot)}</button>`;
}
function planAddServ(d){planAddServings=Math.min(99,Math.max(1,planAddServings+d));planAddFootRecipe();}
function planSubmitRecipe(){
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
  planAddItem(planAddDate,planAddSlot,item);
  closePlanAdd();
}

document.getElementById('planAddOverlay').addEventListener('click',e=>{if(e.target.id==='planAddOverlay')closePlanAdd();});
document.getElementById('planActOverlay').addEventListener('click',e=>{if(e.target.id==='planActOverlay')closePlanAct();});
