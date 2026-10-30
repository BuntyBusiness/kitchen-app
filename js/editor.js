// Edit form: ingredients, steps, sub-recipe picker, nutrition, save and delete

// ─── EDITOR ───────────────────────────────────────────────────────────────────
let editorRecipe  = null;
let edIngredients = [];
let edSteps       = [];

const editorOverlay = document.getElementById('editorOverlay');

function openEditor(r){
  closeModal();
  editorRecipe=r?rawRecipeMap[r.id]:null;
  if(editorRecipe){
    edIngredients=JSON.parse(JSON.stringify(editorRecipe.ingredients||[]));
    edSteps=JSON.parse(JSON.stringify(editorRecipe.steps||[])).sort((a,b)=>a.step-b.step);
  } else {
    edIngredients=[]; edSteps=[];
  }
  document.getElementById('editorTitle').textContent=editorRecipe?'Edit Recipe':'New Recipe';
  renderEditorBody();
  editorOverlay.style.display='flex';
  autosizeAllSteps();
  document.body.style.overflow='hidden';
}

function closeEditor(){
  editorOverlay.style.display='none';
  document.body.style.overflow='';
  editorRecipe=null; edIngredients=[]; edSteps=[];
}

function renderEditorBody(){
  const r=editorRecipe;
  // Form lists = the fixed lists PLUS every value already used by a recipe, so an
  // existing cuisine or category can never be missing (or silently lost on save).
  const usedCuisines=recipes.map(x=>x.cuisine).filter(Boolean);
  const usedCats=recipes.map(x=>x.sub).filter(Boolean);
  const cuList=[...new Set([...CUISINES,...usedCuisines,r?.cuisine].filter(Boolean))].sort();
  const catList=[...new Set([...CATEGORIES.filter(c=>c!=='Other'),...usedCats,r?.category].filter(Boolean))].sort().concat('Other');
  const cuOpts=cuList.map(c=>`<option value="${c}"${r?.cuisine===c?' selected':''}>${c}</option>`).join('');
  const catOpts=[...new Set(catList)].map(c=>`<option value="${c}"${r?.category===c?' selected':''}>${c}</option>`).join('');

  const courseOpts=COURSES.map(c=>`<option value="${c}"${(r?.course||'Main Course')===c?' selected':''}>${c}</option>`).join('');

  document.getElementById('editorBody').innerHTML=`
    <!-- Details -->
    <div class="ios-group-title">Details</div>
    <div class="ios-group">
      <div class="ios-row"><label class="ios-label">Name</label><input class="ios-input" autocomplete="off" id="ef-name" type="text" placeholder="Recipe name" value="${esc(r?.name||'')}"></div>
      <div class="ios-row"><label class="ios-label">Course</label><select class="ios-select" id="ef-course">${courseOpts}</select></div>
      <div class="ios-row"><label class="ios-label">Cuisine</label><select class="ios-select" id="ef-cuisine"><option value="">— select —</option>${cuOpts}</select></div>
      <div class="ios-row"><label class="ios-label">Category</label><select class="ios-select" id="ef-category"><option value="">— select —</option>${catOpts}</select></div>
      <div class="ios-row"><label class="ios-label">Source</label><input class="ios-input" autocomplete="off" id="ef-source" type="text" placeholder="Person, book or website" value="${esc(r?.source||'')}"></div>
      <div class="ios-row"><label class="ios-label">Servings</label><input class="ios-input" autocomplete="off" id="ef-servings" type="number" min="1" max="50" placeholder="4" value="${r?.servings||''}"></div>
      <div class="ios-row"><label class="ios-label">Page link</label><input class="ios-input" autocomplete="off" id="ef-link" type="url" placeholder="https://…" value="${esc(r?.pageLink||'')}"></div>
      <div class="ios-row"><label class="ios-label">Image URL</label><input class="ios-input" autocomplete="off" id="ef-img" type="url" placeholder="./images/recipes/…" value="${esc(r?.imageUrl||'')}"></div>
    </div>

    <!-- Ingredients -->
    <div class="ios-group-title">Ingredients</div>
    <div class="ios-group" id="ed-ing-group">
      ${renderEdIngredients()}
      <div class="ed-add-cat-row">
        <select class="ed-add-cat-sel" id="ed-new-cat-sel">${CAT_ORDER.map(c=>`<option>${c}</option>`).join('')}</select>
        <button class="ed-add-cat-btn" onclick="edAddCategory()">＋ Add category</button>
      </div>
    </div>

    <!-- Steps — paste-and-convert -->
    <div class="ios-group-title">Method steps</div>
    <div class="ios-group" id="ed-steps-group">
      ${renderEdStepsList()}
      <div class="steps-paste-wrap">
        <textarea class="steps-paste-ta" autocomplete="off" id="stepsPasteArea" placeholder="Paste or type steps here — one per line, or numbered like:&#10;1. Rinse the dal&#10;2. Heat oil in a pan&#10;3. Add the spices…"></textarea>
        <p class="steps-paste-hint">Tap a step above to edit its text. Each line you paste here becomes a new step. Numbers and dots are stripped automatically.</p>
        <div class="steps-paste-actions">
          <button class="steps-paste-btn steps-paste-convert" onclick="convertPastedSteps()">Convert to steps</button>
          <button class="steps-paste-btn steps-paste-clear" onclick="clearPasteArea()">Clear</button>
        </div>
      </div>
    </div>

    <!-- Nutrition (per serving) -->
    <div class="ios-group-title">Nutrition (per serving)</div>
    <div class="ios-group">
      ${NUTRITION_FIELDS.map(f=>`<div class="ios-row"><label class="ios-label">${f.label}</label><input class="ios-input nut-in" autocomplete="off" id="ef-nut-${f.key}" type="text" inputmode="decimal" placeholder="—" value="${esc(nutVal(r?.nutrition,f.key))}"><span class="ios-unit">${f.unit}</span></div>`).join('')}
    </div>

    ${r?`<div class="ios-danger-block"><button class="ios-link-btn danger bold ios-danger-btn" onclick="confirmDeleteRecipe()">Delete Recipe</button></div>`:''}
    <div style="height:20px"></div>`;
}

