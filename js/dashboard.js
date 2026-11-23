import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase,
  ref,
  onValue,
  remove,
  update
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const configWarning = document.getElementById("configWarning");
const loginSection = document.getElementById("loginSection");
const dashboardContent = document.getElementById("dashboardContent");
const btnLogout = document.getElementById("btnLogout");
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");

let app, auth, db;
let visitsChartInstance = null;
let buttonsChartInstance = null;
let latestSnapshotData = {};

function getTodayKeyWIB() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function escapeHTML(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseTimestampMs(item) {
  if (!item) return 0;
  if (item.timestamp) {
    const parsed = Date.parse(item.timestamp);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

function parseLastClickedText(str) {
  if (!str || typeof str !== "string") return 0;
  const bulanMap = {
    Januari: 0, Februari: 1, Maret: 2, April: 3, Mei: 4, Juni: 5,
    Juli: 6, Agustus: 7, September: 8, Oktober: 9, November: 10, Desember: 11
  };
  const match = str.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s*\((\d{2}):(\d{2}):(\d{2})/);
  if (!match) return 0;
  const [, d, bulanNama, y, hh, mm, ss] = match;
  const monthIdx = bulanMap[bulanNama];
  if (monthIdx === undefined) return 0;
  return new Date(Number(y), monthIdx, Number(d), Number(hh), Number(mm), Number(ss)).getTime();
}

function isEmptyOrMissing(val) {
  if (val === null || val === undefined) return true;
  const s = String(val).trim();
  return s === "" || s === "-" || s === "Tidak Terdeteksi" || s === "undefined" || s === "null";
}

// Jam Live WIB di Header
function startLiveClock() {
  const label = document.getElementById("liveClockLabel");
  if (!label) return;
  const updateClock = () => {
    const now = new Date();
    label.textContent = now.toLocaleTimeString("id-ID", { hour12: false }) + " WIB";
  };
  updateClock();
  setInterval(updateClock, 1000);
}
startLiveClock();

if (!firebaseConfig || !firebaseConfig.apiKey || firebaseConfig.apiKey.includes("ISI_")) {
  configWarning?.classList.remove("d-none");
} else {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getDatabase(app);

  onAuthStateChanged(auth, (user) => {
    if (user) {
      loginSection.classList.add("d-none");
      dashboardContent.classList.remove("d-none");
      btnLogout.classList.remove("d-none");
      muatDataDashboard();
    } else {
      loginSection.classList.remove("d-none");
      dashboardContent.classList.add("d-none");
      btnLogout.classList.add("d-none");
    }
  });

  loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.classList.add("d-none");
    const email = document.getElementById("adminEmail").value.trim();
    const password = document.getElementById("adminPassword").value;
    const btnSubmit = document.getElementById("btnLoginSubmit");

    btnSubmit.disabled = true;
    btnSubmit.textContent = "Memeriksa...";
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      loginError.textContent = "Login gagal: " + (err.message || "Periksa email & password.");
      loginError.classList.remove("d-none");
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = "Masuk ke Dashboard";
    }
  });

  btnLogout?.addEventListener("click", () => signOut(auth));
}

// Dialog Pembersihan Selektif
const resetDialog = document.getElementById("resetConfirmDialog");
const cleanStatusAlert = document.getElementById("cleanStatusAlert");

function showCleanStatus(msg) {
  if (!cleanStatusAlert) return;
  cleanStatusAlert.textContent = msg;
  cleanStatusAlert.classList.remove("d-none");
}

document.getElementById("btnOpenResetModal")?.addEventListener("click", () => {
  cleanStatusAlert?.classList.add("d-none");
  if (resetDialog && typeof resetDialog.showModal === "function") {
    resetDialog.showModal();
  }
});
document.getElementById("btnCancelReset")?.addEventListener("click", () => resetDialog?.close());
document.getElementById("btnCloseResetX")?.addEventListener("click", () => resetDialog?.close());

