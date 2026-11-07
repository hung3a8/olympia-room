import fs from 'node:fs'
import assert from 'node:assert/strict'
import { act, buildPack, newState, parseCSV, view, norm, shortRounds } from './game.js'

const q = (qid, round, answer = 'ĐÁP ÁN') => ({ qid, season: '26', match: 'M1Q1', round, subject: 'X', question: `Câu ${qid}?`, answer })
const rows = [
  ...[1, 2, 3, 4].flatMap(p => [1, 2, 3, 4, 5, 6].map(i => q(`26-M1Q1-KD-A${p}.${i}`, 'KD'))),
  ...Array.from({ length: 20 }, (_, i) => q(`26-M1Q1-KD-B.${i + 1}`, 'KD')),
  ...[1, 2, 3, 4, 5].map(n => q(`26-M1Q1-VCNV-${n}`, 'VCNV', 'NGÔNNGỮ')),
  ...[1, 2, 3, 4].flatMap(p => [1, 2, 3].map(i => q(`26-M1Q1-VD-${p}.${i}`, 'VD'))),
]

assert.deepEqual(parseCSV('a,b\n"x, ""y""","1\n2"\n'), [{ a: 'x, "y"', b: '1\n2' }])

const pack = buildPack(rows, { match: '26-M1Q1', key: 'Bác Hồ' })
assert.equal(pack.kd1[2][0].qid, '26-M1Q1-KD-A3.1')
assert.equal(pack.kd2.length, 12)
assert.equal(pack.vcnv.rows[4].qid, '26-M1Q1-VCNV-5')

const s = newState('ABCDE')
let t = 1000
const A = a => act(s, a, t)
for (const c of ['a', 'b', 'c']) assert.ok(A({ type: 'join', cid: c, name: c, want: 'player' }))
assert.ok(!A({ type: 'join', cid: 'v', want: 'viewer' }))
A({ type: 'pack', pack })

// Khởi động riêng: không trừ điểm
A({ type: 'round', round: 'kd1' })
A({ type: 'show' }); A({ type: 'judge', ok: true }); A({ type: 'next' })
A({ type: 'show' }); A({ type: 'judge', ok: false })
assert.equal(s.slots[0].score, 10)
assert.equal(view(s, 1).q.answer, 'ĐÁP ÁN')

// Khởi động chung: sai −5, không âm; không ai bấm chuông 5s → hiện đáp án
A({ type: 'round', round: 'kd2' })
A({ type: 'show' })
assert.equal(view(s, 1).q.answer, null)
assert.ok(A({ type: 'buzz', slot: 1 }))
assert.ok(!A({ type: 'buzz', slot: 2 }))
A({ type: 'judge', ok: false })
assert.equal(s.slots[1].score, 0)
A({ type: 'next' }); A({ type: 'show' }); A({ type: 'timer' })
t += 5000; A({ type: 'tick' })
assert.ok(s.revealed)

// VCNV: hàng ngang +10, CNV 60 sau hàng 1, sai bị loại
A({ type: 'round', round: 'vcnv' })
assert.ok(!A({ type: 'pick', row: 4 }))
A({ type: 'pick', row: 0 })
assert.equal(view(s, 0).sub.rows[0].answer, null)
assert.equal(view(s, 0).sub.rows[0].len, 7)
assert.equal(s.q.answer, 'NGÔNNGỮ')
A({ type: 'answer', slot: 0, text: 'ngôn ngữ' }); A({ type: 'answer', slot: 1, text: 'sai' })
assert.deepEqual(view(s, 1).sub.answers, { 1: 'sai' })
A({ type: 'showAnswers' }); A({ type: 'rowDone' })
assert.equal(s.slots[0].score, 20)
assert.equal(view(s, 2).sub.rows[0].answer, 'NGÔNNGỮ')
assert.equal(view(s, 2).sub.key, null)
A({ type: 'cnv', slot: 2, text: 'x' }); A({ type: 'cnv', slot: 1, text: 'bác hồ' })
assert.equal(view(s, 0).sub.cnv[0].text, null)
A({ type: 'cnvJudge', slot: 2, ok: false })
assert.ok(!A({ type: 'cnv', slot: 2, text: 'bác hồ' }))
A({ type: 'cnvJudge', slot: 1, ok: true })
assert.equal(s.slots[1].score, 60)
assert.equal(view(s, 0).sub.key, 'Bác Hồ')

