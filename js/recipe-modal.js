// Recipe pop-up: scaler, tabs, last cooked, sub-recipe links and Back

// ─── COOK MODE STATE ─────────────────────────────────────────────────────────
let currentRecipe      = null;
let currentServings    = 1;
let checkedIngredients = new Set();
let checkedSteps       = new Set();
let activeTab          = 'ingredients';

// ─── VIEW MODAL ───────────────────────────────────────────────────────────────
const overlay      = document.getElementById('modalOverlay');
const modalImgWrap = document.getElementById('modalImgWrap');
const modalHero    = document.getElementById('modalHero');
const modalBody    = document.getElementById('modalBody');

// Hero: name, one muted line (cuisine · course · last cooked) and a soft Servings row
function renderModalHero(r) {
  const meta=[r.cuisine,r.course,r.lastCooked?`gobbled ${formatDate(r.lastCooked)}`:''].filter(Boolean).join(' · ');
  modalHero.innerHTML=`
    <div class="mh-title">${r.name}</div>
    <div class="mh-sub"><span>${meta}</span><button class="mh-edit-btn" onclick="openEditor(currentRecipe)">Edit</button></div>
    <div class="scaler-row">
      <span class="scaler-lbl">Servings</span>
      <span class="scaler-ctl">
        <button class="scaler-btn" onclick="changeServings(-1)" ${currentServings<=1?'disabled':''} aria-label="Fewer servings">−</button>
        <span class="scaler-val">${currentServings}</span>
        <button class="scaler-btn" onclick="changeServings(1)" ${currentServings>=20?'disabled':''} aria-label="More servings">+</button>
      </span>
    </div>`;
}

// Nutrition tab — static, never affected by scaler. A value that is not recorded shows as a dash.
function nutCell(v,unit,label,hl){
  const has=(v!==null&&v!==undefined&&v!=='');
  return `<div class="nut-cell"><div class="nut-val${hl?' hl':''}">${has?v+unit:'—'}</div><div class="nut-lbl">${label}</div></div>`;
}
function renderNutritionTab(r) {
  const nut=rawNutrition[r.id]||{};
  return `
    <div class="nut-panel" style="margin-top:4px">
      <div class="nut-panel-hdr">
        <span class="nut-panel-lbl">Nutrition</span>
        <span class="nut-panel-sub">per serving · recipe makes ${r.servings}</span>
      </div>
      <div class="nut-grid">
        ${nutCell(nut.calories,'','Calories',true)}
        ${nutCell(nut.protein_g,'g','Protein')}
        ${nutCell(nut.carbs_g,'g','Carbs')}
        ${nutCell(nut.fat_g,'g','Fat')}
        ${nutCell(nut.fiber_g,'g','Fiber')}
        ${nutCell(nut.sugars_g,'g','Sugar')}
        ${nutCell(nut.saturatedFat_g,'g','Sat Fat')}
        ${nutCell(nut.sodium_mg,'mg','Sodium')}
        ${nutCell(nut.cholesterol_mg,'mg','Cholesterol')}
      </div>
    </div>`;
}

function renderIngredientsTab(r, scale) {
  const ings=ingredients[r.id]||[];
  const byCat={};
  ings.forEach((item,idx)=>{(byCat[item.cat]=byCat[item.cat]||[]).push({...item,idx});});
  const sortedCats=Object.keys(byCat).sort((a,b)=>{
    const ia=CAT_ORDER.indexOf(a),ib=CAT_ORDER.indexOf(b);
    return (ia<0?99:ia)-(ib<0?99:ib);
  });
  const ingHTML=sortedCats.length
    ?sortedCats.map(cat=>`
      <div class="ing-cat" style="--cc:${catColor(cat)}">
        <div class="ing-cat-name">${esc(cat)}</div>
        <ul class="ing-list">
          ${byCat[cat].map(item=>{
            const sq=(scale!==1&&item.rawQty!==null)?scaleQty(item.rawQty,item.unit,scale):item.qty;
            const cls=checkedIngredients.has(item.idx)?' checked':'';
            const sub=item.recipeId!==null&&item.recipeId!==undefined?recipes.find(x=>x.id===item.recipeId):null;
            return `<li class="ing-row${cls}${sub?' linked':''}" data-idx="${item.idx}" onclick="toggleIngredient(${item.idx})">
              <span class="ing-qty">${sq||'—'}</span>
              <span class="ing-name">${item.name}</span>
              ${sub?`<button class="ing-open" aria-label="Open ${esc(sub.name)}" onclick="event.stopPropagation();openSubRecipe(${sub.id})">${ICON_LINK}</button>`:''}
            </li>`;
          }).join('')}
        </ul>
      </div>`).join('')
    :'<p class="no-ings">No ingredient details available</p>';
  return `
    ${ings.length?`<div class="ing-count" id="ingCounter">${checkedIngredients.size}/${ings.length} checked</div>`:''}
    <div class="ing-section">
      <div class="ing-categories">${ingHTML}</div>
    </div>`;
}