// 1. Hapus Kunjungan Tanpa Klik Tombol (Hari Ini)
document.getElementById("btnCleanNoClickVisits")?.addEventListener("click", async () => {
  if (!db) return;
  const todayKey = getTodayKeyWIB();
  const visitLogsObj = (latestSnapshotData.visit_logs && latestSnapshotData.visit_logs[todayKey]) || {};
  const clickLogsObj = (latestSnapshotData.button_click_logs && latestSnapshotData.button_click_logs[todayKey]) || {};

  const ipsWithClicks = new Set(
    Object.values(clickLogsObj)
      .map((c) => c && c.ip)
      .filter((ip) => !isEmptyOrMissing(ip))
  );

  const updates = {};
  let removedCount = 0;

  Object.entries(visitLogsObj).forEach(([pushId, log]) => {
    const ip = log && log.ip;
    if (!ipsWithClicks.has(ip)) {
      updates[`analytics/visit_logs/${todayKey}/${pushId}`] = null;
      removedCount++;
    }
  });

  const remainingVisits = Object.keys(visitLogsObj).length - removedCount;
  updates[`analytics/daily_visits/${todayKey}`] = remainingVisits > 0 ? remainingVisits : null;

  await update(ref(db), updates);
  showCleanStatus(`Selesai: ${removedCount} log kunjungan tanpa klik tombol berhasil dihapus.`);
});

// 2. Hapus Data Kosong / Jam Tidak Tercatat / IP Tidak Terdeteksi
document.getElementById("btnCleanIncompleteData")?.addEventListener("click", async () => {
  if (!db) return;
  const todayKey = getTodayKeyWIB();
  const updates = {};
  let removedCount = 0;

  // Cek visit_logs hari ini
  const visitLogsObj = (latestSnapshotData.visit_logs && latestSnapshotData.visit_logs[todayKey]) || {};
  let removedVisits = 0;
  Object.entries(visitLogsObj).forEach(([pushId, log]) => {
    if (!log || isEmptyOrMissing(log.ip) || isEmptyOrMissing(log.jam) || isEmptyOrMissing(log.tanggal)) {
      updates[`analytics/visit_logs/${todayKey}/${pushId}`] = null;
      removedVisits++;
      removedCount++;
    }
  });
  if (removedVisits > 0) {
    const sisa = Math.max(0, Object.keys(visitLogsObj).length - removedVisits);
    updates[`analytics/daily_visits/${todayKey}`] = sisa > 0 ? sisa : null;
  }

  // Cek button_click_logs hari ini
  const clickLogsObj = (latestSnapshotData.button_click_logs && latestSnapshotData.button_click_logs[todayKey]) || {};
  const decrementBtnToday = {};
  const decrementBtnTotal = {};

  Object.entries(clickLogsObj).forEach(([pushId, log]) => {
    if (!log || isEmptyOrMissing(log.ip) || isEmptyOrMissing(log.jam) || isEmptyOrMissing(log.tombol_id)) {
      updates[`analytics/button_click_logs/${todayKey}/${pushId}`] = null;
      removedCount++;
      if (log && log.tombol_id) {
        decrementBtnToday[log.tombol_id] = (decrementBtnToday[log.tombol_id] || 0) + 1;
        decrementBtnTotal[log.tombol_id] = (decrementBtnTotal[log.tombol_id] || 0) + 1;
      }
    }
  });

  // Cek button_clicks yang totalnya 0 / kosong / tanpa label valid
  const buttonClicksObj = latestSnapshotData.button_clicks || {};
  const buttonClicksDailyToday = (latestSnapshotData.button_clicks_daily && latestSnapshotData.button_clicks_daily[todayKey]) || {};

  Object.entries(buttonClicksObj).forEach(([btnId, info]) => {
    const totalNum = Number((info && info.total) || 0) - (decrementBtnTotal[btnId] || 0);
    const todayNum = Number(buttonClicksDailyToday[btnId] || 0) - (decrementBtnToday[btnId] || 0);

    if (!info || totalNum <= 0 || isEmptyOrMissing(info.label)) {
      updates[`analytics/button_clicks/${btnId}`] = null;
      updates[`analytics/button_clicks_daily/${todayKey}/${btnId}`] = null;
      removedCount++;
    } else {
      if (decrementBtnTotal[btnId]) {
        updates[`analytics/button_clicks/${btnId}/total`] = totalNum;
      }
      if (decrementBtnToday[btnId]) {
        updates[`analytics/button_clicks_daily/${todayKey}/${btnId}`] = todayNum > 0 ? todayNum : null;
      }
    }
  });

  await update(ref(db), updates);
  showCleanStatus(`Selesai: ${removedCount} entri data kosong / jam tidak tercatat berhasil dibersihkan.`);
});

