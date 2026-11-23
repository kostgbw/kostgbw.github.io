import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const isConfigured = firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("GANTI_");

const configWarning = document.getElementById("configWarning");
const loginSection = document.getElementById("loginSection");
const dashboardContent = document.getElementById("dashboardContent");
const btnLogout = document.getElementById("btnLogout");
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");

let visitsChartInstance = null;
let buttonsChartInstance = null;

function formatDateKey(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getLast14Days() {
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = formatDateKey(d);
    const label = d.toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
    days.push({ key, label });
  }
  return days;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function startLiveClock() {
  const el = document.getElementById("liveClockLabel");
  if (!el) return;
  const update = () => {
    const now = new Date();
    const hariTgl = now.toLocaleDateString("id-ID", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric"
    });
    const jamDetik = now.toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).replace(/\./g, ":");
    el.textContent = `${hariTgl} • ${jamDetik} WIB`;
  };
  update();
  setInterval(update, 1000);
}

function renderVisitsChart(dailyData) {
  const canvas = document.getElementById("visitsChart");
  if (!canvas || typeof Chart === "undefined") return;

  const days = getLast14Days();
  const labels = days.map((d) => d.label);
  const values = days.map((d) => (dailyData && typeof dailyData[d.key] === "number" ? dailyData[d.key] : 0));

  if (visitsChartInstance) {
    visitsChartInstance.data.labels = labels;
    visitsChartInstance.data.datasets[0].data = values;
    visitsChartInstance.update();
    return;
  }

  visitsChartInstance = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Kunjungan",
          data: values,
          backgroundColor: "#5F85DB",
          hoverBackgroundColor: "#4A6FC4",
          borderRadius: 6,
          maxBarThickness: 26
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: "#525866", font: { family: "Plus Jakarta Sans", size: 11 } }
        },
        y: {
          beginAtZero: true,
          ticks: { precision: 0, color: "#525866", font: { family: "Plus Jakarta Sans", size: 11 } },
          grid: { color: "#E2E8F4" }
        }
      }
    }
  });
}

function renderButtonsChart(sortedItems) {
  const canvas = document.getElementById("buttonsChart");
  if (!canvas || typeof Chart === "undefined") return;

  const top8 = sortedItems.slice(0, 8);
  const labels = top8.map((item) => item.label.length > 26 ? item.label.slice(0, 26) + "…" : item.label);
  const totalValues = top8.map((item) => item.total);
  const todayValues = top8.map((item) => item.today);

  if (buttonsChartInstance) {
    buttonsChartInstance.data.labels = labels;
    buttonsChartInstance.data.datasets[0].data = totalValues;
    buttonsChartInstance.data.datasets[1].data = todayValues;
    buttonsChartInstance.update();
    return;
  }

  buttonsChartInstance = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Total Klik",
          data: totalValues,
          backgroundColor: "#5F85DB",
          borderRadius: 5,
          maxBarThickness: 18
        },
        {
          label: "Hari Ini",
          data: todayValues,
          backgroundColor: "#90B8F8",
          borderRadius: 5,
          maxBarThickness: 18
        }
      ]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: { boxWidth: 12, font: { family: "Plus Jakarta Sans", size: 11 } }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { precision: 0, color: "#525866", font: { family: "Plus Jakarta Sans", size: 11 } },
          grid: { color: "#E2E8F4" }
        },
        y: {
          grid: { display: false },
          ticks: { color: "#182238", font: { family: "Plus Jakarta Sans", size: 11, weight: "600" } }
        }
      }
    }
  });
}

function renderTopButtons(buttonsObj, dailyClicksObj) {
  const tbody = document.getElementById("topButtonsBody");
  const statTotalClicks = document.getElementById("statTotalClicks");
  if (!tbody) return;

  const todayClicksTotal = dailyClicksObj
    ? Object.values(dailyClicksObj).reduce((sum, val) => sum + (typeof val === "number" ? val : 0), 0)
    : 0;
  statTotalClicks.textContent = todayClicksTotal.toLocaleString("id-ID");

  if (!buttonsObj) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted-custom py-4 small">Belum ada data klik tercatat.</td></tr>`;
    renderButtonsChart([]);
    return;
  }

  const items = Object.entries(buttonsObj)
    .map(([id, val]) => {
      const totalAll = typeof val.total === "number" ? val.total : (typeof val.count === "number" ? val.count : 0);
      const todayBtn = dailyClicksObj && typeof dailyClicksObj[id] === "number" ? dailyClicksObj[id] : 0;
      return {
        id,
        label: val.label || id,
        group: val.group || "Umum",
        lastClicked: val.last_clicked || "Belum ada waktu",
        total: totalAll,
        today: todayBtn
      };
    })
    .sort((a, b) => b.total - a.total);

  renderButtonsChart(items);

  tbody.innerHTML = items
    .map((item, idx) => {
      const rankClass = idx === 0 ? "rank-badge top-1" : "rank-badge";
      return `
        <tr class="border-bottom">
          <td><span class="${rankClass}">${idx + 1}</span></td>
          <td>
            <div class="d-flex flex-wrap align-items-center gap-1">
              <span class="badge-device">${escapeHtml(item.group)}</span>
              <span class="fw-medium small">${escapeHtml(item.label)}</span>
            </div>
            <div class="text-muted-custom mt-1" style="font-size: 0.72rem;">
              <i class="bi bi-clock me-1"></i>${escapeHtml(item.lastClicked)}
            </div>
          </td>
          <td class="text-end tabular-nums small text-blue-main fw-semibold">${item.today.toLocaleString("id-ID")}</td>
          <td class="text-end fw-bold tabular-nums small">${item.total.toLocaleString("id-ID")}</td>
        </tr>
      `;
    })
    .join("");
}