function renderMethodTab(r) {
  const steps=stepsData[r.id]||[];
  if(!steps.length) return `<div class="no-steps">No method added yet.<br>Tap <strong>✎ Edit</strong> to add steps.</div>`;
  return `
    <div class="steps-progress" id="stepsProgress">${checkedSteps.size} of ${steps.length} steps done</div>
    <div class="steps-list">
      ${steps.map((s,idx)=>{
        const cls=checkedSteps.has(idx)?' checked':'';
        return `<div class="step-row${cls}" data-step="${idx}" onclick="toggleStep(${idx})">
          <div class="step-num">${checkedSteps.has(idx)?'✓':s.step}</div>
          <div class="step-text">${s.instruction}</div>
        </div>`;
      }).join('')}
    </div>`;
}

// Last gobbled: label, date, clear and the gobble button (a hungry round face with crumbs flying out) on one row, inside the recipe pop-up
const ICON_GOBBLE='<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10.5" cy="12" r="7.5"/><circle cx="9" cy="8.9" r=".7" fill="currentColor"/><path d="M5.8 13.4h9.4c0 3-2.1 4.7-4.7 4.7s-4.7-1.7-4.7-4.7z"/><path d="M8.6 16.7c.5-1 1.4-1.4 1.9-1.4s1.4.4 1.9 1.4"/><path d="M19 6.4l1.5-.8M21.2 11l1.4.3M19.4 16.8l1.2 1"/></svg>';
function renderCookedRow(r){
  const d=r.lastCooked||'';
  return `<span class="cooked-lbl">Last Gobbled</span>
    <input class="cooked-date" id="cookedDate" type="date" max="${todayStr()}" value="${d}" onchange="setLastCooked(this.value)">
    ${d?`<button class="cooked-clear" onclick="setLastCooked('')" aria-label="Clear the date">✕</button>`:''}
    <button class="cooked-btn" id="cookedBtn" onclick="setLastCooked(todayStr())" title="Gobbled today" aria-label="Gobbled today">${ICON_GOBBLE}</button>`;
}

// Saves ONLY the lastCooked date of one recipe, on top of the freshly downloaded file
// (same retry saver as everything else), so nothing else in the recipe can be changed.
async function setLastCooked(dateStr){
  const r=currentRecipe; if(!r) return;
  const id=r.id;
  dateStr=(dateStr||'').trim();
  if(dateStr&&!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)){showToast('Please pick a valid date');return;}
  const row=document.getElementById('cookedRow');
  row?.querySelectorAll('button,input').forEach(el=>el.disabled=true);
  try{
    const token=localStorage.getItem('gh_pat_token');
    if(token){
      showToast('Saving…');
      await ghUpdateWithRetry(raw=>{
        const rr=raw.recipes.find(x=>String(x.id)===String(id));
        if(!rr) throw new Error('Recipe not found in the file');
        if(dateStr) rr.lastCooked=dateStr; else delete rr.lastCooked;
      });
    }
    // update what is on screen
    const li=recipes.findIndex(x=>x.id===id);
    if(li!==-1) recipes[li].lastCooked=dateStr;
    if(rawRecipeMap[id]){ if(dateStr) rawRecipeMap[id].lastCooked=dateStr; else delete rawRecipeMap[id].lastCooked; }
    showToast(token?(dateStr?'Saved ✓':'Date cleared ✓'):'Saved locally (no GitHub token)');
    applyFilters();
  }catch(e){
    showToast('Save failed: '+e.message);
  }finally{
    const cur=recipes.find(x=>x.id===id);
    const rowNow=document.getElementById('cookedRow');
    if(cur&&rowNow&&currentRecipe&&currentRecipe.id===id){ rowNow.innerHTML=renderCookedRow(cur); renderModalHero(cur); }
  }
}

function renderModalBody(r, scale) {
  const steps=stepsData[r.id]||[];
  modalBody.innerHTML=`
    <div class="cooked-row" id="cookedRow">${renderCookedRow(r)}</div>
    <div class="modal-tab-bar">
      <button class="modal-tab-btn${activeTab==='ingredients'?' active':''}" onclick="switchTab('ingredients',this)">Ingredients</button>
      <button class="modal-tab-btn${activeTab==='method'?' active':''}" onclick="switchTab('method',this)">Method${steps.length?` (${steps.length})`:''}</button>
      <button class="modal-tab-btn${activeTab==='nutrition'?' active':''}" onclick="switchTab('nutrition',this)">Nutrition</button>
    </div>
    <div class="modal-tab-panel${activeTab==='ingredients'?' active':''}" id="tabIngredients">${renderIngredientsTab(r,scale)}</div>
    <div class="modal-tab-panel${activeTab==='method'?' active':''}" id="tabMethod">${renderMethodTab(r)}</div>
    <div class="modal-tab-panel${activeTab==='nutrition'?' active':''}" id="tabNutrition">${renderNutritionTab(r)}</div>`;
}

