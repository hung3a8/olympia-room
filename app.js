import { html, render } from 'https://unpkg.com/htm@3.1.1/preact/standalone.module.js'
import { act, view, newState, buildPack, parseCSV, pools, draw, norm, active, topTied, NAMES, FLOW, T, vdVal } from './game.js'

const CSV = 'https://lqtue.github.io/olympia-questions/questions.csv'
const PREFIX = 'olympia-vn-room-'
const SAVE = 'olympia-host'
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

const store = {
  get: k => { try { return JSON.parse(localStorage.getItem(k)) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} },
}
// sessionStorage: mỗi tab là một người, tải lại trang vẫn giữ được ghế.
const CID = (() => {
  try { return sessionStorage.olympiaCid ||= crypto.randomUUID() } catch { return crypto.randomUUID() }
})()

const S = {
  screen: 'home', role: null, want: 'player', name: store.get('olympia-name') || '',
  code: location.hash.slice(1).toUpperCase(), status: '', game: null, slot: -1, off: 0,
  rows: null, matches: [], setup: { match: '', key: '', img: '' }, viewers: [],
}
let G = null, peer = null, conn = null, retryT = 0
const conns = new Map(), hist = []

const root = document.getElementById('app')
const paint = () => { if (S.game) sound(S.game); render(App(), root) }
const set = p => (Object.assign(S, p), paint())
const cls = (...a) => a.filter(Boolean).join(' ')
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), b => ALPHA[b % ALPHA.length]).join('')
const isHost = () => S.role === 'host'
const nameOf = (g, i) => g.slots[i]?.name ?? `Thí sinh ${i + 1}`

let ac, last = {}
function beep(f, d = 0.3) {
  try {
    ac ||= new AudioContext()
    const o = ac.createOscillator(), v = ac.createGain()
    o.frequency.value = f
    v.gain.setValueAtTime(0.15, ac.currentTime)
    v.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + d)
    o.connect(v).connect(ac.destination)
    o.start()
    o.stop(ac.currentTime + d)
  } catch {}
}
function sound(g) {
  const n = { who: g.buzz?.who ?? null, up: g.timeup, cnv: g.sub?.cnv?.length || 0 }
  if ((n.who != null && n.who !== last.who) || n.cnv > (last.cnv || 0)) beep(880)
  else if (n.up && !last.up) beep(220, 0.6)
  last = n
}

// ---------- chủ phòng ----------
function hostRoom(resume) {
  const saved = resume && store.get(SAVE)
  G = saved || newState(newCode())
  G.timer = null
  G.slots.forEach(p => p && (p.online = false))
  set({ role: 'host', screen: 'room', status: 'Đang mở phòng…', game: G })
  openHost(!!saved)
  loadCSV()
  setInterval(() => {
    if (G.timer && Date.now() >= G.timer.end && act(G, { type: 'tick' })) sync()
    else if (G.timer) paint()
  }, 100)
}

function openHost(resuming) {
  peer?.destroy()
  peer = new Peer(PREFIX + G.code)
  peer.on('open', () => set({ status: '' }))
  peer.on('disconnected', () => peer.reconnect())
  peer.on('error', e => {
    if (e.type !== 'unavailable-id') return set({ status: `Lỗi kết nối: ${e.type}` })
    // Sau khi tải lại trang, máy chủ PeerJS giữ mã cũ thêm vài giây.
    if (resuming) return set({ status: 'Đang giành lại mã phòng…' }), setTimeout(() => openHost(true), 3000)
    G.code = newCode()
    openHost(false)
  })
  peer.on('connection', c => {
    c.on('data', d => onData(c, d))
    c.on('close', () => {
      const k = conns.get(c.peer)
      conns.delete(c.peer)
      if (k && ![...conns.values()].some(x => x.cid === k.cid)) act(G, { type: 'online', cid: k.cid, on: false })
      sync()
    })
  })
}