function renderVisitLogs(todayLogsObj) {
  const tbody = document.getElementById("visitLogsBody");
  const badge = document.getElementById("logCountBadge");
  if (!tbody) return;

  if (!todayLogsObj || typeof todayLogsObj !== "object") {
    if (badge) badge.textContent = "0 Log";
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted-custom py-4 small">Belum ada log pengunjung hari ini.</td></tr>`;
    return;
  }

  const logs = Object.values(todayLogsObj).reverse();
  if (badge) badge.textContent = `${logs.length} Log`;

  tbody.innerHTML = logs
    .map((log) => {
      const hari = escapeHtml(log.hari || "-");
      const tanggal = escapeHtml(log.tanggal || "-");
      const jam = escapeHtml(log.jam || "-");
      const ip = escapeHtml(log.ip || "Tidak diketahui");
      const perangkat = escapeHtml(log.perangkat || "-");
      const browser = escapeHtml(log.browser || "");
      const asal = escapeHtml(log.asal_link || "Langsung");

      return `
        <tr>
          <td class="text-nowrap">
            <span class="fw-semibold">${hari}</span>, ${tanggal}
          </td>
          <td class="text-nowrap tabular-nums fw-bold text-blue-main">${jam}</td>
          <td class="text-nowrap tabular-nums"><code>${ip}</code></td>
          <td class="text-nowrap">
            <span class="badge-device">${perangkat}</span>
            <span class="text-muted-custom ms-1 small">${browser}</span>
          </td>
          <td class="small text-muted-custom text-truncate" style="max-width: 150px;" title="${asal}">${asal}</td>
        </tr>
      `;
    })
    .join("");
}

