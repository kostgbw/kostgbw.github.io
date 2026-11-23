const firebaseConfig = {
  apiKey: "AIzaSyArZW4xQ7Fdt34c89aAid79aM5PBgmCLlw",
  authDomain: "kostgbw-a5372.firebaseapp.com",
  databaseURL: "https://kostgbw-a5372-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "kostgbw-a5372"
};

let cachedAnalytics = null;

function getTodayKeyWIB() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatTanggalIndo(dateKey) {
  if (!dateKey || !dateKey.includes("-")) return dateKey || "-";
  const bulan = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  const [y, m, d] = dateKey.split("-");
  return `${parseInt(d, 10)} ${bulan[parseInt(m, 10) - 1] || m} ${y}`;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

document.addEventListener("DOMContentLoaded", () => {
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }
  const auth = firebase.auth();
  const db = firebase.database();

  const loginSection = document.getElementById("loginSection");
  const dashboardSection = document.getElementById("dashboardSection");
  const loginForm = document.getElementById("loginForm");
  const loginError = document.getElementById("loginError");

  auth.onAuthStateChanged((user) => {
    if (user) {
      loginSection.classList.add("d-none");
      dashboardSection.classList.remove("d-none");
      loadAnalyticsData(db);
    } else {
      dashboardSection.classList.add("d-none");
      loginSection.classList.remove("d-none");
    }
  });

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.classList.add("d-none");
    const email = document.getElementById("adminEmail").value.trim();
    const pass = document.getElementById("adminPassword").value;
    try {
      await auth.signInWithEmailAndPassword(email, pass);
    } catch (err) {
      loginError.textContent = "Login gagal: " + err.message;
      loginError.classList.remove("d-none");
    }
  });

  document.getElementById("btnLogout").addEventListener("click", () => auth.signOut());
  document.getElementById("btnRefreshData").addEventListener("click", () => loadAnalyticsData(db));
  document.getElementById("btnExportExcel").addEventListener("click", () => exportLaporanExcel());
});

async function loadAnalyticsData(db) {
  const syncText = document.getElementById("lastSyncText");
  syncText.textContent = "Mengambil data terbaru...";

  try {
    const snap = await db.ref("analytics").once("value");
    const raw = snap.val() || {};
    cachedAnalytics = processAnalyticsData(raw);
    renderDashboard(cachedAnalytics);
    syncText.textContent = `Terakhir diperbarui: ${new Date().toLocaleTimeString("id-ID")} WIB`;
  } catch (err) {
    console.error("Gagal memuat analytics:", err);
    syncText.textContent = "Gagal memuat data: " + err.message;
  }
}

