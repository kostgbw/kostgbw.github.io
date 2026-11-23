const FIREBASE_DB_URL = "https://kostgbw-a5372-default-rtdb.asia-southeast1.firebasedatabase.app";

function getWaktuWIB() {
  const now = new Date();
  const hariList = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  const bulanList = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
  ];

  const hari = hariList[now.getDay()];
  const tanggal = `${now.getDate()} ${bulanList[now.getMonth()]} ${now.getFullYear()}`;
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const dateKey = `${yyyy}-${mm}-${dd}`;
  const jam = now.toTimeString().split(" ")[0] + " WIB";

  return { hari, tanggal, jam, dateKey, timestamp: now.toISOString() };
}

function getInfoPerangkat() {
  const ua = navigator.userAgent;
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const tipePerangkat = isMobile ? "HP / Mobile" : "Desktop / Laptop";

  let os = "Lainnya";
  if (/Windows/i.test(ua)) os = "Windows";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";
  else if (/Mac OS/i.test(ua)) os = "macOS";
  else if (/Linux/i.test(ua)) os = "Linux";

  let browser = "Browser Lain";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) browser = "Chrome";
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = "Safari";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";

  return { tipePerangkat, os, browser };
}

let cachedIP = null;
async function getPublicIP() {
  if (cachedIP) return cachedIP;
  try {
    const res = await fetch("https://api.ipify.org?format=json");
    if (res.ok) {
      const data = await res.json();
      cachedIP = data.ip || "Tidak Terdeteksi";
      return cachedIP;
    }
  } catch (e) {
    // Abaikan jika diblokir adblocker
  }
  return "Tidak Terdeteksi";
}

async function tambahSatuKeFirebase(path) {
  try {
    const getRes = await fetch(`${FIREBASE_DB_URL}/${path}.json`);
    const currentVal = await getRes.json();
    const nextVal = (typeof currentVal === "number" ? currentVal : 0) + 1;

    await fetch(`${FIREBASE_DB_URL}/${path}.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nextVal)
    });
  } catch (err) {
    // Jangan ganggu pengalaman user jika offline
  }
}

async function catatKunjunganHalaman() {
  try {
    const waktu = getWaktuWIB();
    const sessionKey = `gbw_visited_${waktu.dateKey}`;
    if (sessionStorage.getItem(sessionKey)) return;
    sessionStorage.setItem(sessionKey, "1");

    const [ip, device] = await Promise.all([
      getPublicIP(),
      Promise.resolve(getInfoPerangkat())
    ]);

    const params = new URLSearchParams(window.location.search);
    const asalLink = params.get("utm_source") || params.get("ref") || document.referrer || "Langsung (Direct)";

    const payload = {
      ip,
      hari: waktu.hari,
      tanggal: waktu.tanggal,
      jam: waktu.jam,
      timestamp: waktu.timestamp,
      perangkat: device.tipePerangkat,
      os: device.os,
      browser: device.browser,
      layar: `${window.screen.width}x${window.screen.height}`,
      asal_link: asalLink
    };

    await Promise.all([
      tambahSatuKeFirebase(`analytics/daily_visits/${waktu.dateKey}`),
      fetch(`${FIREBASE_DB_URL}/analytics/visit_logs/${waktu.dateKey}.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
    ]);
  } catch (err) {
    // Fail silently
  }
}

function lacakKlikTombol(el) {
  const btnId = el.getAttribute("data-track-id");
  const btnLabel = el.getAttribute("data-track-label") || el.innerText.trim() || btnId;
  const btnGroup = el.getAttribute("data-track-group") || "lainnya";
  if (!btnId) return;

  const waktu = getWaktuWIB();
  const device = getInfoPerangkat();
  const urlTujuan = el.getAttribute("href") || "-";
  const ip = cachedIP || "Tidak Terdeteksi";

  tambahSatuKeFirebase(`analytics/button_clicks/${btnId}/total`);
  tambahSatuKeFirebase(`analytics/button_clicks_daily/${waktu.dateKey}/${btnId}`);

  fetch(`${FIREBASE_DB_URL}/analytics/button_clicks/${btnId}/label.json`, {
    method: "PUT",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(btnLabel)
  }).catch(() => {});

  fetch(`${FIREBASE_DB_URL}/analytics/button_clicks/${btnId}/group.json`, {
    method: "PUT",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(btnGroup)
  }).catch(() => {});

  fetch(`${FIREBASE_DB_URL}/analytics/button_clicks/${btnId}/last_clicked.json`, {
    method: "PUT",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(`${waktu.hari}, ${waktu.tanggal} (${waktu.jam})`)
  }).catch(() => {});

  const clickLog = {
    ip,
    tombol_id: btnId,
    nama_tombol: btnLabel,
    grup: btnGroup,
    hari: waktu.hari,
    tanggal: waktu.tanggal,
    jam: waktu.jam,
    timestamp: waktu.timestamp,
    perangkat: device.tipePerangkat,
    url_tujuan: urlTujuan
  };

  fetch(`${FIREBASE_DB_URL}/analytics/button_click_logs/${waktu.dateKey}.json`, {
    method: "POST",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(clickLog)
  }).catch(() => {});
}

document.addEventListener("DOMContentLoaded", () => {
  // 1. Catat Kunjungan Halaman
  catatKunjunganHalaman();

  // 2. Pelacak Klik Tombol
  document.querySelectorAll("[data-track-id]").forEach((el) => {
    el.addEventListener("click", () => lacakKlikTombol(el));
  });

  // 3. Filter Galeri Foto
  const filterTabs = document.querySelectorAll(".filter-tab");
  const galleryCols = document.querySelectorAll(".gallery-item-col");

  filterTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      filterTabs.forEach((btn) => btn.classList.remove("active"));
      tab.classList.add("active");

      const selected = tab.getAttribute("data-filter");
      galleryCols.forEach((col) => {
        const isMatch =
          selected === "all" || col.getAttribute("data-category") === selected;
        col.style.display = isMatch ? "block" : "none";
      });
    });
  });

  // 4. Sorotan Kuning Navbar Aktif & Tutup Menu Mobile Saat Diklik
  const navLinks = document.querySelectorAll("#navbarMenu .nav-link");
  const navbarCollapse = document.getElementById("navbarMenu");

  navLinks.forEach((link) => {
    link.addEventListener("click", () => {
      navLinks.forEach((nav) => nav.classList.remove("active"));
      link.classList.add("active");

      if (
        navbarCollapse &&
        typeof bootstrap !== "undefined" &&
        navbarCollapse.classList.contains("show")
      ) {
        const bsCollapse =
          bootstrap.Collapse.getOrCreateInstance(navbarCollapse);
        bsCollapse.hide();
      }
    });
  });

  // 5. Animasi Scroll Reveal (Neo-Brutalist Snappy Pop-In)
  const revealTargets = document.querySelectorAll(
    ".hero-photo-wrap, .portrait-frame, .amenity-chip, .plan-card, #faqAccordion .accordion-item, .gallery-card, .map-card, .contact-box"
  );

  if ("IntersectionObserver" in window && revealTargets.length > 0) {
    const revealObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -30px 0px" }
    );

    revealTargets.forEach((el, idx) => {
      el.classList.add("nb-reveal");
      el.style.setProperty("--reveal-delay", `${(idx % 4) * 60}ms`);
      revealObserver.observe(el);
    });
  }
});