// Về đích: người điểm cao nhất thi trước, ngôi sao x2, cướp điểm
A({ type: 'round', round: 'vd' })
assert.equal(s.sub.cur, 1)
A({ type: 'val', i: 0, v: 30 }); A({ type: 'star', i: 0 })
A({ type: 'show' }); A({ type: 'judge', ok: true })
assert.equal(s.slots[1].score, 120)
assert.ok(!A({ type: 'star', i: 1 }))
A({ type: 'next' }); A({ type: 'show' }); A({ type: 'judge', ok: false })
assert.ok(!A({ type: 'buzz', slot: 1 }))
A({ type: 'buzz', slot: 0 }); A({ type: 'judge', ok: true })
assert.equal(s.slots[0].score, 40)
assert.equal(s.slots[1].score, 100)
A({ type: 'next' }); A({ type: 'show' }); A({ type: 'judge', ok: false })
A({ type: 'buzz', slot: 2 }); A({ type: 'judge', ok: false })
assert.equal(s.slots[2].score, -10)
A({ type: 'next' })
assert.equal(s.sub.cur, 0)

assert.equal(norm(' Hồ Chí Minh! '), 'HỒCHÍMINH')

// Lọc theo môn: trận đã chọn mà có câu môn bị tắt thì thay bằng câu môn được bật.
const mixed = rows.map((r, i) => ({ ...r, subject: i % 2 ? 'Math' : 'History' }))
const extra = mixed.map(r => ({ ...r, subject: r.subject === 'Math' ? 'History' : 'Math', qid: r.qid.replace('26-M1Q1', '25-M2Q2'), match: 'M2Q2', season: '25' }))
const mathOnly = buildPack([...mixed, ...extra], { match: '26-M1Q1', off: ['History'] })
const all = [...mathOnly.kd1.flat(), ...mathOnly.kd2, ...mathOnly.vcnv.rows, ...mathOnly.vd.flat(), ...mathOnly.tb]
assert.ok(all.every(q => q.subject === 'Math'))
assert.deepEqual(mathOnly.off, ['History'])
assert.deepEqual(shortRounds(mixed, []), [])
assert.deepEqual(shortRounds(mixed, ['Math']), ['kd1', 'kd2', 'vcnv', 'vd'])
// Đề tự soạn: hàng CNV là từ khoá; ngẫu nhiên vẫn lấy trọn ô chữ của một đề.
const own = rows.map(r => ({ ...r, qid: r.qid.replace('26-M1Q1', 'X-1'), season: 'X', match: '1' }))
const cnvRow = { qid: 'X-1-CNV', season: 'X', match: '1', round: 'CNV', subject: 'X', question: '', answer: 'PENDLE' }
const mixPack = buildPack([...rows, ...own, cnvRow], {}, () => 0.99)
assert.equal(mixPack.vcnv.key, 'PENDLE')
assert.ok(mixPack.vcnv.rows.every(q => q.qid.startsWith('X-1-VCNV-')))
assert.equal(buildPack([...own, cnvRow], { match: 'X-1', key: 'khác' }).vcnv.key, 'khác')

const pendle = parseCSV(fs.readFileSync(new URL('./sets/pendle.csv', import.meta.url), 'utf8'))
assert.deepEqual(shortRounds(pendle, []), [])
for (const m of new Set(pendle.map(r => r.match))) {
  const n = re => pendle.filter(r => r.match === m && re.test(r.qid)).length
  assert.deepEqual([n(/-KD-A\d/), n(/-KD-B\./), n(/-VCNV-/), n(/-CNV$/), n(/-VD-/)], [24, 12, 5, 1, 12], `đề ${m} thiếu câu`)
  const p = buildPack(pendle, { match: `Pendle-${m}` }, () => 0)
  const ids = [...p.kd1.flat(), ...p.kd2, ...p.vcnv.rows, ...p.vd.flat()].map(q => q.qid)
  assert.ok(ids.every(id => id.startsWith(`Pendle-${m}-`)), `đề ${m} chưa đủ câu`)
  assert.ok(norm(p.vcnv.key).length >= 4)
  assert.ok(p.vcnv.rows.every(q => norm(q.answer).length > 0))
}
assert.equal(new Set(pendle.map(r => r.qid)).size, pendle.length)
console.log('ok')
