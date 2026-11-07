// Luật theo mùa 26 (vi.wikipedia.org/wiki/Đường_lên_đỉnh_Olympia).
export const T = { kd1: 5, kd2Buzz: 5, answer: 5, vcnv: 15, cnvWindow: 15, vd: { 20: 15, 30: 20 }, steal: 5, tb: 15 }
export const CNV_PTS = [60, 50, 40, 30]
export const FLOW = ['kd1', 'kd2', 'vcnv', 'vd', 'end']
export const NAMES = {
  lobby: 'Phòng chờ', kd1: 'Khởi động · Thi riêng', kd2: 'Khởi động · Thi chung',
  vcnv: 'Vượt chướng ngại vật', vd: 'Về đích', tb: 'Câu hỏi phụ', end: 'Tổng kết',
}

export const norm = s => (s || '').normalize('NFC').toUpperCase().replace(/[^\p{L}\p{N}]/gu, '')
export const active = s => s.slots.flatMap((p, i) => (p ? [i] : []))
const trim = r => r && { qid: r.qid, question: r.question, answer: r.answer, subject: r.subject }

export function parseCSV(text) {
  const rows = [[]]
  let f = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') f += '"', i++
      else if (c === '"') q = false
      else f += c
    } else if (c === '"') q = true
    else if (c === ',') rows.at(-1).push(f), f = ''
    else if (c === '\n') rows.at(-1).push(f.replace(/\r$/, '')), f = '', rows.push([])
    else f += c
  }
  if (f || rows.at(-1).length) rows.at(-1).push(f)
  const [head, ...body] = rows.filter(r => r.length > 1)
  return body.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])))
}

// Nhãn môn có sẵn trong cột `subject` của kho (do AI gắn).
export const SUBJECTS = {
  History: 'Lịch sử', Geography: 'Địa lý', Literature: 'Văn học', Math: 'Toán', Physics: 'Vật lý',
  Chemistry: 'Hoá học', Biology: 'Sinh học', English: 'Tiếng Anh', 'Art/Sports': 'Nghệ thuật & Thể thao',
  'General/Social': 'Hiểu biết chung', 'Logic/IQ': 'Tư duy logic',
}
export const only = (rows, off = []) => (off.length ? rows.filter(r => !off.includes(r.subject)) : rows)
// kd2 và câu hỏi phụ dùng chung kho KD-B: 12 + 5.
export const NEED = { kd1: 24, kd2: 17, vcnv: 5, vd: 12 }
export const shortRounds = (rows, off) => {
  const P = pools(only(rows, off))
  return Object.keys(NEED).filter(k => P[k].length < NEED[k])
}

export const pools = rows => ({
  kd1: rows.filter(r => r.round === 'KD' && !/-KD-B\./.test(r.qid)),
  kd2: rows.filter(r => /-KD-B\./.test(r.qid)),
  vcnv: rows.filter(r => r.round === 'VCNV'),
  vd: rows.filter(r => r.round === 'VD'),
  tb: rows.filter(r => /-KD-B\./.test(r.qid)),
})

export function draw(pool, n, used, rnd = Math.random) {
  const p = pool.filter(r => !used.has(r.qid)), out = []
  while (out.length < n && p.length) {
    const r = p.splice(Math.floor(rnd() * p.length), 1)[0]
    used.add(r.qid)
    out.push(trim(r))
  }
  return out
}

// Ưu tiên câu của đúng trận được chọn; thiếu thì bốc ngẫu nhiên từ kho cùng vòng.
export function buildPack(rows, o = {}, rnd = Math.random) {
  rows = only(rows, o.off)
  const P = pools(rows), used = new Set()
  const m = o.match ? rows.filter(r => `${r.season}-${r.match}` === o.match) : []
  // Đề tự soạn có hàng CNV (từ khoá); chế độ ngẫu nhiên vẫn lấy trọn một ô chữ để hàng ngang khớp từ khoá.
  const keys = rows.filter(r => r.round === 'CNV')
  const cnv = m.find(r => r.round === 'CNV') || (!m.some(r => r.round === 'VCNV') && keys[Math.floor(rnd() * keys.length)])
  const vm = cnv ? rows.filter(r => r.season === cnv.season && r.match === cnv.match) : m
  const fill = (re, pool, n, src = m) => {
    const own = src.filter(r => re.test(r.qid)).slice(0, n)
    own.forEach(r => used.add(r.qid))
    return own.map(trim).concat(draw(pool, n - own.length, used, rnd))
  }
  const seat = [0, 1, 2, 3]
  return {
    kd1: seat.map(p => fill(new RegExp(`-KD-A?${p + 1}\\.`), P.kd1, 6)),
    kd2: fill(/-KD-B\./, P.kd2, 12),
    vcnv: {
      rows: [1, 2, 3, 4, 5].map(n => fill(new RegExp(`-VCNV-${n}$`), P.vcnv, 1, vm)[0]),
      key: o.key?.trim() || cnv?.answer || draw(P.vcnv.filter(r => norm(r.answer).length >= 8), 1, used, rnd)[0]?.answer || '',
      img: o.img?.trim() || '',
    },
    vd: seat.map(p => fill(new RegExp(`-VD-${p + 1}\\.`), P.vd, 3)),
    tb: draw(P.tb, 5, used, rnd),
    off: o.off || [],
  }
}

