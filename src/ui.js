/* UI adapter: no rule data here. All actions go through the pure Engine. */
(() => {
'use strict';
const { MASTER, ARMY_RULES, Engine, Storage } = globalThis.Sekasoko;
const $ = id => document.getElementById(id);
const board = $('board'), pieceLayer = $('pieceLayer'), cells = $('cells'), overlay = $('overlay'), modal = $('modal');
const names = ['はじまりの回廊','苔むした階段','忘れられた門','薄明の広間','石像の庭','残響の迷宮','深緑の祭壇','竜影の回廊','世界の継ぎ目','底へ続く扉'];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let collection;
function initialState() {
  const saved = Storage.load();
  collection = saved?.collection || Engine.createCollection();
  return saved?.exploration || Engine.createRun(collection, true);
}
let state = initialState(), selectedId = null, busy = false, generation = 0;
let selectedHandId = null;
let modalMode = '', returnFocus = null, toastTimer;
let attackMode = false;
let saveWarningShown = false;
function saveState() {
  collection ||= Engine.createCollection();
  const saved = Storage.save(collection, state);
  if (!saved && !saveWarningShown) {
    saveWarningShown = true;
    toast('自動保存できなかった。保存設定を確認してね。読めないデータはメニューの全初期化で消せるよ。');
  }
  return saved;
}
const unitElements = new Map();
const orientationMedia = matchMedia('(orientation: portrait)');
let portraitView = orientationMedia.matches, projectionRevision = 0, presentationContext = null;
const activeAnimations = new Set();
// Pure display projection; battle coordinates always remain 7 × 5.
const Display = Object.freeze({
  toDisplay: ({x,y}, portrait=false) => portrait ? {col:y,row:6-x} : {col:x,row:y},
  fromDisplay: ({col,row}, portrait=false) => portrait ? {x:6-row,y:col} : {x:col,y:row},
  dimensions: (portrait=false) => portrait ? {cols:5,rows:7} : {cols:7,rows:5}
});
Object.defineProperty(globalThis.Sekasoko,'display',{value:Display,enumerable:true});
const viewportSignature = () => `${orientationMedia.matches}:${innerWidth}:${innerHeight}:${window.visualViewport?.width}:${window.visualViewport?.height}`;
let lastViewportSignature = viewportSignature();
function displayPosition(point, anchorX=0, anchorY=0) {
  const {col,row}=Display.toDisplay(point,portraitView), {cols,rows}=Display.dimensions(portraitView);
  return {left:`${(col+anchorX)/cols*100}%`,top:`${(row+anchorY)/rows*100}%`};
}
function displayLabel(point) {
  const {col,row}=Display.toDisplay(point,portraitView);
  return `${col+1}列 ${row+1}行`;
}
function placeUnit(el, point) {
  const {col,row}=Display.toDisplay(point,portraitView);
  Object.assign(el.style,displayPosition(point));
  el.dataset.col=col;el.dataset.row=row;el.dataset.x=point.x;el.dataset.y=point.y;
}
function paintProjection() {
  const {cols,rows}=Display.dimensions(portraitView);
  board.style.setProperty('--columns',cols);board.style.setProperty('--rows',rows);
  board.dataset.orientation=portraitView?'portrait':'landscape';
  board.setAttribute('aria-label',`${cols}列 ${rows}行の戦闘盤面`);
  const ordered=[...cells.children];
  for(const cell of ordered) {
    const point={x:+cell.dataset.x,y:+cell.dataset.y}, {col,row}=Display.toDisplay(point,portraitView);
    cell.dataset.col=col;cell.dataset.row=row;
    cell.style.gridColumn=col+1;cell.style.gridRow=row+1;
    cell.classList.toggle('edge-east',col===cols-1);cell.classList.toggle('edge-south',row===rows-1);
    cell.classList.toggle('is-dark',(col+row)%2===1);
    cell.innerHTML=row===0?`<span class="coord" aria-hidden="true">${col+1}</span>`:'';
  }
  ordered.sort((a,b)=>(+a.dataset.row*cols + +a.dataset.col)-(+b.dataset.row*cols + +b.dataset.col));
  cells.append(...ordered);
}
function refreshPresentation() {
  const signature=viewportSignature();
  if(signature===lastViewportSignature)return;
  lastViewportSignature=signature;portraitView=orientationMedia.matches;projectionRevision++;
  // Engine.act has already committed. Reconcile only presentation, never actions or AI.
  if(presentationContext)presentationContext.skipVisual=true;
  for(const animation of activeAnimations)animation.cancel();
  pieceLayer.querySelectorAll('.floating-damage,.passive-cue').forEach(el=>el.remove());
  paintProjection();paintUnits();paintHands();paintInspector();paintHighlights();
}
window.addEventListener('resize',refreshPresentation);
orientationMedia.addEventListener('change',refreshPresentation);
window.visualViewport?.addEventListener('resize',refreshPresentation);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const find = id => state.units.find(u => u.id === id);
const hands = side => state.hands?.[side] || [];
const findHand = id => [...hands('player'),...hands('enemy')].find(u=>u.id===id);
const selectedHand = () => findHand(selectedHandId);
const selected = () => find(selectedId) || selectedHand();
const deploySquares = () => selectedHandId ? Engine.deploymentSquares(state,selectedHandId) : [];
function toast(message) {
  $('toast').textContent = message; $('toast').classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2300);
}
function closeFlyouts() {
  for (const name of ['menu','log']) {
    $(name+'Panel').hidden=true;
    $(name+'Btn').setAttribute('aria-expanded','false');
  }
}
function toggleFlyout(name) {
  if(!overlay.hidden)return;
  const opening=$(name+'Panel').hidden;
  closeFlyouts();
  if(opening) {
    $(name+'Panel').hidden=false;
    $(name+'Btn').setAttribute('aria-expanded','true');
    $(name==='menu'?'closeMenuBtn':'closeLogBtn').focus();
  }
}
function openModal(mode, html) {
  if (overlay.hidden) {
    const source=document.activeElement;
    returnFocus=source?.closest('#menuPanel')?$('menuBtn'):source?.closest('#logPanel')?$('logBtn'):source;
  }
  closeFlyouts();
  clearTimeout(toastTimer);$('toast').classList.remove('show');
  modalMode = mode; modal.classList.toggle('formation-modal', mode === 'formation'); modal.innerHTML = html; overlay.hidden = false;
  document.body.style.overflow = 'hidden'; modal.focus();
}
function closeModal() {
  overlay.hidden = true; modalMode = ''; document.body.style.overflow = '';
  if (returnFocus && returnFocus.isConnected) returnFocus.focus();
}
function phaseLabel() {
  if (busy) return '行動中…';
  return {preparation:'出撃準備',player:'あなたの手番',enemy:'敵の手番',victory:'階層クリア',defeat:'王が倒れた',clear:'10F 踏破！'}[state.phase];
}
for (let y=0;y<5;y++) for (let x=0;x<7;x++) {
  const cell = document.createElement('button');
  cell.className = 'cell'; cell.dataset.x = x; cell.dataset.y = y;
  cell.addEventListener('click', () => {
    const point=Display.fromDisplay({col:+cell.dataset.col,row:+cell.dataset.row},portraitView);
    cellTap(point.x,point.y);
  });
  cells.appendChild(cell);
}
function paintHighlights() {
  const u = selected();
  const inHand=!!selectedHand();
  const canAct = u && !inHand && u.side === 'player' && state.phase === 'player' && !busy;
  const moves = canAct ? Engine.moves(state,u.id) : [];
  const targets = canAct ? Engine.targets(state,u.id) : [];
  const deployments=!busy&&state.phase==='player'?deploySquares():[];
  for (const c of cells.children) {
    const x=+c.dataset.x, y=+c.dataset.y;
    const move = moves.some(m=>m.x===x&&m.y===y), target = targets.some(t=>t.x===x&&t.y===y);
    const deployment=deployments.some(p=>p.x===x&&p.y===y);
    c.classList.toggle('legal',move||deployment);c.classList.toggle('deployable',deployment); c.classList.toggle('attackable',target);
    c.classList.toggle('selected',!!u&&u.x===x&&u.y===y);
    c.disabled = busy || state.phase!=='player';
    c.setAttribute('aria-label',`${displayLabel({x,y})}${move?' 移動可能':''}${target?' 攻撃可能':''}${deployment?' 手駒を出撃可能':''}`);
  }
  for (const [id,el] of unitElements) {
    const piece=find(id);
    el.classList.toggle('is-selected',id===selectedId);
    el.classList.toggle('is-target',targets.some(t=>t.id===id));
    el.disabled=busy || !['player','enemy'].includes(state.phase);
    el.setAttribute('aria-pressed',id===selectedId?'true':'false');
    if (piece) el.setAttribute('aria-label',`${piece.side==='player'?'味方':'敵'}の${MASTER[piece.type].name} HP ${piece.hp}/${piece.maxHp} ${displayLabel(piece)}${targets.some(t=>t.id===id)?' 攻撃可能':''}`);
  }
}
function paintHands() {
  for(const side of ['player','enemy']) {
    const list=$(side+'HandList'),scroll=list.scrollLeft,pieces=hands(side);
    $(side+'HandCount').textContent=pieces.length;
    const fragment=document.createDocumentFragment();
    for(const u of pieces) {
      const m=MASTER[u.type],button=document.createElement('button');
      button.className='hand-piece';button.dataset.handId=u.id;button.dataset.handSide=side;
      button.classList.toggle('is-hand-selected',u.id===selectedHandId);
      button.setAttribute('aria-pressed',u.id===selectedHandId?'true':'false');
      button.setAttribute('aria-label',`${side==='player'?'味方':'敵'}の捕獲手駒 ${m.name} 個体${u.id} 出撃時HP${u.maxHp} ${u.originSide==='player'?'元の所有手駒':'今回の敵出自'}${side==='enemy'?' 確認のみ':''}`);
      button.innerHTML=`<span class="hand-icon" aria-hidden="true">${m.icon}</span><span>${m.name}</span><small>#${u.id}</small>`;
      button.disabled=busy||state.phase!=='player';
      button.addEventListener('click',()=>handTap(u.id));fragment.appendChild(button);
    }
    if(!pieces.length){const empty=document.createElement('span');empty.className='hand-empty';empty.textContent='捕獲手駒なし';fragment.appendChild(empty);}
    list.replaceChildren(fragment);list.scrollLeft=scroll;
  }
}
for(const side of ['player','enemy']) {
  const list=$(side+'HandList');let gesture=null;
  list.addEventListener('pointerdown',event=>{gesture={x:event.clientX,y:event.clientY,scroll:list.scrollLeft,moved:false};},{passive:true});
  list.addEventListener('pointermove',event=>{if(gesture&&(Math.abs(event.clientX-gesture.x)>8||Math.abs(event.clientY-gesture.y)>8))gesture.moved=true;},{passive:true});
  list.addEventListener('pointercancel',()=>{if(gesture)gesture.moved=true;},{passive:true});
  list.addEventListener('click',event=>{if(event.detail&&gesture&&(gesture.moved||Math.abs(list.scrollLeft-gesture.scroll)>6)){event.preventDefault();event.stopImmediatePropagation();}},true);
}
function handTap(id) {
  if(busy||!overlay.hidden||state.phase!=='player'||!findHand(id))return;
  selectedId=null;attackMode=false;selectedHandId=selectedHandId===id?null:id;render();
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
      el.innerHTML=`<span class="token"><span class="emoji" aria-hidden="true">${m.icon}</span><span class="hp-track"><i></i></span><span class="hp"></span></span>`;
      el.addEventListener('click',()=>unitTap(u.id)); pieceLayer.appendChild(el);unitElements.set(u.id,el);
    }
    placeUnit(el,u);
    el.querySelector('.hp').textContent=u.hp;
    el.querySelector('.hp-track i').style.width=`${u.hp/u.maxHp*100}%`;
  }
}
function paintInspector() {
  const u=selected(), ally=u?.side==='player',inHand=!!selectedHand();
  const info=u?(inHand?{baseAtk:MASTER[u.type].atk,atk:MASTER[u.type].atk,bonusAtk:0,knightIds:[],guardId:null,guardIds:[],passives:Engine.passivesFor(u.type)}:Engine.combatInfo(state,u.id)):null;
  const oldDetail=$('inspectorBody').querySelector('.status-copy');
  const detailScroll=u&&oldDetail?.dataset.detailId===u.id?oldDetail.scrollTop:0;
  $('selectedMark').textContent=u?`${ally?'味方':'敵'}${inHand?'手駒':''} · ${info.passives.map(p=>p.name).join('／')||'能力'}`:'未選択';
  $('detailsBtn').disabled=!u||busy||state.phase!=='player';
  $('inspectorBody').classList.toggle('unselected',!u);
  $('inspectorBody').setAttribute('aria-hidden',u?'false':'true');
  const m=u?MASTER[u.type]:null;
  const stat=(label,value,wide=false)=>`<div class="stat ${wide?'wide':''}">${label}<b>${value}</b></div>`;
  const guard=info?.guardId?find(info.guardId):null;
  const hp=u?(inHand?u.maxHp:u.hp):0;
  const passiveText=info?.passives.length?info.passives.map(p=>`<div class="passive-description"><b>${p.name}</b><p>${p.description}</p></div>`).join(''):'<p>パッシブなし</p>';
  const attackText=info?`<span class="effective-atk">${info.atk}</span><small class="atk-breakdown">基礎 ${info.baseAtk} ＋ ${info.bonusAtk}</small>`:'—';
  $('inspectorBody').innerHTML=`<div class="portrait ${u?'':'empty'}" aria-hidden="true">${m?m.icon:'♟'}</div><div class="status-copy" data-detail-id="${u?.id||''}" tabindex="${u?'0':'-1'}" role="region" aria-label="能力とパッシブ。詳細ボタンでも確認できる"><div class="identity"><h2 class="unit-title ${u?'':'status-empty'}">${m?m.name:'手駒を選択'}</h2><span class="hp-overview">${inHand?'出撃時 ':''}HP ${hp}/${u?.maxHp||'—'}</span><div class="side-tag ${u?.side||''}">${u?(ally?'YOUR COMPANION':'DEPTHS ENEMY'):'PIECE CHRONICLES'}</div></div><div class="stats">${stat('HP',u?`${hp} <small>/ ${u.maxHp}</small>`:'— <small>/ —</small>',true)}<div class="health-line"><i style="width:${u?hp/u.maxHp*100:0}%"></i></div>${stat('ATK',attackText)}${stat('移動',m?m.move:'—')}${stat('射程',m?m.range:'—')}${stat('コスト',m?m.cost:'—')}</div><div class="protection-info" id="protectionInfo">${inHand?'再出撃は満HP・コストなし。捕獲手駒内ではパッシブは発動しない。':guard?`守護の石壁：${MASTER[guard.type].name}が肩代わり <span>HP ${guard.hp}／${guard.maxHp}</span>`:'守護の石壁：保護なし'}</div><div class="passive-info" id="passiveInfo">${info?.knightIds.length?`<p class="inspiration-info">鼓舞：隣接する騎士 ${info.knightIds.length}体で強化中</p>`:""}${passiveText}</div></div>`;
  $('inspectorBody').querySelector('.status-copy').scrollTop=detailScroll;
  const actingAlly=ally&&!inHand;
  const canAttack=actingAlly&&!busy&&state.phase==='player'&&Engine.targets(state,u.id).length>0;
  $('skillActions').classList.toggle('inactive',!actingAlly);
  $('skillActions').setAttribute('aria-hidden',actingAlly?'false':'true');
  $('skillActions').inert=!actingAlly;
  $('normalAttackBtn').disabled=!canAttack;
  $('normalAttackBtn').setAttribute('aria-pressed',attackMode?'true':'false');
  $('normalAttackBtn').querySelector('small').textContent=canAttack?'射程内の敵を選択':'射程内に敵がいない';
  $('cancelAttackBtn').hidden=!attackMode;
  $('inspector').classList.toggle('target-mode',attackMode);
  board.dataset.attackMode=attackMode?'true':'false';
}

