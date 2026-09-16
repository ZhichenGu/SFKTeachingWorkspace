/* Lightweight teacher identity layer: a shared teacher roster + per-teacher data
 * isolation, without accounts/passwords. On every open the site lands on a user
 * selection page; picking a teacher (or guest) enters the workspace.
 */
'use strict';
window.SFKUser=(()=>{
  const cloud=window.SFKCloud;
  const LAST='sfk-last-user',TKEY='sfk-teachers-v1';
  let _current=null,_active=false;

  function localTeachers(){try{return JSON.parse(localStorage.getItem(TKEY)||'[]');}catch{return[];}}
  async function loadTeachers(){
    if(cloud&&cloud.configured){try{return await cloud.listTeachers();}catch{return localTeachers();}}
    return localTeachers();
  }
  async function addTeacher(name){
    name=(name||'').trim();
    if(!name)throw Error('请输入教师姓名');
    if(cloud&&cloud.configured)return await cloud.addTeacher(name);
    const list=localTeachers();let t=list.find(x=>x.name===name);
    if(!t){t={id:((window.crypto&&crypto.randomUUID)?crypto.randomUUID():('t'+Date.now().toString(36)+Math.random().toString(36).slice(2,8))),name};list.push(t);localStorage.setItem(TKEY,JSON.stringify(list));}
    return t;
  }
  function readLast(){try{return JSON.parse(localStorage.getItem(LAST)||'null');}catch{return null;}}
  function writeLast(u){try{localStorage.setItem(LAST,JSON.stringify(u));}catch{}}
  function esc(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

  const st=document.createElement('style');st.textContent='.user-select{max-width:560px;margin:40px auto;padding:0 20px}.us-card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:28px}.us-card h2{margin:0 0 6px}.us-sub{color:#69748a;font-size:14px;margin:0 0 20px}.us-section-label{color:#69748a;font-size:12px;margin:18px 0 8px}.us-row{display:block;width:100%;text-align:left;padding:12px 14px;margin-bottom:8px;border:1px solid var(--line);border-radius:10px;background:#fff;cursor:pointer;font-size:15px}.us-row.recent{border-color:var(--blue);color:var(--blue);font-weight:500}.us-row:hover{border-color:var(--blue)}.us-add{display:flex;gap:10px;margin:16px 0}.us-add input{flex:1}.us-guest{display:block;width:100%;margin-top:8px;padding:12px;border:1px dashed var(--line);background:#f7f8fb;border-radius:10px;cursor:pointer;color:#444;font-size:15px}.us-status{color:#a52626;font-size:13px;min-height:18px;margin:10px 0 0}@media(max-width:520px){.us-card{padding:20px}}';document.head.append(st);

  const chip=document.createElement('div');chip.id='user-chip';chip.style.cssText='margin-left:auto;display:none';
  const chipBtn=document.createElement('button');chipBtn.type='button';chipBtn.id='user-chip-btn';chipBtn.textContent='访客 ▾';chipBtn.title='切换用户';chipBtn.style.cssText='min-height:38px;padding:0 14px';
  chipBtn.onclick=()=>showSelect();
  chip.append(chipBtn);
  const header=document.querySelector('header');if(header)header.append(chip);

  function updateChip(){if(_active){chip.style.display='';chipBtn.textContent=(_current?_current.name:'访客')+' ▾';}else{chip.style.display='none';}}

  const view=document.createElement('main');view.id='user-select';view.className='user-select';view.hidden=true;
  view.innerHTML='<div class="us-card"><h2>选择使用身份</h2><p class="us-sub">选择你的名字进入个人工作台（只看自己的签单）；或使用访客模式自由填写。</p><div id="us-recent"></div><div class="us-section-label">全部老师</div><div id="us-list"></div><div class="us-add"><input id="us-name" maxlength="24" placeholder="新老师姓名"><button type="button" id="us-add-btn">＋ Add User</button></div><button type="button" class="us-guest" id="us-guest">访客模式 · 自由填写</button><p class="us-status" id="us-status" role="status"></p></div>';
  document.body.append(view);

  function usRow(u,recent){
    const b=document.createElement('button');b.type='button';b.className='us-row'+(recent?' recent':'');
    b.innerHTML=(recent?'<span style="font-size:12px;color:#69748a;font-weight:400">最近使用</span><br>':'')+esc(u.name);
    b.onclick=()=>select(u);
    return b;
  }

  async function showSelect(){
    view.hidden=false;
    const dash=document.getElementById('dashboard');if(dash)dash.hidden=true;
    document.querySelector('main.layout').hidden=true;
    if(window.SFKBatch&&SFKBatch.view)SFKBatch.view.hidden=true;
    document.querySelector('h1').textContent='选择使用身份';
    $('us-status').textContent='';updateChip();
    $('us-recent').replaceChildren();$('us-list').replaceChildren();
    let teachers=[];
    try{teachers=await loadTeachers();}catch(e){$('us-status').textContent='读取教师列表失败：'+e.message;}
    const last=readLast();
    if(last)$('us-recent').append(usRow(last,true));
    teachers.filter(t=>!(last&&last.id===t.id)).forEach(t=>$('us-list').append(usRow(t,false)));
    if(!teachers.length&&!last)$('us-list').innerHTML='<p class="us-sub">还没有老师，用下方「＋ Add User」添加第一位。</p>';
    window.scrollTo(0,0);
  }
  function select(u){_current=u;_active=true;writeLast(u);updateChip();view.hidden=true;if(window.SFKShowDashboard)window.SFKShowDashboard();}
  function selectGuest(){_current=null;_active=true;updateChip();view.hidden=true;if(window.SFKShowDashboard)window.SFKShowDashboard();}

  $('us-add-btn').onclick=async()=>{const inp=$('us-name'),name=inp.value.trim();if(!name){$('us-status').textContent='请输入教师姓名';return;}try{const t=await addTeacher(name);inp.value='';_current=t;_active=true;writeLast(t);updateChip();view.hidden=true;if(window.SFKShowDashboard)window.SFKShowDashboard();}catch(e){$('us-status').textContent=e.message;}};
  $('us-guest').onclick=selectGuest;

  if(!location.hash.startsWith('#request='))showSelect();

  return {current:()=>_current,isActive:()=>_active,name:()=>_current?_current.name:'访客',view,showSelect};
})();