function onData(c, d) {
  if (d?.t === 'hello') {
    const k = { c, cid: String(d.cid), name: String(d.name || '').slice(0, 24) }
    conns.set(c.peer, k)
    act(G, { type: 'join', cid: k.cid, name: k.name, want: d.role === 'player' ? 'player' : 'viewer' })
    return sync()
  }
  const k = conns.get(c.peer)
  if (!k || d?.t !== 'act' || !['buzz', 'answer', 'cnv'].includes(d.a?.type)) return
  const slot = G.slots.findIndex(p => p?.cid === k.cid)
  if (slot >= 0 && act(G, { type: d.a.type, text: d.a.text, slot })) sync()
}

function sync() {
  store.set(SAVE, G)
  const now = Date.now()
  for (const k of conns.values()) {
    if (!k.c.open) continue
    const slot = G.slots.findIndex(p => p?.cid === k.cid)
    k.c.send({ t: 'state', s: view(G, slot), slot, now })
  }
  const viewers = [...conns.values()].filter(k => !G.slots.some(p => p?.cid === k.cid)).map(k => k.name)
  set({ game: G, viewers })
}

function doo(a) {
  const before = structuredClone(G)
  if (!act(G, a)) return
  hist.push(before)
  if (hist.length > 80) hist.shift()
  sync()
}
function undo() {
  if (!hist.length) return
  G = hist.pop()
  G.timer = null
  sync()
}
function reroll(row) {
  const [q] = draw(pools(S.rows)[G.phase], 1, new Set([G.q?.qid]))
  if (q) doo({ type: 'reroll', q, row })
}

async function loadCSV() {
  try {
    const rows = parseCSV(await (await fetch(CSV)).text())
    const m = new Map()
    for (const r of rows) {
      const l = m.get(r.season) || m.set(r.season, []).get(r.season)
      if (!l.includes(r.match)) l.push(r.match)
    }
    set({ rows, matches: [...m] })
  } catch (e) {
    set({ status: `Không tải được kho câu hỏi: ${e.message}` })
  }
}

function start() {
  doo({ type: 'pack', pack: buildPack(S.rows, S.setup) })
  doo({ type: 'round', round: 'kd1' })
}

// ---------- khách ----------
function join(e) {
  e.preventDefault()
  S.code = S.code.trim().toUpperCase()
  store.set('olympia-name', S.name)
  location.hash = S.code
  set({ role: S.want, screen: 'room', status: 'Đang kết nối…' })
  peer = new Peer()
  peer.on('open', connect)
  peer.on('disconnected', () => peer.reconnect())
  peer.on('error', e => {
    if (e.type === 'peer-unavailable') set({ status: `Chưa thấy phòng ${S.code}, đang thử lại…` }), retry()
    else set({ status: `Lỗi kết nối: ${e.type}` })
  })
}
const retry = () => (clearTimeout(retryT), (retryT = setTimeout(connect, 2500)))
function connect() {
  const c = peer.connect(PREFIX + S.code, { reliable: true })
  c.on('open', () => {
    conn = c
    c.send({ t: 'hello', cid: CID, name: S.name, role: S.want })
    set({ status: '' })
  })
  c.on('data', d => d?.t === 'state' && set({ game: d.s, slot: d.slot, off: Date.now() - d.now }))
  c.on('close', () => { conn = null; set({ status: 'Mất kết nối, đang nối lại…' }); retry() })
}
const send = a => conn?.open && conn.send({ t: 'act', a })

setInterval(() => !isHost() && S.game?.timer && paint(), 100)