function switchTab(tab,btn){
  activeTab=tab;
  document.querySelectorAll('.modal-tab-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.modal-tab-panel').forEach(p=>p.classList.remove('active'));
  if(btn) btn.classList.add('active');
  const ids={ingredients:'tabIngredients',method:'tabMethod',nutrition:'tabNutrition'};
  const p=document.getElementById(ids[tab]); if(p) p.classList.add('active');
}

function toggleIngredient(idx){
  checkedIngredients.has(idx)?checkedIngredients.delete(idx):checkedIngredients.add(idx);
  const row=document.querySelector(`.ing-row[data-idx="${idx}"]`);
  if(row) row.classList.toggle('checked',checkedIngredients.has(idx));
  const ings=ingredients[currentRecipe.id]||[];
  const counter=document.getElementById('ingCounter');
  if(counter) counter.textContent=`${checkedIngredients.size}/${ings.length} checked`;
}

function toggleStep(idx){
  checkedSteps.has(idx)?checkedSteps.delete(idx):checkedSteps.add(idx);
  const row=document.querySelector(`.step-row[data-step="${idx}"]`);
  if(row){
    row.classList.toggle('checked',checkedSteps.has(idx));
    const ne=row.querySelector('.step-num');
    const steps=stepsData[currentRecipe.id]||[];
    if(ne) ne.textContent=checkedSteps.has(idx)?'✓':String(steps[idx]?.step??idx+1);
  }
  const prog=document.getElementById('stepsProgress');
  if(prog) prog.textContent=`${checkedSteps.size} of ${(stepsData[currentRecipe.id]||[]).length} steps done`;
}

function changeServings(delta){
  const next=currentServings+delta;
  if(next<1||next>20) return;
  currentServings=next;
  const scale=currentServings/currentRecipe.servings;
  renderModalHero(currentRecipe);
  // Patch ingredients tab only — nutrition stays static
  const ingPanel=document.getElementById('tabIngredients');
  if(ingPanel) ingPanel.innerHTML=renderIngredientsTab(currentRecipe,scale);
}

// ── Sub-recipes: open on top, Back returns to exactly where you were ──────────
let modalStack=[];   // earlier recipes (with servings, ticks, tab and scroll position)
function updateBackBar(){
  const bar=document.getElementById('backBar'); if(!bar) return;
  if(!modalStack.length){bar.style.display='none';bar.innerHTML='';return;}
  const prev=modalStack[modalStack.length-1].recipe;
  bar.innerHTML=`<button class="back-btn" onclick="backFromSubRecipe()">‹ Back to ${esc(prev.name)}</button>`;
  bar.style.display='block';
}
function openSubRecipe(id){
  const sub=recipes.find(x=>x.id===id);
  if(!sub||!currentRecipe) return;
  modalStack.push({recipe:currentRecipe,servings:currentServings,ing:new Set(checkedIngredients),steps:new Set(checkedSteps),tab:activeTab,scroll:document.getElementById('modalScroll').scrollTop});
  showRecipe(sub,sub.servings,new Set(),new Set(),'ingredients');
  document.getElementById('modalScroll').scrollTop=0;
}
function backFromSubRecipe(){
  const s=modalStack.pop(); if(!s) return;
  const cur=recipes.find(x=>x.id===s.recipe.id)||s.recipe;   // in case it was changed meanwhile
  showRecipe(cur,s.servings,s.ing,s.steps,s.tab);
  document.getElementById('modalScroll').scrollTop=s.scroll;
}
function showRecipe(r,servings,ing,steps,tab){
  currentRecipe=r; currentServings=servings;
  checkedIngredients=ing; checkedSteps=steps; activeTab=tab;
  const em=cuisineEmoji[r.cuisine]||'🍴', hasImg=!isPlaceholder(r.img), hasLink=!!r.link;
  modalImgWrap.innerHTML=hasImg
    ?`<img class="modal-img" src="${r.img}" alt="${r.name}"${hasLink?` onclick="window.open('${r.link}','_blank')" title="Open recipe page"`:''} onerror="this.parentNode.innerHTML='<div class=modal-img-placeholder>${em}</div>'">${hasLink?'<div class="img-link-hint">↗ Open recipe page</div>':''}`
    :`<div class="modal-img-placeholder"${hasLink?` onclick="window.open('${r.link}','_blank')" style="cursor:pointer"`:''} >${em}</div>${hasLink?'<div class="img-link-hint">↗ Open recipe page</div>':''}`;
  renderModalHero(r);
  renderModalBody(r,servings/r.servings);
  updateBackBar();
}

function openModal(r){
  modalStack=[];
  showRecipe(r,r.servings,new Set(),new Set(),'ingredients');
  document.getElementById('modalScroll').scrollTop=0;
  overlay.classList.add('open');
  document.body.style.overflow='hidden';
}

function closeModal(){
  modalStack=[]; updateBackBar();
  overlay.classList.remove('open');
  document.body.style.overflow='';
  currentRecipe=null; checkedIngredients.clear(); checkedSteps.clear(); activeTab='ingredients';
}

document.getElementById('modalClose').addEventListener('click',closeModal);
overlay.addEventListener('click',e=>{if(e.target===overlay)closeModal();});