export const newState = code => ({
  code, phase: 'lobby', slots: [null, null, null, null], pack: null,
  q: null, shown: false, revealed: false, timer: null, timeup: false, buzz: null, sub: null,
})

const fresh = s => Object.assign(s, { shown: false, revealed: false, timer: null, timeup: false, buzz: null })
const clock = (s, sec, kind, now) => { s.timer = { end: now + sec * 1000, dur: sec, kind }; s.timeup = false }
const nextVd = (s, fin) =>
  active(s).filter(i => !fin.includes(i)).sort((a, b) => s.slots[b].score - s.slots[a].score || a - b)[0] ?? null
export const topTied = s => {
  const P = active(s), max = Math.max(...P.map(i => s.slots[i].score))
  return P.filter(i => s.slots[i].score === max)
}
export const vdVal = sub => sub.vals[sub.i]
export const cnvPts = sub => (sub.centerDone ? 20 : CNV_PTS[Math.min(Math.max(sub.played, 1), 4) - 1])

function enter(s, phase, a) {
  fresh(s)
  s.phase = phase
  s.q = null
  s.sub = null
  const P = active(s)
  if (phase === 'kd1') s.sub = { order: P, p: 0, i: 0, done: false }, s.q = s.pack.kd1[P[0]][0]
  if (phase === 'kd2') s.sub = { i: 0, done: false }, s.q = s.pack.kd2[0]
  if (phase === 'vcnv') s.sub = {
    rows: s.pack.vcnv.rows.map(q => ({ q, st: 'hidden' })), key: s.pack.vcnv.key, img: s.pack.vcnv.img,
    cur: null, played: 0, answers: {}, marks: {}, showAns: false, closed: false,
    elim: [], cnv: [], solved: null, centerDone: false, done: false,
  }
  if (phase === 'vd') {
    const cur = nextVd(s, [])
    s.sub = { fin: [], cur, i: 0, vals: [20, 20, 20], star: {}, stage: 'ready', done: false }
    s.q = s.pack.vd[cur][0]
  }
  if (phase === 'tb') s.sub = { who: a.players?.length ? a.players : topTied(s), i: 0, out: [], winner: null, done: false }, s.q = s.pack.tb[0]
}