function processAnalyticsData(raw) {
  const dailyVisitsObj = raw.daily_visits || {};
  const visitLogsObj = raw.visit_logs || {};
  const buttonClicksObj = raw.button_clicks || {};
  const buttonClickLogsObj = raw.button_click_logs || {};

  // 1. Rekap Harian
  const allDatesSet = new Set([
    ...Object.keys(dailyVisitsObj),
    ...Object.keys(visitLogsObj),
    ...Object.keys(buttonClickLogsObj)
  ]);
  const sortedDates = Array.from(allDatesSet).sort();

  const dailySummary = sortedDates.map((dateKey) => {
    const visitsCount = Number(dailyVisitsObj[dateKey] || 0);
    const vLogs = Object.values(visitLogsObj[dateKey] || {});
    const cLogs = Object.values(buttonClickLogsObj[dateKey] || {});
    const uniqueIps = new Set([
      ...vLogs.map((v) => v.ip).filter(Boolean),
      ...cLogs.map((c) => c.ip).filter(Boolean)
    ]);
    const mobileCount = vLogs.filter((v) => (v.perangkat || "").includes("Mobile")).length;
    const desktopCount = vLogs.filter((v) => !(v.perangkat || "").includes("Mobile")).length;

    return {
      dateKey,
      tanggalLabel: formatTanggalIndo(dateKey),
      visits: Math.max(visitsCount, vLogs.length),
      uniqueVisitors: uniqueIps.size,
      totalClicks: cLogs.length,
      mobileVisits: mobileCount,
      desktopVisits: desktopCount
    };
  });

  // 2. Rekap Tombol
  const buttonSummary = Object.entries(buttonClicksObj)
    .map(([id, info]) => ({
      id,
      label: info?.label || id,
      group: info?.group || "Lainnya",
      total: Number(info?.total || 0),
      lastClicked: info?.last_clicked || "-"
    }))
    .sort((a, b) => b.total - a.total);

  // 3. Log Kunjungan & Klik Lengkap
  const allVisitLogs = [];
  Object.entries(visitLogsObj).forEach(([dateKey, entries]) => {
    Object.values(entries || {}).forEach((item) => {
      allVisitLogs.push({ dateKey, ...item });
    });
  });
  allVisitLogs.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));

  const allClickLogs = [];
  Object.entries(buttonClickLogsObj).forEach(([dateKey, entries]) => {
    Object.values(entries || {}).forEach((item) => {
      allClickLogs.push({ dateKey, ...item });
    });
  });
  allClickLogs.sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""));

  // 4. Jejak Per IP
  const ipMap = new Map();
  const ensureIp = (ip, meta = {}) => {
    const key = ip || "Tidak Terdeteksi";
    if (!ipMap.has(key)) {
      ipMap.set(key, {
        ip: key,
        perangkat: meta.perangkat || "-",
        os: meta.os || "-",
        browser: meta.browser || "-",
        layar: meta.layar || "-",
        asalLink: meta.asal_link || "Langsung (Direct)",
        visitCount: 0,
        clickCount: 0,
        firstSeen: meta.timestamp || "",
        lastSeen: meta.timestamp || "",
        lastSeenLabel: meta.hari ? `${meta.hari}, ${meta.tanggal} ${meta.jam}` : "-",
        actions: []
      });
    }
    return ipMap.get(key);
  };

  allVisitLogs.forEach((v) => {
    const rec = ensureIp(v.ip, v);
    rec.visitCount += 1;
    if (v.perangkat && rec.perangkat === "-") rec.perangkat = v.perangkat;
    if (v.os && rec.os === "-") rec.os = v.os;
    if (v.browser && rec.browser === "-") rec.browser = v.browser;
    if (v.layar && rec.layar === "-") rec.layar = v.layar;
    if (v.asal_link && rec.asalLink === "Langsung (Direct)") rec.asalLink = v.asal_link;
    if (!rec.firstSeen || (v.timestamp && v.timestamp < rec.firstSeen)) rec.firstSeen = v.timestamp;
    if (!rec.lastSeen || (v.timestamp && v.timestamp > rec.lastSeen)) {
      rec.lastSeen = v.timestamp;
      rec.lastSeenLabel = `${v.hari || ""}, ${v.tanggal || ""} ${v.jam || ""}`.trim();
    }
  });

  allClickLogs.forEach((c) => {
    const rec = ensureIp(c.ip, c);
    rec.clickCount += 1;
    if (c.perangkat && rec.perangkat === "-") rec.perangkat = c.perangkat;
    if (c.os && rec.os === "-") rec.os = c.os;
    if (c.browser && rec.browser === "-") rec.browser = c.browser;
    rec.actions.push(`${c.nama_tombol || c.tombol_id} (${c.jam || "-"})`);
    if (!rec.lastSeen || (c.timestamp && c.timestamp > rec.lastSeen)) {
      rec.lastSeen = c.timestamp;
      rec.lastSeenLabel = `${c.hari || ""}, ${c.tanggal || ""} ${c.jam || ""}`.trim();
    }
  });

  const ipJourneys = Array.from(ipMap.values()).sort((a, b) => b.clickCount - a.clickCount || b.visitCount - a.visitCount);

  // 5. Ringkasan Grup & Perangkat
  const groupTotals = {};
  buttonSummary.forEach((b) => {
    groupTotals[b.group] = (groupTotals[b.group] || 0) + b.total;
  });

  const totalVisits = dailySummary.reduce((acc, d) => acc + d.visits, 0);
  const totalClicks = buttonSummary.reduce((acc, b) => acc + b.total, 0);
  const leadClicks = buttonSummary
    .filter((b) => /whatsapp|paket|pesan|wa_/i.test(`${b.group} ${b.id}`))
    .reduce((acc, b) => acc + b.total, 0);

  const mobileUsers = ipJourneys.filter((i) => (i.perangkat || "").includes("Mobile")).length;
  const desktopUsers = ipJourneys.length - mobileUsers;

  return {
    generatedAt: new Date(),
    dailySummary,
    buttonSummary,
    allVisitLogs,
    allClickLogs: [...allClickLogs].reverse(),
    ipJourneys,
    groupTotals,
    kpis: {
      totalVisits,
      todayVisits: dailySummary.find((d) => d.dateKey === getTodayKeyWIB())?.visits || 0,
      uniqueIPs: ipJourneys.length,
      totalClicks,
      leadClicks,
      mobileUsers,
      desktopUsers
    }
  };
}