// ── Ingredient editor ─────────────────────────────────────────────────────────
function renderEdIngredients(){
  if(!edIngredients.length) return '';
  return edIngredients.map((group,gi)=>`
    <div class="ed-cat-hdr">
      <span class="ed-cat-lbl">${group.category}</span>
      <button class="ed-cat-add" onclick="edAddIngRow(${gi})">＋ item</button>
    </div>
    ${(group.items||[]).map((item,ii)=>`
      <div class="ed-ing-row" id="ing-${gi}-${ii}">
        <input class="ed-ing-qty" autocomplete="off" type="text" placeholder="qty" value="${esc(item.quantity||'')}" oninput="edUpdateIng(${gi},${ii},'quantity',this.value)">
        <select class="ed-ing-unit" onchange="edUpdateIng(${gi},${ii},'unit',this.value)">${unitOptions(item.unit)}</select>
        <input class="ed-ing-name" autocomplete="off" type="text" placeholder="ingredient" value="${esc(item.name||'')}" oninput="edUpdateIng(${gi},${ii},'name',this.value)">
        <button class="ed-ing-link${item.recipeId?' on':''}" aria-label="Link to a recipe" onclick="openRecipePicker(${gi},${ii})">${ICON_LINK}</button>
        <button class="ed-ing-del" onclick="edRemoveIng(${gi},${ii})">×</button>
      </div>
      ${item.recipeId?`<div class="ed-ing-sub"><span class="lk">${linkedLabel(item.recipeId)}</span> · <button onclick="edUnlink(${gi},${ii})">Unlink</button></div>`:''}`).join('')}`).join('');
}

