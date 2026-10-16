// The taste board: one self-contained page, CSS and JS inline, no requests but its own images and
// answers. The model is a preference test, not a form: one reference at a time, as large as the
// screen allows, a 1-to-5 scale with anchors only at the ends (no leading words in the middle), and
// a tap that saves and moves on. Number keys do the same on a desktop.

const CSS = `
:root{
  --bg:#f3f1eb;--paper:#fbfaf6;--ink:#1d1c19;--muted:#6f6b62;--line:#d9d5ca;--soft:#e9e6dd;
  --star:#b9821a;--warn:#a5481b;--shadow:0 1px 2px rgba(30,25,15,.08),0 10px 30px rgba(30,25,15,.10);
  color-scheme:light;
}
@media (prefers-color-scheme:dark){:root{
  --bg:#131312;--paper:#1c1b19;--ink:#efece4;--muted:#9d998f;--line:#34322d;--soft:#262522;
  --star:#e2ad45;--warn:#e98a5a;--shadow:0 1px 2px rgba(0,0,0,.4),0 10px 30px rgba(0,0,0,.35);
  color-scheme:dark;
}}
*{box-sizing:border-box}
html,body{margin:0;height:100%;overflow:hidden;overscroll-behavior:none;background:var(--bg);color:var(--ink);
  font:15px/1.4 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
button,input{font:inherit;color:inherit}
button{touch-action:manipulation;-webkit-tap-highlight-color:transparent;cursor:pointer}
#app{height:100dvh;display:grid;grid-template-rows:auto 1fr auto;max-width:1600px;margin:0 auto}
header{display:flex;align-items:center;gap:8px;padding:8px max(12px,env(safe-area-inset-left)) 4px}
.icon{min-width:44px;height:44px;border:0;background:transparent;border-radius:22px;font-size:26px;line-height:1;display:grid;place-items:center}
.icon:disabled{opacity:.25;cursor:default;background:transparent}
.where{flex:1;min-width:0;display:flex;flex-direction:column}
#progress{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-variant-numeric:tabular-nums}
#name{font-family:ui-serif,Georgia,"Iowan Old Style",serif;font-size:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#save{font-size:12px;color:var(--muted);white-space:nowrap;min-width:3.5em;text-align:right}
#save.failed{color:var(--warn)}
#done{height:44px;min-width:72px;padding:0 16px;border-radius:22px;border:1px solid var(--line);background:var(--paper);font-weight:600}
#done.ready{background:var(--ink);color:var(--bg);border-color:var(--ink)}
main{position:relative;min-height:0;padding:8px 16px}
/* A sideways swipe on the stage is the board's (next comp), never the browser's back gesture. */
#stage{touch-action:pan-y;position:absolute;inset:8px 16px;display:flex;align-items:center;justify-content:center;gap:var(--gap,20px);transition:opacity .12s ease}
#stage.leaving{opacity:0}
figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:6px}
figure .shot{background:var(--paper);border-radius:8px;box-shadow:var(--shadow);overflow:hidden;display:block}
figure img{display:block;width:100%;height:100%;object-fit:contain}
figcaption{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);height:14px}
footer{padding:4px 16px max(12px,env(safe-area-inset-bottom));display:flex;flex-direction:column;align-items:center;gap:8px}
.scale{width:100%;max-width:560px}
.rates{display:flex;gap:8px}
.rate{flex:1;height:60px;min-width:44px;border-radius:14px;border:1px solid var(--line);background:var(--paper);
  font-size:22px;font-weight:600;font-variant-numeric:tabular-nums;transition:transform .08s ease,background .12s ease}
.rate:active{transform:scale(.96)}
.rate[aria-pressed=true]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.anchors{display:flex;justify-content:space-between;font-size:12px;color:var(--muted);padding:4px 4px 0}
#note{width:100%;max-width:560px;height:44px;border-radius:12px;border:1px solid var(--line);background:transparent;padding:0 14px}
#note::placeholder{color:var(--muted)}
#note:focus{outline:2px solid var(--ink);outline-offset:-1px}
.end{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;height:100%;text-align:center}
.end h1{font-family:ui-serif,Georgia,serif;font-weight:500;font-size:30px;margin:0}
.end p{margin:0;color:var(--muted)}
.thumbs{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;max-width:100%}
.thumb{border:1px solid var(--line);background:var(--paper);border-radius:10px;padding:4px;display:flex;flex-direction:column;align-items:center;gap:3px;min-width:44px;min-height:44px}
.thumb img{display:block;object-fit:cover;object-position:top;border-radius:6px}
.thumb span{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
#finish{height:56px;padding:0 32px;border-radius:28px;border:0;background:var(--ink);color:var(--bg);font-size:17px;font-weight:600}
.asking #name{font-size:20px}
.grid{position:absolute;inset:0;display:grid;gap:16px;justify-content:center;align-content:center}
.comp{position:relative;min-width:0;min-height:0;display:flex;flex-direction:column;gap:6px;border-radius:12px;padding:6px;border:2px solid transparent;background:transparent}
.comp.sel{border-color:var(--ink)}
.one .comp.sel{border-color:transparent}
.chips{position:absolute;top:0;left:0;right:0;display:flex;gap:8px;justify-content:center}
.chip{flex:1;max-width:88px;min-width:44px;height:52px;border-radius:12px;border:1px solid var(--line);background:var(--paper);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;line-height:1.1;padding:0}
.chip b{font-family:ui-serif,Georgia,serif;font-size:19px;font-weight:500}
.chip small{font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}
.chip[aria-selected=true]{border-color:var(--ink);box-shadow:inset 0 0 0 1px var(--ink)}
.chip b{color:var(--ink)}
.comp .pick{flex:none;border:0;padding:0;background:var(--paper);border-radius:8px;box-shadow:var(--shadow);overflow:hidden;display:block;width:100%}
.comp .pick img{display:block;width:100%;height:100%;object-fit:contain}
.comp .bar{display:flex;align-items:center;gap:6px;height:44px}
.comp .label{flex:1;min-width:0;font-family:ui-serif,Georgia,serif;font-size:18px;padding-left:4px}
.comp .score{font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums}
.star{width:44px;height:44px;border-radius:22px;border:1px solid var(--line);background:var(--paper);font-size:20px;line-height:1;color:var(--muted);flex:none}
.star[aria-pressed=true]{color:var(--star);border-color:var(--star)}
.ended{position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom));transform:translateX(-50%);width:min(560px,calc(100% - 24px));
  background:var(--ink);color:var(--bg);border-radius:14px;padding:14px 16px;box-shadow:var(--shadow);font-size:14px;z-index:10}
.closed{display:grid;place-items:center;height:100dvh;text-align:center;padding:24px}
.closed h1{font-family:ui-serif,Georgia,serif;font-weight:500;font-size:28px;margin:0 0 8px}
.closed p{margin:0;color:var(--muted)}
@media (max-width:520px){
  .rate{height:56px;border-radius:12px;font-size:20px}
  .rates{gap:6px}
  #name{font-size:15px}
  main{padding:4px 12px}
  #stage{inset:4px 12px;--gap:12px}
  footer{padding-left:12px;padding-right:12px;gap:6px}
  .asking #name{font-size:17px}
  .grid{gap:8px}
  .comp{padding:3px}
}
/* Hover only where a pointer really hovers: on a phone a sticky :hover reads as a rating already given. */
@media (hover:hover){.icon:hover{background:var(--soft)}.rate:hover{border-color:var(--muted)}}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`

