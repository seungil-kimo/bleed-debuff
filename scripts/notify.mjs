// GitHub Actions가 30분마다 실행해서 알림을 보내는 스크립트
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { model, events, todayKST } from '../cycle.js';

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
if (!sa.project_id) { console.error('FIREBASE_SERVICE_ACCOUNT 시크릿이 비어 있어요.'); process.exit(1); }
initializeApp({ credential: cert(sa) });
const db = getFirestore(), fcm = getMessaging();

const t = todayKST();
const hourKST = new Date(Date.now() + 9 * 3600e3).getUTCHours();
const APP_URL = process.env.APP_URL || '';
const DRY = process.env.DRY_RUN === '1';

const couples = await db.collection('couples').get();
let sentCount = 0;
for (const c of couples.docs) {
  const data = c.data(), members = data.members || {};
  const [ps, devs] = await Promise.all([c.ref.collection('periods').get(), c.ref.collection('devices').get()]);
  const periods = ps.docs.map(d => ({ start: d.get('start'), end: d.get('end') }));
  const M = model(periods, data.settings || {}, t);

  for (const dev of devs.docs) {
    const d = dev.data(), uid = dev.id, role = members[uid];
    if (!d.token || !role) continue;
    const notify = d.notify || {};
    for (const ev of events(M, t, role)) {
      if (notify[ev.kind] === false) continue;
      if (ev.kind === 'start' && role !== 'partner') continue;   // 생리 시작은 상대에게만
      if (ev.kind !== 'start' && hourKST < 9) continue; // 생리 시작은 언제든 바로, 나머지 예정일 알림은 오전 9시 이후
      const sentRef = c.ref.collection('sent').doc(`${uid}_${ev.key}`);
      if ((await sentRef.get()).exists) continue;
      if (DRY) { console.log('[DRY]', c.id, role, ev.title); continue; }
      try {
        const msg = { token: d.token, notification: { title: ev.title, body: ev.body } };
        if (APP_URL) msg.webpush = { notification: { icon: APP_URL + 'icon-192.png' }, fcmOptions: { link: APP_URL } };
        await fcm.send(msg);
        await sentRef.set({ at: Date.now(), title: ev.title });
        sentCount++;
      } catch (e) {
        console.error('보내기 실패', c.id, e.code || e.message);
        if (['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(e.code)) {
          await dev.ref.update({ token: null }); // 앱을 다시 열면 새 토큰으로 바뀌어요
        }
      }
    }
  }
}
console.log(`${t} ${hourKST}시(KST) · 커플 ${couples.size}쌍 · 보낸 알림 ${sentCount}개`);