// 3. Hapus Klik Tanpa Log Kunjungan IP (Hari Ini)
document.getElementById("btnCleanOrphanClicks")?.addEventListener("click", async () => {
  if (!db) return;
  const todayKey = getTodayKeyWIB();
  const visitLogsObj = (latestSnapshotData.visit_logs && latestSnapshotData.visit_logs[todayKey]) || {};
  const clickLogsObj = (latestSnapshotData.button_click_logs && latestSnapshotData.button_click_logs[todayKey]) || {};
  const buttonClicksObj = latestSnapshotData.button_clicks || {};
  const buttonClicksDailyToday = (latestSnapshotData.button_clicks_daily && latestSnapshotData.button_clicks_daily[todayKey]) || {};

  const validVisitIPs = new Set(
    Object.values(visitLogsObj)
      .map((v) => v && v.ip)
      .filter((ip) => !isEmptyOrMissing(ip))
  );

  const updates = {};
  const decByBtn = {};
  let removedCount = 0;

  Object.entries(clickLogsObj).forEach(([pushId, log]) => {
    const ip = log && log.ip;
    if (!validVisitIPs.has(ip)) {
      updates[`analytics/button_click_logs/${todayKey}/${pushId}`] = null;
      removedCount++;
      if (log && log.tombol_id) {
        decByBtn[log.tombol_id] = (decByBtn[log.tombol_id] || 0) + 1;
      }
    }
  });

  Object.entries(decByBtn).forEach(([btnId, dec]) => {
    const curToday = Number(buttonClicksDailyToday[btnId] || 0);
    const curTotal = Number((buttonClicksObj[btnId] && buttonClicksObj[btnId].total) || 0);
    const nextToday = Math.max(0, curToday - dec);
    const nextTotal = Math.max(0, curTotal - dec);

    updates[`analytics/button_clicks_daily/${todayKey}/${btnId}`] = nextToday > 0 ? nextToday : null;
    if (nextTotal <= 0) {
      updates[`analytics/button_clicks/${btnId}`] = null;
    } else {
      updates[`analytics/button_clicks/${btnId}/total`] = nextTotal;
    }
  });

  await update(ref(db), updates);
  showCleanStatus(`Selesai: ${removedCount} log klik tanpa kunjungan IP berhasil dihapus.`);
});

// 4. Hapus Semua Data Hari Ini Saja
document.getElementById("btnDeleteToday")?.addEventListener("click", async () => {
  if (!db) return;
  if (!confirm("Yakin hapus SEMUA log & statistik untuk tanggal hari ini saja?")) return;
  const todayKey = getTodayKeyWIB();
  try {
    await Promise.all([
      remove(ref(db, `analytics/daily_visits/${todayKey}`)),
      remove(ref(db, `analytics/visit_logs/${todayKey}`)),
      remove(ref(db, `analytics/button_clicks_daily/${todayKey}`)),
      remove(ref(db, `analytics/button_click_logs/${todayKey}`))
    ]);
    resetDialog?.close();
  } catch (err) {
    alert("Gagal menghapus data hari ini: " + err.message);
  }
});

// 5. Reset Total Semua Data
document.getElementById("btnDeleteAll")?.addEventListener("click", async () => {
  if (!db) return;
  if (!confirm("PERINGATAN: Semua data statistik dari awal akan dihapus permanen. Lanjutkan?")) return;
  try {
    await remove(ref(db, "analytics"));
    resetDialog?.close();
  } catch (err) {
    alert("Gagal mereset semua data: " + err.message);
  }
});

