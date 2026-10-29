// Reading and saving recipes.json in the kitchen-data repo (token, safe retry saver)

// ── GitHub helpers ────────────────────────────────────────────────────────────
async function ghGetFile(){
  const token=localStorage.getItem('gh_pat_token');
  const url=`https://api.github.com/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/contents/${GITHUB_CONFIG.path}?ref=${GITHUB_CONFIG.branch}&_=${Date.now()}`;   // _= makes every request unique so a stale cached copy is never returned
  const res=await fetch(url,{cache:'no-store',headers:{'Authorization':`token ${token}`,'Accept':'application/vnd.github.v3+json'}});
  if(!res.ok) throw new Error(`GitHub GET failed: ${res.status}`);
  const meta=await res.json();
  const bytes=Uint8Array.from(atob(meta.content.replace(/\n/g,'')),c=>c.charCodeAt(0));
  const parsed=JSON.parse(new TextDecoder('utf-8').decode(bytes));
  parsed._sha=meta.sha; return parsed;
}
// Gets the latest file, applies your change to it, and saves. If GitHub says the
// file changed in the meantime, it fetches again and retries (up to 4 times).
async function ghUpdateWithRetry(applyChange){
  let lastErr;
  for(let attempt=1;attempt<=4;attempt++){
    try{
      const raw=await ghGetFile();
      applyChange(raw);
      await ghPutFile(raw,raw._sha);
      return;
    }catch(e){
      lastErr=e;
      const msg=String(e.message||'');
      const isMismatch=/does not match|409|sha/i.test(msg);
      if(!isMismatch||attempt===4) throw e;
      await new Promise(r=>setTimeout(r,600*attempt));
    }
  }
  throw lastErr;
}
async function ghPutFile(data,sha){
  const token=localStorage.getItem('gh_pat_token');
  const url=`https://api.github.com/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/contents/${GITHUB_CONFIG.path}`;
  const {_sha,...clean}=data;
  const b64=btoa(unescape(encodeURIComponent(JSON.stringify(clean,null,2))));
  const body={message:'Update recipes via The Kitchen app',content:b64,branch:GITHUB_CONFIG.branch};
  if(sha) body.sha=sha;
  const res=await fetch(url,{method:'PUT',headers:{'Authorization':`token ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!res.ok){const e=await res.json();throw new Error(e.message||`GitHub PUT failed: ${res.status}`);}
}