// Trả về true khi hành động được chấp nhận. Thay đổi `s` tại chỗ.
export function act(s, a, now = Date.now()) {
  const sub = s.sub
  const add = (i, d) => { s.slots[i].score += d }
  switch (a.type) {
    case 'join': {
      const at = s.slots.findIndex(p => p?.cid === a.cid)
      if (at >= 0) return Object.assign(s.slots[at], { name: a.name || s.slots[at].name, online: true }), true
      const free = s.slots.indexOf(null)
      if (a.want !== 'player' || s.phase !== 'lobby' || free < 0) return false
      s.slots[free] = { cid: a.cid, name: a.name || `Thí sinh ${free + 1}`, score: 0, online: true }
      return true
    }
    case 'online': {
      const p = s.slots.find(p => p?.cid === a.cid)
      return p ? ((p.online = a.on), true) : false
    }
    case 'kick':
      if (s.phase !== 'lobby') return false
      s.slots[a.slot] = null
      return true
    case 'swap':
      if (s.phase !== 'lobby' || a.b < 0 || a.b > 3) return false
      ;[s.slots[a.a], s.slots[a.b]] = [s.slots[a.b], s.slots[a.a]]
      return true
    case 'pack':
      s.pack = a.pack
      return true
    case 'round':
      if (!s.pack || !active(s).length) return false
      enter(s, a.round, a)
      return true
    case 'adjust':
      if (!s.slots[a.slot]) return false
      add(a.slot, a.d)
      return true
    case 'reroll':
      if (s.phase === 'vcnv') {
        const r = sub.rows[a.row]
        if (!r || r.st !== 'hidden') return false
        r.q = a.q
        return true
      }
      if (s.shown || !s.q) return false
      s.q = a.q
      return true
    case 'show':
      if (!s.q || s.shown || sub?.done) return false
      s.shown = true
      if (s.phase === 'kd2' || s.phase === 'tb') s.buzz = { who: null }
      if (s.phase === 'vd') sub.stage = 'q'
      return true
    case 'timer': {
      if (!s.shown || s.revealed) return false
      if (s.phase === 'kd1') clock(s, T.kd1, 'answer', now)
      else if (s.phase === 'kd2') { if (s.buzz.who != null) return false; clock(s, T.kd2Buzz, 'buzz', now) }
      else if (s.phase === 'vcnv') { if (sub.cur == null || sub.closed) return false; clock(s, T.vcnv, 'answer', now) }
      else if (s.phase === 'vd') { if (sub.stage !== 'q') return false; clock(s, T.vd[vdVal(sub)], 'answer', now) }
      else if (s.phase === 'tb') { if (s.buzz.who != null) return false; clock(s, T.tb, 'buzz', now) }
      else return false
      return true
    }
    case 'buzz': {
      const i = a.slot
      if (!s.shown || s.revealed || !s.buzz || s.buzz.who != null) return false
      if (s.phase === 'vd' && (sub.stage !== 'steal' || i === sub.cur)) return false
      if (s.phase === 'tb' && (!sub.who.includes(i) || sub.out.includes(i))) return false
      if (!['kd2', 'vd', 'tb'].includes(s.phase)) return false
      s.buzz.who = i
      clock(s, T.answer, 'answer', now)
      return true
    }
    case 'judge': {
      if (!s.shown || s.revealed) return false
      if (s.phase === 'kd1') {
        if (a.ok) add(sub.order[sub.p], 10)
      } else if (s.phase === 'kd2') {
        const w = s.buzz.who
        if (w == null) return false
        s.slots[w].score = Math.max(0, s.slots[w].score + (a.ok ? 10 : -5))
      } else if (s.phase === 'vd') {
        const v = vdVal(sub), star = sub.star[sub.cur] === sub.i
        if (sub.stage === 'q') {
          if (a.ok) add(sub.cur, star ? 2 * v : v)
          else {
            if (star) add(sub.cur, -v)
            sub.stage = 'steal'
            s.buzz = { who: null }
            clock(s, T.steal, 'buzz', now)
            return true
          }
        } else if (sub.stage === 'steal') {
          const w = s.buzz.who
          if (w == null) return false
          if (a.ok) add(w, v), add(sub.cur, -v)
          else add(w, -v / 2)
        } else return false
        sub.stage = 'res'
      } else if (s.phase === 'tb') {
        const w = s.buzz.who
        if (w == null) return false
        if (a.ok) sub.winner = w, sub.done = true
        else {
          sub.out.push(w)
          s.buzz.who = null
          s.timer = null
          if (sub.out.length < sub.who.length) return true
        }
      } else return false
      s.revealed = true
      s.timer = null
      return true
    }
    case 'tick': {
      if (!s.timer || now < s.timer.end) return false
      const kind = s.timer.kind
      s.timer = null
      s.timeup = true
      if (kind === 'buzz' && s.phase === 'kd2' && s.buzz?.who == null) s.revealed = true
      if (kind === 'buzz' && s.phase === 'vd' && sub.stage === 'steal' && s.buzz.who == null) s.revealed = true, sub.stage = 'res'
      if (kind === 'answer' && s.phase === 'vcnv') sub.closed = true
      return true
    }
    case 'next': {
      if (!sub || sub.done || !s.revealed) return false
      fresh(s)
      if (s.phase === 'kd1') {
        if (++sub.i >= 6) sub.i = 0, sub.p++
        if (sub.p >= sub.order.length) sub.done = true, s.q = null
        else s.q = s.pack.kd1[sub.order[sub.p]][sub.i]
      } else if (s.phase === 'kd2') {
        if (++sub.i >= 12) sub.done = true, s.q = null
        else s.q = s.pack.kd2[sub.i]
      } else if (s.phase === 'vd') {
        sub.stage = 'ready'
        if (++sub.i >= 3) {
          sub.fin.push(sub.cur)
          sub.cur = nextVd(s, sub.fin)
          sub.i = 0
          sub.vals = [20, 20, 20]
        }
        if (sub.cur == null) sub.done = true, s.q = null
        else s.q = s.pack.vd[sub.cur][sub.i]
      } else if (s.phase === 'tb') {
        sub.out = []
        s.q = s.pack.tb[++sub.i] || null
        if (!s.q) sub.done = true
      } else return false
      return true
    }
    case 'val':
      if (s.phase !== 'vd' || ![20, 30].includes(a.v) || a.i < sub.i || (a.i === sub.i && s.shown)) return false
      sub.vals[a.i] = a.v
      return true
    case 'star': {
      if (s.phase !== 'vd' || a.i < sub.i || (a.i === sub.i && s.shown)) return false
      const cur = sub.star[sub.cur]
      if (cur != null && (cur < sub.i || (cur === sub.i && s.shown))) return false
      if (cur === a.i) delete sub.star[sub.cur]
      else sub.star[sub.cur] = a.i
      return true
    }
    case 'pick': {
      if (s.phase !== 'vcnv' || sub.done || sub.cur != null) return false
      const r = sub.rows[a.row]
      if (!r || r.st !== 'hidden' || (a.row === 4 && sub.rows.slice(0, 4).some(r => r.st === 'hidden'))) return false
      fresh(s)
      r.st = 'asking'
      Object.assign(sub, { cur: a.row, answers: {}, marks: {}, showAns: false, closed: false })
      s.q = r.q
      s.shown = true
      return true
    }
    case 'answer':
      if (s.phase !== 'vcnv' || sub.cur == null || sub.closed || sub.elim.includes(a.slot)) return false
      sub.answers[a.slot] = String(a.text).slice(0, 60)
      return true
    case 'showAnswers':
      if (s.phase !== 'vcnv' || sub.cur == null) return false
      sub.showAns = sub.closed = true
      s.timer = null
      for (const i of active(s)) sub.marks[i] = !sub.elim.includes(i) && norm(sub.answers[i]) === norm(s.q.answer)
      return true
    case 'mark':
      if (s.phase !== 'vcnv' || !sub.showAns) return false
      sub.marks[a.slot] = !sub.marks[a.slot]
      return true
    case 'rowDone': {
      if (s.phase !== 'vcnv' || !sub.showAns) return false
      const hit = active(s).filter(i => sub.marks[i])
      hit.forEach(i => add(i, 10))
      sub.rows[sub.cur].st = hit.length ? 'open' : 'locked'
      sub.played++
      const center = sub.cur === 4
      sub.cur = null
      fresh(s)
      s.q = null
      if (center) sub.centerDone = true, clock(s, T.cnvWindow, 'cnv', now)
      return true
    }
    case 'cnv':
      if (s.phase !== 'vcnv' || sub.done || sub.played < 1 || sub.elim.includes(a.slot) || sub.cnv.some(b => b.slot === a.slot)) return false
      sub.cnv.push({ slot: a.slot, text: String(a.text).slice(0, 60), pts: cnvPts(sub) })
      return true
    case 'cnvJudge': {
      if (s.phase !== 'vcnv' || sub.done) return false
      const b = sub.cnv.find(b => b.slot === a.slot)
      if (!b) return false
      sub.cnv = sub.cnv.filter(x => x !== b)
      if (a.ok) add(b.slot, b.pts), sub.solved = b.slot, sub.done = true, s.timer = null
      else sub.elim.push(b.slot)
      return true
    }
    case 'vcnvEnd':
      if (s.phase !== 'vcnv') return false
      sub.done = true
      sub.cur = null
      fresh(s)
      return true
  }
  return false
}

// Thứ khách nhìn thấy: không bao giờ chứa đáp án chưa công bố.
export function view(s, slot) {
  const v = structuredClone({ ...s, pack: null })
  if (!v.shown) v.q = null
  // structuredClone giữ tham chiếu chung: v.q có thể chính là một hàng VCNV, nên phải tách bản sao.
  else if (!v.revealed) v.q = { ...v.q, answer: null }
  if (v.phase === 'vcnv') {
    const u = v.sub
    u.rows = u.rows.map(r => ({
      st: r.st, len: norm(r.q.answer).length,
      answer: r.st === 'open' || u.done ? norm(r.q.answer) : null,
    }))
    u.keyLen = norm(u.key).length
    u.key = u.done ? u.key : null
    u.submitted = Object.keys(u.answers).map(Number)
    if (!u.showAns) u.answers = slot >= 0 && u.answers[slot] != null ? { [slot]: u.answers[slot] } : {}
    u.cnv = u.cnv.map(b => ({ ...b, text: b.slot === slot ? b.text : null }))
    // ponytail: URL ảnh lộ cho khách, người tò mò có thể mở thẳng; cắt ảnh phía chủ phòng nếu cần chống gian lận.
  }
  return v
}