// Handler Klik Tombol Hapus Per Baris (Delegasi Event)
document.addEventListener("click", async (e) => {
  if (!db) return;
  const todayKey = getTodayKeyWIB();

  // A. Hapus 1 Baris Log Pengunjung
  const btnDelVisit = e.target.closest("[data-del-visit-id]");
  if (btnDelVisit) {
    const pushId = btnDelVisit.getAttribute("data-del-visit-id");
    const visitLogsObj = (latestSnapshotData.visit_logs && latestSnapshotData.visit_logs[todayKey]) || {};
    const sisa = Math.max(0, Object.keys(visitLogsObj).length - 1);
    const updates = {
      [`analytics/visit_logs/${todayKey}/${pushId}`]: null,
      [`analytics/daily_visits/${todayKey}`]: sisa > 0 ? sisa : null
    };
    await update(ref(db), updates);
    return;
  }

  // B. Hapus 1 Item Klik Tombol di Jejak Aktivitas IP
  const btnDelClick = e.target.closest("[data-del-click-id]");
  if (btnDelClick) {
    const pushId = btnDelClick.getAttribute("data-del-click-id");
    const btnId = btnDelClick.getAttribute("data-btn-id");
    const updates = {
      [`analytics/button_click_logs/${todayKey}/${pushId}`]: null
    };
    if (btnId) {
      const curToday = Number((latestSnapshotData.button_clicks_daily?.[todayKey]?.[btnId]) || 0);
      const curTotal = Number((latestSnapshotData.button_clicks?.[btnId]?.total) || 0);
      const nextToday = Math.max(0, curToday - 1);
      const nextTotal = Math.max(0, curTotal - 1);
      updates[`analytics/button_clicks_daily/${todayKey}/${btnId}`] = nextToday > 0 ? nextToday : null;
      if (nextTotal <= 0) {
        updates[`analytics/button_clicks/${btnId}`] = null;
      } else {
        updates[`analytics/button_clicks/${btnId}/total`] = nextTotal;
      }
    }
    await update(ref(db), updates);
    return;
  }

  // C. Hapus 1 Baris Tombol di Rincian Klik Per Tombol
  const btnDelBtnStat = e.target.closest("[data-del-btn-stat]");
  if (btnDelBtnStat) {
    const btnId = btnDelBtnStat.getAttribute("data-del-btn-stat");
    const clickLogsObj = (latestSnapshotData.button_click_logs && latestSnapshotData.button_click_logs[todayKey]) || {};
    const updates = {
      [`analytics/button_clicks/${btnId}`]: null,
      [`analytics/button_clicks_daily/${todayKey}/${btnId}`]: null
    };
    Object.entries(clickLogsObj).forEach(([pushId, log]) => {
      if (log && log.tombol_id === btnId) {
        updates[`analytics/button_click_logs/${todayKey}/${pushId}`] = null;
      }
    });
    await update(ref(db), updates);
    return;
  }

  // D. Hapus Seluruh Jejak 1 IP Tertentu (Hari Ini)
  const btnDelIp = e.target.closest("[data-del-ip]");
  if (btnDelIp) {
    const targetIp = btnDelIp.getAttribute("data-del-ip");
    const visitLogsObj = (latestSnapshotData.visit_logs && latestSnapshotData.visit_logs[todayKey]) || {};
    const clickLogsObj = (latestSnapshotData.button_click_logs && latestSnapshotData.button_click_logs[todayKey]) || {};
    const updates = {};
    let removedVisits = 0;
    const decByBtn = {};

    Object.entries(visitLogsObj).forEach(([pushId, log]) => {
      if ((log?.ip || "Tidak Terdeteksi") === targetIp) {
        updates[`analytics/visit_logs/${todayKey}/${pushId}`] = null;
        removedVisits++;
      }
    });

    Object.entries(clickLogsObj).forEach(([pushId, log]) => {
      if ((log?.ip || "Tidak Terdeteksi") === targetIp) {
        updates[`analytics/button_click_logs/${todayKey}/${pushId}`] = null;
        if (log?.tombol_id) {
          decByBtn[log.tombol_id] = (decByBtn[log.tombol_id] || 0) + 1;
        }
      }
    });

    if (removedVisits > 0) {
      const sisaVisits = Math.max(0, Object.keys(visitLogsObj).length - removedVisits);
      updates[`analytics/daily_visits/${todayKey}`] = sisaVisits > 0 ? sisaVisits : null;
    }

    Object.entries(decByBtn).forEach(([btnId, dec]) => {
      const curToday = Number((latestSnapshotData.button_clicks_daily?.[todayKey]?.[btnId]) || 0);
      const curTotal = Number((latestSnapshotData.button_clicks?.[btnId]?.total) || 0);
      const nextToday = Math.max(0, curToday - dec);
      const nextTotal = Math.max(0, curTotal - dec);
      updates[`analytics/button_clicks_daily/${todayKey}/${btnId}`] = nextToday > 0 ? nextToday : null;
      if (nextTotal <= 0) {
        updates[`analytics/button_clicks/${btnId}`] = null;
      } else {
        updates[`analytics/button_clicks/${btnId}/total`] = nextTotal;
      }
    });

    await update(ref(db), updates);
  }
});