function render(skipUnits=false) {
  if (!find(selectedId)) {selectedId=null;attackMode=false;}
  if(!findHand(selectedHandId))selectedHandId=null;
  $('floorNum').textContent=state.floor;$('floorTitle').textContent=names[state.floor-1];
  $('turnNum').textContent=`TURN ${String(state.turn).padStart(2,'0')}`;
  $('phaseBadge').textContent=phaseLabel();$('phaseBadge').classList.toggle('enemy',state.phase==='enemy');
  $('waitBtn').disabled=busy||state.phase!=='player';
  $('restartBtn').disabled=busy||state.phase==='enemy';$('clearSaveBtn').disabled=busy||state.phase==='enemy';
  const u=selected();
  $('boardHint').dataset.mode=attackMode?'attack':'normal';
  $('boardHint').textContent=busy?'一手の行方を見届けよう。':state.phase==='enemy'?'敵が次の一手を考えている…':state.phase==='preparation'?'所有駒から軍団を編成して出撃しよう。':state.phase!=='player'?'この階層の戦いは決着した。':selectedHand()?(u.side==='enemy'?'敵の捕獲手駒を確認中。':deploySquares().length?'光る空きマスへ出撃。1手番を使う。':'空きマスがないため、今は出撃できない。'):attackMode?'赤い敵をタップして攻撃。':u?(u.side==='enemy'?'敵の能力を確認中。':'青へ移動 ／ 赤い敵を攻撃。'):'';
  $('logList').innerHTML=state.log.map(text=>`<li>${text}</li>`).join('');
  if(!skipUnits) paintUnits(); paintHands();paintInspector();paintHighlights();
}
function unitTap(id) {
  if (busy || overlay.hidden===false || state.phase!=='player') return;
  const actor=selected(), target=find(id);
  if (!target) return;
  if (actor && actor.side==='player' && target.side==='enemy' && Engine.targets(state,actor.id).some(t=>t.id===id)) {
    doAction({type:'attack',unitId:actor.id,targetId:id});return;
  }
  selectedHandId=null;attackMode=false;selectedId=selectedId===id?null:id;render();
}
function cellTap(x,y) {
  if(busy||!overlay.hidden||state.phase!=='player')return;
  const occupied=state.units.find(u=>u.x===x&&u.y===y);
  const hand=selectedHand();
  if(hand&&hand.side==='player') {
    if(!occupied&&deploySquares().some(p=>p.x===x&&p.y===y))doAction({type:'deploy',unitId:hand.id,x,y});
    else toast('出撃できる空きマスを選んでね。');
    return;
  }
  if(occupied){unitTap(occupied.id);return;}
  const actor=selected();
  if(actor&&actor.side==='player') {
    if(Engine.moves(state,actor.id).some(m=>m.x===x&&m.y===y)) doAction({type:'move',unitId:actor.id,x,y});
    else toast('青く光るマスへ移動できるよ。');
  } else {attackMode=false;selectedId=null;render();}
}
function canAnimate(context) {
  return !context.skipVisual && context.revision===projectionRevision && context.generation===generation;
}
async function playVisual(element, frames, options, context) {
  if(!element?.isConnected||!canAnimate(context))return false;
  const animation=element.animate(frames,options);
  activeAnimations.add(animation);
  try {
    await animation.finished;
    return canAnimate(context)&&element.isConnected;
  } catch(error) {
    // Layout changes cancel WAAPI promises. Continue later nonvisual events exactly once.
    if(error.name!=='AbortError')console.error(error);
    return false;
  } finally {
    activeAnimations.delete(animation);animation.cancel();
  }
}
async function animateEvents(events, context) {
  for(const e of events) {
    if(context.generation!==generation)return;
    if(e.type==='capture') {
      toast(`${e.side==='player'?'捕獲！':'敵が捕獲！'} ${MASTER[e.unitType].icon} ${MASTER[e.unitType].name}（戦闘中の手駒）`);
      continue;
    }
    if(!canAnimate(context))continue;
    if(e.type==='deploy') {
      const unit=find(e.unitId);if(!unit)continue;
      paintUnits();paintHighlights();const el=unitElements.get(e.unitId);if(!el)continue;
      board.dataset.animation='deploy';
      await playVisual(el,[{opacity:0,transform:'translateY(-9px) scale(.7)'},{opacity:1,transform:'translateY(0) scale(1)'}],{duration:reducedMotion?1:190,easing:'ease-out'},context);
    }
    if(e.type==='guard') {
      const guardian=unitElements.get(e.unitId),point=context.positions.get(e.unitId);
      if(!guardian||!point)continue;
      board.dataset.animation='guard';
      const cue=showPassiveCue('守護の石壁',point);
      cue.dataset.sourceId=e.unitId;cue.dataset.effect='guard';
      try {
        await playVisual(guardian.querySelector('.token'),[{filter:'brightness(1)'},{filter:'brightness(1.8) drop-shadow(0 0 8px #cce5c0)'},{filter:'brightness(1)'}],{duration:reducedMotion?1:context.guardDuration},context);
      } finally {cue.remove();}
    }
    if(e.type==='move') {
      const el=unitElements.get(e.unitId);if(!el)continue;
      board.dataset.animation='move';
      const complete=await playVisual(el,[e.from,...e.path].map(point=>displayPosition(point)),{duration:reducedMotion?1:Math.max(240,e.path.length*145),easing:'ease-in-out',fill:'forwards'},context);
      // A canceled old projection must never overwrite the reconciled position.
      if(complete)placeUnit(el,e.to);
    }
    if(e.type==='attack') {
      const attacker=unitElements.get(e.unitId),target=unitElements.get(e.targetId);
      if(!attacker||!target)continue;
      board.dataset.animation=e.followUp?'support':'attack';
      const actorPoint=context.positions.get(e.unitId),targetPoint=context.positions.get(e.targetId);
      if(!actorPoint||!targetPoint)continue;
      const aimPoint=context.positions.get(e.originalTargetId)||targetPoint;
      const a=Display.toDisplay(actorPoint,portraitView),t=Display.toDisplay(aimPoint,portraitView);
      const {cols,rows}=Display.dimensions(portraitView),rect=board.getBoundingClientRect();
      const dx=(t.col-a.col)/cols*rect.width,dy=(t.row-a.row)/rows*rect.height,dist=Math.hypot(dx,dy)||1;
      const cue=e.followUp?showPassiveCue('支援射撃',actorPoint):null;
      if(cue){cue.dataset.sourceId=e.unitId;cue.dataset.effect='support';}
      let complete;
      try {
        complete=await playVisual(attacker.querySelector('.token'),[{transform:'translate(0,0)'},{transform:`translate(${dx/dist*15}px,${dy/dist*15}px) scale(1.06)`},{transform:'translate(0,0)'}],{duration:reducedMotion?1:e.followUp?context.supportDuration:220,easing:'ease-out'},context);
      } finally {cue?.remove();}
      if(!complete||!target.isConnected)continue;
      const damage=document.createElement('span');damage.className='floating-damage';damage.textContent=`−${e.damage}`;
      damage.dataset.recipientId=e.targetId;damage.dataset.originalTargetId=e.originalTargetId||e.targetId;
      Object.assign(damage.style,displayPosition(targetPoint,.5,.35));pieceLayer.appendChild(damage);
      const hp=e.hpAfter??find(e.targetId)?.hp??0;
      target.querySelector('.hp').textContent=hp;
      target.querySelector('.hp-track i').style.width=`${hp/context.maxHp.get(e.targetId)*100}%`;
      await playVisual(target.querySelector('.token'),[{transform:'translateX(0)',filter:'brightness(2)'},{transform:'translateX(-4px)'},{transform:'translateX(4px)'},{transform:'translateX(0)',filter:'brightness(1)'}],{duration:reducedMotion?1:e.followUp?context.supportDuration*.75:220},context);
      setTimeout(()=>damage.remove(),700);
    }
    if(e.type==='death') {
      const el=unitElements.get(e.unitId),point=context.positions.get(e.unitId);
      if(el&&point) {
        board.dataset.animation='death';placeUnit(el,point);
        const complete=await playVisual(el,[{opacity:1,transform:'scale(1)'},{opacity:0,transform:'scale(.7) translateY(-10px)'}],{duration:reducedMotion?1:context.deathDuration,fill:'forwards'},context);
        if(complete){el.remove();unitElements.delete(e.unitId);}
      }
    }
  }
}

