// Starts the app (must load last): Escape key and init()

async function init() {
  const raw = await fetchFromGitHub(GITHUB_CONFIG, 'recipeGrid');
  if (!raw) return;
  adaptRecipes(raw);
  renderCourseBar();
  renderCards(recipes);
  if(typeof planView!=='undefined'&&planView==='plan') planRender();   // Plan was opened before the recipes arrived
}

document.addEventListener('keydown',e=>{if(e.key==='Escape'){
  if(document.getElementById('planDestOverlay').style.display==='flex'){closePlanDest();return;}
  if(document.getElementById('planActOverlay').style.display==='flex'){closePlanAct();return;}
  if(document.getElementById('planAddOverlay').style.display==='flex'){closePlanAdd();return;}
  if(document.getElementById('pickerOverlay').style.display==='flex'){closePicker();return;}
  closeFilterSheet();closeModal();closeEditor();
}});

init();