// ── Sub-recipe links in the editor ────────────────────────────────────────────
function linkedLabel(id){
  const r=recipes.find(x=>String(x.id)===String(id));
  return r?`Linked to ${esc(r.name)}`:'Linked to a recipe that no longer exists';
}
let pickerTarget=null;   // {gi, ii}
function openRecipePicker(gi,ii){
  pickerTarget={gi,ii};
  document.getElementById('pickerSearch').value='';
  renderPickerList();
  document.getElementById('pickerOverlay').style.display='flex';
}
function closePicker(){
  document.getElementById('pickerOverlay').style.display='none';
  pickerTarget=null;
}
function renderPickerList(){
  if(!pickerTarget) return;
  const q=document.getElementById('pickerSearch').value.toLowerCase().trim();
  const item=edIngredients[pickerTarget.gi]?.items?.[pickerTarget.ii];
  const curId=item?subId(item.recipeId):null;
  const selfId=editorRecipe?parseInt(editorRecipe.id):null;
  const list=recipes.filter(r=>r.id!==selfId&&(!q||r.name.toLowerCase().includes(q)))
    .slice().sort((a,b)=>a.name.localeCompare(b.name));
  document.getElementById('pickerList').innerHTML=list.length
    ?list.map(r=>`<button class="pk-item" onclick="pickRecipe(${r.id})"><span>${esc(r.name)}</span>${r.id===curId?'<span class="cur">✓ current</span>':''}</button>`).join('')
    :'<div class="fs-empty" style="padding:14px">No recipes match.</div>';
  document.getElementById('pickerRemoveWrap').innerHTML=curId!==null
    ?'<button class="pk-remove" onclick="pickRecipe(null)">Remove link</button>':'';
}
function pickRecipe(id){
  if(!pickerTarget) return;
  const item=edIngredients[pickerTarget.gi]?.items?.[pickerTarget.ii];
  if(item){
    if(id===null) delete item.recipeId;
    else{
      item.recipeId=id;
      if(!(item.name||'').trim()){const r=recipes.find(x=>x.id===id); if(r) item.name=r.name;}
    }
  }
  closePicker();
  refreshEdIngredients();
}
function edUnlink(gi,ii){
  const item=edIngredients[gi]?.items?.[ii];
  if(item) delete item.recipeId;
  refreshEdIngredients();
}
document.getElementById('pickerOverlay').addEventListener('click',e=>{if(e.target.id==='pickerOverlay')closePicker();});

// Builds the <option> list for the unit dropdown. If a recipe already has a unit
// that is not in UNITS, it is kept as an extra option so nothing is lost.
function unitOptions(current){
  const cur=(current||'').trim();
  const list=(cur&&!UNITS.includes(cur))?[...UNITS,cur]:UNITS;
  return `<option value=""${cur===''?' selected':''}>—</option>`+
    list.map(u=>`<option value="${esc(u)}"${u===cur?' selected':''}>${esc(u)}</option>`).join('');
}

function edUpdateIng(gi,ii,field,val){if(edIngredients[gi]?.items?.[ii]) edIngredients[gi].items[ii][field]=val;}
function edAddIngRow(gi){edIngredients[gi].items.push({name:'',quantity:'',unit:''});refreshEdIngredients();}
function edRemoveIng(gi,ii){
  edIngredients[gi].items.splice(ii,1);
  if(!edIngredients[gi].items.length) edIngredients.splice(gi,1);
  refreshEdIngredients();
}
function edAddCategory(){
  const sel=document.getElementById('ed-new-cat-sel'), cat=sel?.value;
  if(!cat) return;
  if(edIngredients.find(g=>g.category===cat)){showToast(`"${cat}" already exists`);return;}
  edIngredients.push({category:cat,items:[{name:'',quantity:'',unit:''}]});
  refreshEdIngredients();
}
function refreshEdIngredients(){
  const grp=document.getElementById('ed-ing-group');
  if(!grp) return;
  const addRow=grp.querySelector('.ed-add-cat-row');
  grp.innerHTML=renderEdIngredients()+(addRow?addRow.outerHTML:'');
}

