// Small helpers: quantities and fractions, dates, esc(), nutrition parsing, toast message

// recipeId on an ingredient (sub-recipe link) as a whole number, or null when not linked
function subId(v){const n=parseInt(v);return (v===null||v===undefined||v===''||isNaN(n))?null:n;}

// Reads "1/2", "1 1/2", "0.5", "1½", "2" and returns a number (or null if unreadable, e.g. "2-3")
function parseQty(q) {
  if (q===null||q===undefined) return null;
  let s=String(q).trim();
  if(!s) return null;
  const uni={'½':.5,'¼':.25,'¾':.75,'⅓':1/3,'⅔':2/3,'⅛':.125,'⅜':.375,'⅝':.625,'⅞':.875};
  let total=0, found=false;
  for(const ch in uni){ if(s.includes(ch)){ total+=uni[ch]; s=s.replace(ch,' '); found=true; } }
  s=s.trim();
  if(s){
    for(const p of s.split(/\s+/)){
      let v;
      if(/^\d+\/\d+$/.test(p)){ const [a,b]=p.split('/').map(Number); if(!b) return null; v=a/b; }
      else if(/^\d*\.?\d+$/.test(p)) v=parseFloat(p);
      else return null;
      total+=v; found=true;
    }
  }
  return (found&&total>0)?total:null;
}

// Shows a number nicely: 0.75 → ¾, 1.5 → 1½, 312.5 → 313
function formatQty(val) {
  if(val>=20) return String(Math.round(val));
  const fr=[[0,''],[1/8,'⅛'],[1/4,'¼'],[1/3,'⅓'],[3/8,'⅜'],[1/2,'½'],[5/8,'⅝'],[2/3,'⅔'],[3/4,'¾'],[7/8,'⅞'],[1,'']];
  let whole=Math.floor(val), frac=val-whole, best=fr[0];
  fr.forEach(f=>{ if(Math.abs(f[0]-frac)<Math.abs(best[0]-frac)) best=f; });
  if(Math.abs(best[0]-frac)>0.03) return String(Math.round(val*100)/100);
  if(best[0]===1) whole+=1;
  if(!best[1]) return String(whole);
  return (whole?whole:'')+best[1];
}

function scaleQty(rawQty, unit, scale) {
  if (rawQty===null) return '';
  const d = formatQty(rawQty*scale);
  return unit ? d+' '+unit : d;
}

function isPlaceholder(url){return !url||url.includes('recipe_image_placeholder')}

// "2026-10-24" -> "24 Oct 2026" (read as plain text, so time zones cannot shift the day)
function formatDate(s){
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||'');
  if(!m) return s||'';
  return `${parseInt(m[3])} ${MONTHS[parseInt(m[2])-1]||''} ${m[1]}`;
}
// Today's date on this device, as YYYY-MM-DD
function todayStr(){
  const d=new Date(), p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}

function nutVal(n,key){const v=n?n[key]:null;return (v===null||v===undefined)?'':String(v);}
// Blank or unreadable = null; "12,5" and "12.5" both become the number 12.5
function parseNut(v){
  const t=String(v||'').trim().replace(',','.');
  if(!t) return null;
  const n=Number(t);
  return (isFinite(n)&&n>=0)?n:null;
}

function esc(s){return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')}

// Plain numbers are stored as numbers ("2" -> 2); things like "1/2" or "2-3" stay as typed
function storeQty(v){
  const t=String(v).trim();
  return /^\d+(\.\d+)?$/.test(t)?Number(t):t;
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let _toastTimer;
function showToast(msg){
  const t=document.getElementById('saveToast');
  t.textContent=msg; t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer=setTimeout(()=>t.classList.remove('show'),2800);
}
