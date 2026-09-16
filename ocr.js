/* Schedule OCR: upload a timetable screenshot -> Google Cloud Vision (via Edge
 * Function) -> parse rows -> confirm/edit -> fill content -> batch create links.
 * Reuses the existing repository / compactRecord / publish link pipeline.
 */
'use strict';
window.SFKOCR=(()=>{
  const cloud=window.SFKCloud,repo=window.SFKRepo;
  if(!repo||!cloud)return {show(){},hide(){},view:null};
  const uid=()=>Math.random().toString(36).slice(2,10);
  const newRow=()=>({key:uid(),selected:true,studentName:'',courseName:'',lessonDate:'',checkIn:'',checkOut:'',teacherName:'',content:'',homework:'',status:'new',link:'',error:'',id:null,revision:0});

  let stage='upload',rows=[],imageDataUrl=null,showMineOnly=true,busy=false;

  const style=document.createElement('style');
  style.textContent='.ocr-view{max-width:1428px;margin:30px auto;padding:0 24px}.ocr-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:16px}.ocr-bar h2{margin:0}.ocr-status{color:#69748a;font-size:14px;line-height:1.6}.dropzone{border:2px dashed var(--line);border-radius:16px;background:#fff;padding:44px 20px;text-align:center;cursor:pointer;color:#69748a}.dropzone.drag{border-color:var(--blue);background:#eef3ff}.dropzone strong{color:#202637;font-size:16px}.ocr-preview{max-width:100%;max-height:320px;margin:16px auto 0;border-radius:12px;border:1px solid var(--line);display:block}.ocr-section{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:16px}.ocr-head{display:grid;grid-template-columns:44px 130px 130px 120px 130px 130px 120px 130px;gap:10px;padding:0 4px 8px;color:#69748a;font-size:13px}.ocr-row{display:grid;grid-template-columns:44px 130px 130px 120px 130px 130px 120px 130px;gap:10px;align-items:start;background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px;margin-bottom:10px}.ocr-row.done{border-color:#9fe1cb}.ocr-row select,.ocr-row input{width:100%}.ocr-row textarea{width:100%;resize:vertical;min-height:46px}.ocr-row .cell{min-width:0}.ocr-actions{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin:14px 0}.ocr-actions button{min-height:40px}.apply-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:10px}.apply-grid textarea{width:100%;resize:vertical;min-height:64px}.copyall{background:#f7f8fb;border:1px dashed var(--line);border-radius:10px;padding:14px;margin-top:12px;white-space:pre-wrap;font-size:13px;color:#333;word-break:break-all}.badge{padding:4px 8px;border-radius:8px;font-size:12px}@media(max-width:860px){.ocr-view{padding:0 14px 90px;margin-top:16px}.ocr-head{display:none}.ocr-row{display:flex;flex-direction:column;gap:10px;padding:14px}.ocr-row .cell{padding-left:0}.ocr-row .cell::before{content:attr(data-label);display:block;font-size:12px;color:#69748a;margin-bottom:4px}.apply-grid{grid-template-columns:1fr}}';
  document.head.append(style);

  const view=document.createElement('main');view.className='ocr-view';view.id='ocr-view';view.hidden=true;
  view.innerHTML='<div class="ocr-bar"><div><h2>课表识别新建</h2><p class="ocr-status">上传课表截图，自动识别学生 / 课程 / 时间，确认后批量生成签单。</p></div><div><button type="button" id="ocr-back">← 返回管理</button></div></div>'+
   '<div id="ocr-stage"></div><p class="ocr-status" id="ocr-status" role="status"></p>';
  document.body.append(view);

  const $=id=>document.getElementById(id);
  const stageEl=()=>$('ocr-stage');
  function status(t){$('ocr-status').textContent=t||'';}
  const curUser=()=>window.SFKUser&&SFKUser.current();

  function pad(n){return String(n).padStart(2,'0');}
  function linesFromWords(words){
    if(!words||!words.length)return[];
    const sorted=[...words].sort((a,b)=>a.y-b.y||a.x-b.x),lines=[];
    for(const w of sorted){
      let line=lines.find(l=>Math.abs(l.y-w.y)<=(w.h||l.h||20)*0.6);
      if(!line){line={y:w.y,h:w.h||20,words:[]};lines.push(line);}
      line.words.push(w);line.y=Math.min(line.y,w.y);line.h=Math.max(line.h||0,w.h||0);
    }
    lines.sort((a,b)=>a.y-b.y);
    return lines.map(l=>l.words.sort((a,b)=>a.x-b.x));
  }
  function parseLine(text,roster){
    let rest=text;
    const row={studentName:'',courseName:'',lessonDate:'',checkIn:'',checkOut:'',teacherName:''};
    let m=rest.match(/(\d{1,2}):(\d{2})\s*(?:[-–—~至到]|to)?\s*(\d{1,2}):(\d{2})/i);
    if(m){row.checkIn=m[1]+':'+m[2];row.checkOut=m[3]+':'+m[4];rest=rest.replace(m[0],' ');}
    let d=rest.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
    if(d){row.lessonDate=d[1]+'-'+pad(d[2])+'-'+pad(d[3]);rest=rest.replace(d[0],' ');}
    else{d=rest.match(/(\d{1,2})[-/](\d{1,2})/);if(d){row.lessonDate=(new Date()).getFullYear()+'-'+pad(d[1])+'-'+pad(d[2]);rest=rest.replace(d[0],' ');}}
    for(const n of (roster||[])){if(rest.includes(n)){row.teacherName=n;rest=rest.replace(n,' ');break;}}
    const tokens=rest.split(/\s+/).map(s=>s.replace(/[|｜,，;；]/g,'').trim()).filter(Boolean);
    const cjk=/^[\u4e00-\u9fff]{2,4}$/;
    const ni=tokens.findIndex(t=>cjk.test(t));
    if(ni>=0){row.studentName=tokens[ni];tokens.splice(ni,1);}
    row.courseName=tokens.join(' ').replace(/[|｜]/g,' ').trim();
    return row;
  }
  async function rosterNames(){
    try{const t=await (cloud.configured?cloud.listTeachers():JSON.parse(localStorage.getItem('sfk-teachers-v1')||'[]'));return (t||[]).map(x=>x.name).filter(Boolean);}catch{return[];}
  }

  function renderUpload(){
    stageEl().innerHTML='<div class="ocr-section"><div class="dropzone" id="ocr-drop"><strong>点击或拖拽上传课表截图</strong><br>支持 JPG / JPEG / PNG，单张图片</div><input id="ocr-file" type="file" accept="image/jpeg,image/png" hidden><img id="ocr-preview" class="ocr-preview" alt="课表预览" hidden></div><div class="ocr-actions"><button type="button" class="primary" id="ocr-recognize" disabled>开始识别</button><button type="button" id="ocr-reset">重新上传</button></div>';
    const drop=$('ocr-drop'),file=$('ocr-file'),preview=$('ocr-preview'),rec=$('ocr-recognize');
    drop.onclick=()=>file.click();
    ['dragover','dragenter'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('drag');}));
    ['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('drag');}));
    drop.addEventListener('drop',e=>{const f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0];if(f)readImage(f);});
    file.onchange=()=>{const f=file.files&&file.files[0];if(f)readImage(f);};
    $('ocr-reset').onclick=()=>{imageDataUrl=null;file.value='';preview.hidden=true;preview.src='';rec.disabled=true;renderUpload();};
    function readImage(f){
      if(!['image/jpeg','image/png'].includes(f.type)){status('请选择 JPG / PNG 图片');return;}
      if(f.size>10*1024*1024){status('图片过大，请小于 10 MB');return;}
      const r=new FileReader();r.onload=()=>{imageDataUrl=r.result;preview.src=r.result;preview.hidden=false;rec.disabled=false;status('');};
      r.onerror=()=>status('读取图片失败，请重试');
      r.readAsDataURL(f);
    }
    rec.onclick=()=>recognize();
  }

  async function recognize(){
    if(busy)return;busy=true;stageEl().innerHTML='<div class="ocr-section" style="text-align:center;padding:60px 20px"><p class="ocr-status" style="font-size:16px">正在识别课表…</p><p class="ocr-status">首次调用 Google Vision 可能需数秒</p></div>';
    status('');
    try{
      if(!cloud.configured){throw Error('当前是本地预览，无法调用 OCR。请先配置 Supabase 并部署 ocr-schedule 函数。');}
      const result=await cloud.ocrSchedule(imageDataUrl);
      const roster=await rosterNames();
      const u=curUser();
      rows=[];
      for(const arr of linesFromWords(result.words)){
        const line=arr.map(w=>w.text).join(' ');
        const r=parseLine(line,roster);
        if(r.checkIn||r.checkOut||r.studentName||r.courseName){
          const row=newRow();Object.assign(row,{studentName:r.studentName,courseName:r.courseName,lessonDate:r.lessonDate,checkIn:r.checkIn,checkOut:r.checkOut,teacherName:r.teacherName||(u?u.name:'')});
          rows.push(row);
        }
      }
      if(!rows.length){status('没有识别出课程，请确认图片清晰或手动添加。');stage='confirm';renderConfirm();busy=false;return;}
      showMineOnly=!!(u&&rows.some(r=>r.teacherName===u.name));
      stage='confirm';renderConfirm();
      status('识别出 '+rows.length+' 条，请核对并修改后继续。');
    }catch(e){
      status('识别失败：'+e.message);
      renderUpload();
    }finally{busy=false;}
  }

  function filteredRows(){
    const u=curUser();
    if(showMineOnly&&u){const mine=rows.filter(r=>r.teacherName===u.name);if(mine.length)return mine;}
    return rows;
  }

  function renderConfirm(){
    const u=curUser();
    const list=filteredRows();
    const mineBtn=u?('<button type="button" id="ocr-toggle">'+(showMineOnly?'显示全部课程':'仅显示我的课程')+'</button>'):'';
    stageEl().innerHTML='<div class="ocr-section"><div class="ocr-actions"><button type="button" id="ocr-add">＋ 手动添加一条</button>'+mineBtn+'<button type="button" class="primary" id="ocr-next">下一步：填写内容</button></div>'+
      '<div class="ocr-head"><span>选择</span><span>学生</span><span>课程</span><span>日期</span><span>开始</span><span>结束</span><span>教师</span><span></span></div><div id="ocr-rows"></div></div>';
    const box=$('ocr-rows');
    box.replaceChildren();
    if(!list.length){const p=document.createElement('p');p.className='ocr-status';p.textContent='没有可显示的课程。';box.append(p);}
    list.forEach(r=>box.append(renderRow(r)));
    $('ocr-add').onclick=()=>{rows.push(newRow());if(u)rows[rows.length-1].teacherName=u.name;renderConfirm();};
    if(u)$('ocr-toggle').onclick=()=>{showMineOnly=!showMineOnly;renderConfirm();};
    $('ocr-next').onclick=()=>{const sel=rows.filter(r=>r.selected);if(!sel.length){status('请至少勾选一条课程');return;}if(sel.some(r=>!r.studentName.trim())){status('有学生姓名未确认，请补全或取消勾选');return;}stage='content';renderContent();};
  }

  function renderRow(row){
    const box=document.createElement('div');box.className='ocr-row';
    const chk=document.createElement('input');chk.type='checkbox';chk.checked=row.selected;chk.onchange=()=>{row.selected=chk.checked;};
    const student=input(row.studentName);student.placeholder='姓名';
    const course=input(row.courseName);course.placeholder='课程';
    const date=input(row.lessonDate);date.type='date';
    const tin=input(row.checkIn);tin.type='time';tin.step='1800';
    const tout=input(row.checkOut);tout.type='time';tout.step='1800';
    const teacher=input(row.teacherName);teacher.placeholder='教师（可空）';
    const del=document.createElement('button');del.type='button';del.className='danger';del.textContent='删除';del.onclick=()=>{rows.splice(rows.indexOf(row),1);renderConfirm();};
    const cells=[[chk,'选择'],[student,'学生'],[course,'课程'],[date,'日期'],[tin,'开始时间'],[tout,'结束时间'],[teacher,'教师'],[del,'操作']];
    cells.forEach(([el,label])=>{const c=document.createElement('div');c.className='cell';c.setAttribute('data-label',label);c.append(el);box.append(c);});
    student.oninput=()=>row.studentName=student.value;
    course.oninput=()=>row.courseName=course.value;
    date.oninput=()=>row.lessonDate=date.value;
    tin.oninput=()=>row.checkIn=tin.value;
    tout.oninput=()=>row.checkOut=tout.value;
    teacher.oninput=()=>row.teacherName=teacher.value;
    return box;
  }
  function input(val){const i=document.createElement('input');i.value=val||'';return i;}

  function buildRecord(row){
    const rec=initialRecord();
    rec.studentName=row.studentName.trim();
    rec.courseName=row.courseName||'项目课';
    rec.lessonDate=row.lessonDate||dateLocal(new Date());
    rec.checkIn=row.checkIn||'';rec.checkOut=row.checkOut||'';
    rec.content=row.content||'';rec.homework=row.homework||'';
    rec.teacherName=row.teacherName||(curUser()?curUser().name:'');
    rec.signatures.mentor={mode:'text',text:rec.teacherName,image:null,strokes:[],loading:false,revision:0};
    rec.signatures.student=blankSignature();
    return rec;
  }

  function renderContent(){
    stageEl().innerHTML='<div class="ocr-section"><div class="ocr-actions"><button type="button" id="ocr-back-confirm">← 返回确认</button><button type="button" class="primary" id="ocr-generate">批量生成签单</button></div>'+
      '<div class="apply-grid"><div><label>上课内容（应用到全部）</label><textarea id="ocr-apply-content" placeholder="填写后点「应用到全部」"></textarea></div><div><label>课后作业（应用到全部）</label><textarea id="ocr-apply-homework" placeholder="填写后点「应用到全部」"></textarea></div></div>'+
      '<div class="ocr-actions"><button type="button" id="ocr-apply">应用到全部（勾选的签单）</button></div>'+
      '<div id="ocr-content-rows"></div></div><div class="ocr-section" id="ocr-results" hidden></div>';
    const box=$('ocr-content-rows');box.replaceChildren();
    rows.filter(r=>r.selected).forEach(r=>box.append(renderContentRow(r)));
    $('ocr-back-confirm').onclick=()=>{stage='confirm';renderConfirm();};
    $('ocr-apply').onclick=()=>{const c=$('ocr-apply-content').value,hm=$('ocr-apply-homework').value;if(!c&&!hm){status('请先在上方填写内容或作业');return;}rows.forEach(r=>{if(r.selected){if(c)r.content=c;if(hm)r.homework=hm;}});renderContent();status('已应用到全部勾选的签单。');};
    $('ocr-generate').onclick=()=>generate();
  }

  function renderContentRow(row){
    const box=document.createElement('div');box.className='ocr-row';
    const name=document.createElement('div');name.className='cell';name.setAttribute('data-label','学生');const n=document.createElement('strong');n.textContent=row.studentName||'未命名';name.append(n);
    const content=document.createElement('textarea');content.value=row.content;content.placeholder='上课内容…';
    const homework=document.createElement('textarea');homework.value=row.homework;homework.placeholder='课后作业…';
    const ccell=document.createElement('div');ccell.className='cell';ccell.setAttribute('data-label','上课内容');ccell.append(content);
    const hcell=document.createElement('div');hcell.className='cell';hcell.setAttribute('data-label','课后作业');hcell.append(homework);
    const state=document.createElement('div');state.className='cell';state.setAttribute('data-label','状态');
    const linkArea=document.createElement('div');
    if(row.status==='linked'&&row.link){const a=document.createElement('a');a.href=row.link;a.target='_blank';a.rel='noopener noreferrer';a.textContent='打开';const c=document.createElement('button');c.type='button';c.textContent='复制链接';c.onclick=async()=>{try{await navigator.clipboard.writeText(row.link);}catch{}c.textContent='已复制';};linkArea.append(a,' ',c);}
    else if(row.status==='error'){const s=document.createElement('span');s.className='ocr-status';s.style.color='#a52626';s.textContent='失败：'+row.error;linkArea.append(s);}
    else if(row.status==='new'){linkArea.append(document.createTextNode('待生成'));}
    state.append(linkArea);
    box.append(name,ccell,hcell,state);
    content.oninput=()=>row.content=content.value;
    homework.oninput=()=>row.homework=homework.value;
    return box;
  }

  async function generate(){
    if(busy)return;busy=true;$('ocr-generate').disabled=true;
    const target=rows.filter(r=>r.selected&&r.studentName.trim()&&r.status!=='linked');
    if(!target.length){status('没有待生成的签单（已生成或未填写学生姓名）。');busy=false;$('ocr-generate').disabled=false;return;}
    let ok=0,fail=[];
    for(const r of rows){if(!r.selected||!r.studentName.trim()||r.status==='linked')continue;r.status='new';r.error='';}
    renderContent();
    for(const r of rows){
      if(!r.selected||!r.studentName.trim()||r.status==='linked')continue;
      status('正在生成 '+r.studentName+' …');
      try{
        const record=await cloud.compactRecord(buildRecord(r));
        r.id=r.id||crypto.randomUUID();
        const saved=await repo.save(r.id,r.revision||0,record,curUser()?curUser().id:null);
        r.id=saved.id;r.revision=saved.revision;
        if(cloud.configured){const share=await cloud.publish(saved.id);const base=new URL(window.SFK_CONFIG.siteUrl);base.hash='request='+share.token;base.search='';r.link=base.href;}
        r.status='linked';ok++;
      }catch(e){r.status='error';r.error=e.message;fail.push((r.studentName||'未命名')+'：'+e.message);}
      renderContent();
    }
    status('成功 '+ok+' 份'+(fail.length?'；失败 '+fail.length+' 份：'+fail.join('；'):''));
    renderResults();
    busy=false;$('ocr-generate').disabled=false;
  }

  function renderResults(){
    const linked=rows.filter(r=>r.status==='linked'&&r.link);
    const failed=rows.filter(r=>r.status==='error');
    const box=$('ocr-results');box.replaceChildren();
    if(!linked.length&&!failed.length){box.hidden=true;return;}
    box.hidden=false;
    box.innerHTML='<h3 style="margin:0 0 10px">生成结果</h3>'+(linked.length?('<div class="ocr-actions"><button type="button" id="ocr-copyall">复制全部链接</button>'+(failed.length?'<button type="button" id="ocr-retry">仅重试失败项</button>':'')+'</div>'):'')+'<div id="ocr-result-list"></div>';
    const list=$('ocr-result-list');
    linked.forEach(r=>{const line=document.createElement('div');line.className='ocr-status';line.style.cssText='display:flex;justify-content:space-between;gap:10px;margin-bottom:6px';line.innerHTML='<span>'+esc(r.studentName)+'｜'+esc(r.courseName)+'</span><span><a href="'+esc(r.link)+'" target="_blank" rel="noopener noreferrer">打开</a> <button type="button" class="cp">复制链接</button></span>';line.querySelector('.cp').onclick=async()=>{try{await navigator.clipboard.writeText(r.link);}catch{}line.querySelector('.cp').textContent='已复制';};list.append(line);});
    if(linked.length){$('ocr-copyall').onclick=async()=>{const txt=linked.map(r=>r.studentName+'｜'+r.courseName+'\n'+r.link).join('\n\n');try{await navigator.clipboard.writeText(txt);status('已复制全部链接。');}catch{const t=document.createElement('textarea');t.value=txt;document.body.append(t);t.select();document.execCommand('copy');t.remove();status('已复制全部链接。');}};}
    if(failed.length){$('ocr-retry').onclick=()=>{failed.forEach(r=>{r.status='new';r.error='';});renderContent();generate();};}
  }
  function esc(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

  function show(){
    stage='upload';rows=[];imageDataUrl=null;showMineOnly=true;busy=false;status('');
    document.querySelector('main.layout').hidden=true;
    const dash=document.getElementById('dashboard');if(dash)dash.hidden=true;
    if(window.SFKBatch&&SFKBatch.view)SFKBatch.view.hidden=true;
    if(window.SFKUser&&SFKUser.view)SFKUser.view.hidden=true;
    view.hidden=false;document.querySelector('h1').textContent='课表识别新建';
    renderUpload();window.scrollTo(0,0);
  }
  function hide(){view.hidden=true;}

  $('ocr-back').onclick=()=>{if(window.SFKShowDashboard)window.SFKShowDashboard();else hide();};

  return {show,hide,view,_parse:(words,roster)=>{const out=[];for(const arr of linesFromWords(words)){const r=parseLine(arr.map(w=>w.text).join(' '),roster);if(r.checkIn||r.checkOut||r.studentName||r.courseName)out.push(r);}return out;}};
})();