// ── Steps paste-and-convert ───────────────────────────────────────────────────
function renderEdStepsList(){
  if(!edSteps.length) return `<div class="ed-steps-empty" id="stepsEmptyMsg">No steps yet. Add some with the box below.</div>`;
  return edSteps.map((s,idx)=>`
    <div class="ed-step-row" id="ed-step-${idx}">
      <div class="ed-step-num">${idx+1}</div>
      <div class="ed-step-main">
        <div class="ed-step-grow" data-replicated-value="${esc(s.instruction||'')}"><textarea class="ed-step-text" autocomplete="off" rows="1" oninput="edUpdateStep(${idx},this.value);autosize(this)">${esc(s.instruction||'')}</textarea></div>
        ${idx>0?`<div class="ed-step-tools"><button class="ed-step-merge" onclick="edMergeStepUp(${idx})">↑ Merge into step ${idx}</button></div>`:''}
      </div>
      <button class="ed-step-del" onclick="edRemoveStep(${idx})">×</button>
    </div>`).join('');
}

// The grey box grows with its text: a hidden copy of the text sits behind the
// text box and gives the row its height (pure CSS, no measuring needed)
function autosize(el){if(el&&el.parentNode) el.parentNode.setAttribute('data-replicated-value',el.value);}
function autosizeAllSteps(){document.querySelectorAll('.ed-step-text').forEach(autosize);}

// Save what is typed in a step into the list
function edUpdateStep(idx,val){if(edSteps[idx]) edSteps[idx].instruction=val;}

// Join step idx onto the end of the step above it
function edMergeStepUp(idx){
  if(idx<1||!edSteps[idx]) return;
  const above=(edSteps[idx-1].instruction||'').trim();
  const here=(edSteps[idx].instruction||'').trim();
  edSteps[idx-1].instruction=[above,here].filter(Boolean).join(' ');
  edSteps.splice(idx,1);
  edSteps.forEach((st,i)=>st.step=i+1);
  refreshEdSteps();
  showToast(`Steps ${idx} and ${idx+1} merged`);
}

function convertPastedSteps(){
  const ta=document.getElementById('stepsPasteArea');
  if(!ta||!ta.value.trim()){showToast('Nothing to convert');return;}
  const lines=ta.value.split('\n')
    .map(l=>l.replace(/^\s*(\d+[\.\)]\s*|\-\s*|\*\s*)/,'').trim())
    .filter(l=>l.length>0);
  if(!lines.length){showToast('No steps found');return;}
  // Append to existing steps (don't wipe)
  const startIdx=edSteps.length;
  lines.forEach((line,i)=>edSteps.push({step:startIdx+i+1,instruction:line}));
  ta.value='';
  refreshEdSteps();
  showToast(`${lines.length} step${lines.length!==1?'s':''} added`);
}

function clearPasteArea(){
  const ta=document.getElementById('stepsPasteArea');
  if(ta) ta.value='';
}

function edRemoveStep(idx){
  edSteps.splice(idx,1);
  edSteps.forEach((s,i)=>s.step=i+1);
  refreshEdSteps();
}

function refreshEdSteps(){
  const grp=document.getElementById('ed-steps-group');
  if(!grp) return;
  const pasteWrap=grp.querySelector('.steps-paste-wrap');
  const pasted=document.getElementById('stepsPasteArea')?.value||'';
  grp.innerHTML=renderEdStepsList()+(pasteWrap?pasteWrap.outerHTML:'');
  const ta=document.getElementById('stepsPasteArea');
  if(ta) ta.value=pasted;
  autosizeAllSteps();
}

// ── Delete ────────────────────────────────────────────────────────────────────
function confirmDeleteRecipe(){
  if(!editorRecipe) return;
  if(!confirm(`Delete "${editorRecipe.name}"? This cannot be undone.`)) return;
  deleteRecipe(editorRecipe.id);
}
async function deleteRecipe(id){
  const token=localStorage.getItem('gh_pat_token');
  if(!token){showToast('No GitHub token');return;}
  showToast('Deleting…');
  try{
    await ghUpdateWithRetry(raw=>{
      raw.recipes=raw.recipes.filter(r=>String(r.id)!==String(id));
      raw.meta.count=raw.recipes.length;
    });
    const idx=recipes.findIndex(r=>r.id===parseInt(id));
    if(idx!==-1) recipes.splice(idx,1);
    delete ingredients[parseInt(id)]; delete stepsData[parseInt(id)];
    delete rawNutrition[parseInt(id)]; delete rawRecipeMap[parseInt(id)];
    closeEditor(); applyFilters(); showToast('Recipe deleted');
  } catch(e){showToast('Delete failed: '+e.message);}
}

