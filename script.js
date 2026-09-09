import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  updatePassword, reauthenticateWithCredential, EmailAuthProvider
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot, getDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
// NOTE: Firebase Storage is intentionally NOT used anymore — it requires the
// paid Blaze billing plan. Photos are compressed client-side and saved as
// base64 image strings directly inside Firestore documents instead (works on
// the free Spark plan).

const firebaseConfig = {
  apiKey: "AIzaSyDcNV4Eh-nDGWg2ZC_AZ5QzSqbypDO7K4Q",
  authDomain: "pfa-database-46f5d.firebaseapp.com",
  projectId: "pfa-database-46f5d",
  storageBucket: "pfa-database-46f5d.firebasestorage.app",
  messagingSenderId: "404321188315",
  appId: "1:404321188315:web:02694962bfa84592f1cffe"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Admin login email used behind the scenes — the admin only types a password in the UI.
// This MUST match the email you used when creating the admin user in Firebase Authentication.
const ADMIN_EMAIL = "mdrifatfarage01@gmail.com";

const shieldSVG = `<svg viewBox="0 0 64 64" width="100%" height="100%">
  <path d="M32 4 L54 12 V30 C54 46 44 56 32 60 C20 56 10 46 10 30 V12 Z" fill="#eafbf1" stroke="#1a8f4c" stroke-width="2"/>
  <circle cx="32" cy="28" r="10" fill="none" stroke="#1a8f4c" stroke-width="2"/>
  <path d="M32 20 L36 24 L34 30 L30 30 L28 24 Z" fill="#1a8f4c"/>
  <path d="M18 40 Q32 48 46 40" fill="none" stroke="#1a8f4c" stroke-width="2"/>
</svg>`;
document.querySelectorAll('.logo-wrap, .flogo, .photo-preview, .modal-photo, #logoCurrentPreview').forEach(el => { if (el.innerHTML.trim() === 'SHIELD_SVG') el.innerHTML = shieldSVG; });

const posLabel = {GK:'গোলকিপার', DEF:'ডিফেন্ডার', MID:'মিডফিল্ডার', FWD:'ফরোয়ার্ড'};

// ---- Local state (kept in sync with Firestore in real time) ----
let players = [];
let pending = [];
let committee = [];
let coaches = [];
let results = [];
let pastLeagues = [];
let gallery = [];
let matchInfo = {team2:'-', team2Logo:'', time:'-', league:'-', venue:'-'};
let siteSettings = { logo:'', phone:'', email:'', address:'', creatorName:'Md RiFaT RoHoMaN', creatorPhone:'', notice:'',
  hirePlayerPhone:'', hirePlayerWhatsapp:'', hirePlayerFacebook:'',
  hireTeamPhone:'', hireTeamWhatsapp:'', hireTeamFacebook:'' };
let editingPlayerId = null;
let editingCommitteeId = null;
let editingCoachId = null;
let currentFilter = 'all';
let pendingUnsub = null;
let isAdmin = false;

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>\"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[ch]));
}
function safeUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return '';
  if (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(url)) return url;
  try { const u = new URL(url, location.href); return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : ''; }
  catch { return ''; }
}
function photoTag(photo) { const url = safeUrl(photo); return url ? `<img src="${escapeHTML(url)}" alt="" loading="lazy" decoding="async">` : shieldSVG; }

// Extracts a YouTube video ID from common URL formats (watch?v=, youtu.be/, shorts/, embed/)
// and returns a safe embed URL, or '' if the input isn't a recognizable YouTube link.
// This whitelist approach (only ever building youtube.com/embed URLs ourselves) prevents
// admins from being able to inject an arbitrary iframe src.
function youtubeEmbedUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return '';
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtube\.com\/shorts\/|youtube\.com\/embed\/|youtu\.be\/)([\w-]{11})/i
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m && m[1]) return `https://www.youtube.com/embed/${m[1]}`;
  }
  return '';
}
function formatDOB(dob) {
  if (!dob) return '-';
  const d = new Date(dob + 'T00:00:00');
  if (isNaN(d.getTime())) return escapeHTML(dob);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  let age = new Date().getFullYear() - yyyy;
  const today = new Date();
  if (today.getMonth() < d.getMonth() || (today.getMonth() === d.getMonth() && today.getDate() < d.getDate())) age--;
  return `${dd}-${mm}-${yyyy} (বয়স ${age})`;
}

// ---- Renderers ----
function renderLogo() {
  document.querySelectorAll('.logo-wrap, .flogo').forEach(el => {
    const url = safeUrl(siteSettings.logo);
    el.innerHTML = url ? `<img src="${escapeHTML(url)}" alt="একাডেমি লোগো" loading="lazy">` : shieldSVG;
  });
}
function renderContact() {
  document.getElementById('contactInfoRows').innerHTML = `
    <div class="info-row"><span class="k">ফোন</span><span class="v">${escapeHTML(siteSettings.phone)}</span></div>
    <div class="info-row"><span class="k">ইমেইল</span><span class="v">${escapeHTML(siteSettings.email)}</span></div>
    <div class="info-row"><span class="k">ঠিকানা</span><span class="v">${escapeHTML(siteSettings.address)}</span></div>`;
}
function renderCreatorLine() {
  const phone = siteSettings.creatorPhone ? ` • ${siteSettings.creatorPhone}` : '';
  document.getElementById('creatorLine').innerHTML = `ওয়েব ক্রিয়েটর: <span class="creator-name">${escapeHTML(siteSettings.creatorName)}</span>${escapeHTML(phone)}`;
}
function renderNotice() {
  const bar = document.getElementById('noticeBar');
  const textEl = document.getElementById('noticeText');
  const text = (siteSettings.notice || '').trim();
  if (!text) { bar.style.display = 'none'; textEl.textContent = ''; return; }
  textEl.textContent = text;
  // Longer notices scroll a bit slower so they stay readable.
  const duration = Math.min(40, Math.max(10, text.length * 0.22));
  textEl.style.animationDuration = duration + 's';
  bar.style.display = 'flex';
}
function renderCommittee() {
  const wrap = document.getElementById('committeeGrid');
  wrap.innerHTML = committee.length ? committee.map(c => `
    <div class="committee-card">
      <div class="committee-photo">${photoTag(c.photo)}</div>
      <div class="committee-name">${escapeHTML(c.name)}</div>
      <div class="committee-role">${escapeHTML(c.role)}</div>
    </div>`).join('') : `<p class="empty-note">এখনো কোনো কমিটি সদস্য যোগ করা হয়নি।</p>`;
}
function renderCoaches() {
  const wrap = document.getElementById('coachWrap');
  wrap.innerHTML = coaches.length ? coaches.map(c => `
    <div class="coach-card">
      <div class="coach-photo">${photoTag(c.photo)}</div>
      <div>
        <div class="coach-name">${escapeHTML(c.name)}</div>
        <div class="coach-role">${escapeHTML(c.role || '')}</div>
        ${c.phone ? `<div class="coach-phone">📞 ${escapeHTML(c.phone)}</div>` : ''}
        ${c.bio ? `<div class="coach-bio">${escapeHTML(c.bio)}</div>` : ''}
        ${youtubeEmbedUrl(c.video) ? `<a href="${escapeHTML(youtubeEmbedUrl(c.video))}" target="_blank" rel="noopener noreferrer" style="display:inline-block; margin-top:6px; font-size:12px; color:#1a8f4c; font-weight:700; text-decoration:none;">▶ ভিডিও দেখুন</a>` : ''}
      </div>
    </div>`).join('') : `<p class="empty-note">এখনো কোনো কোচ যোগ করা হয়নি।</p>`;
}
function renderMatch() {
  const ownLogoUrl = safeUrl(siteSettings.logo);
  const ownBadge = ownLogoUrl ? `<img src="${escapeHTML(ownLogoUrl)}" alt="">` : shieldSVG;
  const oppLogoUrl = safeUrl(matchInfo.team2Logo);
  const oppBadge = oppLogoUrl ? `<img src="${escapeHTML(oppLogoUrl)}" alt="">` : escapeHTML((matchInfo.team2||'').slice(0,2));
  document.getElementById('matchCard').innerHTML = `
    <div class="match-teams">
      <div class="team"><div class="team-badge">${ownBadge}</div><div class="team-name">পীরগঞ্জ ফুটবল একাডেমি</div></div>
      <div class="vs-block"><div class="vs-label">vs</div><div class="vs-time">${escapeHTML(matchInfo.time||'')}</div></div>
      <div class="team"><div class="team-badge">${oppBadge}</div><div class="team-name">${escapeHTML(matchInfo.team2||'')}</div></div>
    </div>
    <div class="match-meta">${escapeHTML(matchInfo.league||'')}</div>
    <div class="match-venue">ভেন্যু: ${escapeHTML(matchInfo.venue||'')}</div>`;
}