function muatDataDashboard() {
  const analyticsRef = ref(db, "analytics");
  onValue(analyticsRef, (snapshot) => {
    const data = snapshot.val() || {};
    latestSnapshotData = data;
    const todayKey = getTodayKeyWIB();

    const dailyVisits = data.daily_visits || {};
    const visitLogsTodayObj = (data.visit_logs && data.visit_logs[todayKey]) || {};
    const buttonClicks = data.button_clicks || {};
    const buttonClicksDailyToday = (data.button_clicks_daily && data.button_clicks_daily[todayKey]) || {};
    const buttonClickLogsTodayObj = (data.button_click_logs && data.button_click_logs[todayKey]) || {};

    // 1. Kartu Ringkasan
    const statToday = Number(dailyVisits[todayKey] || 0);
    const statTotal = Object.values(dailyVisits).reduce((sum, v) => sum + Number(v || 0), 0);
    const statTotalClicks = Object.values(buttonClicksDailyToday).reduce((sum, v) => sum + Number(v || 0), 0);

    document.getElementById("statToday").textContent = statToday.toLocaleString("id-ID");
    document.getElementById("statTotal").textContent = statTotal.toLocaleString("id-ID");
    document.getElementById("statTotalClicks").textContent = statTotalClicks.toLocaleString("id-ID");

    // 2. Grafik 14 Hari Terakhir
    renderVisitsChart(dailyVisits);

    // 3. Rincian Klik Per Tombol (Terbaru di Atas) & Grafik Top 8
    const clickLogsWithId = Object.entries(buttonClickLogsTodayObj).map(([pushId, val]) => ({
      pushId,
      ...(val || {})
    }));
    renderButtonsAndChart(buttonClicks, buttonClicksDailyToday, clickLogsWithId);

    // 4. Log Pengunjung Hari Ini (Terbaru di Atas)
    const visitLogsWithId = Object.entries(visitLogsTodayObj).map(([pushId, val]) => ({
      pushId,
      ...(val || {})
    }));
    renderVisitLogs(visitLogsWithId);

    // 5. Jejak Aktivitas Per IP Pengunjung (Hari Ini)
    renderIpActivity(visitLogsWithId, clickLogsWithId);
  });
}

function renderVisitsChart(dailyVisits) {
  const labels = [];
  const values = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    labels.push(d.toLocaleDateString("id-ID", { day: "2-digit", month: "short" }));
    values.push(Number(dailyVisits[key] || 0));
  }

  const ctx = document.getElementById("visitsChart");
  if (!ctx) return;
  if (visitsChartInstance) visitsChartInstance.destroy();

  visitsChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Kunjungan",
        data: values,
        borderColor: "#5F85DB",
        backgroundColor: "rgba(95, 133, 219, 0.14)",
        fill: true,
        tension: 0.35,
        borderWidth: 2.5,
        pointRadius: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
    }
  });
}