// ── Save ──────────────────────────────────────────────────────────────────────
async function saveRecipe(){
  const btn=document.getElementById('editorSaveBtn');
  btn.disabled=true; btn.textContent='Saving…';
  try{
    const built=buildRecipeFromForm();
    if(!built.name){showToast('Name is required');btn.disabled=false;btn.textContent='Save';return;}
    const token=localStorage.getItem('gh_pat_token');
    if(!token){
      if(built.id===null) built.id=Math.max(0,...recipes.map(r=>r.id))+1;
      applyLocalUpdate(built); closeEditor(); applyFilters();
      showToast('Saved locally (no GitHub token)');
      return;
    }
    showToast('Saving to GitHub…');
    const isNewRecipe=(built.id===null);
    await ghUpdateWithRetry(raw=>{
      // A new recipe gets its id from the file just downloaded, so two people
      // adding at once can never receive the same number.
      if(isNewRecipe) built.id=Math.max(0,...raw.recipes.map(r=>parseInt(r.id)||0))+1;   // renumbered on every retry
      const ei=raw.recipes.findIndex(r=>String(r.id)===String(built.id));
      if(ei!==-1){raw.recipes[ei]=built;}else{raw.recipes.push(built);}
      raw.meta.count=raw.recipes.length;
    });
    applyLocalUpdate(built); closeEditor(); applyFilters(); showToast('Saved ✓');
  } catch(e){showToast('Save failed: '+e.message);}
  finally{btn.disabled=false;btn.textContent='Save';}
}

function buildRecipeFromForm(){
  const isNew=!editorRecipe;
  const newId=isNew?null:parseInt(editorRecipe.id);   // null = new recipe, numbered when saving

  // Capture live ingredient values from DOM
  const liveIngs=JSON.parse(JSON.stringify(edIngredients));
  document.querySelectorAll('.ed-ing-row').forEach(row=>{
    const parts=row.id.split('-'); const gi=parseInt(parts[1]),ii=parseInt(parts[2]);
    if(liveIngs[gi]?.items?.[ii]){
      liveIngs[gi].items[ii].quantity=storeQty(row.querySelector('.ed-ing-qty')?.value||'');
      liveIngs[gi].items[ii].unit=row.querySelector('.ed-ing-unit')?.value||'';
      liveIngs[gi].items[ii].name=row.querySelector('.ed-ing-name')?.value||'';
    }
  });
  const cleanIngs=liveIngs.map(g=>({...g,items:g.items.filter(i=>i.name.trim())})).filter(g=>g.items.length);
  const cleanSteps=edSteps.filter(s=>(s.instruction||'').trim()).map((s,i)=>({step:i+1,instruction:s.instruction}));

  return {
    id:newId,
    ...(editorRecipe?.slug?{slug:editorRecipe.slug}:{}),
    name:(document.getElementById('ef-name')?.value||'').trim(),
    source:(document.getElementById('ef-source')?.value||'').trim(),
    cuisine:document.getElementById('ef-cuisine')?.value||'',
    category:document.getElementById('ef-category')?.value||'',
    course:document.getElementById('ef-course')?.value||'Main Course',
    servings:parseInt(document.getElementById('ef-servings')?.value)||4,
    imageUrl:(document.getElementById('ef-img')?.value||'').trim(),
    pageLink:(document.getElementById('ef-link')?.value||'').trim(),
    // Nutrition comes from the form (blank = null, values are numbers); any other keys already stored are kept
    nutrition:{...(editorRecipe?.nutrition||{}),...Object.fromEntries(NUTRITION_FIELDS.map(f=>[f.key,parseNut(document.getElementById('ef-nut-'+f.key)?.value)]))},
    ingredients:cleanIngs,
    steps:cleanSteps,
    linkedRecipes:editorRecipe?.linkedRecipes||[],
    // lastCooked is not in the form, so carry it over or it would be lost on every edit-save
    ...(editorRecipe?.lastCooked?{lastCooked:editorRecipe.lastCooked}:{}),
  };
}
