// Constants and lists: config, courses, cuisines, categories, units, icons, nutrition fields

const GITHUB_CONFIG = { owner:"BuntyBusiness", repo:"kitchen-data", path:"data/recipes.json", branch:"main" };

// ─── DATA ────────────────────────────────────────────────────────────────────
let recipes      = [];
let ingredients  = {};   // {id: [{cat,qty,rawQty,unit,name}]}
let stepsData    = {};   // {id: [{step,instruction}]}
let rawNutrition = {};   // {id: nutrition obj} — static, never scaled
let rawRecipeMap = {};   // {id: full raw JSON recipe}

const CUISINES   = ['Indian','Italian','Mexican','Middle Eastern','Sri Lankan','Asian','Western','Cocktails'];
// Course = which part of the meal (exactly one per recipe). Order = order of the buttons on the Browse bar.
const COURSES    = ['Main Course','Drinks','Breakfast','Snack','Dessert','Bread','Soup','Salad','Side','Sauce','Other'];
let   activeCourse = 'All';
// Filter sheet selections (Category and Cuisine chips). Within one group any ticked chip matches;
// across groups every group with a tick must match.
const activeCats     = new Set();
const activeCuisines = new Set();
// Category = type of dish (extra tag; used in the filter sheet later)
const CATEGORIES = ['Beans / Lentils','Biryani','Bowl','Burger','Cake','Cocktail','Curry','Dal','Dip','Gravy','Juice','Noodles','Pancakes','Pasta','Pickle','Pizza','Rice / Grains','Sauce','Other'];
// Fixed list of units for the ingredient editor dropdown. Add new ones here if you need them.
const UNITS = ['g','kg','ml','l','tsp','tbsp','cup','clove','piece','serving','pinch','dash','bunch','sprig','slice','can'];
const CAT_ORDER  = ['Vegetables','Legumes/Dals','Grains/Flour','Dairy','Nuts/Coconut','Spices (Powder)','Spices (Whole/Seeds)','Fresh Aromatics','Oils/Fats','Alcohol/Cocktail','Citrus/Acid','Liquids','Fruits','Salt/Seasonings','Other'];

const ICON_LINK='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>';

const cuisineTagClass = {'Indian':'tag-indian','Cocktails':'tag-cocktails','Mexican':'tag-mexican','Sri Lankan':'tag-sri-lankan','Asian':'tag-asian','Western':'tag-western'};
const cuisineEmoji    = {'Indian':'🍛','Cocktails':'🍹','Mexican':'🌮','Sri Lankan':'🥥','Asian':'🥢','Western':'🍽️'};

const ICON_FLAME='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.3 1.4 1 2.2 1.8 2.5C10.5 8.5 11 5.5 12 3z"/></svg>';
const ICON_CAL='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><line x1="3.5" y1="10" x2="20.5" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/></svg>';
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const NUTRITION_FIELDS=[
  {key:'calories',label:'Calories',unit:'kcal'},
  {key:'protein_g',label:'Protein',unit:'g'},
  {key:'carbs_g',label:'Carbs',unit:'g'},
  {key:'fat_g',label:'Fat',unit:'g'},
  {key:'fiber_g',label:'Fiber',unit:'g'},
  {key:'sugars_g',label:'Sugar',unit:'g'},
  {key:'saturatedFat_g',label:'Sat fat',unit:'g'},
  {key:'sodium_mg',label:'Sodium',unit:'mg'},
  {key:'cholesterol_mg',label:'Cholesterol',unit:'mg'},
];
