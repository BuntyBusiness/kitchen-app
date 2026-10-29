// Starts the app (must load last): Escape key and init()

async function init() {
  const raw = await fetchFromGitHub(GITHUB_CONFIG, 'recipeGrid');
  if (!raw) return;
  adaptRecipes(raw);
  renderCourseBar();
  renderCards(recipes);
}

document.addEventListener('keydown',e=>{if(e.key==='Escape'){
  if(document.getElementById('pickerOverlay').style.display==='flex'){closePicker();return;}
  closeFilterSheet();closeModal();closeEditor();
}});

init();
