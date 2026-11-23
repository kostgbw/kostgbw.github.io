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
  remove
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

// Jam Live WIB di Header
function startLiveClock() {
  const label = document.getElementById("liveClockLabel");
  if (!label) return;
  const update = () => {
    const now = new Date();
    label.textContent = now.toLocaleTimeString("id-ID", { hour12: false }) + " WIB";
  };
  update();
  setInterval(update, 1000);
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

// Dialog Konfirmasi Hapus Data
const resetDialog = document.getElementById("resetConfirmDialog");
document.getElementById("btnOpenResetModal")?.addEventListener("click", () => {
  if (resetDialog && typeof resetDialog.showModal === "function") {
    resetDialog.showModal();
  }
});
document.getElementById("btnCancelReset")?.addEventListener("click", () => {
  resetDialog?.close();
});

document.getElementById("btnDeleteToday")?.addEventListener("click", async () => {
  if (!db) return;
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

document.getElementById("btnDeleteAll")?.addEventListener("click", async () => {
  if (!db) return;
  try {
    await remove(ref(db, "analytics"));
    resetDialog?.close();
  } catch (err) {
    alert("Gagal mereset semua data: " + err.message);
  }
});

function muatDataDashboard() {
  const analyticsRef = ref(db, "analytics");
  onValue(analyticsRef, (snapshot) => {
    const data = snapshot.val() || {};
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

    // 3. Rincian Klik Per Tombol (DIURUTKAN TERBARU DI ATAS) & Grafik Top 8
    const clickLogsArray = Object.values(buttonClickLogsTodayObj);
    renderButtonsAndChart(buttonClicks, buttonClicksDailyToday, clickLogsArray);

    // 4. Log Pengunjung Hari Ini (Terbaru di Atas)
    const visitLogsArray = Object.values(visitLogsTodayObj);
    renderVisitLogs(visitLogsArray);

    // 5. Jejak Aktivitas Per IP Pengunjung (Hari Ini)
    renderIpActivity(visitLogsArray, clickLogsArray);
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

function renderButtonsAndChart(buttonClicks, buttonClicksDailyToday, clickLogsArray) {
  const latestLogTsByBtn = {};
  clickLogsArray.forEach((log) => {
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
      group: info.group || "umum",
      lastClicked: info.last_clicked || "-",
      today: todayCount,
      total: totalCount,
      latestTs
    };
  });

  // Urutkan Rincian Klik Per Tombol: TERBARU DI ATAS
  const sortedNewestFirst = [...items].sort((a, b) => {
    if (b.latestTs !== a.latestTs) return b.latestTs - a.latestTs;
    return b.today - a.today;
  });

  const tbody = document.getElementById("topButtonsBody");
  if (tbody) {
    if (sortedNewestFirst.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted-custom py-4 small">Belum ada klik tombol tercatat.</td></tr>`;
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
        </tr>
      `).join("");
    }
  }

  // Grafik Top 8 berdasarkan klik terbanyak
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

function renderVisitLogs(visitLogsArray) {
  const badge = document.getElementById("logCountBadge");
  const tbody = document.getElementById("visitLogsBody");
  if (badge) badge.textContent = `${visitLogsArray.length} Log`;
  if (!tbody) return;

  if (visitLogsArray.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted-custom py-4 small">Belum ada pengunjung hari ini.</td></tr>`;
    return;
  }

  const sorted = [...visitLogsArray].sort((a, b) => parseTimestampMs(b) - parseTimestampMs(a));
  tbody.innerHTML = sorted.map((log) => `
    <tr>
      <td class="fw-medium">${escapeHTML(log.hari || "-")}, ${escapeHTML(log.tanggal || "-")}</td>
      <td class="tabular-nums fw-semibold text-blue-main">${escapeHTML(log.jam || "-")}</td>
      <td><code>${escapeHTML(log.ip || "-")}</code></td>
      <td><span class="badge-device">${escapeHTML(log.perangkat || "-")} • ${escapeHTML(log.browser || "-")}</span></td>
      <td class="small text-muted-custom text-truncate" style="max-width: 150px;">${escapeHTML(log.asal_link || "Langsung")}</td>
    </tr>
  `).join("");
}

function renderIpActivity(visitLogsArray, clickLogsArray) {
  const badge = document.getElementById("ipActivityCountBadge");
  const tbody = document.getElementById("ipActivityBody");
  if (!tbody) return;

  const ipMap = new Map();

  visitLogsArray.forEach((v) => {
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

  clickLogsArray.forEach((c) => {
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
    tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted-custom py-4 small">Belum ada jejak aktivitas hari ini.</td></tr>`;
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
          <span class="badge bg-light text-dark border fw-normal">
            <strong>${idx + 1}.</strong> ${escapeHTML(c.nama_tombol || c.tombol_id)}
            <span class="text-primary fw-semibold ms-1">(${escapeHTML(c.jam || "-")})</span>
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
      </tr>
    `;
  }).join("");
}
