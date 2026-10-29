// Browse page: recipe tiles, search, Course buttons, filter sheet

// ─── INIT ─────────────────────────────────────────────────────────────────────
const searchInput   = document.getElementById('searchInput');
const recipeGrid    = document.getElementById('recipeGrid');
const resultsInfo   = document.getElementById('resultsInfo');

// ─── RENDER CARDS ─────────────────────────────────────────────────────────────
function renderCards(list) {
  recipeGrid.innerHTML='';
  // "28 recipes" with nothing filtered, "5 of 28 recipes" when a search or filter is on
  resultsInfo.textContent=(list.length===recipes.length)
    ?`${recipes.length} recipe${recipes.length!==1?'s':''}`
    :`${list.length} of ${recipes.length} recipe${recipes.length!==1?'s':''}`;
  if(!list.length){recipeGrid.innerHTML='<div class="no-results">No recipes match — try a different search or filter.</div>';return;}
  list.forEach((r,i)=>{
    const card=document.createElement('div');
    card.className='recipe-card';
    card.style.animationDelay=`${Math.min(i*.025,.35)}s`;
    const tc=cuisineTagClass[r.cuisine]||'tag-indian', em=cuisineEmoji[r.cuisine]||'🍴';
    const hasCal=(r.cal!==null&&r.cal!==undefined&&r.cal!=='');
    card.innerHTML=`
      <div class="card-thumb">${isPlaceholder(r.img)?`<div class="card-img-placeholder">${em}</div>`:`<img class="card-img" src="${r.img}" alt="${esc(r.name)}" onerror="this.parentNode.innerHTML='<div class=card-img-placeholder>${em}</div>'">`}</div>
      <div class="card-body">
        <div class="card-name">${r.name}</div>
        ${hasCal?`<div class="card-data">${ICON_FLAME}<span>${r.cal} kcal</span></div>`:''}
        ${r.lastCooked?`<div class="card-data">${ICON_CAL}<span>${formatDate(r.lastCooked)}</span></div>`:''}
      </div>`;
    card.addEventListener('click',()=>openModal(r));
    recipeGrid.appendChild(card);
  });
}

function filterRecipes(){
  const q=searchInput.value.toLowerCase().trim();
  return recipes.filter(r=>{
    if(activeCourse!=='All'&&r.course!==activeCourse) return false;
    if(activeCats.size&&!activeCats.has(r.sub)) return false;
    if(activeCuisines.size&&!activeCuisines.has(r.cuisine)) return false;
    if(q){
      const ings=(ingredients[r.id]||[]).map(i=>i.name.toLowerCase()).join(' ');
      if(!r.name.toLowerCase().includes(q)&&!r.cuisine.toLowerCase().includes(q)&&!r.sub.toLowerCase().includes(q)&&!(r.course||'').toLowerCase().includes(q)&&!ings.includes(q)) return false;
    }
    return true;
  });
}
function applyFilters(){renderCards(filterRecipes());updateFilterBtn();}
searchInput.addEventListener('input',applyFilters);
// Clear = empty the search box, the Course buttons (back to All) AND the filter-sheet chips
document.getElementById('clearBtn').addEventListener('click',()=>{
  searchInput.value=''; activeCats.clear(); activeCuisines.clear(); setCourse('All');
});

// ─── FILTER SHEET ─────────────────────────────────────────────────────────────
// The round button shows only a number: how many chips are ticked in the sheet.
function updateFilterBtn(){
  const n=activeCats.size+activeCuisines.size;
  const b=document.getElementById('filterBadge'), btn=document.getElementById('filterBtn');
  if(b){ b.textContent=n; b.classList.toggle('show',n>0); }
  if(btn){ btn.classList.toggle('on',n>0); btn.setAttribute('aria-label',n?`Open filters, ${n} active`:'Open filters'); }
}
function chipHTML(type,val,on){
  return `<button class="fs-chip${on?' on':''}" data-type="${type}" data-val="${esc(val)}" onclick="toggleFilterChip(this)">${esc(val)}</button>`;
}
// Chips come from the values the recipes really use, so the sheet never offers an empty choice
function renderFilterSheet(){
  const cats=[...new Set(recipes.map(r=>r.sub).filter(Boolean))].sort((a,b)=>a==='Other'?1:b==='Other'?-1:a.localeCompare(b));
  const cuis=[...new Set(recipes.map(r=>r.cuisine).filter(Boolean))].sort();
  document.getElementById('filterBody').innerHTML=`
    <div class="fs-group-title">Category</div>
    <div class="fs-chips">${cats.length?cats.map(c=>chipHTML('cat',c,activeCats.has(c))).join(''):'<span class="fs-empty">No categories yet</span>'}</div>
    <div class="fs-group-title">Cuisine</div>
    <div class="fs-chips">${cuis.length?cuis.map(c=>chipHTML('cuisine',c,activeCuisines.has(c))).join(''):'<span class="fs-empty">No cuisines yet</span>'}</div>`;
  updateFilterShowBtn();
}
function updateFilterShowBtn(){
  const n=filterRecipes().length;
  const b=document.getElementById('filterShowBtn');
  if(b) b.textContent=`Show ${n} recipe${n!==1?'s':''}`;
}
// Ticking a chip changes the list behind the sheet straight away; the chips themselves are not rebuilt
function toggleFilterChip(el){
  const set=el.dataset.type==='cat'?activeCats:activeCuisines, v=el.dataset.val;
  set.has(v)?set.delete(v):set.add(v);
  el.classList.toggle('on',set.has(v));
  applyFilters(); updateFilterShowBtn();
}
function clearSheetFilters(){
  activeCats.clear(); activeCuisines.clear();
  document.querySelectorAll('#filterBody .fs-chip').forEach(c=>c.classList.remove('on'));
  applyFilters(); updateFilterShowBtn();
}
function openFilterSheet(){
  renderFilterSheet();
  document.getElementById('filterOverlay').style.display='flex';
  document.body.style.overflow='hidden';
}
function closeFilterSheet(){
  document.getElementById('filterOverlay').style.display='none';
  document.body.style.overflow='';
}
document.getElementById('filterOverlay').addEventListener('click',e=>{if(e.target.id==='filterOverlay')closeFilterSheet();});

// Course buttons: All first, then the course list; the bar scrolls sideways.
// Tapping only switches the highlight (the buttons are not rebuilt, so the bar keeps its scroll position).
function renderCourseBar(){
  const bar=document.getElementById('courseBar');
  if(!bar) return;
  bar.innerHTML=['All',...COURSES].map(c=>`<button class="course-btn${c===activeCourse?' active':''}" data-course="${esc(c)}" onclick="setCourse(this.dataset.course)">${c}</button>`).join('');
}
function setCourse(c){
  activeCourse=c;
  document.querySelectorAll('#courseBar .course-btn').forEach(b=>b.classList.toggle('active',b.dataset.course===c));
  applyFilters();
}