const JS = `
(function(){
'use strict'
var S = JSON.parse(document.getElementById('state').textContent)
var refs = S.refs, comps = S.comps
var steps = refs.map(function(r, i){ return { kind: 'ref', i: i } })
steps.push(comps.length ? { kind: 'comps' } : { kind: 'end' })
var $ = function(id){ return document.getElementById(id) }
var stage = $('stage'), note = $('note'), footer = $('footer')
var pos = 0, sel = 0, busy = false, noteTimer = null
var notes = {}

function answerOf(kind, id){ return (kind === 'comp' ? S.compRatings : S.ratings)[id] || {} }
function el(tag, cls, text){ var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }

// Saving. An answer joins a queue and leaves it only when the server says it is on disk; a failed
// send stays queued and is retried, and "Saved" shows only when the queue is empty. Answers go one
// at a time, in order, so a later answer for a card never lands under an earlier one; a newer
// answer for a card still waiting is merged into it. A 4xx is never retried: the server is up and
// has said no (the round ended or changed), so the page says that plainly.
var queue = [], retryTimer = null, ended = false, failing = false
function setSave(s){
  var t = $('save'); t.className = s === 'failed' ? 'failed' : ''
  t.textContent = s === 'saving' ? 'Saving' : s === 'saved' ? 'Saved' : s === 'failed' ? 'Not saved' : ''
}
function status(){ setSave(ended ? '' : !queue.length ? 'saved' : failing ? 'failed' : 'saving') }
function send(path, body){
  return fetch(path, { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json', 'x-taste-token': S.token }, body: JSON.stringify(body) })
}
function keyOf(path, body){ return path === '/api/pick' ? 'pick' : path + ':' + body.kind + ':' + body.id }
function post(path, body){
  if (ended) return
  var k = keyOf(path, body)
  for (var i = 0; i < queue.length; i++){
    var q = queue[i]
    if (!q.busy && q.key === k){ q.body = path === '/api/pick' ? body : Object.assign({}, q.body, body); status(); pump(); return }
  }
  queue.push({ path: path, body: body, key: k, busy: false })
  status(); pump()
}
function deliver(item){
  item.busy = true
  return send(item.path, item.body)
    .then(function(r){
      item.busy = false
      if (r.status >= 400 && r.status < 500){ endRound(); return }
      if (!r.ok) throw new Error('HTTP ' + r.status)
      var i = queue.indexOf(item); if (i >= 0) queue.splice(i, 1)
      failing = false; status(); pump()
    })
    .catch(function(){ item.busy = false; failing = true; status(); retrySoon() })
}
function pump(){ if (!ended && !failing && queue.length && !queue[0].busy) deliver(queue[0]) }
function retrySoon(){
  if (retryTimer) return
  retryTimer = setTimeout(function(){ retryTimer = null; failing = false; pump() }, 2000)
}
function endRound(){
  if (ended) return
  ended = true; queue = []
  setSave('')
  var b = el('div', 'ended'); b.id = 'ended'; b.setAttribute('role', 'alert')
  b.appendChild(el('strong', null, 'This round has ended.'))
  b.appendChild(el('span', null, ' Every answer it saved is on disk. Run rig taste again for a fresh link.'))
  document.body.appendChild(b)
}
// The tab is going (closed, switched away, phone locked): send the note being typed and everything
// still queued now, as keepalive requests the browser finishes even after the page is gone. They
// leave the queue only when acknowledged, so a tab that was merely hidden, with the board
// unreachable, still has every answer to retry when it comes back.
function flushAll(){
  if (ended) return
  flushNote()
  queue.forEach(function(q){ if (!q.busy) deliver(q) })
}
window.addEventListener('pagehide', flushAll)
document.addEventListener('visibilitychange', function(){ if (document.visibilityState === 'hidden') flushAll() })

function flushNote(){
  if (!noteTimer) return
  clearTimeout(noteTimer); noteTimer = null
  var t = noteTarget(); if (t) post('/api/answer', { kind: t.kind, id: t.id, note: note.value })
}
function noteTarget(){
  var s = steps[pos]
  if (s.kind === 'ref') return { kind: 'ref', id: refs[s.i].id }
  if (s.kind === 'comps' && comps[sel]) return { kind: 'comp', id: comps[sel].id }
  return null
}
note.addEventListener('input', function(){
  var t = noteTarget(); if (!t) return
  notes[t.kind + ':' + t.id] = note.value
  var a = answerOf(t.kind, t.id); a.note = note.value
  clearTimeout(noteTimer)
  noteTimer = setTimeout(function(){ noteTimer = 1; flushNote() }, 250)
})
note.addEventListener('blur', flushNote)
note.addEventListener('keydown', function(e){ if (e.key === 'Escape' || e.key === 'Enter') note.blur(); e.stopPropagation() })

// Layout: make the shots as large as the stage allows. Two shots go side by side or stacked,
// whichever gives them more area; the phone shot sits beside the desktop one on a wide screen.
function fit(figs){
  var W = stage.clientWidth, H = stage.clientHeight - 20, gap = parseFloat(getComputedStyle(stage).gap) || 16
  var as = figs.map(function(f){ var i = f.querySelector('img'); return i.naturalWidth && i.naturalHeight ? i.naturalWidth / i.naturalHeight : (f.dataset.view === 'phone' ? 390/844 : 1.6) })
  var sumA = as.reduce(function(a, b){ return a + b }, 0)
  var sumInv = as.reduce(function(a, b){ return a + 1 / b }, 0)
  var n = figs.length
  var rowH = Math.min(H, (W - gap * (n - 1)) / sumA)
  var colW = Math.min(W, (H - (gap + 20) * (n - 1)) / sumInv)
  var rowArea = rowH * rowH * sumA, colArea = colW * colW * sumInv
  var row = n === 1 || rowArea >= colArea
  stage.style.flexDirection = row ? 'row' : 'column'
  figs.forEach(function(f, k){
    var w = row ? rowH * as[k] : colW, h = row ? rowH : colW / as[k]
    var s = f.querySelector('.shot'); s.style.width = Math.floor(w) + 'px'; s.style.height = Math.floor(h) + 'px'
  })
}

// The token rides on every image URL; v changes when the file does, so a reworked comp is never stale.
function imgUrl(card, view){ return '/img/' + encodeURIComponent(card.id) + '/' + view + '?t=' + encodeURIComponent(S.token) + '&v=' + (card.v[view] || '') }

var relayout = function(){}
// A horizontal swipe on the single comp moves to the next or previous one.
var swipeFrom = null
stage.addEventListener('touchstart', function(e){ swipeFrom = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null }, { passive: true })
stage.addEventListener('touchend', function(e){
  var t = e.changedTouches[0], from = swipeFrom; swipeFrom = null
  if (!from || !t || steps[pos].kind !== 'comps' || innerWidth >= ONE_UNDER) return
  var dx = t.clientX - from.x, dy = t.clientY - from.y
  if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.2) return
  select(Math.max(0, Math.min(comps.length - 1, sel + (dx < 0 ? 1 : -1))))
})
window.addEventListener('resize', function(){ relayout() })

function shotFig(card, view, caption){
  var f = el('figure'); f.dataset.view = view
  var s = el('div', 'shot'); var img = new Image(); img.alt = card.name + (caption ? ' — ' + caption : ''); img.src = imgUrl(card, view)
  img.decoding = 'async'; s.appendChild(img); f.appendChild(s)
  if (caption) f.appendChild(el('figcaption', null, caption))
  return f
}
function preload(card){ if (card) card.views.forEach(function(v){ var i = new Image(); i.src = imgUrl(card, v) }) }

function renderRef(i){
  var card = refs[i]
  $('progress').textContent = (i + 1) + ' of ' + refs.length
  $('name').textContent = card.name; $('name').title = card.name
  stage.innerHTML = ''; stage.style.display = 'flex'
  var views = card.views.indexOf('single') >= 0 ? ['single'] : ['desktop', 'phone'].filter(function(v){ return card.views.indexOf(v) >= 0 })
  var figs = views.map(function(v){ return shotFig(card, v, views.length > 1 ? (v === 'phone' ? 'Phone' : 'Desktop') : '') })
  figs.forEach(function(f){ stage.appendChild(f); f.querySelector('img').addEventListener('load', function(){ fit(figs) }) })
  relayout = function(){ fit(figs) }; fit(figs)
  showRating(answerOf('ref', card.id).rating)
  note.value = answerOf('ref', card.id).note || ''
  preload(refs[i + 1])
}

// The comps view: the question once, in the header, and the comps as large as the stage allows.
// Each frame takes its image's own shape, and the column count is whichever makes them biggest.
// Under 600 px wide a grid of four is four thumbnails, so a phone shows one comp at a time at
// full width, with A–D chips above it (tap one, or swipe the comp) carrying each one's rating.
var ONE_UNDER = 600
function renderComps(){
  var one = innerWidth < ONE_UNDER
  $('progress').textContent = 'Comps · ' + comps.length
  $('name').textContent = S.question || 'Which one?'; $('name').title = S.question || ''
  document.body.classList.add('asking')
  document.body.classList.toggle('one', one)
  stage.innerHTML = ''; stage.style.display = 'block'; stage.style.flexDirection = ''
  var chips = null
  if (one){
    chips = el('div', 'chips'); chips.id = 'chips'; chips.setAttribute('role', 'tablist')
    comps.forEach(function(c, k){
      var a = answerOf('comp', c.id), letter = String.fromCharCode(65 + k)
      var chip = el('button', 'chip'); chip.type = 'button'; chip.dataset.k = k
      chip.setAttribute('role', 'tab'); chip.setAttribute('aria-selected', String(k === sel)); chip.setAttribute('aria-label', 'Comp ' + letter + (a.rating ? ', rated ' + a.rating : ''))
      chip.appendChild(el('b', null, letter + (S.pick === c.id ? ' ★' : '')))
      chip.appendChild(el('small', null, a.rating ? a.rating + ' / 5' : '–'))
      chip.addEventListener('click', function(){ select(k) })
      chips.appendChild(chip)
    })
    stage.appendChild(chips)
  }
  var grid = el('div', 'grid'); grid.id = 'grid'
  stage.appendChild(grid)
  var imgs = []
  comps.forEach(function(c, k){
    if (one && k !== sel) return
    var a = answerOf('comp', c.id), letter = String.fromCharCode(65 + k)
    var card = el('div', 'comp' + (k === sel ? ' sel' : '')); card.dataset.id = c.id
    var pick = el('button', 'pick'); pick.type = 'button'; pick.setAttribute('aria-label', 'Select comp ' + letter)
    var img = new Image(); img.alt = 'Comp ' + letter; img.src = imgUrl(c, c.views[0]); pick.appendChild(img)
    img.addEventListener('load', function(){ relayout() })
    imgs.push(img)
    pick.addEventListener('click', function(){ select(k) })
    var bar = el('div', 'bar')
    bar.appendChild(el('span', 'label', letter))
    bar.appendChild(el('span', 'score', a.rating ? a.rating + ' / 5' : ''))
    var star = el('button', 'star', '★'); star.type = 'button'; star.setAttribute('aria-label', 'Favourite: comp ' + letter)
    star.setAttribute('aria-pressed', S.pick === c.id ? 'true' : 'false')
    star.addEventListener('click', function(){ togglePick(k) })
    bar.appendChild(star)
    card.appendChild(pick); card.appendChild(bar); grid.appendChild(card)
  })
  relayout = function(){
    if ((innerWidth < ONE_UNDER) !== one) return renderComps()
    if (chips) grid.style.top = chips.offsetHeight + 12 + 'px'
    var W = grid.clientWidth, H = grid.clientHeight, gap = parseFloat(getComputedStyle(grid).rowGap) || 8
    var loaded = imgs.filter(function(i){ return i.naturalWidth && i.naturalHeight })
    var a = loaded.length ? loaded.reduce(function(s, i){ return s + i.naturalWidth / i.naturalHeight }, 0) / loaded.length : 1.6
    var cs = getComputedStyle(grid.firstChild)
    var padW = parseFloat(cs.paddingLeft) * 2 + parseFloat(cs.borderLeftWidth) * 2
    var padH = padW + 44 + parseFloat(cs.rowGap || 0)
    var best = 1, bestW = 0, n = grid.children.length
    for (var c = 1; c <= n; c++){
      var r = Math.ceil(n / c)
      var w = Math.min((W - gap * (c - 1)) / c - padW, ((H - gap * (r - 1)) / r - padH) * a)
      if (w > bestW){ bestW = w; best = c }
    }
    bestW = Math.floor(Math.max(44, bestW))
    grid.style.gridTemplateColumns = 'repeat(' + best + ', ' + (bestW + padW) + 'px)'
    Array.prototype.forEach.call(grid.querySelectorAll('.pick'), function(p){ p.style.width = bestW + 'px'; p.style.height = Math.floor(bestW / a) + 'px' })
  }
  relayout()
  showRating(comps[sel] ? answerOf('comp', comps[sel].id).rating : null)
  note.value = comps[sel] ? answerOf('comp', comps[sel].id).note || '' : ''
  updateDone()
}

function renderEnd(){
  $('progress').textContent = refs.length + ' of ' + refs.length
  $('name').textContent = 'All done'
  stage.innerHTML = ''; stage.style.display = 'block'
  var rated = refs.filter(function(r){ return answerOf('ref', r.id).rating }).length
  var box = el('div', 'end'); box.id = 'end'
  box.appendChild(el('h1', null, rated === refs.length ? 'All ' + refs.length + ' rated.' : rated + ' of ' + refs.length + ' rated.'))
  var thumbs = el('div', 'thumbs'); box.appendChild(thumbs)
  var th = Math.max(44, Math.min(120, (stage.clientHeight - 200) / Math.ceil(refs.length / Math.max(1, Math.floor(stage.clientWidth / 110))) - 30))
  refs.forEach(function(r, k){
    var b = el('button', 'thumb'); b.type = 'button'; b.setAttribute('aria-label', 'Back to ' + r.name)
    var v = r.views.indexOf('desktop') >= 0 ? 'desktop' : r.views[0]
    var img = new Image(); img.alt = ''; img.src = imgUrl(r, v)
    img.style.height = Math.round(th * 0.6) + 'px'; img.style.width = Math.round(th * 0.6 * 1.4) + 'px'
    b.appendChild(img)
    var a = answerOf('ref', r.id); b.appendChild(el('span', null, a.rating ? a.rating + ' / 5' : 'skipped'))
    b.addEventListener('click', function(){ go(k) })
    thumbs.appendChild(b)
  })
  var fin = el('button', null, 'Done'); fin.id = 'finish'; fin.type = 'button'; fin.addEventListener('click', done)
  box.appendChild(fin)
  box.appendChild(el('p', null, 'Writes docs/TASTE.md. Every rating is already saved.'))
  stage.appendChild(box)
  relayout = function(){}
}

function showRating(r){
  Array.prototype.forEach.call(document.querySelectorAll('.rate'), function(b){ b.setAttribute('aria-pressed', String(Number(b.dataset.rating) === r)) })
}
function updateDone(){
  var all = refs.every(function(r){ return answerOf('ref', r.id).rating }) && comps.every(function(c){ return answerOf('comp', c.id).rating })
  $('done').classList.toggle('ready', all && (!comps.length || !!S.pick))
}

function go(p){
  flushNote()
  document.body.classList.remove('asking', 'one')
  pos = Math.max(0, Math.min(steps.length - 1, p))
  var s = steps[pos]
  $('back').disabled = pos === 0
  footer.style.visibility = s.kind === 'end' ? 'hidden' : 'visible'
  if (s.kind === 'ref') renderRef(s.i)
  else if (s.kind === 'comps') renderComps()
  else renderEnd()
  updateDone()
}

// A tap while the last one is still moving the board on is queued, never dropped: it lands on the
// card that comes up next. A tap that does nothing is the worst thing this page can do.
var taps = []
function settle(){ busy = false; if (taps.length) rate(taps.shift()) }
function rate(r){
  if (ended) return
  if (busy){ taps.push(r); return }
  var s = steps[pos]
  if (s.kind === 'ref'){
    var card = refs[s.i], a = S.ratings[card.id] = S.ratings[card.id] || {}
    a.rating = r
    var body = { kind: 'ref', id: card.id, rating: r }
    if (('ref:' + card.id) in notes) body.note = notes['ref:' + card.id]
    clearTimeout(noteTimer); noteTimer = null
    post('/api/answer', body)
    showRating(r); busy = true
    stage.classList.add('leaving')
    setTimeout(function(){ stage.classList.remove('leaving'); go(pos + 1); settle() }, 160)
  } else if (s.kind === 'comps' && comps[sel]){
    var c = comps[sel], ca = S.compRatings[c.id] = S.compRatings[c.id] || {}
    ca.rating = r
    var cb = { kind: 'comp', id: c.id, rating: r }
    if (('comp:' + c.id) in notes) cb.note = notes['comp:' + c.id]
    clearTimeout(noteTimer); noteTimer = null
    post('/api/answer', cb)
    // Move to the next comp still unrated, so rating them all is one tap each.
    var next = -1
    for (var k = 1; k <= comps.length; k++){ var j = (sel + k) % comps.length; if (!answerOf('comp', comps[j].id).rating){ next = j; break } }
    busy = true; showRating(r)
    setTimeout(function(){ if (next >= 0) sel = next; renderComps(); settle() }, 160)
  }
  updateDone()
}
function select(k){ flushNote(); sel = k; renderComps() }
function togglePick(k){
  S.pick = S.pick === comps[k].id ? null : comps[k].id
  post('/api/pick', { id: S.pick })
  renderComps()
}

// Done waits for every answer to land, for 6 seconds at most, and then says what went wrong
// instead of hanging.
var finished = false
function done(){
  if (finished || ended) return
  flushNote()
  finished = true
  $('done').textContent = 'Saving…'
  var until = Date.now() + 6000
  var wait = function(){
    if (!queue.length) return Promise.resolve()
    if (Date.now() > until) return Promise.reject(new Error('unsaved'))
    return new Promise(function(r){ setTimeout(r, 120) }).then(wait)
  }
  wait().then(function(){ return send('/api/done', {}) })
    .then(function(r){
      if (r.status >= 400 && r.status < 500){ endRound(); throw new Error('ended') }
      if (!r.ok) throw new Error('HTTP ' + r.status)
      return r.json()
    })
    .then(function(j){
      document.body.innerHTML = ''
      var c = el('div', 'closed'); c.id = 'closed'; var d = el('div')
      d.appendChild(el('h1', null, 'Saved.')); d.appendChild(el('p', null, (j.path || 'docs/TASTE.md') + ' is written. You can close this tab.'))
      c.appendChild(d); document.body.appendChild(c)
    })
    .catch(function(e){
      finished = false
      $('done').textContent = 'Done'
      if (e.message === 'ended') return
      setSave('failed')
      var b = $('ended') || el('div', 'ended'); b.id = 'ended'; b.setAttribute('role', 'alert'); b.textContent = ''
      b.appendChild(el('strong', null, 'The board is not answering.'))
      b.appendChild(el('span', null, ' Answers marked Saved are on disk. Press Done again, or run rig taste --done in the terminal.'))
      document.body.appendChild(b)
    })
}

Array.prototype.forEach.call(document.querySelectorAll('.rate'), function(b){ b.addEventListener('click', function(){ rate(Number(b.dataset.rating)) }) })
$('back').addEventListener('click', function(){ go(pos - 1) })
$('done').addEventListener('click', done)

document.addEventListener('keydown', function(e){
  if (e.metaKey || e.ctrlKey || e.altKey || finished || ended) return
  var s = steps[pos]
  if (/^[1-5]$/.test(e.key) && s.kind !== 'end'){ e.preventDefault(); rate(Number(e.key)) }
  else if (e.key === 'ArrowLeft' || e.key === 'Backspace'){ e.preventDefault(); if (s.kind === 'comps' && sel > 0) select(sel - 1); else go(pos - 1) }
  else if (e.key === 'ArrowRight'){ e.preventDefault(); if (s.kind === 'comps') select(Math.min(comps.length - 1, sel + 1)); else go(pos + 1) }
  else if ((e.key === 's' || e.key === '*') && s.kind === 'comps'){ e.preventDefault(); togglePick(sel) }
  else if (e.key === 'n'){ e.preventDefault(); note.focus() }
  else if (e.key === 'Enter' && s.kind === 'end'){ e.preventDefault(); done() }
})

// Start where he left off: the first reference not yet rated.
var first = refs.findIndex(function(r){ return !answerOf('ref', r.id).rating })
go(first < 0 ? steps.length - 1 : first)
setSave('')
})()
`

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/** The page for one round. `pub` is publicState(round, token): no file paths, the token inside. */
export function pageHtml(pub) {
  const data = JSON.stringify(pub).replace(/</g, '\\u003c')
  const rates = [1, 2, 3, 4, 5]
    .map((n) => `<button type="button" class="rate" data-rating="${n}" aria-label="Rate ${n} of 5" aria-pressed="false">${n}</button>`)
    .join('')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>Taste${pub.question ? ` — ${esc(pub.question)}` : ''}</title>
<style>${CSS}</style>
</head>
<body>
<div id="app">
  <header>
    <button type="button" id="back" class="icon" aria-label="Back" title="Back (←)">‹</button>
    <div class="where"><span id="progress"></span><span id="name"></span></div>
    <span id="save" aria-live="polite"></span>
    <button type="button" id="done" title="Write docs/TASTE.md">Done</button>
  </header>
  <main><div id="stage"></div></main>
  <footer id="footer">
    <div class="scale" role="group" aria-label="Rating">
      <div class="rates">${rates}</div>
      <div class="anchors"><span>1 · not this</span><span>exactly this · 5</span></div>
    </div>
    <input id="note" type="text" autocomplete="off" placeholder="Note (optional)" aria-label="Note, optional">
  </footer>
</div>
<script type="application/json" id="state">${data}</script>
<script>${JS}</script>
</body>
</html>
`
}