function canBuzz(g) {
  const i = S.slot, u = g?.sub
  if (!g || i < 0 || !g.shown || g.revealed || !g.buzz || g.buzz.who != null) return false
  if (g.phase === 'vd') return u.stage === 'steal' && i !== u.cur
  if (g.phase === 'tb') return u.who.includes(i) && !u.out.includes(i)
  return g.phase === 'kd2'
}
addEventListener('keydown', e => {
  if (e.code !== 'Space' || S.role !== 'player' || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return
  e.preventDefault()
  if (canBuzz(S.game)) send({ type: 'buzz' })
})

// ---------- giao diện ----------
const matchName = m =>
  m === 'Final' ? 'Chung kết năm'
    : m.replace(/^QF(\d)$/, 'Chung kết Quý $1').replace(/^W(\d)M(\d)Q(\d)$/, 'Tuần $1 · Tháng $2 · Quý $3').replace(/^M(\d)Q(\d)$/, 'Tháng $1 · Quý $2')

const App = () => (S.screen === 'home' ? Home() : Room())

function Home() {
  const saved = store.get(SAVE)
  return html`
    <header class="bar frame"><span class="mark">Olympia</span></header>
    <main class="frame home">
      <section class="hero">
        <p class="muted">Đường lên đỉnh Olympia · phiên bản thi tại nhà</p>
        <h1>Khởi động. Vượt chướng ngại vật. Về đích.</h1>
        <p class="muted lead">Một người dẫn chương trình, một đến bốn thí sinh, khán giả không giới hạn. Đề lấy từ kho hơn 21.000 câu hỏi mùa 19–26, chạy hoàn toàn trên trình duyệt.</p>
      </section>
      <section class="cards">
        <form class="panel" onSubmit=${join}>
          <h2>Vào phòng</h2>
          <label>Mã phòng<input class="codein" maxlength="5" required autocomplete="off" value=${S.code}
            onInput=${e => set({ code: e.target.value.toUpperCase() })} /></label>
          <label>Tên hiển thị<input maxlength="24" required value=${S.name} onInput=${e => (S.name = e.target.value)} /></label>
          <div class="seg">
            ${[['player', 'Thí sinh'], ['viewer', 'Khán giả']].map(([r, l]) => html`
              <button type="button" class=${cls('pill', S.want === r && 'on')} onClick=${() => set({ want: r })}>${l}</button>`)}
          </div>
          <button class="pill primary wide">Vào phòng</button>
        </form>
        <div class="panel">
          <h2>Dẫn chương trình</h2>
          <p class="muted">Tạo phòng, chia sẻ mã, đọc câu hỏi, điều khiển đồng hồ và chấm điểm. Người dẫn không tham gia trả lời.</p>
          <div class="stack">
            <button class="pill primary wide" onClick=${() => hostRoom(false)}>Tạo phòng mới</button>
            ${saved && html`<button class="pill wide" onClick=${() => hostRoom(true)}>Tiếp tục phòng ${saved.code}</button>`}
          </div>
        </div>
      </section>
      <footer class="muted small foot">
        Câu hỏi từ <a href="https://lqtue.github.io/olympia-questions/">olympia-questions</a> (nguồn Đường lên đỉnh Olympia Wiki, CC-BY-SA). Bản quyền câu hỏi thuộc VTV.
      </footer>
    </main>`
}

function Room() {
  const g = S.game
  const me = isHost() ? 'Người dẫn' : S.slot >= 0 ? `Thí sinh ${S.slot + 1}` : 'Khán giả'
  return html`
    <header class="bar frame">
      <a class="mark" href=${location.pathname}>Olympia</a>
      <div>${g && html`<span class="pill ghost">Phòng <b>${g.code}</b></span>`}</div>
      <div class="right">${S.status && html`<span class="muted small">${S.status}</span>`}<span class="pill ghost">${me}</span></div>
    </header>
    ${g ? html`
      <main class="frame room">
        ${Rounds(g)}
        ${Scores(g)}
        ${g.phase === 'lobby' ? Lobby(g) : Stage(g)}
      </main>
      ${isHost() && g.phase !== 'lobby' && HostBar(g)}
      ${S.role === 'player' && S.slot >= 0 && g.phase !== 'lobby' && PlayerBar(g)}`
    : html`<main class="frame room"><p class="muted">${S.status}</p></main>`}`
}

function Rounds(g) {
  const list = [...FLOW, ...(g.phase === 'tb' ? ['tb'] : [])]
  return html`<nav class="rounds">${list.map(r => isHost() && g.phase !== 'lobby'
    ? html`<button class=${cls('pill', g.phase === r && 'on')} onClick=${() => g.phase !== r && confirm(`Chuyển sang ${NAMES[r]}?`) && doo({ type: 'round', round: r })}>${NAMES[r]}</button>`
    : html`<span class=${cls('pill', g.phase === r && 'on')}>${NAMES[r]}</span>`)}</nav>`
}

const turnOf = g => (g.phase === 'kd1' && !g.sub.done ? g.sub.order[g.sub.p] : g.phase === 'vd' ? g.sub.cur : null)

function tags(g, i) {
  const u = g.sub, t = []
  if (g.buzz?.who === i) t.push('Giành quyền')
  if (g.phase === 'vcnv') {
    if (u.elim.includes(i)) t.push('Bị loại')
    if (u.cnv.some(b => b.slot === i)) t.push('Xin trả lời CNV')
    if (u.cur != null && !u.showAns && (isHost() ? u.answers[i] != null : u.submitted.includes(i))) t.push('Đã gửi')
  }
  if (g.phase === 'vd' && u.star[i] != null) t.push('★')
  if (g.phase === 'tb' && u.who.includes(i)) t.push(u.out.includes(i) ? 'Đã trả lời sai' : 'Thi phụ')
  return t
}

function Scores(g) {
  const turn = turnOf(g), lobby = g.phase === 'lobby'
  return html`<section class="scores">${g.slots.map((p, i) => html`
    <div class=${cls('score', !p && 'empty', turn === i && 'turn', g.buzz?.who === i && 'buzzed', g.phase === 'vcnv' && g.sub.elim.includes(i) && 'out')}>
      <div class="pos"><span>${i + 1}</span>${S.slot === i && html`<em>Bạn</em>`}${p && !p.online && html`<em class="off">Mất kết nối</em>`}</div>
      <div class="who">${p ? p.name : 'Ghế trống'}</div>
      <div class="pts">${p ? p.score : '–'}</div>
      <div class="tags">${p && tags(g, i).map(t => html`<span>${t}</span>`)}</div>
      ${isHost() && p && html`<div class="adj">${lobby
        ? html`<button onClick=${() => doo({ type: 'swap', a: i, b: i - 1 })}>←</button><button onClick=${() => doo({ type: 'swap', a: i, b: i + 1 })}>→</button><button onClick=${() => doo({ type: 'kick', slot: i })}>Mời ra</button>`
        : [-10, -5, 5, 10].map(d => html`<button onClick=${() => doo({ type: 'adjust', slot: i, d })}>${d > 0 ? '+' : '−'}${Math.abs(d)}</button>`)}</div>`}
    </div>`)}</section>`
}

function Lobby(g) {
  if (!isHost()) return html`<section class="panel center">
    <h2>Chờ người dẫn bắt đầu</h2>
    <p class="muted">${S.slot >= 0 ? `Bạn ngồi ghế số ${S.slot + 1}. Ở phần bấm chuông, nhấn nút lớn hoặc phím Space.` : 'Bạn đang theo dõi với tư cách khán giả. Phòng đã đủ thí sinh hoặc bạn chọn xem.'}</p>
  </section>`
  const link = `${location.origin}${location.pathname}#${g.code}`
  return html`<section class="lobby">
    <div class="panel">
      <h2>Mời người chơi</h2>
      <div class="bigcode">${g.code}</div>
      <p class="muted small break">${link}</p>
      <button class="pill" onClick=${() => navigator.clipboard?.writeText(link)}>Sao chép liên kết</button>
      <p class="muted small">Khán giả: ${S.viewers.join(', ') || 'chưa có'}</p>
    </div>
    <div class="panel">
      <h2>Bộ đề</h2>
      ${!S.rows ? html`<p class="muted">Đang tải kho câu hỏi…</p>` : html`
        <label>Lấy đề theo trận
          <select onChange=${e => (S.setup.match = e.target.value)}>
            <option value="">Ngẫu nhiên toàn bộ kho</option>
            ${S.matches.map(([season, list]) => html`<optgroup label=${`Năm thứ ${season}`}>
              ${list.map(m => html`<option value=${`${season}-${m}`} selected=${S.setup.match === `${season}-${m}`}>${matchName(m)} · năm ${season}</option>`)}
            </optgroup>`)}
          </select>
        </label>
        <label>Từ khoá chướng ngại vật<input value=${S.setup.key} placeholder="Bỏ trống để bốc ngẫu nhiên" onInput=${e => (S.setup.key = e.target.value)} /></label>
        <label>Ảnh chướng ngại vật (URL, không bắt buộc)<input value=${S.setup.img} placeholder="https://…" onInput=${e => (S.setup.img = e.target.value)} /></label>
        <p class="muted small">Kho dữ liệu không có từ khoá và ảnh CNV nên người dẫn tự nhập. Vòng Tăng tốc được lược bỏ. Câu nào trận đã chọn thiếu sẽ được bốc ngẫu nhiên trong cùng vòng.</p>
        <button class="pill primary wide" disabled=${!active(g).length} onClick=${start}>
          ${active(g).length ? `Bắt đầu với ${active(g).length} thí sinh` : 'Cần ít nhất 1 thí sinh'}
        </button>`}
    </div>
  </section>`
}

function Clock(g) {
  const t = g.timer
  const left = t ? Math.max(0, t.end + (isHost() ? 0 : S.off) - Date.now()) : 0
  return html`<div class=${cls('clock', t && 'live', t && left < 3000 && 'hot')}>
    <div class="track"><i style=${`width:${t ? left / (t.dur * 10) : 0}%`}></i></div>
    <b>${t ? Math.ceil(left / 1000) : g.timeup ? 'Hết giờ' : ''}</b>
  </div>`
}

function QCard(g, meta) {
  const q = g.q, see = q && (g.shown || isHost())
  return html`<article class="q">
    <div class="qmeta"><span>${meta}</span>${see && html`<span>${q.subject} · ${q.qid}</span>`}</div>
    ${Clock(g)}
    <p class=${cls('qtext', !see && 'muted')}>${see ? q.question : 'Chờ người dẫn mở câu hỏi…'}</p>
    ${see && !g.shown && html`<p class="muted small">Câu hỏi này mới chỉ hiện với người dẫn.</p>`}
    ${see && q.answer != null && (g.revealed || isHost()) && html`
      <p class=${cls('ans', !g.revealed && 'private')}><span>${g.revealed ? 'Đáp án' : 'Đáp án · chỉ người dẫn thấy'}</span>${q.answer}</p>`}
  </article>`
}

const Banner = (text, tone) => text && html`<div class=${cls('banner', tone)}>${text}</div>`
const Done = text => html`<article class="q"><p class="qtext">${text}</p></article>`

function Stage(g) {
  const u = g.sub
  if (g.phase === 'kd1') return u.done ? Done('Kết thúc phần thi riêng.') : html`
    ${Banner(`Lượt của ${nameOf(g, u.order[u.p])} · trả lời trong ${T.kd1} giây sau khi đọc xong, đúng +10, sai không trừ.`)}
    ${QCard(g, `Thí sinh ${u.order[u.p] + 1} · câu ${u.i + 1}/6`)}`
  if (g.phase === 'kd2') return u.done ? Done('Kết thúc phần Khởi động.') : html`
    ${Banner(g.buzz?.who != null ? `${nameOf(g, g.buzz.who)} giành quyền trả lời` : 'Bấm chuông bất cứ lúc nào · đúng +10, sai −5', g.buzz?.who != null && 'hot')}
    ${QCard(g, `Câu ${u.i + 1}/12`)}`
  if (g.phase === 'vcnv') return Board(g)
  if (g.phase === 'vd') return u.done ? Done('Kết thúc phần Về đích.') : html`
    ${Package(g)}
    ${u.stage === 'steal' && Banner(g.buzz?.who != null ? `${nameOf(g, g.buzz.who)} giành quyền trả lời` : `Các thí sinh còn lại có ${T.steal} giây để bấm chuông giành quyền`, 'hot')}
    ${QCard(g, `${nameOf(g, u.cur)} · câu ${u.i + 1}/3 · ${vdVal(u)} điểm · ${T.vd[vdVal(u)]} giây`)}`
  if (g.phase === 'tb') return html`
    ${Banner(u.winner != null ? `${nameOf(g, u.winner)} chiến thắng câu hỏi phụ` : u.done ? 'Hết câu hỏi phụ: bốc thăm để phân định.' : `Thi phụ: ${u.who.map(i => nameOf(g, i)).join(', ')} · người trả lời đúng đầu tiên thắng`, 'hot')}
    ${!u.done && QCard(g, `Câu hỏi phụ ${u.i + 1}`)}`
  return Final(g)
}

function Board(g) {
  const u = g.sub, host = isHost()
  const opened = i => u.rows[i].st === 'open' || u.done
  const word = i => (host ? norm(u.rows[i].q.answer) : u.rows[i].answer || '')
  const len = i => (host ? norm(u.rows[i].q.answer).length : u.rows[i].len)
  const key = host || u.done ? norm(u.key) : ''
  const keyLen = host ? key.length : u.keyLen
  const P = active(g)
  const picker = P[u.played % P.length]
  return html`
    ${u.solved != null ? Banner(`${nameOf(g, u.solved)} giải được chướng ngại vật!`, 'hot')
      : u.done ? Banner('Chướng ngại vật đã được công bố.')
      : g.timer?.kind === 'cnv' ? Banner(`${T.cnvWindow} giây cuối: trả lời đúng CNV được 20 điểm`, 'hot')
      : u.cur == null ? Banner(`Lượt chọn hàng ngang: ${nameOf(g, picker)}`) : null}
    ${u.cur != null && html`
      ${QCard(g, u.cur === 4 ? 'Câu hỏi ô trung tâm · 15 giây' : `Hàng ngang ${u.cur + 1} · 15 giây · ${len(u.cur)} ký tự`)}
      ${(u.showAns || host) && html`<section class="panel list">
        <h3>${u.showAns ? 'Đáp án của các thí sinh' : 'Đáp án đang gửi về'}</h3>
        ${P.map(i => html`<div class=${cls('line', u.showAns && (u.marks[i] ? 'good' : 'bad'))}>
          <b>${nameOf(g, i)}</b><span>${u.elim.includes(i) ? 'Đã bị loại' : u.answers[i] || '—'}</span>
          ${u.showAns && html`<span class="muted">${u.marks[i] ? 'Đúng' : 'Sai'}</span>`}
          ${host && u.showAns && !u.elim.includes(i) && html`<span class="btns"><button class="pill" onClick=${() => doo({ type: 'mark', slot: i })}>Đổi kết quả</button></span>`}
        </div>`)}
      </section>`}`}
    <section class="board">
      <div class="rows">
        ${u.rows.map((r, i) => html`
          <div class=${cls('row', r.st, u.done && 'open')} role=${host ? 'button' : null}
            onClick=${() => host && doo({ type: 'pick', row: i })}>
            <span class="rn">${i === 4 ? 'TT' : i + 1}</span>
            <span class="cells">${Array.from({ length: len(i) }, (_, k) => html`<i class=${host && !opened(i) ? 'ghost' : ''}>${opened(i) || host ? word(i)[k] : ''}</i>`)}</span>
            <span class="rl">${i === 4 ? 'Ô trung tâm' : `${len(i)} ký tự`}${host && r.st === 'hidden' && html` <button class="link" onClick=${e => (e.stopPropagation(), reroll(i))}>đổi</button>`}</span>
          </div>`)}
        <div class=${cls('key', u.done && 'done')}>
          <span class="muted small">Chướng ngại vật · ${keyLen} ký tự</span>
          <div class="cells big">${Array.from({ length: keyLen }, (_, k) => html`<i class=${host && !u.done ? 'ghost' : ''}>${key[k] || ''}</i>`)}</div>
          ${u.done && html`<p class="ans"><span>Từ khoá</span>${u.key}</p>`}
        </div>
      </div>
      <div class="pic">
        ${u.img ? html`<img src=${u.img} alt="Hình ảnh chướng ngại vật" />` : html`<div class="noimg muted small">Không có hình ảnh</div>`}
        ${[0, 1, 2, 3, 4].map(i => !opened(i) && html`<div class=${`cover c${i}`}>${i === 4 ? 'TT' : i + 1}</div>`)}
      </div>
    </section>
    ${u.cnv.length > 0 && html`<section class="panel list">
      <h3>Xin trả lời chướng ngại vật (theo thứ tự bấm)</h3>
      ${u.cnv.map(b => html`<div class="line">
        <b>${nameOf(g, b.slot)}</b><span>${b.text ?? '•••'}</span><span class="muted">${b.pts} điểm</span>
        ${host && html`<span class="btns"><button class="pill ok" onClick=${() => doo({ type: 'cnvJudge', slot: b.slot, ok: true })}>Đúng</button><button class="pill bad" onClick=${() => doo({ type: 'cnvJudge', slot: b.slot, ok: false })}>Sai · loại</button></span>`}
      </div>`)}
    </section>`}
`
}

function Package(g) {
  const u = g.sub, star = u.star[u.cur], host = isHost()
  return html`<section class="pack">
    <span class="muted small">Gói câu hỏi của ${nameOf(g, u.cur)} · thứ tự thi: điểm cao thi trước</span>
    <div class="pks">${u.vals.map((v, i) => html`
      <div class=${cls('pk', i < u.i && 'done', i === u.i && 'cur', star === i && 'star')}>
        <b>${v}</b><span>${star === i ? '★ Ngôi sao hy vọng' : `${T.vd[v]} giây`}</span>
        ${host && (i > u.i || (i === u.i && !g.shown)) && html`<div class="mini">
          <button onClick=${() => doo({ type: 'val', i, v: v === 20 ? 30 : 20 })}>Đổi thành ${v === 20 ? 30 : 20}</button>
          <button onClick=${() => doo({ type: 'star', i })}>${star === i ? 'Bỏ sao' : 'Đặt sao'}</button>
        </div>`}
      </div>`)}</div>
  </section>`
}

function Final(g) {
  const P = active(g).sort((a, b) => g.slots[b].score - g.slots[a].score || a - b)
  const tie = topTied(g).length > 1
  return html`<section class="final">
    ${P.map((i, r) => html`<div class=${cls('rank', r === 0 && 'top')}><span>${r + 1}</span><b>${nameOf(g, i)}</b><em>${g.slots[i].score}</em></div>`)}
    ${tie && html`<p class="muted">Có thí sinh đồng điểm cao nhất · cần câu hỏi phụ.</p>`}
    ${tie && isHost() && html`<button class="pill primary" onClick=${() => doo({ type: 'round', round: 'tb' })}>Bắt đầu câu hỏi phụ</button>`}
  </section>`
}

function HostBar(g) {
  const u = g.sub
  const B = (label, a, tone, dis) => html`<button class=${cls('pill', tone)} disabled=${dis}
    onClick=${typeof a === 'function' ? a : () => doo(a)}>${label}</button>`
  const nextRound = FLOW[FLOW.indexOf(g.phase) + 1]
  const show = B('Hiện câu hỏi', { type: 'show' }, 'primary')
  const next = B('Câu tiếp', { type: 'next' }, 'primary')
  const timer = s => B(`Tính giờ ${s} giây`, { type: 'timer' }, null, !!g.timer)
  let main = []
  if (u?.done && g.phase !== 'tb') main = [nextRound && B(`Sang phần ${NAMES[nextRound]}`, { type: 'round', round: nextRound }, 'primary')]
  else if (g.phase === 'kd1') main = !g.shown ? [show] : g.revealed ? [next]
    : [timer(T.kd1), B('Đúng +10', { type: 'judge', ok: true }, 'ok'), B('Sai', { type: 'judge', ok: false }, 'bad')]
  else if (g.phase === 'kd2') main = !g.shown ? [show] : g.revealed ? [next]
    : g.buzz.who == null ? [B(`Đọc xong · mở ${T.kd2Buzz} giây bấm chuông`, { type: 'timer' }, null, !!g.timer)]
    : [B('Đúng +10', { type: 'judge', ok: true }, 'ok'), B('Sai −5', { type: 'judge', ok: false }, 'bad')]
  else if (g.phase === 'vd') {
    const v = vdVal(u), star = u.star[u.cur] === u.i
    main = !g.shown ? [show] : g.revealed ? [next]
      : u.stage === 'q' ? [timer(T.vd[v]), B(`Đúng +${star ? 2 * v : v}`, { type: 'judge', ok: true }, 'ok'), B(star ? `Sai −${v}` : 'Sai / không trả lời', { type: 'judge', ok: false }, 'bad')]
      : g.buzz.who == null ? [B('Đang chờ bấm chuông…', () => {}, null, true)]
      : [B(`Đúng · lấy ${v} điểm`, { type: 'judge', ok: true }, 'ok'), B(`Sai −${v / 2}`, { type: 'judge', ok: false }, 'bad')]
  } else if (g.phase === 'tb') main = u.done ? [] : !g.shown ? [show] : g.revealed ? [next]
    : g.buzz.who == null ? [timer(T.tb)]
    : [B('Đúng · thắng', { type: 'judge', ok: true }, 'ok'), B('Sai', { type: 'judge', ok: false }, 'bad')]
  else if (g.phase === 'vcnv') main = u.cur == null
    ? [html`<span class="muted small">Bấm vào một hàng ngang để mở câu hỏi.</span>`, B('Kết thúc vòng · công bố CNV', { type: 'vcnvEnd' })]
    : !u.showAns ? [timer(T.vcnv), B('Công bố đáp án thí sinh', { type: 'showAnswers' }, 'primary')]
    : [B('Chấm điểm & đóng hàng', { type: 'rowDone' }, 'primary')]
  const canReroll = g.phase !== 'vcnv' && g.q && !g.shown
  return html`<section class="dock"><div class="frame dockin">
    <div class="btns">${main}</div>
    <div class="btns">${B('Đổi câu', () => reroll(), null, !canReroll)}${B('Hoàn tác', undo, null, !hist.length)}</div>
  </div></section>`
}

function PlayerBar(g) {
  const u = g.sub, i = S.slot
  if (g.phase === 'vcnv') {
    const out = u.elim.includes(i), mine = u.cnv.some(b => b.slot === i)
    const rowOpen = u.cur != null && !u.closed && !out
    const submit = (e, type) => {
      e.preventDefault()
      const f = e.target.elements.a
      if (f.value.trim()) send({ type, text: f.value.trim() })
      if (type === 'cnv') f.value = ''
    }
    return html`<section class="dock"><div class="frame dockin col">
      ${rowOpen && html`<form class="answer" key=${`r${u.cur}-${u.played}`} onSubmit=${e => submit(e, 'answer')}>
        <input name="a" autocomplete="off" placeholder="Đáp án hàng ngang (gửi lại để sửa)" />
        <button class="pill primary">Gửi</button>
        <span class="muted small">${u.answers[i] != null ? `Đã gửi: ${u.answers[i]}` : ''}</span>
      </form>`}
      <form class="answer" onSubmit=${e => submit(e, 'cnv')}>
        <input name="a" autocomplete="off" disabled=${out || mine || u.done || u.played < 1}
          placeholder=${out ? 'Bạn đã bị loại khỏi vòng này' : mine ? 'Đã xin trả lời CNV' : u.played < 1 ? 'Mở sau hàng ngang đầu tiên' : 'Trả lời chướng ngại vật'} />
        <button class="pill bad" disabled=${out || mine || u.done || u.played < 1}>Trả lời CNV</button>
      </form>
    </div></section>`
  }
  if (['kd2', 'tb'].includes(g.phase) || (g.phase === 'vd' && u.cur !== i)) {
    const ok = canBuzz(g)
    return html`<section class="dock"><div class="frame dockin">
      <button class=${cls('buzz', ok && 'ready', g.buzz?.who === i && 'mine')} disabled=${!ok} onClick=${() => send({ type: 'buzz' })}>
        ${g.buzz?.who === i ? 'Bạn giành quyền · trả lời ngay' : ok ? 'Bấm chuông · Space' : 'Chuông chưa mở'}
      </button>
    </div></section>`
  }
  if (turnOf(g) === i) return html`<section class="dock"><div class="frame dockin"><span class="turnnote">Đến lượt bạn · trả lời trực tiếp với người dẫn</span></div></section>`
  return null
}

paint()
