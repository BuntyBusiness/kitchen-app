// Turning recipes.json into the lists the app uses, and updating them after a save

function adaptRecipes(raw) {
  raw.recipes.forEach(r => {
    const id = parseInt(r.id);
    recipes.push({
      id, name:r.name, cuisine:r.cuisine||'', sub:r.category||'', course:r.course||'',
      servings:r.servings, img:r.imageUrl, link:r.pageLink, source:r.source||'',
      cal:r.nutrition?.calories, protein:r.nutrition?.protein_g,
      carb:r.nutrition?.carbs_g, fat:r.nutrition?.fat_g,
      lastCooked:r.lastCooked||'',
    });
    ingredients[id] = (r.ingredients||[]).flatMap(g =>
      (g.items||[]).map(i => ({
        cat:g.category, qty:i.quantity+(i.unit?' '+i.unit:''),
        rawQty:parseQty(i.quantity), unit:i.unit||'', name:i.name,
        recipeId:subId(i.recipeId)
      }))
    );
    stepsData[id]    = (r.steps||[]).slice().sort((a,b)=>a.step-b.step);
    rawNutrition[id] = r.nutrition||{};
    rawRecipeMap[id] = r;
  });
}

function applyLocalUpdate(built){
  const id=parseInt(built.id);
  const ei=recipes.findIndex(r=>r.id===id);
  const adapted={
    id, name:built.name, cuisine:built.cuisine||'', sub:built.category||'', course:built.course||'',
    servings:built.servings, img:built.imageUrl, link:built.pageLink, source:built.source,
    cal:built.nutrition?.calories, protein:built.nutrition?.protein_g,
    carb:built.nutrition?.carbs_g, fat:built.nutrition?.fat_g,
    lastCooked:built.lastCooked||'',
  };
  if(ei!==-1){recipes[ei]=adapted;}else{recipes.push(adapted);}
  ingredients[id]=(built.ingredients||[]).flatMap(g=>(g.items||[]).map(i=>({
    cat:g.category,qty:i.quantity+(i.unit?' '+i.unit:''),
    rawQty:parseQty(i.quantity),unit:i.unit||'',name:i.name,
    recipeId:subId(i.recipeId)
  })));
  stepsData[id]=(built.steps||[]).slice().sort((a,b)=>a.step-b.step);
  rawNutrition[id]=built.nutrition||{};
  rawRecipeMap[id]=built;
}

// Sets a recipe's lastCooked on what is on screen (after it has been saved to GitHub). Changes the existing objects in place,
// so a recipe pop-up that is open sees the new date too.
function applyLastCookedLocal(id,dateStr){
  const r=recipes.find(x=>String(x.id)===String(id));
  if(r) r.lastCooked=dateStr;
  const raw=rawRecipeMap[parseInt(id)];
  if(raw) raw.lastCooked=dateStr;
}
