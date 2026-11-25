/* UI adapter: no rule data here. All actions go through the pure Engine. */
(() => {
'use strict';
const { MASTER, Engine } = globalThis.Sekasoko;
const $ = id => document.getElementById(id);
const board = $('board'), cells = $('cells'), overlay = $('overlay'), modal = $('modal');
const names = ['はじまりの回廊','苔むした階段','忘れられた門','薄明の広間','石像の庭','残響の迷宮','深緑の祭壇','竜影の回廊','世界の継ぎ目','底へ続く扉'];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let state = Engine.createRun(), selectedId = null, busy = false, generation = 0;
let modalMode = '', returnFocus = null, toastTimer;
const unitElements = new Map();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const find = id => state.units.find(u => u.id === id);
const selected = () => find(selectedId);
function toast(message) {
  $('toast').textContent = message; $('toast').classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2300);
}
function openModal(mode, html) {
  if (overlay.hidden) returnFocus = document.activeElement;
  modalMode = mode; modal.classList.toggle('formation-modal', mode === 'formation'); modal.innerHTML = html; overlay.hidden = false;
  document.body.style.overflow = 'hidden'; modal.focus();
}
function closeModal() {
  overlay.hidden = true; modalMode = ''; document.body.style.overflow = '';
  if (returnFocus && returnFocus.isConnected) returnFocus.focus();
}
function phaseLabel() {
  if (busy) return '行動中…';
  return {player:'あなたの手番',enemy:'敵の手番',victory:'階層クリア',defeat:'王が倒れた',clear:'10F 踏破！'}[state.phase];
}
for (let y=0;y<5;y++) for (let x=0;x<7;x++) {
  const cell = document.createElement('button');
  cell.className = 'cell'; cell.dataset.x = x; cell.dataset.y = y;
  cell.setAttribute('aria-label', `${x+1}列 ${y+1}行`);
  if (y===0) cell.innerHTML=`<span class="coord" aria-hidden="true">${x+1}</span>`;
  cell.addEventListener('click', () => cellTap(x,y)); cells.appendChild(cell);
}
function paintHighlights() {
  const u = selected();
  const canAct = u && u.side === 'player' && state.phase === 'player' && !busy;
  const moves = canAct ? Engine.moves(state,u.id) : [];
  const targets = canAct ? Engine.targets(state,u.id) : [];
  for (const c of cells.children) {
    const x=+c.dataset.x, y=+c.dataset.y;
    const move = moves.some(m=>m.x===x&&m.y===y), target = targets.some(t=>t.x===x&&t.y===y);
    c.classList.toggle('legal',move); c.classList.toggle('attackable',target);
    c.classList.toggle('selected',!!u&&u.x===x&&u.y===y);
    c.disabled = busy || state.phase!=='player';
    c.setAttribute('aria-label',`${x+1}列 ${y+1}行${move?' 移動可能':''}${target?' 攻撃可能':''}`);
  }
  for (const [id,el] of unitElements) {
    const piece=find(id);
    el.classList.toggle('is-selected',id===selectedId);
    el.classList.toggle('is-target',targets.some(t=>t.id===id));
    el.disabled=busy || !['player','enemy'].includes(state.phase);
    el.setAttribute('aria-pressed',id===selectedId?'true':'false');
    if (piece) el.setAttribute('aria-label',`${piece.side==='player'?'味方':'敵'}の${MASTER[piece.type].name} HP ${piece.hp}/${piece.maxHp} ${piece.x+1}列 ${piece.y+1}行${targets.some(t=>t.id===id)?' 攻撃可能':''}`);
  }
}
function paintUnits() {
  const alive = new Set(state.units.map(u=>u.id));
  for (const [id,el] of unitElements) if (!alive.has(id)) { el.remove();unitElements.delete(id); }
  for (const u of state.units) {
    let el = unitElements.get(u.id);
    const m=MASTER[u.type];
    if (!el) {
      el=document.createElement('button'); el.className=`unit ${u.side} ${u.type==='king'?'king':''}`;
      el.dataset.unitId=u.id;
      el.innerHTML=`<span class="token"><span class="emoji" aria-hidden="true">${m.icon}</span><span class="unit-name">${m.name}</span><span class="hp-track"><i></i></span><span class="hp"></span></span>`;
      el.addEventListener('click',()=>unitTap(u.id)); board.appendChild(el);unitElements.set(u.id,el);
    }
    el.style.left=`${u.x/7*100}%`;el.style.top=`${u.y/5*100}%`;
    el.querySelector('.hp').textContent=u.hp;
    el.querySelector('.hp-track i').style.width=`${u.hp/u.maxHp*100}%`;
  }
}
function paintInspector() {
  const u=selected();
  $('selectedMark').textContent=u?'選択中':'未選択';
  if (!u) {
    $('inspectorBody').innerHTML='<div class="portrait" aria-hidden="true">♟</div><div class="select-hint">駒をタップして<br>能力と行動範囲を見よう。</div>';
    return;
  }
  const m=MASTER[u.type];
  $('inspectorBody').innerHTML=`<div class="portrait" aria-hidden="true">${m.icon}</div><div><h2 class="unit-title">${m.name}</h2><div class="side-tag ${u.side}">${u.side==='player'?'YOUR COMPANION':'DEPTHS ENEMY'}${u.type==='king'?' · 王':''}</div></div><div class="stats"><div class="stat wide">HP <b>${u.hp} <small>/ ${u.maxHp}</small></b></div><div class="stat">攻撃 <b>${m.atk}</b></div><div class="stat">コスト <b>${m.cost}</b></div><div class="stat">移動 <b>${m.move}</b></div><div class="stat">射程 <b>${m.range}</b></div></div><div class="health-line"><i style="width:${u.hp/u.maxHp*100}%"></i></div>`;
}
function render(skipUnits=false) {
  if (!find(selectedId)) selectedId=null;
  $('floorNum').textContent=state.floor;$('floorTitle').textContent=names[state.floor-1];
  $('storyNumber').textContent=String(state.floor).padStart(2,'0');
  $('turnNum').textContent=`TURN ${String(state.turn).padStart(2,'0')}`;
  $('phaseBadge').textContent=phaseLabel();$('phaseBadge').classList.toggle('enemy',state.phase==='enemy');
  $('steps').innerHTML=Array.from({length:10},(_,i)=>`<i class="step ${i+1===state.floor?'current':i+1<state.floor?'done':''}"></i>`).join('');
  $('waitBtn').disabled=busy||state.phase!=='player';
  $('restartBtn').disabled=busy||state.phase==='enemy';
  const u=selected();
  $('boardHint').textContent=busy?'一手の行方を見届けよう。':state.phase==='enemy'?'敵が次の一手を考えている…':state.phase!=='player'?'この階層の戦いは決着した。':u?(u.side==='enemy'?'敵の能力を確認中。味方の駒を選ぶと行動できるよ。':'青いマスへ移動 ／ 赤い敵を攻撃。どちらか1つで手番終了。'):'味方の駒をタップして、一手を選ぼう。';
  const loot=state.phase==='victory'||state.phase==='clear'?state.lastRewards:state.candidates;
  $('lootCount').textContent=`${loot.length} PIECES`;
  $('lootList').innerHTML=loot.length?loot.map(type=>`<span class="loot-chip">${MASTER[type].icon} ${MASTER[type].name}</span>`).join(''):'<span class="empty-loot">まだ候補はいない。敵の手駒を撃破して集めよう。</span>';
  $('logList').innerHTML=state.log.slice(0,3).map(text=>`<li>${text}</li>`).join('');
  if(!skipUnits) paintUnits(); paintInspector();paintHighlights();
}
function unitTap(id) {
  if (busy || overlay.hidden===false || state.phase!=='player') return;
  const actor=selected(), target=find(id);
  if (!target) return;
  if (actor && actor.side==='player' && target.side==='enemy' && Engine.targets(state,actor.id).some(t=>t.id===id)) {
    doAction({type:'attack',unitId:actor.id,targetId:id});return;
  }
  selectedId=selectedId===id?null:id;render();
}
function cellTap(x,y) {
  if(busy||!overlay.hidden||state.phase!=='player')return;
  const occupied=state.units.find(u=>u.x===x&&u.y===y);
  if(occupied){unitTap(occupied.id);return;}
  const actor=selected();
  if(actor&&actor.side==='player') {
    if(Engine.moves(state,actor.id).some(m=>m.x===x&&m.y===y)) doAction({type:'move',unitId:actor.id,x,y});
    else toast('青く光るマスへ移動できるよ。');
  } else {selectedId=null;render();}
}
async function animateEvents(events) {
  for(const e of events) {
    if (e.type==='move') {
      const el=unitElements.get(e.unitId);if(!el)continue;
      const points=[e.from,...e.path];
      await el.animate(points.map(p=>({left:`${p.x/7*100}%`,top:`${p.y/5*100}%`})),{duration:reducedMotion?1:Math.max(240,e.path.length*145),easing:'ease-in-out',fill:'forwards'}).finished;
      el.style.left=`${e.to.x/7*100}%`;el.style.top=`${e.to.y/5*100}%`;el.getAnimations().forEach(a=>a.cancel());
    }
    if (e.type==='attack') {
      const attacker=unitElements.get(e.unitId), target=unitElements.get(e.targetId);
      if(!attacker||!target)continue;
      const a=attacker.getBoundingClientRect(),t=target.getBoundingClientRect();
      const dx=t.x-a.x,dy=t.y-a.y,dist=Math.hypot(dx,dy)||1;
      const bump=attacker.querySelector('.token');
      await bump.animate([{transform:'translate(0,0)'},{transform:`translate(${dx/dist*15}px,${dy/dist*15}px) scale(1.06)`},{transform:'translate(0,0)'}],{duration:reducedMotion?1:220,easing:'ease-out'}).finished;
      const damage=document.createElement('span');damage.className='floating-damage';damage.textContent=`−${e.damage}`;
      damage.style.left=`${(parseFloat(target.style.left)||0)+5}%`;damage.style.top=`${(parseFloat(target.style.top)||0)+4}%`;board.appendChild(damage);
      const remaining=find(e.targetId);target.querySelector('.hp').textContent=remaining?remaining.hp:0;
      target.querySelector('.hp-track i').style.width=`${remaining?remaining.hp/remaining.maxHp*100:0}%`;
      await target.querySelector('.token').animate([{transform:'translateX(0)',filter:'brightness(2)'},{transform:'translateX(-4px)'},{transform:'translateX(4px)'},{transform:'translateX(0)',filter:'brightness(1)'}],{duration:reducedMotion?1:220}).finished;
      setTimeout(()=>damage.remove(),700);
    }
    if(e.type==='death') {
      const el=unitElements.get(e.unitId);if(el) {
        await el.animate([{opacity:1,transform:'scale(1)'},{opacity:0,transform:'scale(.7) translateY(-10px)'}],{duration:reducedMotion?1:230,fill:'forwards'}).finished;
      }
    }
    if(e.type==='candidate') toast(`${MASTER[e.unitType].icon} ${MASTER[e.unitType].name}が獲得候補に！`);
  }
}
async function doAction(action) {
  if(busy||!['player','enemy'].includes(state.phase))return;
  const token=generation;const result=Engine.act(state,action);
  if(!result.ok){toast(result.error);return;}
  busy=true;render(true);
  try {await animateEvents(result.events);} catch(error) {console.error(error);}
  if(token!==generation)return;
  busy=false;selectedId=null;render();
  if(['victory','defeat','clear'].includes(state.phase)) {await sleep(reducedMotion?1:300);showResult();}
  else if(state.phase==='enemy') scheduleEnemy();
}
async function scheduleEnemy() {
  const token=generation;
  await sleep(reducedMotion?30:620);
  if(token===generation&&state.phase==='enemy'&&!busy)await doAction(Engine.chooseAI(state));
}
$('waitBtn').addEventListener('click',()=>{
  if(busy||state.phase!=='player'||!overlay.hidden)return;
  const u=selected();doAction({type:'wait',...(u?.side==='player'?{unitId:u.id}:{})});
});
function rewardsHTML() {
  return state.lastRewards.length?state.lastRewards.map(type=>`<span class="loot-chip">${MASTER[type].icon} ${MASTER[type].name} × 1</span>`).join(''):'<p>今回は手駒の獲得なし。王を倒して、道を切り開いた！</p>';
}
function showFormation() {
  const cost=state.formation.reduce((sum,id)=>sum+MASTER[state.roster.find(p=>p.id===id).type].cost,0);
  const rosterCards=state.roster.map((p,i)=>{
    const m=MASTER[p.type],chosen=state.formation.includes(p.id);
    const isNew=i>=state.roster.length-state.lastRewards.length;
    return `<button class="roster-card ${chosen?'chosen':''}" data-roster="${p.id}" aria-pressed="${chosen}" aria-label="${m.name} 個体${i+1} コスト${m.cost} ${chosen?'出撃中':'控え'}"><span class="roster-icon" aria-hidden="true">${m.icon}</span><span class="cost">COST ${m.cost}</span><span class="check">${chosen?'✓ 出撃':isNew?'NEW':''}</span><span class="name">${m.name} <small style="color:var(--muted)">#${i+1}</small></span><span class="mini-stat">HP ${m.hp}　ATK ${m.atk}<br>移動 ${m.move}　射程 ${m.range}</span></button>`;
  }).join('');
  openModal('formation',`<div class="modal-title"><div><div class="eyebrow">FLOOR ${String(state.floor).padStart(2,'0')} — VICTORY</div><h2 id="modalTitle">手駒を迎えて、さらに深く。</h2><p>味方は全員復帰・HP全回復。次の階層の仲間を選ぼう。</p></div><span style="color:var(--gold);font-size:27px">✦</span></div><div class="rewards" aria-label="獲得した手駒">${rewardsHTML()}</div><div class="divider"></div><div class="formation-bar"><span>次の出撃メンバー <small>タップで入れ替え</small></span><span class="formation-count">手駒 ${state.formation.length}/3　コスト ${cost}/10</span></div><div class="roster"><div class="roster-card fixed"><span class="roster-icon">${MASTER.king.icon}</span><span class="cost">COST 0</span><span class="check" style="color:var(--gold)">必須</span><span class="name">王</span><span class="mini-stat">HP 12　ATK 2<br>移動 1　射程 1</span></div>${rosterCards}</div><div class="modal-actions"><span class="modal-note">同じ種類も編成OK。選んだ3体までが王と出撃するよ。</span><button class="primary" id="nextFloorBtn">${state.floor+1}Fへ進む →</button></div>`);
  modal.querySelectorAll('[data-roster]').forEach(button=>button.addEventListener('click',()=>{
    const id=button.dataset.roster;
    const ids=state.formation.includes(id)?state.formation.filter(p=>p!==id):[...state.formation,id];
    const result=Engine.setFormation(state,ids);
    if(!result.ok){toast(result.error);return;}
    showFormation();modal.querySelector(`[data-roster="${id}"]`)?.focus();
  }));
  $('nextFloorBtn').addEventListener('click',()=>{
    const result=Engine.advance(state);if(!result.ok){toast(result.error);return;}
    selectedId=null;closeModal();render();toast(`${state.floor}Fへ。軍団のHPが全回復した！`);
  });
}
function showResult() {
  if(state.phase==='victory') {showFormation();return;}
  if(!['clear','defeat'].includes(state.phase))return;
  const won=state.phase==='clear';
  openModal('ending',`<div class="ending"><div class="eyebrow">${won?'PROTOTYPE COMPLETED':'THE JOURNEY ENDS'}</div><div class="emblem">${won?'♛':'♚'}</div><h2 id="modalTitle">${won?'世界の底へ、最初の一歩。':'王は倒れた。でも、また潜れる。'}</h2><p>${won?'10F踏破！ セカソコ！～手駒編～ VER.001 クリア。':'味方の王のHPが0になった。今回の獲得候補は失われた。'}<br>${state.floor}F到達 · 総行動 ${state.totalActions}手 · ${state.roster.length}体の手駒と出会った。</p>${won?`<div class="rewards" style="justify-content:center">${rewardsHTML()}</div>`:''}<div class="modal-actions"><button class="primary" id="retryBtn">新しい軍団で、最初から →</button></div><p style="font-size:10px;margin-top:15px">再挑戦すると軍団・階層は初期状態に戻るよ。</p></div>`);
  $('retryBtn').addEventListener('click',resetRun);
}
function resetRun() {
  generation++;busy=false;selectedId=null;state=Engine.createRun();
  for(const el of unitElements.values())el.remove();unitElements.clear();
  board.querySelectorAll('.floating-damage').forEach(el=>el.remove());
  closeModal();render();toast('新しい探索が始まった。1Fから、もう一度！');
}
function showRules() {
  openModal('rules',`<div class="modal-title"><div><div class="eyebrow">HOW TO PLAY · VER.001</div><h2 id="modalTitle">一手ずつ、仲間と底へ。</h2></div><button class="icon-btn" id="closeRulesBtn" aria-label="遊び方を閉じる">×</button></div><div class="rules-grid"><section><h3>01 · 動く、攻める、待つ。</h3><p>味方の駒 → 青いマスで移動。<br>味方の駒 → 赤い敵で攻撃。<br>移動と攻撃はそれぞれ1行動。1体の行動後、敵と交代するよ。待機は未選択でも使える。範囲は上下左右の距離、移動は駒を通り抜けられない。遠距離攻撃は射線を遮られないよ。</p></section><section><h3>02 · 王を守って、手駒を集める。</h3><p>敵の王を倒せば勝利、味方の王が倒れたら敗北。王手・詰みはなし。<br>撃破した敵だけが獲得候補になり、勝利すると100%仲間に。王と生き残った敵は獲得できず、敗北すると候補を失うよ。</p></section><section><h3>03 · 軍団を組んで、次の階層へ。</h3><p>王1体＋手駒最大3体、コスト合計10以内。<br>同じ種類も複数編成OK。階層の間に全員が復帰し、HP全回復。集めた手駒は次の階層から出撃できる。10Fを突破すれば試作版クリア！</p></section><section><h3>04 · 試作版について。</h3><p>数値と敵編成は仮仕様。2Fから敵はランダム、深層ほど強い敵に出会いやすくなるよ。<br>セーブ・音は未実装。ページを閉じる／再読み込みすると最初から。iPhoneは横向き推奨。</p></section></div><div class="divider"></div><div class="panel-head">CHARACTER MASTER · 全10種類</div><table class="master-table"><thead><tr><th>手駒</th><th>HP</th><th>ATK</th><th>移動</th><th>射程</th><th>コスト</th></tr></thead><tbody>${Object.values(MASTER).map(m=>`<tr><td>${m.icon} ${m.name}</td><td>${m.hp}</td><td>${m.atk}</td><td>${m.move}</td><td>${m.range}</td><td>${m.cost}</td></tr>`).join('')}</tbody></table><div class="modal-actions"><button class="primary" id="backToBoardBtn">盤面に戻る →</button></div>`);
  $('closeRulesBtn').addEventListener('click',closeModal);$('backToBoardBtn').addEventListener('click',closeModal);
}
$('helpBtn').addEventListener('click',showRules);
$('restartBtn').addEventListener('click',()=>{
  if(busy||state.phase==='enemy')return;
  openModal('restart',`<div class="eyebrow">START A NEW JOURNEY</div><h2 id="modalTitle">1Fからやり直す？</h2><p>今の階層と集めた手駒はリセットされるよ。</p><div class="modal-actions"><button id="cancelRestartBtn" class="quiet">探索を続ける</button><button class="primary" id="confirmRestartBtn">最初から始める</button></div>`);
  $('cancelRestartBtn').addEventListener('click',closeModal);$('confirmRestartBtn').addEventListener('click',resetRun);
});
document.addEventListener('keydown',event=>{
  if(overlay.hidden)return;
  if(event.key==='Escape'&&['rules','restart'].includes(modalMode)) {closeModal();return;}
  if(event.key!=='Tab')return;
  const items=[...modal.querySelectorAll('button:not(:disabled),[tabindex="0"]')];
  if(!items.length){event.preventDefault();return;}
  const first=items[0],last=items[items.length-1];
  if(event.shiftKey&&(document.activeElement===first||document.activeElement===modal)){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===modal)){event.preventDefault();first.focus();}
});
render();
// Read-only snapshot allows reproducible QA without affecting gameplay.
globalThis.Sekasoko.inspect = () => JSON.parse(JSON.stringify(state));
})();