// ---- Player / Team hire contact info (admin-set, public-visible on click) ----
function hireContactHTML(phone, whatsapp, facebook) {
  const rows = [];
  if (phone) rows.push(`<div class="info-row"><span class="k">ফোন</span><span class="v">${escapeHTML(phone)}</span></div>`);
  if (!phone && !whatsapp && !facebook) {
    return `<p class="empty-note" style="padding:10px 0;">যোগাযোগ তথ্য এখনো যোগ করা হয়নি।</p>`;
  }
  let html = rows.length ? `<div class="info-rows" style="margin-bottom:10px;">${rows.join('')}</div>` : '';
  html += `<div class="social-row" style="margin-bottom:0;">`;
  if (whatsapp) {
    const digits = String(whatsapp).replace(/[^0-9+]/g,'').replace(/^0+/, '880');
    html += `<button class="social-btn wa" onclick="window.open('https://wa.me/${escapeHTML(digits.replace('+',''))}','_blank','noopener,noreferrer')">WhatsApp</button>`;
  }
  if (facebook) {
    const url = safeUrl(facebook);
    if (url) html += `<button class="social-btn fb" onclick="window.open('${escapeHTML(url)}','_blank','noopener,noreferrer')">Facebook</button>`;
  }
  html += `</div>`;
  return html;
}
function renderHireInfo() {
  document.getElementById('hirePlayerInfo').innerHTML = hireContactHTML(siteSettings.hirePlayerPhone, siteSettings.hirePlayerWhatsapp, siteSettings.hirePlayerFacebook);
  document.getElementById('hireTeamInfo').innerHTML = hireContactHTML(siteSettings.hireTeamPhone, siteSettings.hireTeamWhatsapp, siteSettings.hireTeamFacebook);
}
function toggleHireInfo(type) {
  const playerBox = document.getElementById('hirePlayerInfo');
  const teamBox = document.getElementById('hireTeamInfo');
  if (type === 'player') {
    const willShow = playerBox.style.display === 'none';
    playerBox.style.display = willShow ? 'block' : 'none';
    teamBox.style.display = 'none';
  } else {
    const willShow = teamBox.style.display === 'none';
    teamBox.style.display = willShow ? 'block' : 'none';
    playerBox.style.display = 'none';
  }
}
function renderResults() {
  document.getElementById('resultsWrap').innerHTML = results.map(r => `
    <div class="result-row">
      <div class="result-team">${escapeHTML(r.team1)}</div>
      <div class="score-block"><div class="score">${escapeHTML(r.score)}</div><div class="result-sub">${escapeHTML(r.sub)}</div></div>
      <div class="result-team right">${escapeHTML(r.team2)}</div>
    </div>`).join('');
}
function renderPastLeagues() {
  const wrap = document.getElementById('pastLeagueWrap');
  wrap.innerHTML = pastLeagues.length ? pastLeagues.map(p => `
    <div class="card"><div class="player-name">${escapeHTML(p.name)}</div><div class="player-club">${escapeHTML(p.note)}</div></div>
  `).join('') : `<p class="empty-note">এখনো কোনো পুরনো লিগ তথ্য নেই।</p>`;
}
function renderGallery() {
  const wrap = document.getElementById('galleryGrid');
  if (!wrap) return;
  wrap.innerHTML = gallery.length ? gallery.map(g => `
    <div class="gallery-item">${photoTag(g.photo)}${g.caption ? `<div class="gallery-caption">${escapeHTML(g.caption)}</div>` : ''}</div>
  `).join('') : `<p class="empty-note">এখনো কোনো গ্যালারি ছবি যোগ করা হয়নি।</p>`;
}
function renderPlayers(filter) {
  const grid = document.getElementById('playerGrid');
  grid.innerHTML = '';
  players.filter(p => filter === 'all' || p.pos === filter).forEach(p => {
    const card = document.createElement('div');
    card.className = 'player-card';
    card.onclick = () => openModal(p);
    card.innerHTML = `
      <div class="player-photo"><span class="pos-badge pos-${['GK','DEF','MID','FWD'].includes(p.pos) ? p.pos : 'MID'}">${escapeHTML(posLabel[p.pos] || p.pos || '-')}</span>${photoTag(p.photo)}</div>
      <div class="player-info">
        <div class="player-name">${escapeHTML(p.name)}</div>
        <div class="player-club">${escapeHTML(p.club)}</div>
        <div class="player-foot"><span class="rating">রেটিং ${p.rating}</span><span class="matches-played">${p.matches || ''}</span></div>
      </div>`;
    grid.appendChild(card);
  });
}
function filterPlayers(pos, btn) {
  currentFilter = pos;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderPlayers(pos);
}

function toggleSidebar(open) {
  document.getElementById('sidebar').classList.toggle('open', open);
  document.getElementById('sidebarOverlay').classList.toggle('open', open);
}
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  toggleSidebar(false);
  window.scrollTo(0,0);
  if (name === 'pastleague') renderPastLeagues();
  if (name === 'committee') renderCommittee();
  if (name === 'coach') renderCoaches();
  if (name === 'gallery') renderGallery();
  if (name === 'contact') renderContact();
}
let currentModalPlayer = null;
function openModal(p) {
  currentModalPlayer = p;
  document.getElementById('mPhoto').innerHTML = photoTag(p.photo);
  document.getElementById('mPos').textContent = posLabel[p.pos];
  document.getElementById('mName').textContent = p.name;
  document.getElementById('mClub').textContent = p.club;
  document.getElementById('mFather').textContent = p.father || '-';
  document.getElementById('mMother').textContent = p.mother || '-';
  document.getElementById('mHeight').textContent = p.height || '-';
  document.getElementById('mDOB').textContent = formatDOB(p.dob);
  document.getElementById('socialSection').style.display = 'none';
  const waBtn = document.querySelector('.social-btn.wa');
  waBtn.onclick = () => { const digits = String(p.phone || '').replace(/[^0-9+]/g,'').replace(/^0+/, '880'); if (digits) window.open('https://wa.me/' + digits.replace('+',''), '_blank', 'noopener,noreferrer'); };
  const fbBtn = document.querySelector('.social-btn.fb');
  fbBtn.onclick = () => alert('এই প্লেয়ারের Facebook লিংক সংরক্ষিত নেই।');
  document.getElementById('mExp').textContent = p.exp || '-';
  document.getElementById('mAcc').textContent = p.rating || '-';
  const embedUrl = youtubeEmbedUrl(p.video);
  document.getElementById('mVideoSection').style.display = embedUrl ? 'block' : 'none';
  document.getElementById('mVideoFrame').src = embedUrl || '';
  document.getElementById('modalOverlay').classList.add('open');
}
function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
  document.getElementById('mVideoFrame').src = ''; // stop playback when modal closes
}
function closeModalBg(e) { if (e.target.id === 'modalOverlay') closeModal(); }
function showSocial() { document.getElementById('socialSection').style.display = 'block'; }

const MAX_UPLOAD_SIZE = 12 * 1024 * 1024; // 12 MB raw file limit (before compression)
const MAX_IMAGE_DIM = 720; // keep Firestore documents and page loads lighter
const IMAGE_QUALITY = 0.62; // initial JPEG quality
const pendingImageFiles = {};