function renderDashboard(data) {
  const { kpis, buttonSummary, ipJourneys, groupTotals } = data;
  document.getElementById("kpiTotalVisits").textContent = kpis.totalVisits.toLocaleString("id-ID");
  document.getElementById("kpiTodayVisits").textContent = `Hari ini: ${kpis.todayVisits.toLocaleString("id-ID")}`;
  document.getElementById("kpiUniqueIPs").textContent = kpis.uniqueIPs.toLocaleString("id-ID");
  document.getElementById("kpiTotalClicks").textContent = kpis.totalClicks.toLocaleString("id-ID");
  document.getElementById("kpiLeadClicks").textContent = kpis.leadClicks.toLocaleString("id-ID");

  const topGroupEntry = Object.entries(groupTotals).sort((a, b) => b[1] - a[1])[0];
  document.getElementById("kpiTopGroup").textContent = topGroupEntry
    ? `Teraktif: ${topGroupEntry[0]} (${topGroupEntry[1]}x)`
    : "Grup teraktif: -";

  document.getElementById("badgeTotalButtons").textContent = `${buttonSummary.length} tombol`;
  document.getElementById("badgeTotalIPs").textContent = `${ipJourneys.length} IP`;

  const tbodyBtn = document.getElementById("tbodyButtonSummary");
  tbodyBtn.innerHTML = buttonSummary.length
    ? buttonSummary
        .map(
          (b) => `
        <tr>
          <td>
            <div class="fw-semibold small">${escapeHtml(b.label)}</div>
            <div class="text-muted" style="font-size:0.72rem;">${escapeHtml(b.id)}</div>
          </td>
          <td><span class="badge bg-light text-dark border border-dark">${escapeHtml(b.group)}</span></td>
          <td class="text-end fw-bold">${b.total.toLocaleString("id-ID")}</td>
        </tr>`
        )
        .join("")
    : `<tr><td colspan="3" class="text-center text-muted py-4">Belum ada data klik tombol.</td></tr>`;

  const tbodyIp = document.getElementById("tbodyIpJourney");
  tbodyIp.innerHTML = ipJourneys.length
    ? ipJourneys
        .map((ip) => {
          const isMobile = (ip.perangkat || "").includes("Mobile");
          const badgeClass = isMobile ? "badge-device-mobile" : "badge-device-desktop";
          const sequence = ip.actions.length ? escapeHtml(ip.actions.join(" → ")) : "<span class='text-muted'>Hanya melihat halaman</span>";
          return `
        <tr>
          <td>
            <div class="fw-bold small font-monospace">${escapeHtml(ip.ip)}</div>
            <div class="text-muted" style="font-size:0.72rem;">${escapeHtml(ip.asalLink)}</div>
          </td>
          <td>
            <span class="badge ${badgeClass}">${isMobile ? "HP" : "Desktop"}</span>
            <div class="text-muted mt-1" style="font-size:0.72rem;">${escapeHtml(ip.os)} • ${escapeHtml(ip.browser)}</div>
          </td>
          <td class="small">
            <div>Visit: <strong>${ip.visitCount}x</strong></div>
            <div>Klik: <strong>${ip.clickCount}x</strong></div>
          </td>
          <td class="small">${sequence}</td>
        </tr>`;
        })
        .join("")
    : `<tr><td colspan="4" class="text-center text-muted py-4">Belum ada jejak pengunjung.</td></tr>`;
}