function renderButtonsAndChart(buttonClicks, buttonClicksDailyToday, clickLogsWithId) {
  const latestLogTsByBtn = {};
  clickLogsWithId.forEach((log) => {
    if (!log || !log.tombol_id) return;
    const ts = parseTimestampMs(log);
    if (ts > (latestLogTsByBtn[log.tombol_id] || 0)) {
      latestLogTsByBtn[log.tombol_id] = ts;
    }
  });

  const allBtnIds = new Set([
    ...Object.keys(buttonClicks),
    ...Object.keys(buttonClicksDailyToday)
  ]);

  const items = Array.from(allBtnIds).map((id) => {
    const info = buttonClicks[id] || {};
    const todayCount = Number(buttonClicksDailyToday[id] || 0);
    const totalCount = Number(info.total || todayCount);
    const latestTs = Math.max(
      latestLogTsByBtn[id] || 0,
      parseLastClickedText(info.last_clicked)
    );

    return {
      id,
      label: info.label || id,
      lastClicked: info.last_clicked || "-",
      today: todayCount,
      total: totalCount,
      latestTs
    };
  });

  const sortedNewestFirst = [...items].sort((a, b) => {
    if (b.latestTs !== a.latestTs) return b.latestTs - a.latestTs;
    return b.today - a.today;
  });

  const tbody = document.getElementById("topButtonsBody");
  if (tbody) {
    if (sortedNewestFirst.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted-custom py-4 small">Belum ada klik tombol tercatat.</td></tr>`;
    } else {
      tbody.innerHTML = sortedNewestFirst.map((btn, idx) => `
        <tr>
          <td><span class="rank-badge ${idx === 0 ? "top-1" : ""}">${idx + 1}</span></td>
          <td>
            <div class="fw-semibold small">${escapeHTML(btn.label)}</div>
            <div class="text-muted" style="font-size: 0.72rem;">Terakhir: ${escapeHTML(btn.lastClicked)}</div>
          </td>
          <td class="text-end fw-bold tabular-nums">${btn.today}</td>
          <td class="text-end text-muted-custom tabular-nums">${btn.total}</td>
          <td class="text-end">
            <button type="button" class="btn btn-outline-danger btn-row-del" data-del-btn-stat="${escapeHTML(btn.id)}" title="Hapus statistik tombol ini">
              <i class="bi bi-trash3"></i>
            </button>
          </td>
        </tr>
      `).join("");
    }
  }

  const top8 = [...items].sort((a, b) => b.total - a.total).slice(0, 8);
  const ctx = document.getElementById("buttonsChart");
  if (!ctx) return;
  if (buttonsChartInstance) buttonsChartInstance.destroy();

  buttonsChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: top8.map((b) => b.label.length > 22 ? b.label.slice(0, 22) + "…" : b.label),
      datasets: [{
        label: "Total Klik",
        data: top8.map((b) => b.total),
        backgroundColor: "#5F85DB",
        borderRadius: 6
      }]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, ticks: { precision: 0 } } }
    }
  });
}

function renderVisitLogs(visitLogsWithId) {
  const badge = document.getElementById("logCountBadge");
  const tbody = document.getElementById("visitLogsBody");
  if (badge) badge.textContent = `${visitLogsWithId.length} Log`;
  if (!tbody) return;

  if (visitLogsWithId.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted-custom py-4 small">Belum ada pengunjung hari ini.</td></tr>`;
    return;
  }

  const sorted = [...visitLogsWithId].sort((a, b) => parseTimestampMs(b) - parseTimestampMs(a));
  tbody.innerHTML = sorted.map((log) => `
    <tr>
      <td class="fw-medium">${escapeHTML(log.hari || "-")}, ${escapeHTML(log.tanggal || "-")}</td>
      <td class="tabular-nums fw-semibold text-blue-main">${escapeHTML(log.jam || "-")}</td>
      <td><code>${escapeHTML(log.ip || "-")}</code></td>
      <td><span class="badge-device">${escapeHTML(log.perangkat || "-")} • ${escapeHTML(log.browser || "-")}</span></td>
      <td class="small text-muted-custom text-truncate" style="max-width: 140px;">${escapeHTML(log.asal_link || "Langsung")}</td>
      <td class="text-end">
        <button type="button" class="btn btn-outline-danger btn-row-del" data-del-visit-id="${escapeHTML(log.pushId)}" title="Hapus baris log ini">
          <i class="bi bi-trash3"></i>
        </button>
      </td>
    </tr>
  `).join("");
}