function previewPhoto(input, previewId) {
  const file = input.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    alert('শুধু ছবি (JPG, PNG, WEBP, GIF ইত্যাদি) আপলোড করা যাবে।');
    input.value = '';
    return;
  }
  if (file.size > MAX_UPLOAD_SIZE) {
    alert('ছবির সর্বোচ্চ সাইজ 12 MB। 12 MB-এর বেশি ছবি দেওয়া যাবে না।');
    input.value = '';
    return;
  }

  // The original file is kept only for the live on-screen preview. When the
  // form is actually submitted, getPreviewPhoto() compresses it down to a
  // small base64 image that gets stored directly in the Firestore document
  // (no Firebase Storage / no Blaze billing plan required).
  pendingImageFiles[previewId] = file;
  const objectUrl = URL.createObjectURL(file);
  document.getElementById(previewId).innerHTML = `<img src="${objectUrl}" alt="ছবির প্রিভিউ">`;
}

// Resizes + compresses an image file in the browser and returns it as a
// small base64 data URL, so it can be saved straight into a Firestore field.
function compressImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('ছবি পড়া যায়নি।'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('ছবি লোড করা যায়নি। অন্য একটি ছবি দিয়ে চেষ্টা করুন।'));
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(width, height));
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d', {alpha:false});
        ctx.fillStyle = '#fff'; ctx.fillRect(0,0,width,height);
        ctx.drawImage(img, 0, 0, width, height);
        // Keep trying lower quality until the data URL is comfortably below
        // Firestore's document limit. This also makes the public site faster.
        let quality = IMAGE_QUALITY;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        while (dataUrl.length > 300000 && quality > 0.35) {
          quality -= 0.07;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        if (dataUrl.length > 300000) {
          // One final dimension reduction for unusually detailed photos.
          const factor = Math.sqrt(280000 / dataUrl.length);
          const w2 = Math.max(320, Math.round(width * factor));
          const h2 = Math.max(320, Math.round(height * factor));
          canvas.width = w2; canvas.height = h2;
          const ctx2 = canvas.getContext('2d', {alpha:false});
          ctx2.fillStyle = '#fff'; ctx2.fillRect(0,0,w2,h2);
          ctx2.drawImage(img, 0, 0, w2, h2);
          dataUrl = canvas.toDataURL('image/jpeg', 0.5);
        }
        resolve(dataUrl);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function getPreviewPhoto(previewId, fallbackUrl = '') {
  const file = pendingImageFiles[previewId];

  // No new file selected: keep the existing stored photo during edit.
  if (!file) {
    if (fallbackUrl) return safeUrl(fallbackUrl);
    const img = document.querySelector('#' + previewId + ' img');
    const src = img ? img.src : '';
    return src.startsWith('blob:') ? '' : safeUrl(src);
  }

  try {
    const dataUrl = await compressImageFile(file);
    delete pendingImageFiles[previewId];
    return dataUrl;
  } catch (e) {
    console.error('Image compression failed:', e);
    throw new Error(`IMAGE_PROCESS_FAILED: ${e.message || ''}`);
  }
}

function clearPendingImage(previewId) {
  delete pendingImageFiles[previewId];
  const inputMap = {regPhotoPreview:'regPhoto', adminPhotoPreview:'adminPhoto', committeePhotoPreview:'committeePhoto', coachPhotoPreview:'coachPhoto', logoCurrentPreview:'logoUpload', matchLogoPreview:'matchLogo'};
  const input = document.getElementById(inputMap[previewId]);
  if (input) input.value = '';
}

// ---- Public registration (writes to 'pending', allowed for everyone) ----
async function submitRegistration() {
  const submitBtn = document.querySelector('#view-registration button[onclick="submitRegistration()"]');
  if (submitBtn.disabled) return;
  const name = document.getElementById('regName').value.trim();
  const phone = document.getElementById('regPhone').value.trim();
  if (!name || !phone) { alert('নাম ও মোবাইল নম্বর আবশ্যক।'); return; }
  if (name.length > 100 || phone.length > 30) { alert('নাম বা মোবাইল নম্বরের দৈর্ঘ্য সঠিক নয়।'); return; }
  submitBtn.disabled = true; submitBtn.textContent = 'সাবমিট হচ্ছে...';
  try {
    const entry = {
      name, phone,
      father: document.getElementById('regFather').value.trim(),
      mother: document.getElementById('regMother').value.trim(),
      village: document.getElementById('regVillage').value.trim(),
      post: document.getElementById('regPost').value.trim(),
      upazila: document.getElementById('regUpazila').value.trim(),
      district: document.getElementById('regDistrict').value.trim(),
      pVillage: document.getElementById('regPVillage').value.trim(),
      pPost: document.getElementById('regPPost').value.trim(),
      pUpazila: document.getElementById('regPUpazila').value.trim(),
      pDistrict: document.getElementById('regPDistrict').value.trim(),
      dob: document.getElementById('regDOB').value,
      occupation: document.getElementById('regOccupation').value.trim(),
      school: document.getElementById('regSchool').value.trim(),
      className: document.getElementById('regClass').value.trim(),
      religion: document.getElementById('regReligion').value.trim(),
      pos: document.getElementById('regPos').value,
      nationality: document.getElementById('regNationality').value.trim(),
      height: document.getElementById('regHeight').value.trim(),
      blood: document.getElementById('regBlood').value.trim(),
      exp: document.getElementById('regExp').value.trim(),
      club: document.getElementById('regClub').value.trim(),
      photo: await getPreviewPhoto('regPhotoPreview'),
      rating: '-', matches: '০ ম্যাচ'
    };
    await addDoc(collection(db, 'pending'), entry);
    document.getElementById('regMsg').textContent = 'ধন্যবাদ! আপনার রেজিস্ট্রেশন জমা হয়েছে, এডমিন অনুমোদনের পর প্রোফাইল প্লেয়ার মার্কেটে দেখা যাবে।';
    document.getElementById('regMsg').classList.add('show');
    ['regName','regFather','regMother','regVillage','regPost','regUpazila','regDistrict','regPVillage','regPPost','regPUpazila','regPDistrict','regDOB','regOccupation','regSchool','regClass','regReligion','regPhone','regHeight','regBlood','regExp','regClub'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('regNationality').value = 'বাংলাদেশী';
    document.getElementById('regPos').value = 'GK';
    updateFormDownloadButton();
    clearPendingImage('regPhotoPreview');
    document.getElementById('regPhotoPreview').innerHTML = shieldSVG;
  } catch (e) {
    alert('দুঃখিত, সাবমিট করা যায়নি। আবার চেষ্টা করুন। (' + e.message + ')');
  }
}

// ---- Admin: pending approvals ----
function renderPending() {
  const wrap = document.getElementById('pendingList');
  if (!wrap) return;
  if (!pending.length) { wrap.innerHTML = '<p class="empty-note">কোনো পেন্ডিং রেজিস্ট্রেশন নেই।</p>'; return; }
  wrap.innerHTML = pending.map(p => `
    <div class="pending-item">
      <div class="pending-thumb">${photoTag(p.photo)}</div>
      <div class="pending-info"><b>${escapeHTML(p.name)}</b><br>${escapeHTML(p.club || '')} • ${escapeHTML(posLabel[p.pos] || p.pos || '-') }<br>${escapeHTML(p.phone || '')}</div>
      <div class="pending-actions">
        <button class="mini-btn mini-approve" onclick="approvePending('${p.id}')">অনুমোদন</button>
        <button class="mini-btn admin-edit" onclick="downloadAdminForm('${p.id}','pending')">ফরম PDF</button>
        <button class="mini-btn mini-reject" onclick="rejectPending('${p.id}')">বাতিল</button>
      </div>
    </div>`).join('');
}
async function approvePending(id) {
  const p = pending.find(p => p.id === id);
  if (!p) return;
  const { id: _drop, ...data } = p;
  data.rating = data.rating === '-' ? '৭.৫' : data.rating;
  try {
    const batch = writeBatch(db);
    batch.set(doc(collection(db, 'players')), data);
    batch.delete(doc(db, 'pending', id));
    await batch.commit();
  } catch (e) { alert('সমস্যা হয়েছে: ' + e.message); }
}
async function rejectPending(id) {
  try { await deleteDoc(doc(db, 'pending', id)); } catch (e) { alert('সমস্যা হয়েছে: ' + e.message); }
}


// ---- Filled admission form PDF ----
function formValue(id){ const el=document.getElementById(id); return el ? el.value.trim() : ''; }
function formDataFromInputs(){
  return {
    name:formValue('regName'), father:formValue('regFather'), mother:formValue('regMother'),
    village:formValue('regVillage'), post:formValue('regPost'), upazila:formValue('regUpazila'), district:formValue('regDistrict'),
    pVillage:formValue('regPVillage'), pPost:formValue('regPPost'), pUpazila:formValue('regPUpazila'), pDistrict:formValue('regPDistrict'),
    dob:formValue('regDOB'), occupation:formValue('regOccupation'), school:formValue('regSchool'), className:formValue('regClass'),
    religion:formValue('regReligion'), pos:formValue('regPos'), nationality:formValue('regNationality'), phone:formValue('regPhone'),
    height:formValue('regHeight'), blood:formValue('regBlood'), photo:(document.querySelector('#regPhotoPreview img')?.src || '')
  };
}
function updateFormDownloadButton(){
  const btn=document.getElementById('downloadFilledFormBtn'); if(!btn) return;
  const ids=['regPhoto','regName','regFather','regMother','regVillage','regPost','regUpazila','regDistrict','regPVillage','regPPost','regPUpazila','regPDistrict','regDOB','regOccupation','regSchool','regClass','regReligion','regPos','regNationality','regPhone','regHeight','regBlood'];
  const ok=ids.every(id=>{const el=document.getElementById(id); return id==='regPhoto' ? !!el.files?.length : !!el?.value?.trim();});
  btn.disabled=!ok;
  const note=document.getElementById('formDownloadNote'); if(note) note.textContent=ok?'সব তথ্য পূরণ হয়েছে — এখন PDF ডাউনলোড করতে পারবেন।':'সব প্রয়োজনীয় তথ্য ও ছবি পূরণ করলে ডাউনলোড বাটনটি চালু হবে।';
}
function loadImage(src){ return new Promise((resolve,reject)=>{const img=new Image(); img.onload=()=>resolve(img); img.onerror=reject; img.src=src;}); }
function fmtDate(v){ if(!v) return ''; const [y,m,d]=v.split('-'); return d&&m&&y?`${d}-${m}-${y}`:v; }
function fitText(text,max){ text=String(text||''); return text.length>max ? text.slice(0,max-1)+'…' : text; }
async function makeFilledFormPDF(data, filename='PFA-filled-form.pdf'){
  if(!window.jspdf?.jsPDF) throw new Error('PDF library load হয়নি। ইন্টারনেট connection check করুন।');
  const page1=await loadImage(new URL('form-page1.jpg', document.baseURI).href);
  const page2=await loadImage(new URL('form-page2.jpg', document.baseURI).href);
  const W=1448,H=2048;
  const container=document.createElement('div');
  container.style.cssText=`position:fixed;left:0;top:0;width:${W}px;background:#fff;font-family:Arial,"Noto Sans Bengali",sans-serif;z-index:2147483647;opacity:0.01;pointer-events:none;`;
  container.setAttribute('aria-hidden','true');
  document.body.appendChild(container);
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const makePage=(img,html)=>{ const d=document.createElement('div'); d.style.cssText=`position:relative;width:${W}px;height:${H}px;overflow:hidden;background:#fff;`; d.innerHTML=`<img crossorigin="anonymous" src="${esc(img.src)}" style="position:absolute;inset:0;width:100%;height:100%;display:block;">${html}`; container.appendChild(d); return d; };
  const t=(x,y,w,text,size=28,align='left')=>`<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;font-size:${size}px;line-height:1.05;font-weight:500;color:#111;text-align:${align};white-space:nowrap;overflow:hidden;">${esc(fitText(text,38))}</div>`;
  let photoHtml='';
  if(data.photo){ photoHtml=`<img src="${esc(data.photo)}" style="position:absolute;left:1133px;top:335px;width:224px;height:306px;object-fit:cover;">`; }
  const p1=`${photoHtml}
    ${t(205,700,1100,data.name)}
    ${t(247,787,1100,data.father)}
    ${t(247,875,1100,data.mother)}
    ${t(403,970,440,data.village)}${t(1018,970,360,data.post)}
    ${t(354,1057,520,data.upazila)}${t(1011,1057,360,data.district)}
    ${t(403,1145,440,data.pVillage)}${t(1018,1145,360,data.pPost)}
    ${t(354,1232,520,data.pUpazila)}${t(1011,1232,360,data.pDistrict)}
    ${t(247,1320,520,fmtDate(data.dob))}${t(856,1320,480,data.occupation)}
    ${t(354,1407,980,data.school)}
    ${t(219,1494,500,data.className)}${t(863,1494,470,data.religion)}
    ${t(488,1582,1000,posLabel[data.pos]||data.pos)}
    ${t(290,1668,410,data.nationality)}${t(841,1668,530,data.phone)}
    ${t(290,1756,410,data.height)}${t(919,1756,400,data.blood)}`;
  const d1=makePage(page1,p1);
  const d2=makePage(page2,'');
  if (!window.html2canvas) throw new Error('PDF image library load হয়নি। ইন্টারনেট connection check করুন।');
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const canvas1=await html2canvas(d1,{scale:1,useCORS:true,allowTaint:false,backgroundColor:'#fff',logging:false,windowWidth:W,windowHeight:H});
  const canvas2=await html2canvas(d2,{scale:1,useCORS:true,allowTaint:false,backgroundColor:'#fff',logging:false,windowWidth:W,windowHeight:H});
  const {jsPDF}=window.jspdf; const pdf=new jsPDF({orientation:'portrait',unit:'mm',format:'a4',compress:true});
  pdf.addImage(canvas1.toDataURL('image/jpeg',0.92),'JPEG',0,0,210,297); pdf.addPage(); pdf.addImage(canvas2.toDataURL('image/jpeg',0.92),'JPEG',0,0,210,297); pdf.save(filename);
  container.remove();
}
async function downloadFilledForm(){
  const data=formDataFromInputs();
  const ids=['name','father','mother','village','post','upazila','district','pVillage','pPost','pUpazila','pDistrict','dob','occupation','school','className','religion','nationality','phone','height','blood'];
  if(ids.some(k=>!data[k]) || !data.photo){ alert('প্রথমে সব প্রয়োজনীয় তথ্য ও ছবি পূরণ করুন।'); return; }
  const btn=document.getElementById('downloadFilledFormBtn'); if(btn){btn.disabled=true;btn.textContent='PDF তৈরি হচ্ছে...';}
  try{ await makeFilledFormPDF(data,'PFA-ভর্তি-ফরম.pdf'); }catch(e){console.error(e);alert('PDF তৈরি করা যায়নি: '+e.message);} finally{updateFormDownloadButton(); if(btn)btn.textContent='⬇ পূরণকৃত ভর্তি ফরম PDF ডাউনলোড';}
}
async function downloadAdminForm(id,type){
  if(!auth.currentUser || !isAdmin){alert('Admin Login করুন।');return;}
  const list=type==='pending'?pending:players; const p=list.find(x=>x.id===id); if(!p)return;
  const data={...p, className:p.className||p.class||'', occupation:p.occupation||p.job||'', school:p.school||p.education||'', nationality:p.nationality||'বাংলাদেশী', photo:safeUrl(p.photo||'')};
  try{await makeFilledFormPDF(data,`PFA-${(p.name||'player').replace(/[^\p{L}\p{N}_-]+/gu,'_')}-ভর্তি-ফরম.pdf`);}catch(e){console.error(e);alert('PDF তৈরি করা যায়নি: '+e.message);}
}

// ---- Admin login/logout ----
async function adminLogin() {
  const val = document.getElementById('adminPass').value;
  try {
    await signInWithEmailAndPassword(auth, ADMIN_EMAIL, val);
    document.getElementById('adminPass').value = '';
    document.getElementById('adminError').style.display = 'none';
  } catch (e) {
    document.getElementById('adminError').style.display = 'block';
  }
}
function adminLogout() { signOut(auth); }

onAuthStateChanged(auth, user => {
  isAdmin = !!user && String(user.email || '').toLowerCase() === ADMIN_EMAIL.toLowerCase();
  document.getElementById('adminLoginBox').style.display = isAdmin ? 'none' : 'block';
  document.getElementById('adminDashboard').style.display = isAdmin ? 'block' : 'none';
  if (isAdmin) {
    if (pendingUnsub) pendingUnsub();
    pendingUnsub = onSnapshot(collection(db, 'pending'), snap => {
      pending = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderPending();
    }, err => { console.error('Pending sync error:', err); renderPending(); });
  } else {
    if (pendingUnsub) { pendingUnsub(); pendingUnsub = null; }
    pending = [];
  }
});

function adminTab(name, btn) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.admin-subview').forEach(v => v.classList.remove('active'));
  document.getElementById('admin-' + name).classList.add('active');
  if (name === 'pending') renderPending();
  if (name === 'addplayer') renderAdminPlayerList();
  if (name === 'committee') renderAdminCommitteeList();
  if (name === 'coach') renderAdminCoachList();
  if (name === 'gallery') renderAdminGalleryList();
  if (name === 'settings') fillSettingsForm();
  if (name === 'match') fillMatchForm();
}
function fillMatchForm() {
  document.getElementById('mTeam2').value = matchInfo.team2 || '';
  document.getElementById('mTime').value = matchInfo.time || '';
  document.getElementById('mLeague').value = matchInfo.league || '';
  document.getElementById('mVenue').value = matchInfo.venue || '';
  clearPendingImage('matchLogoPreview');
  document.getElementById('matchLogoPreview').innerHTML = matchInfo.team2Logo ? `<img src="${escapeHTML(safeUrl(matchInfo.team2Logo))}" alt="">` : shieldSVG;
}

// ---- Admin: players (full CRUD, including rating) ----
function renderAdminPlayerList() {
  const wrap = document.getElementById('adminPlayerList');
  if (!players.length) { wrap.innerHTML = '<p class="empty-note">কোনো প্লেয়ার নেই।</p>'; return; }
  wrap.innerHTML = players.map(p => `
    <div class="pending-item">
      <div class="pending-thumb">${photoTag(p.photo)}</div>
      <div class="pending-info"><b>${escapeHTML(p.name)}</b><br>${escapeHTML(p.club || '')} • ${escapeHTML(posLabel[p.pos] || p.pos || '-')}<br>রেটিং: ${escapeHTML(p.rating)}</div>
      <div class="pending-actions">
        <button class="mini-btn admin-edit" onclick="editPlayer('${p.id}')">এডিট</button>
        <button class="mini-btn admin-edit" onclick="downloadAdminForm('${p.id}','player')">ফরম PDF</button>
        <button class="mini-btn mini-reject" onclick="deletePlayer('${p.id}')">ডিলিট</button>
      </div>
    </div>`).join('');
}
function editPlayer(id) {
  const p = players.find(p => p.id === id);
  if (!p) return;
  editingPlayerId = id;
  document.getElementById('adminName').value = p.name || '';
  document.getElementById('adminFather').value = p.father || '';
  document.getElementById('adminMother').value = p.mother || '';
  document.getElementById('adminVillage').value = p.village || '';
  document.getElementById('adminPost').value = p.post || '';
  document.getElementById('adminUpazila').value = p.upazila || '';
  document.getElementById('adminDistrict').value = p.district || '';
  document.getElementById('adminPVillage').value = p.pVillage || '';
  document.getElementById('adminPPost').value = p.pPost || '';
  document.getElementById('adminPUpazila').value = p.pUpazila || '';
  document.getElementById('adminPDistrict').value = p.pDistrict || '';
  document.getElementById('adminDOB').value = p.dob || '';
  document.getElementById('adminOccupation').value = p.occupation || '';
  document.getElementById('adminSchool').value = p.school || '';
  document.getElementById('adminClass').value = p.className || '';
  document.getElementById('adminReligion').value = p.religion || '';
  document.getElementById('adminNationality').value = p.nationality || 'বাংলাদেশী';
  document.getElementById('adminPhone').value = p.phone || '';
  document.getElementById('adminBlood').value = p.blood || '';
  document.getElementById('adminHeight').value = p.height || '';
  document.getElementById('adminExp').value = p.exp || '';
  document.getElementById('adminPos').value = p.pos || 'GK';
  document.getElementById('adminClub').value = p.club || '';
  document.getElementById('adminMatches').value = p.matches || '';
  document.getElementById('adminRating').value = p.rating === '-' ? '' : (p.rating || '');
  document.getElementById('adminVideo').value = p.video || '';
  clearPendingImage('adminPhotoPreview');
  document.getElementById('adminPhotoPreview').innerHTML = photoTag(p.photo);
  document.getElementById('playerFormTitle').textContent = 'প্লেয়ার এডিট করুন: ' + p.name;
  document.getElementById('playerFormBtn').textContent = 'আপডেট সেভ করুন';
  document.getElementById('playerCancelBtn').style.display = 'block';
  document.getElementById('playerFormBtn').scrollIntoView({behavior:'smooth', block:'center'});
}
function cancelPlayerEdit() {
  editingPlayerId = null;
  ['adminName','adminFather','adminMother','adminVillage','adminPost','adminUpazila','adminDistrict','adminPVillage','adminPPost','adminPUpazila','adminPDistrict','adminDOB','adminOccupation','adminSchool','adminClass','adminReligion','adminNationality','adminPhone','adminBlood','adminHeight','adminExp','adminClub','adminMatches','adminRating','adminVideo'].forEach(id => document.getElementById(id).value = '');
  clearPendingImage('adminPhotoPreview');
    document.getElementById('adminPhotoPreview').innerHTML = shieldSVG;
  document.getElementById('playerFormTitle').textContent = 'নতুন প্লেয়ার সরাসরি যোগ করুন';
  document.getElementById('playerFormBtn').textContent = 'প্লেয়ার যোগ করুন';
  document.getElementById('playerCancelBtn').style.display = 'none';
}
async function deletePlayer(id) {
  if (!auth.currentUser || !isAdmin) { alert('Admin Login করুন।'); return; }
  if (!confirm('আপনি কি নিশ্চিত এই প্লেয়ারকে ডিলিট করতে চান?')) return;
  try {
    await deleteDoc(doc(db, 'players', id));
    if (editingPlayerId === id) cancelPlayerEdit();
  } catch (e) { alert('সমস্যা হয়েছে: ' + e.message); }
}
async function adminAddPlayer() {
  if (!auth.currentUser || !isAdmin) { alert('Admin Login করুন, তারপর Player যোগ করুন।'); return; }
  const name = document.getElementById('adminName').value.trim();
  if (!name) { alert('নাম আবশ্যক।'); return; }
  const btn = document.getElementById('playerFormBtn');
  btn.disabled = true; btn.textContent = editingPlayerId !== null ? 'সেভ হচ্ছে...' : 'যোগ হচ্ছে...';
  try {
    const photo = await getPreviewPhoto('adminPhotoPreview', editingPlayerId !== null ? (players.find(p => p.id === editingPlayerId)?.photo || '') : '');
    const data = {
      name,
      father: document.getElementById('adminFather').value.trim(),
      mother: document.getElementById('adminMother').value.trim(),
      village: document.getElementById('adminVillage').value.trim(),
      post: document.getElementById('adminPost').value.trim(),
      upazila: document.getElementById('adminUpazila').value.trim(),
      district: document.getElementById('adminDistrict').value.trim(),
      pVillage: document.getElementById('adminPVillage').value.trim(),
      pPost: document.getElementById('adminPPost').value.trim(),
      pUpazila: document.getElementById('adminPUpazila').value.trim(),
      pDistrict: document.getElementById('adminPDistrict').value.trim(),
      dob: document.getElementById('adminDOB').value,
      occupation: document.getElementById('adminOccupation').value.trim(),
      school: document.getElementById('adminSchool').value.trim(),
      className: document.getElementById('adminClass').value.trim(),
      religion: document.getElementById('adminReligion').value.trim(),
      nationality: document.getElementById('adminNationality').value.trim(),
      phone: document.getElementById('adminPhone').value.trim(),
      blood: document.getElementById('adminBlood').value.trim(),
      height: document.getElementById('adminHeight').value.trim(),
      exp: document.getElementById('adminExp').value.trim(),
      pos: document.getElementById('adminPos').value,
      club: document.getElementById('adminClub').value.trim(),
      rating: document.getElementById('adminRating').value.trim() || '-',
      matches: document.getElementById('adminMatches').value.trim() || '০ ম্যাচ',
      video: document.getElementById('adminVideo').value.trim(),
      photo
    };
    if (editingPlayerId !== null) {
      await updateDoc(doc(db, 'players', editingPlayerId), data);
      cancelPlayerEdit();
      alert('প্লেয়ার আপডেট হয়েছে।');
      return;
    }
    await addDoc(collection(db, 'players'), data);
    ['adminName','adminFather','adminMother','adminVillage','adminPost','adminUpazila','adminDistrict','adminPVillage','adminPPost','adminPUpazila','adminPDistrict','adminDOB','adminOccupation','adminSchool','adminClass','adminReligion','adminNationality','adminPhone','adminBlood','adminHeight','adminExp','adminClub','adminMatches','adminRating','adminVideo'].forEach(id => document.getElementById(id).value = '');
    clearPendingImage('adminPhotoPreview');
    document.getElementById('adminPhotoPreview').innerHTML = shieldSVG;
    document.getElementById('adminPhoto').value = '';
    alert('প্লেয়ার যোগ হয়েছে।');
  } catch (e) {
    console.error(e);
    alert('প্লেয়ার যোগ করা যায়নি। Admin Login, Firebase Firestore Rules এবং Storage Rules পরীক্ষা করুন।\n\n' + (e.code || '') + ': ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = editingPlayerId !== null ? 'আপডেট সেভ করুন' : 'প্লেয়ার যোগ করুন';
  }
}

async function adminUpdateMatch() {
  if (!auth.currentUser || !isAdmin) { alert('Admin Login করুন, তারপর আপডেট করুন।'); return; }
  try {
    const team2Logo = await getPreviewPhoto('matchLogoPreview', matchInfo.team2Logo || '');
    const data = {
      team2: document.getElementById('mTeam2').value.trim() || matchInfo.team2,
      team2Logo,
      time: document.getElementById('mTime').value.trim() || matchInfo.time,
      league: document.getElementById('mLeague').value.trim() || matchInfo.league,
      venue: document.getElementById('mVenue').value.trim() || matchInfo.venue
    };
    await setDoc(doc(db, 'meta', 'match'), data);
    alert('পরবর্তী ম্যাচ আপডেট হয়েছে।');
  } catch (e) { alert('সমস্যা হয়েছে: ' + e.message); }
}

// ---- Admin: committee ----
function renderAdminCommitteeList() {
  const wrap = document.getElementById('adminCommitteeList');
  if (!committee.length) { wrap.innerHTML = '<p class="empty-note">কোনো কমিটি সদস্য নেই।</p>'; return; }
  wrap.innerHTML = committee.map(c => `
    <div class="pending-item">
      <div class="pending-thumb">${photoTag(c.photo)}</div>
      <div class="pending-info"><b>${escapeHTML(c.name)}</b><br>${escapeHTML(c.role)}</div>
      <div class="pending-actions">
        <button class="mini-btn admin-edit" onclick="editCommittee('${c.id}')">এডিট</button>
        <button class="mini-btn mini-reject" onclick="deleteCommittee('${c.id}')">ডিলিট</button>
      </div>
    </div>`).join('');
}
function editCommittee(id) {
  const c = committee.find(c => c.id === id);
  if (!c) return;
  editingCommitteeId = id;
  document.getElementById('committeeName').value = c.name || '';
  document.getElementById('committeeRole').value = c.role || '';
  clearPendingImage('committeePhotoPreview');
  document.getElementById('committeePhotoPreview').innerHTML = photoTag(c.photo);
  document.getElementById('committeeFormTitle').textContent = 'সদস্য এডিট করুন: ' + c.name;
  document.getElementById('committeeFormBtn').textContent = 'আপডেট সেভ করুন';
  document.getElementById('committeeCancelBtn').style.display = 'block';
}
function cancelCommitteeEdit() {
  editingCommitteeId = null;
  document.getElementById('committeeName').value = '';
  document.getElementById('committeeRole').value = '';
  clearPendingImage('committeePhotoPreview');
    document.getElementById('committeePhotoPreview').innerHTML = shieldSVG;
  document.getElementById('committeeFormTitle').textContent = 'নতুন কমিটি সদস্য যোগ করুন';
  document.getElementById('committeeFormBtn').textContent = 'সদস্য যোগ করুন';
  document.getElementById('committeeCancelBtn').style.display = 'none';
}
async function deleteCommittee(id) {
  if (!auth.currentUser || !isAdmin) { alert('Admin Login করুন।'); return; }
  if (!confirm('এই কমিটি সদস্যকে ডিলিট করতে চান?')) return;
  try {
    await deleteDoc(doc(db, 'committee', id));
    if (editingCommitteeId === id) cancelCommitteeEdit();
  } catch (e) { alert('সমস্যা হয়েছে: ' + e.message); }
}
async function adminSaveCommittee() {
  if (!auth.currentUser || !isAdmin) { alert('Admin Login করুন, তারপর Committee যোগ করুন।'); return; }
  const name = document.getElementById('committeeName').value.trim();
  if (!name) { alert('নাম আবশ্যক।'); return; }
  const btn = document.getElementById('committeeFormBtn');
  btn.disabled = true; btn.textContent = editingCommitteeId !== null ? 'সেভ হচ্ছে...' : 'যোগ হচ্ছে...';
  try {
    const data = {
      name,
      role: document.getElementById('committeeRole').value.trim(),
      photo: await getPreviewPhoto('committeePhotoPreview', editingCommitteeId !== null ? (committee.find(c => c.id === editingCommitteeId)?.photo || '') : '')
    };
    if (editingCommitteeId !== null) {
      await updateDoc(doc(db, 'committee', editingCommitteeId), data);
      cancelCommitteeEdit();
      alert('কমিটি সদস্য আপডেট হয়েছে।');
    } else {
      await addDoc(collection(db, 'committee'), data);
      document.getElementById('committeeName').value = '';
      document.getElementById('committeeRole').value = '';
      clearPendingImage('committeePhotoPreview');
      document.getElementById('committeePhoto').value = '';
      document.getElementById('committeePhotoPreview').innerHTML = shieldSVG;
      alert('কমিটি সদস্য যোগ হয়েছে।');
    }
  } catch (e) {
    console.error(e);
    alert('কমিটি সদস্য যোগ করা যায়নি। Admin Login, Firebase Firestore Rules এবং Storage Rules পরীক্ষা করুন.\n\n' + (e.code || '') + ': ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = editingCommitteeId !== null ? 'আপডেট সেভ করুন' : 'সদস্য যোগ করুন';
  }
}

// ---- Admin: coaches ----
function renderAdminCoachList() {
  const wrap = document.getElementById('adminCoachList');
  if (!coaches.length) { wrap.innerHTML = '<p class="empty-note">কোনো কোচ নেই।</p>'; return; }
  wrap.innerHTML = coaches.map(c => `
    <div class="pending-item">
      <div class="pending-thumb">${photoTag(c.photo)}</div>
      <div class="pending-info"><b>${escapeHTML(c.name)}</b><br>${escapeHTML(c.role || '')}${c.phone ? ' • ' + escapeHTML(c.phone) : ''}</div>
      <div class="pending-actions">
        <button class="mini-btn admin-edit" onclick="editCoach('${c.id}')">এডিট</button>
        <button class="mini-btn mini-reject" onclick="deleteCoach('${c.id}')">ডিলিট</button>
      </div>
    </div>`).join('');
}
function editCoach(id) {
  const c = coaches.find(c => c.id === id);
  if (!c) return;
  editingCoachId = id;
  document.getElementById('coachName').value = c.name || '';
  document.getElementById('coachRole').value = c.role || '';
  document.getElementById('coachPhone').value = c.phone || '';
  document.getElementById('coachBio').value = c.bio || '';
  document.getElementById('coachVideo').value = c.video || '';
  clearPendingImage('coachPhotoPreview');
  document.getElementById('coachPhotoPreview').innerHTML = photoTag(c.photo);
  document.getElementById('coachFormTitle').textContent = 'কোচ এডিট করুন: ' + c.name;
  document.getElementById('coachFormBtn').textContent = 'আপডেট সেভ করুন';
  document.getElementById('coachCancelBtn').style.display = 'block';
}
function cancelCoachEdit() {
  editingCoachId = null;
  ['coachName','coachRole','coachPhone','coachBio','coachVideo'].forEach(id => document.getElementById(id).value = '');
  clearPendingImage('coachPhotoPreview');
    document.getElementById('coachPhotoPreview').innerHTML = shieldSVG;
  document.getElementById('coachFormTitle').textContent = 'নতুন কোচ যোগ করুন';
  document.getElementById('coachFormBtn').textContent = 'কোচ যোগ করুন';
  document.getElementById('coachCancelBtn').style.display = 'none';
}
async function deleteCoach(id) {
  if (!auth.currentUser || !isAdmin) { alert('Admin Login করুন।'); return; }
  if (!confirm('এই কোচকে ডিলিট করতে চান?')) return;
  try {
    await deleteDoc(doc(db, 'coaches', id));
    if (editingCoachId === id) cancelCoachEdit();
  } catch (e) { alert('সমস্যা হয়েছে: ' + e.message); }
}
async function adminSaveCoach() {
  if (!auth.currentUser || !isAdmin) { alert('Admin Login করুন, তারপর Coach যোগ করুন।'); return; }
  const name = document.getElementById('coachName').value.trim();
  if (!name) { alert('নাম আবশ্যক।'); return; }
  const btn = document.getElementById('coachFormBtn');
  btn.disabled = true; btn.textContent = editingCoachId !== null ? 'সেভ হচ্ছে...' : 'যোগ হচ্ছে...';
  try {
    const data = {
      name,
      role: document.getElementById('coachRole').value.trim(),
      phone: document.getElementById('coachPhone').value.trim(),
      bio: document.getElementById('coachBio').value.trim(),
      video: document.getElementById('coachVideo').value.trim(),
      photo: await getPreviewPhoto('coachPhotoPreview', editingCoachId !== null ? (coaches.find(c => c.id === editingCoachId)?.photo || '') : '')
    };
    if (editingCoachId !== null) {
      await updateDoc(doc(db, 'coaches', editingCoachId), data);
      cancelCoachEdit();
      alert('কোচ আপডেট হয়েছে।');
    } else {
      await addDoc(collection(db, 'coaches'), data);
      ['coachName','coachRole','coachPhone','coachBio','coachVideo'].forEach(id => document.getElementById(id).value = '');
      clearPendingImage('coachPhotoPreview');
      document.getElementById('coachPhoto').value = '';
      document.getElementById('coachPhotoPreview').innerHTML = shieldSVG;
      alert('কোচ যোগ হয়েছে।');
    }
  } catch (e) {
    console.error(e);
    alert('কোচ যোগ করা যায়নি। Admin Login, Firebase Firestore Rules এবং Storage Rules পরীক্ষা করুন.\n\n' + (e.code || '') + ': ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = editingCoachId !== null ? 'আপডেট সেভ করুন' : 'কোচ যোগ করুন';
  }
}

// ---- Admin: gallery (match photos) ----
function renderAdminGalleryList() {
  const wrap = document.getElementById('adminGalleryList');
  if (!wrap) return;
  if (!gallery.length) { wrap.innerHTML = '<p class="empty-note">কোনো গ্যালারি ছবি নেই।</p>'; return; }
  wrap.innerHTML = gallery.map(g => `
    <div class="pending-item">
      <div class="pending-thumb">${photoTag(g.photo)}</div>
      <div class="pending-info">${escapeHTML(g.caption || 'ক্যাপশন নেই')}</div>
      <div class="pending-actions">
        <button class="mini-btn mini-reject" onclick="deleteGalleryPhoto('${g.id}')">ডিলিট</button>
      </div>
    </div>`).join('');
}
async function adminSaveGallery() {
  if (!auth.currentUser || !isAdmin) { alert('Admin Login করুন, তারপর ছবি যোগ করুন।'); return; }
  if (!pendingImageFiles['galleryPhotoPreview']) { alert('একটি ছবি নির্বাচন করুন।'); return; }
  const btn = document.getElementById('galleryFormBtn');
  btn.disabled = true; btn.textContent = 'যোগ হচ্ছে...';
  try {
    const photo = await getPreviewPhoto('galleryPhotoPreview');
    const caption = document.getElementById('galleryCaption').value.trim();
    await addDoc(collection(db, 'gallery'), { photo, caption, createdAt: Date.now() });
    document.getElementById('galleryCaption').value = '';
    clearPendingImage('galleryPhotoPreview');
    document.getElementById('galleryPhoto').value = '';
    document.getElementById('galleryPhotoPreview').innerHTML = shieldSVG;
    alert('গ্যালারি ছবি যোগ হয়েছে।');
  } catch (e) {
    console.error(e);
    alert('ছবি যোগ করা যায়নি: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'ছবি যোগ করুন';
  }
}
async function deleteGalleryPhoto(id) {
  if (!auth.currentUser || !isAdmin) { alert('Admin Login করুন।'); return; }
  if (!confirm('এই ছবিটি ডিলিট করতে চান?')) return;
  try { await deleteDoc(doc(db, 'gallery', id)); } catch (e) { alert('সমস্যা হয়েছে: ' + e.message); }
}

// ---- Admin: settings (logo, contact, creator) ----
function fillSettingsForm() {
  const logoUrl = safeUrl(siteSettings.logo);
  document.getElementById('logoCurrentPreview').innerHTML = logoUrl ? `<img src="${escapeHTML(logoUrl)}" alt="লোগো">` : shieldSVG;
  document.getElementById('setNotice').value = siteSettings.notice || '';
  document.getElementById('setPhone').value = siteSettings.phone || '';
  document.getElementById('setEmail').value = siteSettings.email || '';
  document.getElementById('setAddress').value = siteSettings.address || '';
  document.getElementById('setCreatorName').value = siteSettings.creatorName || '';
  document.getElementById('setCreatorPhone').value = siteSettings.creatorPhone || '';
  document.getElementById('setHirePlayerPhone').value = siteSettings.hirePlayerPhone || '';
  document.getElementById('setHirePlayerWhatsapp').value = siteSettings.hirePlayerWhatsapp || '';
  document.getElementById('setHirePlayerFacebook').value = siteSettings.hirePlayerFacebook || '';
  document.getElementById('setHireTeamPhone').value = siteSettings.hireTeamPhone || '';
  document.getElementById('setHireTeamWhatsapp').value = siteSettings.hireTeamWhatsapp || '';
  document.getElementById('setHireTeamFacebook').value = siteSettings.hireTeamFacebook || '';
}
async function adminSaveNotice() {
  if (!auth.currentUser || !isAdmin) { alert('Admin Login করুন, তারপর নোটিশ সেভ করুন।'); return; }
  const notice = document.getElementById('setNotice').value.trim();
  try {
    await setDoc(doc(db, 'meta', 'settings'), { notice }, { merge: true });
    alert('নোটিশ সেভ হয়েছে।');
  } catch (e) { alert('সমস্যা হয়েছে: ' + e.message); }
}
async function adminSaveLogo() {
  if (!auth.currentUser || !isAdmin) { alert('Admin Login করুন, তারপর Logo সেভ করুন।'); return; }
  try {
    const logoUrl = await getPreviewPhoto('logoCurrentPreview', siteSettings.logo || '');
    await setDoc(doc(db, 'meta', 'settings'), { logo: logoUrl }, { merge: true });
    alert('লোগো সেভ হয়েছে।');
  } catch (e) { alert('লোগো আপলোড করা যায়নি: ' + e.message); }
}
async function adminSaveContact() {
  if (!auth.currentUser || !isAdmin) { alert('Admin Login করুন, তারপর সেভ করুন।'); return; }
  const data = {
    phone: document.getElementById('setPhone').value.trim(),
    email: document.getElementById('setEmail').value.trim(),
    address: document.getElementById('setAddress').value.trim()
  };
  try {
    await setDoc(doc(db, 'meta', 'settings'), data, { merge: true });
    alert('যোগাযোগ তথ্য সেভ হয়েছে।');
  } catch (e) { alert('সমস্যা হয়েছে: ' + e.message); }
}
async function adminSaveHireInfo() {
  if (!auth.currentUser || !isAdmin) { alert('Admin Login করুন, তারপর সেভ করুন।'); return; }
  const data = {
    hirePlayerPhone: document.getElementById('setHirePlayerPhone').value.trim(),
    hirePlayerWhatsapp: document.getElementById('setHirePlayerWhatsapp').value.trim(),
    hirePlayerFacebook: document.getElementById('setHirePlayerFacebook').value.trim(),
    hireTeamPhone: document.getElementById('setHireTeamPhone').value.trim(),
    hireTeamWhatsapp: document.getElementById('setHireTeamWhatsapp').value.trim(),
    hireTeamFacebook: document.getElementById('setHireTeamFacebook').value.trim()
  };
  try {
    await setDoc(doc(db, 'meta', 'settings'), data, { merge: true });
    alert('হায়ার যোগাযোগ তথ্য সেভ হয়েছে।');
  } catch (e) { alert('সমস্যা হয়েছে: ' + e.message); }
}
async function adminSaveCreator() {
  if (!auth.currentUser || !isAdmin) { alert('Admin Login করুন, তারপর সেভ করুন।'); return; }
  const data = {
    creatorName: document.getElementById('setCreatorName').value.trim() || siteSettings.creatorName,
    creatorPhone: document.getElementById('setCreatorPhone').value.trim()
  };
  try {
    await setDoc(doc(db, 'meta', 'settings'), data, { merge: true });
    alert('ক্রিয়েটর তথ্য সেভ হয়েছে।');
  } catch (e) { alert('সমস্যা হয়েছে: ' + e.message); }
}

// ---- Admin: change password (real Firebase Auth password) ----
async function adminChangePassword() {
  const cur = document.getElementById('curPass').value;
  const n1 = document.getElementById('newPass').value;
  const n2 = document.getElementById('newPass2').value;
  const msg = document.getElementById('passMsg');
  msg.style.display = 'block';
  if (!n1 || n1.length < 6) { msg.style.color = '#a32d2d'; msg.textContent = 'নতুন পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।'; return; }
  if (n1 !== n2) { msg.style.color = '#a32d2d'; msg.textContent = 'নতুন পাসওয়ার্ড দুইবার মেলেনি।'; return; }
  try {
    const cred = EmailAuthProvider.credential(ADMIN_EMAIL, cur);
    await reauthenticateWithCredential(auth.currentUser, cred);
    await updatePassword(auth.currentUser, n1);
    msg.style.color = '#0f6e3a'; msg.textContent = 'পাসওয়ার্ড পরিবর্তন হয়েছে।';
    ['curPass','newPass','newPass2'].forEach(id => document.getElementById(id).value = '');
  } catch (e) {
    msg.style.color = '#a32d2d';
    msg.textContent = e.code === 'auth/invalid-credential' ? 'বর্তমান পাসওয়ার্ড ভুল।' : ('সমস্যা হয়েছে: ' + e.message);
  }
}

// ---- Live sync: public collections/docs (readable by everyone) ----
onSnapshot(collection(db, 'players'), snap => {
  players = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderPlayers(currentFilter);
  renderAdminPlayerList();
}, err => console.error('Players sync error:', err));
onSnapshot(collection(db, 'committee'), snap => {
  committee = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderCommittee();
  renderAdminCommitteeList();
}, err => console.error('Committee sync error:', err));
onSnapshot(collection(db, 'coaches'), snap => {
  coaches = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderCoaches();
  renderAdminCoachList();
}, err => console.error('Coach sync error:', err));
onSnapshot(collection(db, 'results'), snap => {
  results = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderResults();
}, err => console.error('Results sync error:', err));
onSnapshot(collection(db, 'pastLeagues'), snap => {
  pastLeagues = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderPastLeagues();
}, err => console.error('Past league sync error:', err));
onSnapshot(collection(db, 'gallery'), snap => {
  gallery = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  renderGallery();
  renderAdminGalleryList();
}, err => console.error('Gallery sync error:', err));
onSnapshot(doc(db, 'meta', 'match'), snap => {
  if (snap.exists()) matchInfo = snap.data();
  renderMatch();
}, err => console.error('Match sync error:', err));
onSnapshot(doc(db, 'meta', 'settings'), snap => {
  if (snap.exists()) siteSettings = { ...siteSettings, ...snap.data() };
  renderLogo(); renderContact(); renderCreatorLine(); renderNotice(); renderHireInfo(); renderMatch();
}, err => console.error('Settings sync error:', err));

// Initial seed is intentionally disabled in production. Create default data from the admin panel.

// Expose functions used via inline onclick= attributes in the HTML
Object.assign(window, {
  toggleSidebar, showView, filterPlayers, openModal, closeModal, closeModalBg, showSocial, toggleHireInfo,
  previewPhoto, submitRegistration, approvePending, rejectPending, updateFormDownloadButton, downloadFilledForm, downloadAdminForm,
  adminLogin, adminLogout, adminTab, adminAddPlayer, editPlayer, cancelPlayerEdit, deletePlayer,
  adminUpdateMatch, adminSaveCommittee, editCommittee, cancelCommitteeEdit, deleteCommittee,
  adminSaveCoach, editCoach, cancelCoachEdit, deleteCoach,
  adminSaveGallery, deleteGalleryPhoto,
  adminSaveNotice, adminSaveLogo, adminSaveContact, adminSaveHireInfo, adminSaveCreator, adminChangePassword
});

// HTML uses inline onclick/onchange attributes, while this script is a module.
// Expose the handlers explicitly so those buttons can call them.
Object.assign(window, {
  showView, toggleSidebar, closeModal, closeModalBg, showSocial,
  filterPlayers, previewPhoto, submitRegistration, updateFormDownloadButton, downloadFilledForm, downloadAdminForm,
  approvePending, rejectPending, adminLogin, adminLogout, adminTab,
  fillMatchForm, editPlayer, cancelPlayerEdit, deletePlayer, adminAddPlayer,
  adminUpdateMatch, renderAdminPlayerList,
  editCommittee, cancelCommitteeEdit, deleteCommittee, adminSaveCommittee,
  renderAdminCommitteeList, editCoach, cancelCoachEdit, deleteCoach,
  adminSaveCoach, renderAdminCoachList, fillSettingsForm,
  adminSaveGallery, deleteGalleryPhoto, renderAdminGalleryList,
  adminSaveNotice, adminSaveLogo, adminSaveContact, adminSaveHireInfo, adminSaveCreator, adminChangePassword
});

(function(){
 const body=document.body, btn=document.getElementById('themeToggle');
 const saved=localStorage.getItem('pfa-theme');
 function apply(mode){body.classList.toggle('dark-mode',mode==='dark');btn.textContent=mode==='dark'?'☀️ Light':'🌙 Dark';}
 const initial=saved || (window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
 apply(initial);
 btn.addEventListener('click',()=>{const next=body.classList.contains('dark-mode')?'light':'dark';localStorage.setItem('pfa-theme',next);apply(next);});
})();
