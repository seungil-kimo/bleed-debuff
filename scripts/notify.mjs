// GitHub Actions가 30분마다 실행해서 알림을 보내는 스크립트
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { model, events, todayKST, pd } from '../cycle.js';

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
if (!sa.project_id) { console.error('FIREBASE_SERVICE_ACCOUNT 시크릿이 비어 있어요.'); process.exit(1); }
initializeApp({ credential: cert(sa) });
const db = getFirestore(), fcm = getMessaging();

const t = todayKST();
const hourKST = new Date(Date.now() + 9 * 3600e3).getUTCHours();
const APP_URL = process.env.APP_URL || '';
const DRY = process.env.DRY_RUN === '1';
const FLOW = ['없음', '적음', '보통', '많음'], PAIN = ['없음', '약함', '보통', '심함'];

let sentCount = 0;
// 한 기기에 알림 하나 보내기 (같은 key는 한 번만)
async function send(c, dev, key, title, body) {
  const d = dev.data(), sentRef = c.ref.collection('sent').doc(`${dev.id}_${key}`);
  if ((await sentRef.get()).exists) return;
  if (DRY) { console.log('[DRY]', c.id, title, '/', body); return; }
  try {
    const msg = { token: d.token, notification: { title, body } };
    if (APP_URL) msg.webpush = { notification: { icon: APP_URL + 'icon-192.png' }, fcmOptions: { link: APP_URL } };
    await fcm.send(msg);
    await sentRef.set({ at: Date.now(), title });
    sentCount++;
  } catch (e) {
    console.error('보내기 실패', c.id, e.code || e.message);
    if (['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(e.code)) {
      await dev.ref.update({ token: null }); // 앱을 다시 열면 새 토큰으로 바뀌어요
    }
  }
}

const couples = await db.collection('couples').get();
for (const c of couples.docs) {
  const data = c.data(), members = data.members || {};
  const since = Date.now() - 2 * 3600e3; // 최근 2시간 안에 저장된 몸 상태 기록만
  const [ps, devs, logs, msgs, chats] = await Promise.all([
    c.ref.collection('periods').get(),
    c.ref.collection('devices').get(),
    c.ref.collection('logs').where('updatedAt', '>', since).get(),
    c.ref.collection('msgs').where('at', '>', since).get(),
    c.ref.collection('chat').where('at', '>', since).get()
  ]);
  const periods = ps.docs.map(d => ({ start: d.get('start'), end: d.get('end') }));
  const M = model(periods, data.settings || {}, t);

  for (const dev of devs.docs) {
    const d = dev.data(), uid = dev.id, role = members[uid];
    if (!d.token || !role) continue;
    const notify = d.notify || {};

    // 1) 주기 알림 (예정일, 생리 시작, 가임기 등)
    for (const ev of events(M, t, role)) {
      if (notify[ev.kind] === false) continue;
      if (ev.kind === 'start' && role !== 'partner') continue;   // 생리 시작은 상대에게만
      if (ev.kind !== 'start' && hourKST < 9) continue;          // 생리 시작은 언제든, 나머지는 오전 9시 이후
      await send(c, dev, ev.key, ev.title, ev.body);
    }

    // 2) 한마디 알림: 상대가 보낸 한마디 (본인이 보낸 건 제외)
    if (notify.msg !== false) {
      for (const m of msgs.docs) {
        const x = m.data();
        if (typeof x.text !== 'string' || x.by === uid) continue;
        await send(c, dev, `msg-${m.id}`, '💌 한마디가 도착했어요', x.text.slice(0, 120));
      }
    }

    // 2-1) 채팅 알림 (즉시 알림이 실패했을 때만 여기서 보내져요)
    if (notify.chat !== false) {
      for (const m of chats.docs) {
        const x = m.data();
        if (typeof x.text !== 'string' || x.by === uid) continue;
        await send(c, dev, `chat-${m.id}`, '💬 새 메시지', x.type === 'img' ? (x.once ? '📸 한 번만 볼 수 있는 사진을 보냈어요' : '📷 사진을 보냈어요') : x.text.slice(0, 140));
      }
    }

    // 3) 몸 상태 기록 알림: 상대가 증상·기분을 저장하면 (본인이 쓴 기록은 제외)
    if (notify.log !== false) {
      for (const lg of logs.docs) {
        const L = lg.data();
        if (!L.updatedAt || L.by === uid) continue;
        const parts = [];
        if (Number.isInteger(L.pain) && L.pain > 0) parts.push('생리통 ' + PAIN[L.pain]);
        if (Number.isInteger(L.flow) && L.flow > 0) parts.push('양 ' + FLOW[L.flow]);
        if (Array.isArray(L.sym) && L.sym.length) parts.push(L.sym.slice(0, 3).join(', ') + (L.sym.length > 3 ? ' 외' : ''));
        if (Array.isArray(L.mood) && L.mood.length) parts.push('기분 ' + L.mood.slice(0, 2).join(', '));
        if (typeof L.memo === 'string' && L.memo.trim()) parts.push('메모 있음');
        const day = lg.id === t ? '오늘' : (() => { const x = pd(lg.id); return `${x.getMonth() + 1}월 ${x.getDate()}일`; })();
        await send(c, dev, `log-${lg.id}-${L.updatedAt}`, `${day} 몸 상태 기록이 올라왔어요`, parts.join(' · ') || '앱에서 확인해 보세요');
      }
    }
  }
}
console.log(`${t} ${hourKST}시(KST) · 커플 ${couples.size}쌍 · 보낸 알림 ${sentCount}개`);