// =========================================================================
// EXPORT LAPORAN EXCEL PROFESIONAL (.XLSX) DENGAN EXCELJS
// =========================================================================
async function exportLaporanExcel() {
  if (!cachedAnalytics) {
    alert("Data belum selesai dimuat. Silakan klik Refresh terlebih dahulu.");
    return;
  }
  if (typeof ExcelJS === "undefined") {
    alert("Library ExcelJS gagal dimuat. Periksa koneksi internet Anda.");
    return;
  }

  const btn = document.getElementById("btnExportExcel");
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> Menyusun Laporan...`;

  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = "Dashboard Analitik Kost Griya Bangun Widadi";
    wb.created = new Date();

    // Palet warna korporat Navy & Slate yang bersih untuk bahan evaluasi klien
    const NAVY_DARK = "FF0F172A";
    const NAVY_SUB = "FF1E3A8A";
    const SLATE_TINT = "FFF1F5F9";
    const ACCENT_SOFT = "FFDBEAFE";
    const GREEN_SOFT = "FFDCFCE7";
    const BORDER_GRAY = "FFCBD5E1";

    const thinBorder = {
      top: { style: "thin", color: { argb: BORDER_GRAY } },
      left: { style: "thin", color: { argb: BORDER_GRAY } },
      bottom: { style: "thin", color: { argb: BORDER_GRAY } },
      right: { style: "thin", color: { argb: BORDER_GRAY } }
    };

    const styleTitleBanner = (ws, maxColLetter, title, subtitle) => {
      ws.mergeCells(`A1:${maxColLetter}1`);
      const c1 = ws.getCell("A1");
      c1.value = title;
      c1.font = { name: "Calibri", size: 15, bold: true, color: { argb: "FFFFFFFF" } };
      c1.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY_DARK } };
      c1.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      ws.getRow(1).height = 32;

      ws.mergeCells(`A2:${maxColLetter}2`);
      const c2 = ws.getCell("A2");
      c2.value = subtitle;
      c2.font = { name: "Calibri", size: 10, italic: true, color: { argb: "FF334155" } };
      c2.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SLATE_TINT } };
      c2.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      ws.getRow(2).height = 22;
    };

    const styleTableHeader = (row, colCount) => {
      row.height = 26;
      for (let i = 1; i <= colCount; i++) {
        const cell = row.getCell(i);
        cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY_SUB } };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        cell.border = thinBorder;
      }
    };

    const styleDataRow = (row, colCount, isEven, numericCols = []) => {
      row.height = 22;
      for (let i = 1; i <= colCount; i++) {
        const cell = row.getCell(i);
        cell.font = { name: "Calibri", size: 10.5, color: { argb: "FF0F172A" } };
        if (isEven) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
        }
        cell.border = thinBorder;
        cell.alignment = {
          vertical: "middle",
          horizontal: numericCols.includes(i) ? "right" : "left",
          wrapText: true
        };
        if (numericCols.includes(i)) {
          cell.numFmt = "#,##0";
        }
      }
    };

    const tanggalCetak = new Date().toLocaleString("id-ID", {
      dateStyle: "full",
      timeStyle: "short"
    }) + " WIB";

    const { kpis, dailySummary, buttonSummary, ipJourneys, allVisitLogs, allClickLogs, groupTotals } = cachedAnalytics;
    const periodeAwal = dailySummary[0]?.tanggalLabel || "-";
    const periodeAkhir = dailySummary[dailySummary.length - 1]?.tanggalLabel || "-";

    // =====================================================================
    // SHEET 1: RINGKASAN EVALUASI (EXECUTIVE SUMMARY)
    // =====================================================================
    const wsSummary = wb.addWorksheet("Ringkasan Evaluasi", {
      views: [{ showGridLines: true }]
    });
    styleTitleBanner(
      wsSummary,
      "E",
      "LAPORAN EVALUASI PERFORMA WEBSITE — KOST GRIYA BANGUN WIDADI",
      `Periode Data: ${periodeAwal} s/d ${periodeAkhir}   |   Diekspor pada: ${tanggalCetak}`
    );

    wsSummary.getCell("A4").value = "1. INDIKATOR KINERJA UTAMA (KPI)";
    wsSummary.getCell("A4").font = { name: "Calibri", size: 12, bold: true, color: { argb: NAVY_DARK } };

    const kpiHeader = wsSummary.getRow(5);
    kpiHeader.values = ["Metrik Evaluasi", "Nilai Tercatat", "Keterangan & Insight Evaluasi"];
    styleTableHeader(kpiHeader, 3);

    const conversionRate = kpis.totalVisits > 0 ? ((kpis.leadClicks / kpis.totalVisits) * 100).toFixed(1) + "%" : "0%";
    const avgClickPerVisitor = kpis.uniqueIPs > 0 ? (kpis.totalClicks / kpis.uniqueIPs).toFixed(2) : "0";

    const kpiRowsData = [
      ["Total Kunjungan Halaman", kpis.totalVisits, "Akumulasi sesi kunjungan unik harian ke landing page Kost GBW"],
      ["Total Pengunjung Unik (IP)", kpis.uniqueIPs, "Jumlah alamat IP berbeda yang mengakses website"],
      ["Pengunjung HP / Mobile", kpis.mobileUsers, "Pengunjung yang membuka website melalui smartphone"],
      ["Pengunjung Desktop / Laptop", kpis.desktopUsers, "Pengunjung yang membuka website melalui komputer/laptop"],
      ["Total Interaksi Klik", kpis.totalClicks, `Rata-rata ${avgClickPerVisitor} klik per pengunjung unik`],
      ["Klik Prospek (WhatsApp & Paket)", kpis.leadClicks, `Rasio ketertarikan calon penghuni terhadap total kunjungan: ${conversionRate}`]
    ];

    kpiRowsData.forEach((item, idx) => {
      const r = wsSummary.getRow(6 + idx);
      r.values = item;
      styleDataRow(r, 3, idx % 2 === 1, [2]);
      r.getCell(2).font = { name: "Calibri", size: 11, bold: true, color: { argb: NAVY_SUB } };
      if (idx === 5) {
        r.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN_SOFT } };
        r.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN_SOFT } };
        r.getCell(3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN_SOFT } };
      }
    });

    // Bagian 2: Rekap Interaksi Per Kategori/Grup
    wsSummary.getCell("A14").value = "2. DISTRIBUSI INTERAKSI BERDASARKAN KATEGORI FITUR";
    wsSummary.getCell("A14").font = { name: "Calibri", size: 12, bold: true, color: { argb: NAVY_DARK } };

    const grpHeader = wsSummary.getRow(15);
    grpHeader.values = ["Kategori / Grup Fitur", "Total Klik", "Persentase (%)"];
    styleTableHeader(grpHeader, 3);

    const sortedGroups = Object.entries(groupTotals).sort((a, b) => b[1] - a[1]);
    sortedGroups.forEach(([grpName, count], idx) => {
      const r = wsSummary.getRow(16 + idx);
      const pct = kpis.totalClicks > 0 ? count / kpis.totalClicks : 0;
      r.values = [grpName, count, pct];
      styleDataRow(r, 3, idx % 2 === 1, [2]);
      r.getCell(3).alignment = { vertical: "middle", horizontal: "right" };
      r.getCell(3).numFmt = "0.0%";
    });

    if (sortedGroups.length > 0) {
      const totalRowIdx = 16 + sortedGroups.length;
      const totalRow = wsSummary.getRow(totalRowIdx);
      totalRow.values = ["TOTAL INTERAKSI", { formula: `SUM(B16:B${totalRowIdx - 1})` }, 1];
      styleDataRow(totalRow, 3, false, [2]);
      totalRow.eachCell((c) => {
        c.font = { name: "Calibri", size: 11, bold: true };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACCENT_SOFT } };
      });
      totalRow.getCell(3).alignment = { vertical: "middle", horizontal: "right" };
      totalRow.getCell(3).numFmt = "0.0%";
    }

    wsSummary.columns = [
      { width: 34 },
      { width: 18 },
      { width: 58 },
      { width: 15 },
      { width: 15 }
    ];

    // =====================================================================
    // SHEET 2: PERFORMA TOMBOL & CTA
    // =====================================================================
    const wsButtons = wb.addWorksheet("Performa Tombol & CTA", {
      views: [{ state: "frozen", ySplit: 4 }]
    });
    styleTitleBanner(
      wsButtons,
      "F",
      "REKAPITULASI KLIK PER TOMBOL & MENU (CTA PERFORMANCE)",
      `Diurutkan dari tombol yang paling sering diklik pengunjung   |   Diekspor: ${tanggalCetak}`
    );

    const btnHeader = wsButtons.getRow(4);
    btnHeader.values = ["No", "Nama Tombol / Menu", "Kategori Grup", "ID Pelacakan", "Total Klik", "Terakhir Diklik"];
    styleTableHeader(btnHeader, 6);

    buttonSummary.forEach((b, idx) => {
      const r = wsButtons.getRow(5 + idx);
      r.values = [idx + 1, b.label, b.group, b.id, b.total, b.lastClicked];
      styleDataRow(r, 6, idx % 2 === 1, [1, 5]);
      r.getCell(1).alignment = { vertical: "middle", horizontal: "center" };
    });

    if (buttonSummary.length > 0) {
      const endR = 5 + buttonSummary.length;
      const totR = wsButtons.getRow(endR);
      totR.values = ["", "TOTAL SELURUH KLIK TOMBOL", "", "", { formula: `SUM(E5:E${endR - 1})` }, ""];
      styleDataRow(totR, 6, false, [5]);
      totR.eachCell((c) => {
        c.font = { name: "Calibri", size: 11, bold: true };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACCENT_SOFT } };
      });
    }

    wsButtons.columns = [
      { width: 6 },
      { width: 38 },
      { width: 20 },
      { width: 26 },
      { width: 14 },
      { width: 30 }
    ];

    // =====================================================================
    // SHEET 3: TREN HARIAN
    // =====================================================================
    const wsDaily = wb.addWorksheet("Tren Kunjungan Harian", {
      views: [{ state: "frozen", ySplit: 4 }]
    });
    styleTitleBanner(
      wsDaily,
      "G",
      "REKAP KUNJUNGAN & AKTIVITAS HARIAN",
      `Monitoring trafik harian berdasarkan waktu Indonesia Barat (WIB)   |   Diekspor: ${tanggalCetak}`
    );

    const dailyHeader = wsDaily.getRow(4);
    dailyHeader.values = [
      "Tanggal (YYYY-MM-DD)",
      "Tanggal",
      "Total Kunjungan",
      "Pengunjung Unik (IP)",
      "Akses HP / Mobile",
      "Akses Desktop",
      "Total Klik Tombol"
    ];
    styleTableHeader(dailyHeader, 7);

    dailySummary.forEach((d, idx) => {
      const r = wsDaily.getRow(5 + idx);
      r.values = [d.dateKey, d.tanggalLabel, d.visits, d.uniqueVisitors, d.mobileVisits, d.desktopVisits, d.totalClicks];
      styleDataRow(r, 7, idx % 2 === 1, [3, 4, 5, 6, 7]);
    });

    if (dailySummary.length > 0) {
      const endR = 5 + dailySummary.length;
      const totR = wsDaily.getRow(endR);
      totR.values = [
        "TOTAL",
        `${dailySummary.length} Hari`,
        { formula: `SUM(C5:C${endR - 1})` },
        { formula: `SUM(D5:D${endR - 1})` },
        { formula: `SUM(E5:E${endR - 1})` },
        { formula: `SUM(F5:F${endR - 1})` },
        { formula: `SUM(G5:G${endR - 1})` }
      ];
      styleDataRow(totR, 7, false, [3, 4, 5, 6, 7]);
      totR.eachCell((c) => {
        c.font = { name: "Calibri", size: 11, bold: true };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACCENT_SOFT } };
      });
    }

    wsDaily.columns = [
      { width: 22 },
      { width: 18 },
      { width: 18 },
      { width: 20 },
      { width: 18 },
      { width: 16 },
      { width: 18 }
    ];

    // =====================================================================
    // SHEET 4: JEJAK AKTIVITAS PER IP
    // =====================================================================
    const wsIp = wb.addWorksheet("Jejak Aktivitas Per IP", {
      views: [{ state: "frozen", ySplit: 4 }]
    });
    styleTitleBanner(
      wsIp,
      "I",
      "JEJAK PERILAKU PENGUNJUNG BERDASARKAN ALAMAT IP",
      `Analisis urutan interaksi setiap pengunjung untuk evaluasi minat kamar & fasilitas`
    );

    const ipHeader = wsIp.getRow(4);
    ipHeader.values = [
      "No",
      "Alamat IP",
      "Perangkat",
      "OS & Browser",
      "Sumber Trafik",
      "Jml Kunjungan",
      "Jml Klik",
      "Aktivitas Terakhir",
      "Urutan Tombol yang Diklik"
    ];
    styleTableHeader(ipHeader, 9);

    ipJourneys.forEach((ip, idx) => {
      const r = wsIp.getRow(5 + idx);
      r.values = [
        idx + 1,
        ip.ip,
        ip.perangkat,
        `${ip.os} / ${ip.browser}`,
        ip.asalLink,
        ip.visitCount,
        ip.clickCount,
        ip.lastSeenLabel,
        ip.actions.length ? ip.actions.join(" -> ") : "Hanya melihat halaman"
      ];
      styleDataRow(r, 9, idx % 2 === 1, [1, 6, 7]);
      r.getCell(1).alignment = { vertical: "middle", horizontal: "center" };
    });

    wsIp.columns = [
      { width: 6 },
      { width: 18 },
      { width: 16 },
      { width: 20 },
      { width: 24 },
      { width: 15 },
      { width: 12 },
      { width: 28 },
      { width: 55 }
    ];

    // =====================================================================
    // SHEET 5: LOG DETAIL KLIK (RAW AUDIT TRAIL)
    // =====================================================================
    const wsClickLogs = wb.addWorksheet("Log Detail Klik", {
      views: [{ state: "frozen", ySplit: 4 }]
    });
    styleTitleBanner(
      wsClickLogs,
      "H",
      "LOG DETAIL SETIAP KLIK TOMBOL (AUDIT TRAIL)",
      `Catatan kronologis setiap interaksi pengunjung di website Kost Griya Bangun Widadi`
    );

    const clickHeader = wsClickLogs.getRow(4);
    clickHeader.values = ["Hari", "Tanggal", "Jam (WIB)", "Alamat IP", "Perangkat", "Grup Fitur", "Nama Tombol", "Tujuan / Target"];
    styleTableHeader(clickHeader, 8);

    allClickLogs.forEach((c, idx) => {
      const r = wsClickLogs.getRow(5 + idx);
      r.values = [
        c.hari || "-",
        c.tanggal || c.dateKey || "-",
        c.jam || "-",
        c.ip || "-",
        `${c.perangkat || "-"} (${c.os || "-"})`,
        c.grup || "-",
        c.nama_tombol || c.tombol_id || "-",
        c.url_tujuan || "-"
      ];
      styleDataRow(r, 8, idx % 2 === 1, []);
    });

    wsClickLogs.columns = [
      { width: 12 },
      { width: 18 },
      { width: 14 },
      { width: 18 },
      { width: 24 },
      { width: 18 },
      { width: 34 },
      { width: 36 }
    ];

    // =====================================================================
    // SHEET 6: LOG DETAIL KUNJUNGAN
    // =====================================================================
    const wsVisitLogs = wb.addWorksheet("Log Detail Kunjungan", {
      views: [{ state: "frozen", ySplit: 4 }]
    });
    styleTitleBanner(
      wsVisitLogs,
      "H",
      "LOG DETAIL KUNJUNGAN HALAMAN",
      `Catatan kronologis sesi kunjungan masuk beserta sumber referral dan resolusi layar`
    );

    const visitHeader = wsVisitLogs.getRow(4);
    visitHeader.values = ["Hari", "Tanggal", "Jam (WIB)", "Alamat IP", "Perangkat", "OS / Browser", "Resolusi Layar", "Sumber Trafik (Referrer)"];
    styleTableHeader(visitHeader, 8);

    allVisitLogs.forEach((v, idx) => {
      const r = wsVisitLogs.getRow(5 + idx);
      r.values = [
        v.hari || "-",
        v.tanggal || v.dateKey || "-",
        v.jam || "-",
        v.ip || "-",
        v.perangkat || "-",
        `${v.os || "-"} / ${v.browser || "-"}`,
        v.layar || "-",
        v.asal_link || "Langsung (Direct)"
      ];
      styleDataRow(r, 8, idx % 2 === 1, []);
    });

    wsVisitLogs.columns = [
      { width: 12 },
      { width: 18 },
      { width: 14 },
      { width: 18 },
      { width: 16 },
      { width: 20 },
      { width: 16 },
      { width: 36 }
    ];

    // Unduh file .xlsx
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Laporan-Evaluasi-Website-Kost-GBW_${getTodayKeyWIB()}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("Gagal export Excel:", err);
    alert("Terjadi kesalahan saat membuat file Excel: " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}