function renderIpActivity(visitLogsWithId, clickLogsWithId) {
  const badge = document.getElementById("ipActivityCountBadge");
  const tbody = document.getElementById("ipActivityBody");
  if (!tbody) return;

  const ipMap = new Map();

  visitLogsWithId.forEach((v) => {
    const ip = v.ip || "Tidak Terdeteksi";
    if (!ipMap.has(ip)) {
      ipMap.set(ip, {
        ip,
        perangkat: v.perangkat || "-",
        browser: v.browser || "-",
        firstVisitTs: parseTimestampMs(v),
        firstVisitJam: v.jam || "",
        lastActivityTs: parseTimestampMs(v),
        lastActivityJam: v.jam || "",
        clicks: []
      });
    } else {
      const entry = ipMap.get(ip);
      const ts = parseTimestampMs(v);
      if (ts && (!entry.firstVisitTs || ts < entry.firstVisitTs)) {
        entry.firstVisitTs = ts;
        entry.firstVisitJam = v.jam || entry.firstVisitJam;
      }
      if (ts > entry.lastActivityTs) {
        entry.lastActivityTs = ts;
        entry.lastActivityJam = v.jam || entry.lastActivityJam;
      }
    }
  });

  clickLogsWithId.forEach((c) => {
    const ip = c.ip || "Tidak Terdeteksi";
    const ts = parseTimestampMs(c);
    if (!ipMap.has(ip)) {
      ipMap.set(ip, {
        ip,
        perangkat: c.perangkat || "-",
        browser: c.browser || "-",
        firstVisitTs: ts,
        firstVisitJam: c.jam || "",
        lastActivityTs: ts,
        lastActivityJam: c.jam || "",
        clicks: []
      });
    }
    const entry = ipMap.get(ip);
    if (entry.perangkat === "-" && c.perangkat) entry.perangkat = c.perangkat;
    if (entry.browser === "-" && c.browser) entry.browser = c.browser;
    if (!entry.firstVisitJam && c.jam) {
      entry.firstVisitJam = c.jam;
      entry.firstVisitTs = ts;
    }
    if (ts > entry.lastActivityTs) {
      entry.lastActivityTs = ts;
      entry.lastActivityJam = c.jam || entry.lastActivityJam;
    }
    entry.clicks.push(c);
  });

  const rows = Array.from(ipMap.values()).sort((a, b) => b.lastActivityTs - a.lastActivityTs);
  if (badge) badge.textContent = `${rows.length} IP`;

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted-custom py-4 small">Belum ada jejak aktivitas hari ini.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((row) => {
    row.clicks.sort((a, b) => parseTimestampMs(a) - parseTimestampMs(b));

    const jamMasuk = row.firstVisitJam || (row.clicks[0]?.jam) || "-";
    const jamTerakhir = row.lastActivityJam || (row.clicks[row.clicks.length - 1]?.jam) || jamMasuk;
    const rentangJam = (jamMasuk !== "-" && jamTerakhir !== "-" && jamMasuk !== jamTerakhir)
      ? `${jamMasuk} – ${jamTerakhir}`
      : jamMasuk;

    const clicksHtml = row.clicks.length === 0
      ? `<span class="text-muted-custom small">Hanya melihat halaman (belum klik tombol)</span>`
      : `<div class="d-flex flex-wrap gap-1">` + row.clicks.map((c, idx) => `
          <span class="badge bg-light text-dark border fw-normal d-inline-flex align-items-center gap-1">
            <span><strong>${idx + 1}.</strong> ${escapeHTML(c.nama_tombol || c.tombol_id)} <span class="text-primary fw-semibold">(${escapeHTML(c.jam || "-")})</span></span>
            <button type="button" class="btn-close" style="font-size: 0.55rem;" data-del-click-id="${escapeHTML(c.pushId)}" data-btn-id="${escapeHTML(c.tombol_id || "")}" title="Hapus klik ini"></button>
          </span>
        `).join("") + `</div>`;

    return `
      <tr>
        <td>
          <div class="fw-bold font-monospace small">${escapeHTML(row.ip)}</div>
          <div class="small text-muted-custom">${escapeHTML(row.perangkat)} • ${escapeHTML(row.browser)}</div>
        </td>
        <td class="tabular-nums fw-semibold text-blue-main small">${escapeHTML(rentangJam)}</td>
        <td>${clicksHtml}</td>
        <td class="text-end">
          <button type="button" class="btn btn-outline-danger btn-row-del" data-del-ip="${escapeHTML(row.ip)}" title="Hapus seluruh aktivitas IP ini">
            <i class="bi bi-trash3"></i>
          </button>
        </td>
      </tr>
    `;
  }).join("");
}