// Gabungkan kunjungan & klik tombol dengan kunci gabungan: IP + Perangkat + Browser
function renderIpActivity(todayLogsObj, todayClickLogsObj) {
  const tbody = document.getElementById("ipActivityBody");
  const badge = document.getElementById("ipActivityCountBadge");
  if (!tbody) return;

  const sessionMap = {};

  // 1. Kumpulkan data kunjungan per (IP + Perangkat + Browser)
  if (todayLogsObj && typeof todayLogsObj === "object") {
    Object.values(todayLogsObj).forEach((log) => {
      const ip = log.ip || "Tidak diketahui";
      const perangkat = log.perangkat || "Perangkat Tidak Diketahui";
      const browser = log.browser || "";
      const key = `${ip}__${perangkat}__${browser}`;

      if (!sessionMap[key]) {
        sessionMap[key] = {
          ip,
          perangkat,
          browser,
          visits: [],
          clicks: []
        };
      }
      if (log.jam && !sessionMap[key].visits.includes(log.jam)) {
        sessionMap[key].visits.push(log.jam);
      }
    });
  }

  // 2. Kumpulkan data klik tombol per (IP + Perangkat + Browser)
  if (todayClickLogsObj && typeof todayClickLogsObj === "object") {
    Object.values(todayClickLogsObj).forEach((clk) => {
      const ip = clk.ip || "Tidak diketahui";
      const perangkat = clk.perangkat || "Perangkat Tidak Diketahui";
      const browser = clk.browser || "";
      let key = `${ip}__${perangkat}__${browser}`;

      // Fallback untuk data lama yang belum menyimpan field perangkat pada click_logs
      if (!sessionMap[key] && !clk.perangkat) {
        const existingKey = Object.keys(sessionMap).find((k) => k.startsWith(`${ip}__`));
        if (existingKey) key = existingKey;
      }

      if (!sessionMap[key]) {
        sessionMap[key] = {
          ip,
          perangkat,
          browser,
          visits: [],
          clicks: []
        };
      }

      sessionMap[key].clicks.push({
        jam: clk.jam || "-",
        grup: clk.grup || "Umum",
        nama: clk.nama_tombol || clk.tombol_id || "-"
      });
    });
  }

  const listSession = Object.values(sessionMap).reverse();
  if (badge) badge.textContent = `${listSession.length} Sesi Perangkat`;

  if (listSession.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted-custom py-4 small">Belum ada aktivitas IP hari ini.</td></tr>`;
    return;
  }

  tbody.innerHTML = listSession
    .map((item) => {
      const isMobile = item.perangkat.toLowerCase().includes("mobile") || item.perangkat.toLowerCase().includes("hp");
      const deviceIcon = isMobile ? "bi-phone" : "bi-laptop";

      // Rangkum jam masuk agar tidak melebar ke samping & makan banyak ruang
      let visitSummaryHtml = `<span class="text-muted-custom small">-</span>`;
      if (item.visits.length === 1) {
        visitSummaryHtml = `<span class="badge-device">${escapeHtml(item.visits[0])}</span>`;
      } else if (item.visits.length > 1) {
        const firstVisit = escapeHtml(item.visits[0]);
        const lastVisit = escapeHtml(item.visits[item.visits.length - 1]);
        visitSummaryHtml = `
          <div class="d-flex flex-wrap align-items-center gap-1">
            <span class="badge-device" title="Kunjungan pertama">${firstVisit}</span>
            <span class="small text-muted-custom">s.d.</span>
            <span class="badge-device" title="Kunjungan terakhir">${lastVisit}</span>
            <span class="small text-muted-custom">(${item.visits.length}x)</span>
          </div>
        `;
      }

      // Daftar klik rapat, rapi, dengan max-height & scroll internal jika sangat banyak
      const clickListHtml = item.clicks.length > 0
        ? `<div class="d-flex flex-column gap-1 pe-1" style="max-height: 220px; overflow-y: auto;">` +
          item.clicks
            .map(
              (c) => `
              <div class="small d-flex flex-wrap align-items-baseline gap-1 py-1 border-bottom border-light">
                <span class="fw-bold text-blue-main tabular-nums text-nowrap">[${escapeHtml(c.jam)}]</span>
                <span class="badge-device text-nowrap">${escapeHtml(c.grup)}</span>
                <span class="text-break">${escapeHtml(c.nama)}</span>
              </div>`
            )
            .join("") +
          `</div>`
        : `<span class="text-muted-custom small fst-italic">Hanya melihat halaman (belum klik tombol)</span>`;

      return `
        <tr>
          <td class="align-top" style="min-width: 170px; width: 22%;">
            <div class="fw-bold"><code>${escapeHtml(item.ip)}</code></div>
            <div class="small text-muted-custom mt-1">
              <i class="bi ${deviceIcon} me-1"></i>${escapeHtml(item.perangkat)} ${escapeHtml(item.browser)}
            </div>
          </td>
          <td class="align-top" style="min-width: 185px; width: 23%;">${visitSummaryHtml}</td>
          <td class="align-top" style="min-width: 280px; width: 55%;">${clickListHtml}</td>
        </tr>
      `;
    })
    .join("");
}

if (!isConfigured) {
  configWarning.classList.remove("d-none");
} else {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getDatabase(app);

  startLiveClock();
  const todayKey = formatDateKey(new Date());

  onAuthStateChanged(auth, (user) => {
    if (user) {
      loginSection.classList.add("d-none");
      dashboardContent.classList.remove("d-none");
      btnLogout.classList.remove("d-none");

      const analyticsRef = ref(db, "analytics");
      onValue(analyticsRef, (snapshot) => {
        const data = snapshot.val() || {};
        const daily = data.daily_visits || {};
        const todayCount = typeof daily[todayKey] === "number" ? daily[todayKey] : 0;

        const totalAllVisits = Object.values(daily).reduce(
          (sum, val) => sum + (typeof val === "number" ? val : 0),
          0
        );

        document.getElementById("statToday").textContent = todayCount.toLocaleString("id-ID");
        document.getElementById("statTotal").textContent = totalAllVisits.toLocaleString("id-ID");

        const todayButtonClicks = (data.button_clicks_daily && data.button_clicks_daily[todayKey]) || null;
        const todayVisitLogs = (data.visit_logs && data.visit_logs[todayKey]) || null;
        const todayClickLogs = (data.button_click_logs && data.button_click_logs[todayKey]) || null;

        renderVisitsChart(daily);
        renderTopButtons(data.button_clicks || null, todayButtonClicks);
        renderVisitLogs(todayVisitLogs);
        renderIpActivity(todayVisitLogs, todayClickLogs);
      }, (err) => {
        console.error("Gagal membaca data analytics:", err);
      });
    } else {
      loginSection.classList.remove("d-none");
      dashboardContent.classList.add("d-none");
      btnLogout.classList.add("d-none");
    }
  });

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.classList.add("d-none");
    const email = document.getElementById("adminEmail").value.trim();
    const password = document.getElementById("adminPassword").value;
    const submitBtn = document.getElementById("btnLoginSubmit");

    submitBtn.disabled = true;
    submitBtn.textContent = "Memeriksa...";

    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      loginError.textContent = "Email atau password salah. Pastikan akun sudah dibuat di Firebase Authentication.";
      loginError.classList.remove("d-none");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Masuk ke Dashboard";
    }
  });

  btnLogout.addEventListener("click", () => {
    signOut(auth);
  });
}