function showPassiveCue(text,point) {
  const cue=document.createElement('span');cue.className='passive-cue';cue.textContent=text;
  Object.assign(cue.style,displayPosition(point,.5,.25));pieceLayer.appendChild(cue);return cue;
}

async function doAction(action) {
  if(busy||!['player','enemy'].includes(state.phase))return;
  const token=generation;
  const context={generation:token,revision:projectionRevision,skipVisual:false,positions:new Map(state.units.map(u=>[u.id,{x:u.x,y:u.y}])),maxHp:new Map(state.units.map(u=>[u.id,u.maxHp]))};
  const result=Engine.act(state,action);
  if(!result.ok){toast(result.error);return;}
  saveState(); // Save the committed action and settlement before any animation or enemy timer.
  // Bound added presentation time as more passives fire; combat still resolves in the engine once.
  context.supportDuration=Math.max(28,Math.min(95,450/Math.max(1,result.events.filter(e=>e.type==='attack'&&e.followUp).length)));
  context.guardDuration=Math.max(25,Math.min(90,220/Math.max(1,result.events.filter(e=>e.type==='guard').length)));
  context.deathDuration=Math.max(45,Math.min(230,460/Math.max(1,result.events.filter(e=>e.type==='death').length)));
  presentationContext=context;attackMode=false;busy=true;render(true);
  try {await animateEvents(result.events,context);} catch(error) {console.error(error);}
  finally {if(presentationContext===context)presentationContext=null;delete board.dataset.animation;}
  if(token!==generation)return;
  busy=false;selectedId=null;selectedHandId=null;render();
  if(['victory','defeat','clear'].includes(state.phase)) {await sleep(reducedMotion?1:300);showResult();}
  else if(state.phase==='enemy') scheduleEnemy();
}
async function scheduleEnemy() {
  const token=generation;
  await sleep(reducedMotion?30:620);
  if(token===generation&&state.phase==='enemy'&&!busy)await doAction(Engine.chooseAI(state));
}
$('normalAttackBtn').addEventListener('click',()=>{
  const u=selected();
  if(busy||!overlay.hidden||state.phase!=='player'||u?.side!=='player'||!Engine.targets(state,u.id).length)return;
  attackMode=true;render();
});
$('cancelAttackBtn').addEventListener('click',()=>{attackMode=false;render();});
for(const name of ['menu','log']) {
  $(name+'Btn').addEventListener('click',()=>toggleFlyout(name));
  $('close'+(name==='menu'?'Menu':'Log')+'Btn').addEventListener('click',()=>{
    closeFlyouts();$(name+'Btn').focus();
  });
}
document.addEventListener('click',event=>{
  if(!event.target.closest('.flyout,#menuBtn,#logBtn'))closeFlyouts();
});
$('waitBtn').addEventListener('click',()=>{
  if(busy||state.phase!=='player'||!overlay.hidden)return;
  const u=find(selectedId);doAction({type:'wait',...(u?.side==='player'?{unitId:u.id}:{})});
});
function rewardsHTML() {
  return state.lastRewards.length?state.lastRewards.map(type=>`<span class="loot-chip">${MASTER[type].icon} ${MASTER[type].name} × 1</span>`).join(''):'<p>今回は正式獲得なし。元の所有手駒は返還されたよ。</p>';
}
function showFormation() {
  const preparing=state.phase==='preparation';
  const cost=state.formation.reduce((sum,id)=>sum+MASTER[state.roster.find(p=>p.id===id).type].cost,0);
  const rosterCards=state.roster.map((p,i)=>{
    const m=MASTER[p.type],chosen=state.formation.includes(p.id);
    const isNew=i>=state.roster.length-state.lastRewards.length;
    return `<button class="roster-card ${chosen?'chosen':''}" data-roster="${p.id}" aria-pressed="${chosen}" aria-label="${m.name} 個体${i+1} コスト${m.cost} ${chosen?'出撃中':'控え'}"><span class="roster-icon" aria-hidden="true">${m.icon}</span><span class="cost">COST ${m.cost}</span><span class="check">${chosen?'✓ 出撃':isNew?'NEW':''}</span><span class="name">${m.name} <small style="color:var(--muted)">#${i+1}</small></span><span class="mini-stat">HP ${m.hp}　ATK ${m.atk}<br>移動 ${m.move}　射程 ${m.range}</span></button>`;
  }).join('');
  openModal('formation',`<div class="modal-title"><div><div class="eyebrow">${preparing?'EXPEDITION PREPARATION':`FLOOR ${String(state.floor).padStart(2,'0')} — VICTORY`}</div><h2 id="modalTitle">${preparing?'所有駒を選んで、世界の底へ。':'手駒を迎えて、さらに深く。'}</h2><p>${preparing?`所有 ${state.roster.length+1}体（王を含む） · ${saveWarningShown?'自動保存できていないため、ブラウザーの保存設定を確認してね。':'この端末に自動保存。'}<br>王は必須。手駒を選んで探索を始めよう。`:`正式獲得 ${state.lastRewards.length}体 · 元の所有手駒 ${state.lastReturns?.length||0}体を返還。<br>味方は全員復帰・HP全回復。次の仲間を選ぼう。`}</p></div><span style="color:var(--gold);font-size:27px">✦</span></div><div class="rewards" aria-label="獲得した手駒">${preparing?'':rewardsHTML()}</div><div class="divider"></div><div class="formation-bar"><span>次の出撃メンバー <small>タップで入れ替え</small></span><span class="formation-count">手駒 ${state.formation.length}/${ARMY_RULES.maxHandPieces}　コスト ${cost}/${ARMY_RULES.costLimit}</span></div><div class="roster"><div class="roster-card fixed"><span class="roster-icon">${MASTER.king.icon}</span><span class="cost">COST 0</span><span class="check" style="color:var(--gold)">必須</span><span class="name">王 <small>#${state.kingId}</small></span><span class="mini-stat">HP 12　ATK 2<br>移動 1　射程 1</span></div>${rosterCards}</div><div class="modal-actions"><span class="modal-note">同じ種類も編成OK。選んだ${ARMY_RULES.maxHandPieces}体までが王と出撃するよ。</span><button class="primary" id="nextFloorBtn">${preparing?'探索開始 →':`${state.floor+1}Fへ進む →`}</button></div>`);
  modal.querySelectorAll('[data-roster]').forEach(button=>button.addEventListener('click',()=>{
    const id=button.dataset.roster;
    const ids=state.formation.includes(id)?state.formation.filter(p=>p!==id):[...state.formation,id];
    const result=Engine.setFormation(state,ids);
    if(!result.ok){toast(result.error);return;}
    saveState();showFormation();modal.querySelector(`[data-roster="${id}"]`)?.focus();
  }));
  $('nextFloorBtn').addEventListener('click',()=>{
    const result=preparing?Engine.begin(state):Engine.advance(state);if(!result.ok){toast(result.error);return;}
    saveState();
    attackMode=false;selectedId=null;selectedHandId=null;closeModal();render();toast(`${state.floor}Fへ。軍団のHPが全回復した！`);
  });
}
function showResult() {
  if(state.phase==='victory') {showFormation();return;}
  if(!['clear','defeat'].includes(state.phase))return;
  const won=state.phase==='clear';
  openModal('ending',`<div class="ending"><div class="eyebrow">${won?'PROTOTYPE COMPLETED':'THE JOURNEY ENDS'}</div><div class="emblem">${won?'♛':'♚'}</div><h2 id="modalTitle">${won?'世界の底へ、最初の一歩。':'王は倒れた。でも、また潜れる。'}</h2><p>${won?'10F踏破！ セカソコ！～手駒編～ VER.010 クリア。':'味方の王のHPが0になった。新しい所有手駒の獲得はなし。元の所有手駒は返還された。'}<br>${state.floor}F到達 · 総行動 ${state.totalActions}手 · 所有駒${state.roster.length+1}体（王を含む）。<br>正式獲得 ${state.lastRewards.length}体 · 元の所有手駒 ${state.lastReturns?.length||0}体を返還。</p>${won?`<div class="rewards" style="justify-content:center">${rewardsHTML()}</div>`:''}<div class="modal-actions"><button class="primary" id="retryBtn">所有駒で編成し直す →</button></div><p style="font-size:10px;margin-top:15px">正式に獲得した所有駒を保持して、1Fから新しく探索するよ。</p></div>`);
  $('retryBtn').addEventListener('click',resetRun);
}
function resetRun() {
  saveState();generation++;busy=false;attackMode=false;selectedId=null;selectedHandId=null;state=Engine.createRun(collection,true);
  for(const el of unitElements.values())el.remove();unitElements.clear();
  board.querySelectorAll('.floating-damage,.passive-cue').forEach(el=>el.remove());
  saveState();closeModal();render();showFormation();
}
function showPieceDetails() {
  const u=selected();if(!u||busy||state.phase!=='player'||!overlay.hidden)return;
  const m=MASTER[u.type],inHand=!!selectedHand();
  const info=inHand?{atk:m.atk,bonusAtk:0,knightIds:[],guardId:null}:Engine.combatInfo(state,u.id);
  const guard=info.guardId?find(info.guardId):null;
  const passives=Engine.passivesFor(u.type).map(p=>`<div class="passive-description"><b>${p.name}</b><p>${p.description}</p></div>`).join('')||'<p>パッシブなし</p>';
  const canAttack=!inHand&&u.side==='player'&&Engine.targets(state,u.id).length>0;
  openModal('piece',`<div class="piece-detail"><div class="modal-title"><div><div class="eyebrow">${u.side==='player'?'味方':'敵'}${inHand?'の捕獲手駒':'の盤上駒'}</div><h2 id="modalTitle">${m.icon} ${m.name}</h2><p class="detail-id">個体 #${u.id} · ${u.originSide==='player'?'元の所有手駒':'今回の敵出自'}</p></div><button class="icon-btn" id="closeDetailsBtn" aria-label="駒の詳細を閉じる">×</button></div><div class="detail-stats"><span>${inHand?'出撃時 ':''}HP<b>${inHand?u.maxHp:u.hp} / ${u.maxHp}</b></span><span>ATK<b class="detail-effective-atk">${info.atk}</b><small>基礎 ${m.atk} ＋ ${info.bonusAtk}</small></span><span>移動<b>${m.move}</b></span><span>射程<b>${m.range}</b></span><span>編成コスト<b>${m.cost}</b></span></div><div class="protection-info">${inHand?'再出撃は満HP・コストなし。手駒内のパッシブは発動せず、出撃直後から有効。':guard?`守護の石壁：${MASTER[guard.type].name} #${guard.id} が肩代わり（HP ${guard.hp} / ${guard.maxHp}）`:'守護の石壁：保護なし'}</div><div class="passive-info">${info.knightIds.length?`<p>鼓舞：隣接する騎士${info.knightIds.length}体で強化中。</p>`:''}${passives}</div>${inHand?'<p>味方の手駒を選んで、光る空きマスへ出撃。敵陣も選べる。戦闘中の人数上限はない。</p>':''}<div class="modal-actions"><button id="detailAttackBtn" ${canAttack?'':'disabled'}>通常攻撃</button><button disabled>固有技（未実装）</button><button disabled>必殺技（未実装）</button><button class="primary" id="backFromDetailsBtn">盤面へ戻る</button></div></div>`);
  $('closeDetailsBtn').addEventListener('click',closeModal);$('backFromDetailsBtn').addEventListener('click',closeModal);
  $('detailAttackBtn').addEventListener('click',()=>{closeModal();$('normalAttackBtn').click();});
}
$('detailsBtn').addEventListener('click',showPieceDetails);
function showRules() {
  const passiveRules=Object.keys(MASTER).flatMap(type=>Engine.passivesFor(type).map(p=>`${MASTER[type].name}「${p.name}」：${p.description}`)).join("<br>");
  openModal('rules',`<div class="modal-title"><div><div class="eyebrow">HOW TO PLAY · VER.010</div><h2 id="modalTitle">一手ずつ、仲間と底へ。</h2></div><button class="icon-btn" id="closeRulesBtn" aria-label="遊び方を閉じる">×</button></div><div class="rules-grid"><section><h3>01 · 動く、攻める、待つ。</h3><p>味方の駒 → 青いマスで移動。<br>味方の駒 → 赤い敵で攻撃。<br>移動と攻撃はそれぞれ1行動。1体の行動後、敵と交代するよ。待機は未選択でも使える。範囲は上下左右の距離、移動は駒を通り抜けられない。遠距離攻撃は射線を遮られないよ。</p></section><section><h3>02 · 王を守って、手駒を集める。</h3><p>敵の王を倒せば勝利、味方の王が倒れたら敗北。王手・詰みはなし。<br>王以外を撃破すると、その個体が戦闘中の捕獲手駒に。敵も捕獲・再出撃するよ。<br>勝利時に「今回の敵出自で、いま味方に所属する個体」だけを100%正式獲得。敵に奪い返された個体は獲得しない。元の所有手駒は勝敗を問わず返還される。</p></section><section><h3>03 · 軍団を組んで、次の階層へ。</h3><p>王1体＋手駒最大${ARMY_RULES.maxHandPieces}体、コスト合計${ARMY_RULES.costLimit}以内。<br>同じ種類も複数編成OK。階層の間に全員が復帰し、HP全回復。捕獲手駒は同じ戦闘中にも再出撃できる。階層をまたぐ正式な編成とは別で、10Fを突破すれば試作版クリア！</p></section><section><h3>04 · 試作版について。</h3><p>数値と敵編成は仮仕様。2Fから敵はランダム、深層ほど強い敵に出会いやすくなるよ。<br>この端末に自動保存し、再起動すると続きから。所有駒は新しい探索にも引き継ぐ。音は未実装。iPhoneの縦向き・横向きで遊べるよ。</p></section><section><h3>05 · 仲間と連携する。</h3><p>${passiveRules}<br>自動発動で追加の手番は使わない。鼓舞は加算後に切り捨て。追撃からの追撃や、肩代わりの連鎖は起きないよ。王が倒れたらその時点で決着。ステータスの「詳細」から、強化や保護も確認しよう。</p></section><section><h3>06 · 捕獲して、再出撃。</h3><p>味方の捕獲手駒を選び、光る空きマスへ。全35マスが対象で、敵陣や敵王の隣もOK。<br>再出撃だけで1行動、満HP・コストなし。戦闘中は空きマスがある限り出撃できる。出撃直後からパッシブが有効で、手駒内では発動しない。再捕獲でも同じ個体のまま。横スクロールで全個体を選べるよ。</p></section></div><div class="divider"></div><div class="panel-head">CHARACTER MASTER · 全10種類</div><table class="master-table"><thead><tr><th>手駒</th><th>HP</th><th>ATK</th><th>移動</th><th>射程</th><th>コスト</th></tr></thead><tbody>${Object.values(MASTER).map(m=>`<tr><td>${m.icon} ${m.name}</td><td>${m.hp}</td><td>${m.atk}</td><td>${m.move}</td><td>${m.range}</td><td>${m.cost}</td></tr>`).join('')}</tbody></table><div class="modal-actions"><button class="primary" id="backToBoardBtn">盤面に戻る →</button></div>`);
  $('closeRulesBtn').addEventListener('click',closeModal);$('backToBoardBtn').addEventListener('click',closeModal);
}
$('helpBtn').addEventListener('click',showRules);
$('restartBtn').addEventListener('click',()=>{
  if(busy||state.phase==='enemy')return;
  openModal('restart',`<div class="eyebrow">START A NEW JOURNEY</div><h2 id="modalTitle">1Fからやり直す？</h2><p>今の探索と未確定の捕獲手駒を終了し、1Fの出撃前へ戻るよ。正式に所有した駒は残る。</p><div class="modal-actions"><button id="cancelRestartBtn" class="quiet">探索を続ける</button><button class="primary" id="confirmRestartBtn">最初から始める</button></div>`);
  $('cancelRestartBtn').addEventListener('click',closeModal);$('confirmRestartBtn').addEventListener('click',resetRun);
});
$('clearSaveBtn').addEventListener('click',()=>{
  if(busy||state.phase==='enemy')return;
  openModal('clearSave',`<div class="eyebrow">RESET ALL SAVE DATA</div><h2 id="modalTitle">全セーブデータを初期化する？</h2><p>永続所有・編成・探索の進行をすべて消すよ。初期所有の王・騎士・弓兵の3体に戻る。この操作は取り消せない。</p><div class="modal-actions"><button id="cancelClearSaveBtn" class="quiet">戻る</button><button class="primary" id="confirmClearSaveBtn">全データを初期化</button></div>`);
  $('cancelClearSaveBtn').addEventListener('click',closeModal);
  $('confirmClearSaveBtn').addEventListener('click',()=>{
    if(!Storage.clear()){toast('保存データを削除できなかった。ブラウザーの保存設定を確認してね。');return;}
    collection=Engine.createCollection();state=Engine.createRun(collection,true);saveWarningShown=false;
    generation++;busy=false;attackMode=false;selectedId=null;selectedHandId=null;
    for(const el of unitElements.values())el.remove();unitElements.clear();
    board.querySelectorAll('.floating-damage,.passive-cue').forEach(el=>el.remove());
    saveState();closeModal();render();showFormation();
  });
});
document.addEventListener('keydown',event=>{
  if(overlay.hidden) {
    if(event.key==='Escape') {
      if(!$('menuPanel').hidden||!$('logPanel').hidden) {
        const focus=$('menuPanel').hidden?'logBtn':'menuBtn';closeFlyouts();$(focus).focus();
      } else if(attackMode) {attackMode=false;render();}
      else if(selectedHandId){selectedHandId=null;render();}
    }
    return;
  }
  if(event.key==='Escape'&&['rules','restart','piece','clearSave'].includes(modalMode)) {closeModal();return;}
  if(event.key!=='Tab')return;
  const items=[...modal.querySelectorAll('button:not(:disabled),[tabindex="0"]')];
  if(!items.length){event.preventDefault();return;}
  const first=items[0],last=items[items.length-1];
  if(event.shiftKey&&(document.activeElement===first||document.activeElement===modal)){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===modal)){event.preventDefault();first.focus();}
});
paintProjection();render();saveState();
if(state.phase==='preparation')showFormation();
else if(['victory','defeat','clear'].includes(state.phase))showResult();
else if(state.phase==='enemy')scheduleEnemy();
// Read-only snapshot allows reproducible QA without affecting gameplay.
globalThis.Sekasoko.inspect = () => JSON.parse(JSON.stringify(state));
})();
