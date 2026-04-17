/* Pamsimas Water Utility Management - Refactored Vanilla JS localStorage app */
/* NOTE: Billing, Payments, Dashboard, Reports, and Meter-Reading Review now use Backend API */

// --- 1. API CLIENT & STORAGE ---

// Backend API base URL
const API_BASE = '';  // Empty = relative URL (same domain on Vercel)

/**
 * Authenticated fetch wrapper.
 * All requests include credentials (session cookies from Better Auth).
 * Returns the parsed JSON response body.
 */
async function apiFetch(path, options = {}) {
  const { body, method = 'GET', headers = {} } = options;
  const config = {
    method,
    credentials: 'include',
    headers: { ...headers },
  };
  if (body) {
    config.headers['Content-Type'] = 'application/json';
    config.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const res = await fetch(`${API_BASE}${path}`, config);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json.error || json.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

/**
 * Auth helpers using Better Auth endpoints.
 */
async function apiLogin(username, password) {
  return apiFetch('/api/auth/sign-in/username', {
    method: 'POST',
    body: { username, password },
  });
}

async function apiLogout() {
  return apiFetch('/api/auth/sign-out', { method: 'POST' });
}

async function apiGetSession() {
  try {
    return await apiFetch('/api/auth/get-session');
  } catch {
    return null;
  }
}

// localStorage keys (still used for non-migrated modules: members, spk, officer panel)
const STORAGE = {
  admin: 'pamsimas_admin',
  users: 'pamsimas_users',
  session: 'pamsimas_session',
  members: 'pamsimas_members',
  usage: 'pamsimas_usage',
  rate: 'pamsimas_rate',
  adminFee: 'pamsimas_admin_fee',
  payments: 'pamsimas_payments',
  installments: 'pamsimas_installments', // Cicilan
  spk: 'pamsimas_spk', // Surat Perintah Kerja pemasangan
  logs: 'pamsimas_logs' // Audit trail
};

const defaultAdmin = { username: 'admin', password: 'admin123', role: 'admin', name: 'Super Admin' };
const defaultRate = 2100; // per m3
const defaultAdminFee = 500; // default admin fee per bill Rp

const appRoot = document.getElementById('app');

function initStorage() {
  if (!localStorage.getItem(STORAGE.admin)) localStorage.setItem(STORAGE.admin, JSON.stringify(defaultAdmin));
  if (!localStorage.getItem(STORAGE.users)) localStorage.setItem(STORAGE.users, JSON.stringify([]));
  if (!localStorage.getItem(STORAGE.rate)) localStorage.setItem(STORAGE.rate, JSON.stringify(defaultRate));
  if (!localStorage.getItem(STORAGE.adminFee)) localStorage.setItem(STORAGE.adminFee, JSON.stringify(defaultAdminFee));
  if (!localStorage.getItem(STORAGE.members)) localStorage.setItem(STORAGE.members, JSON.stringify([]));
  if (!localStorage.getItem(STORAGE.usage)) localStorage.setItem(STORAGE.usage, JSON.stringify([]));
  if (!localStorage.getItem(STORAGE.payments)) localStorage.setItem(STORAGE.payments, JSON.stringify([]));
  if (!localStorage.getItem(STORAGE.installments)) localStorage.setItem(STORAGE.installments, JSON.stringify([]));
  if (!localStorage.getItem(STORAGE.spk)) localStorage.setItem(STORAGE.spk, JSON.stringify([]));
  if (!localStorage.getItem(STORAGE.logs)) localStorage.setItem(STORAGE.logs, JSON.stringify([]));
}

// Helpers
const getDB = (key) => JSON.parse(localStorage.getItem(key) || '[]');
const saveDB = (key, data) => localStorage.setItem(key, JSON.stringify(data));
const getSession = () => JSON.parse(localStorage.getItem(STORAGE.session));
const setSession = (user) => localStorage.setItem(STORAGE.session, JSON.stringify(user));
const clearSession = () => localStorage.removeItem(STORAGE.session);

const formatRp = (num) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(num || 0);
const formatDate = (isoString) => {
  if (!isoString) return '-';
  const d = new Date(isoString);
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

// UI Utils (Toast Notification)
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<div style="display:flex; align-items:center; gap:10px;">
    <i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'}"></i>
    <span>${message}</span>
  </div>`;

  container.appendChild(toast);

  // Trigger reflow & slide in
  setTimeout(() => toast.classList.add('show'), 10);

  // Remove after 3s
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Audit Logger
function logAction(action, details) {
  const session = getSession();
  const username = session ? session.username : 'System/Warga';
  const logs = getDB(STORAGE.logs);
  logs.unshift({ id: Date.now().toString(), username, action, details, timestamp: new Date().toISOString() });
  // Keep only last 100 logs
  if (logs.length > 100) logs.pop();
  saveDB(STORAGE.logs, logs);
}

// --- PDF RECEIPT GENERATOR (jsPDF) ---

/**
 * Helper: convert phone number to international WA format.
 * 08xxx → 628xxx, +62xxx → 62xxx, etc.
 */
function toWAPhone(phone) {
  let p = phone.replace(/[\s\-\+]/g, '');
  if (p.startsWith('0')) p = '62' + p.slice(1);
  if (p.startsWith('+')) p = p.slice(1);
  return p;
}

/**
 * Format month number (1-12) to Indonesian month name.
 */
function monthName(m) {
  return new Date(0, m - 1).toLocaleString('id-ID', { month: 'long' });
}

/**
 * Generate a professional thermal-style PDF receipt.
 * Returns a jsPDF document instance.
 *
 * @param {Object} data - Receipt data
 * @param {string} data.invoiceId - Invoice/payment reference ID
 * @param {string} data.memberName - Customer name
 * @param {string} data.memberId - Customer ID (e.g. P-001)
 * @param {string} data.zone - Block/Zone/RT-RW
 * @param {string} data.address - Customer address
 * @param {number} data.month - Billing month (1-12)
 * @param {number} data.year - Billing year
 * @param {number} data.prevReading - Previous meter reading
 * @param {number} data.currentReading - Current meter reading
 * @param {number} data.volume - Usage in m³
 * @param {number} data.biayaAir - Water cost
 * @param {number} data.biayaBeban - Admin/maintenance fee
 * @param {number} data.biayaCicilan - Installment amount (0 if none)
 * @param {number} data.total - Total amount
 * @param {boolean} data.isPaid - Whether this is paid
 * @param {string|null} data.paidAt - ISO date when paid
 * @param {Object|null} data.cicilanInfo - { bulanKe, tenure } or null
 */
function generateReceiptPDF(data) {
  const { jsPDF } = window.jspdf;

  // A4 portrait: 210mm x 297mm
  const pageW = 210;
  const pageH = 297;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

  const mL = 20; // left margin
  const mR = pageW - 20; // right margin x
  const cX = pageW / 2; // center x
  const contentW = pageW - 40; // usable width
  let y = 0;

  // --- Color Palette (ocean/water blue theme) ---
  const deepBlue    = [26, 54, 93];    // #1a365d
  const medBlue     = [44, 82, 130];   // #2c5282
  const brandBlue   = [59, 130, 246];  // #3b82f6
  const lightBlue   = [66, 153, 225];  // #4299e1
  const softBlue    = [190, 227, 248]; // #bee3f8
  const paleBlue    = [235, 248, 255]; // #ebf8ff
  const white       = [255, 255, 255];
  const offWhite    = [247, 250, 252];
  const darkText    = [26, 32, 44];    // #1a202c
  const grayText    = [113, 128, 150]; // #718096
  const lightGray   = [226, 232, 240]; // #e2e8f0
  const green       = [56, 161, 105];  // #38a169
  const red         = [229, 62, 62];   // #e53e3e

  // ===== HELPER: Draw decorative wave at a given Y =====
  const drawWaveTop = (startY, height, color, opacity) => {
    doc.setFillColor(...color);
    // Main rectangle band
    doc.rect(0, startY, pageW, height, 'F');
    // Wavy bottom edge using multiple ellipses to create organic wave
    const waveH = 12;
    doc.setFillColor(...color);
    // Create a series of overlapping circles for wave effect
    for (let x = -20; x <= pageW + 20; x += 30) {
      doc.ellipse(x, startY + height, 25, waveH, 'F');
    }
    // Overlay white to cut the bottom of the wave
    doc.setFillColor(...white);
    doc.rect(0, startY + height + waveH - 3, pageW, waveH + 5, 'F');
  };

  const drawWaveBottom = (startY, color) => {
    // Wavy top edge
    doc.setFillColor(...color);
    const waveH = 14;
    for (let x = -15; x <= pageW + 15; x += 28) {
      doc.ellipse(x, startY, 24, waveH, 'F');
    }
    // Fill everything below
    doc.rect(0, startY, pageW, pageH - startY, 'F');
  };

  // ===== BACKGROUND =====
  doc.setFillColor(...white);
  doc.rect(0, 0, pageW, pageH, 'F');

  // ===== TOP WAVE HEADER =====
  // Deep blue band with wave
  doc.setFillColor(...deepBlue);
  doc.rect(0, 0, pageW, 52, 'F');
  // Lighter wave overlay
  doc.setFillColor(...medBlue);
  for (let x = -10; x <= pageW + 10; x += 32) {
    doc.ellipse(x, 52, 28, 14, 'F');
  }
  // White cleanup below wave
  doc.setFillColor(...white);
  doc.rect(0, 62, pageW, 10, 'F');
  // Soft blue accent wave
  doc.setFillColor(...softBlue);
  for (let x = -5; x <= pageW + 5; x += 35) {
    doc.ellipse(x, 56, 22, 8, 'F');
  }
  doc.setFillColor(...white);
  doc.rect(0, 61, pageW, 10, 'F');

  // ===== LOGO & BRANDING =====
  y = 16;
  // Water drop icon (simulated with circle and triangle)
  doc.setFillColor(...lightBlue);
  doc.circle(38, y + 6, 10, 'F');
  doc.setFillColor(...white);
  doc.circle(38, y + 6, 7.5, 'F');
  doc.setFillColor(...lightBlue);
  // Small water droplet inside
  doc.circle(38, y + 5, 3, 'F');
  doc.setFillColor(...white);
  doc.circle(38, y + 4.5, 1.5, 'F');

  // Organization name
  doc.setTextColor(...white);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('PAMSIMAS', 35, y + 17, { align: 'center' });
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('DUSUN PILANG', 35, y + 22, { align: 'center' });

  // "INVOICE" title - right side
  doc.setFontSize(32);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...softBlue);
  doc.text('INVOICE', mR, y + 4, { align: 'right' });

  // Invoice metadata below title
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...white);
  const invoiceNoText = `Invoice No : ${data.invoiceId || '-'}`;
  const invoiceDateText = `Invoice Date : ${data.isPaid && data.paidAt ? formatDate(data.paidAt) : new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })}`;
  const periodText = `Periode : ${monthName(data.month)} ${data.year}`;
  doc.text(invoiceNoText, mR, y + 12, { align: 'right' });
  doc.text(invoiceDateText, mR, y + 17, { align: 'right' });
  doc.text(periodText, mR, y + 22, { align: 'right' });

  // ===== MAIN CONTENT AREA =====
  y = 72;

  // --- Table Header ---
  const colX = {
    desc: mL,
    price: mL + contentW * 0.50,
    qty: mL + contentW * 0.68,
    total: mL + contentW * 0.82
  };

  // Table header background
  doc.setFillColor(...deepBlue);
  doc.rect(mL, y, contentW, 10, 'F');

  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...white);
  doc.text('Deskripsi Tagihan', colX.desc + 4, y + 7);
  doc.text('Harga', colX.price + 2, y + 7);
  doc.text('Vol.', colX.qty + 4, y + 7);
  doc.text('Total', colX.total + 2, y + 7);
  y += 10;

  // --- Table Rows ---
  const rate = Number(localStorage.getItem(STORAGE.rate)) || 2100;

  const tableRows = [];

  // Row 1: Water usage
  tableRows.push({
    desc: `Pemakaian Air Bersih`,
    detail: `Meteran: ${data.prevReading} → ${data.currentReading} m³`,
    price: formatRp(rate) + '/m³',
    qty: `${data.volume} m³`,
    total: formatRp(data.biayaAir)
  });

  // Row 2: Admin/maintenance fee
  tableRows.push({
    desc: 'Biaya Beban / Perawatan',
    detail: 'Biaya tetap bulanan',
    price: formatRp(data.biayaBeban),
    qty: '1',
    total: formatRp(data.biayaBeban)
  });

  // Row 3: Installment (if any)
  if (data.biayaCicilan > 0 && data.cicilanInfo) {
    tableRows.push({
      desc: `Cicilan Pemasangan`,
      detail: `Angsuran ke-${data.cicilanInfo.bulanKe} dari ${data.cicilanInfo.tenure} bulan`,
      price: formatRp(data.biayaCicilan),
      qty: '1',
      total: formatRp(data.biayaCicilan)
    });
  }

  // Draw rows
  tableRows.forEach((row, idx) => {
    const rowH = 16;
    // Alternate row background
    if (idx % 2 === 0) {
      doc.setFillColor(...paleBlue);
      doc.rect(mL, y, contentW, rowH, 'F');
    }

    // Row border
    doc.setDrawColor(...lightGray);
    doc.setLineWidth(0.3);
    doc.line(mL, y + rowH, mR, y + rowH);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...darkText);
    doc.text(row.desc, colX.desc + 4, y + 6);

    // Detail sub-text
    doc.setFontSize(7);
    doc.setTextColor(...grayText);
    doc.text(row.detail, colX.desc + 4, y + 11);

    // Price
    doc.setFontSize(9);
    doc.setTextColor(...darkText);
    doc.text(row.price, colX.price + 2, y + 7);

    // Qty
    doc.text(row.qty, colX.qty + 4, y + 7);

    // Total
    doc.setFont('helvetica', 'bold');
    doc.text(row.total, colX.total + 2, y + 7);

    y += rowH;
  });

  // Add empty rows to fill visual space (like the reference)
  const emptyRows = Math.max(0, 3 - tableRows.length);
  for (let i = 0; i < emptyRows; i++) {
    const rowH = 12;
    if ((tableRows.length + i) % 2 === 0) {
      doc.setFillColor(...paleBlue);
      doc.rect(mL, y, contentW, rowH, 'F');
    }
    doc.setDrawColor(...lightGray);
    doc.setLineWidth(0.3);
    doc.line(mL, y + rowH, mR, y + rowH);
    y += rowH;
  }

  // --- Table bottom border ---
  doc.setDrawColor(...deepBlue);
  doc.setLineWidth(0.5);
  doc.line(mL, y, mR, y);

  y += 8;

  // ===== INVOICE TO & TOTALS SECTION =====
  const splitY = y;

  // --- Left side: Invoice To ---
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...deepBlue);
  doc.text('Tagihan untuk:', mL, splitY + 2);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...darkText);
  doc.text(data.memberName, mL, splitY + 9);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...grayText);
  doc.text(`ID: ${data.memberId}`, mL, splitY + 15);
  doc.text(`Zona: ${data.zone}`, mL, splitY + 20);
  if (data.address) {
    const addr = data.address.length > 40 ? data.address.substring(0, 40) + '...' : data.address;
    doc.text(addr, mL, splitY + 25);
  }

  // --- Right side: Subtotal / Fees / Total ---
  const rightCol = mR - 70;
  const valCol = mR;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...grayText);
  doc.text('Subtotal', rightCol, splitY + 3);
  doc.setTextColor(...darkText);
  doc.setFont('helvetica', 'bold');
  doc.text(formatRp(data.biayaAir), valCol, splitY + 3, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...grayText);
  doc.text('Biaya Beban', rightCol, splitY + 9);
  doc.setTextColor(...darkText);
  doc.text(formatRp(data.biayaBeban), valCol, splitY + 9, { align: 'right' });

  if (data.biayaCicilan > 0) {
    doc.setTextColor(...grayText);
    doc.text('Cicilan', rightCol, splitY + 15);
    doc.setTextColor(...darkText);
    doc.text(formatRp(data.biayaCicilan), valCol, splitY + 15, { align: 'right' });
  }

  // Separator line
  const totLineY = data.biayaCicilan > 0 ? splitY + 20 : splitY + 16;
  doc.setDrawColor(...lightGray);
  doc.setLineWidth(0.4);
  doc.line(rightCol, totLineY, valCol, totLineY);

  // TOTAL box
  const totalBoxY = totLineY + 3;
  doc.setFillColor(...deepBlue);
  doc.roundedRect(rightCol - 2, totalBoxY - 2, valCol - rightCol + 4, 14, 2, 2, 'F');

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...white);
  doc.text('TOTAL', rightCol + 4, totalBoxY + 7);

  doc.setFontSize(13);
  doc.text(formatRp(data.total), valCol - 3, totalBoxY + 7, { align: 'right' });

  // ===== STATUS STAMP =====
  y = totalBoxY + 26;

  if (data.isPaid) {
    // LUNAS stamp
    doc.setDrawColor(...green);
    doc.setLineWidth(2);
    doc.roundedRect(cX - 28, y - 8, 56, 18, 3, 3, 'S');
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...green);
    doc.text('LUNAS', cX, y + 4, { align: 'center' });

    y += 14;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...grayText);
    doc.text(`Dibayar: ${data.paidAt ? formatDate(data.paidAt) : '-'}`, cX, y, { align: 'center' });
    y += 6;
  } else {
    // BELUM LUNAS stamp
    doc.setDrawColor(...red);
    doc.setLineWidth(2);
    doc.roundedRect(cX - 35, y - 8, 70, 18, 3, 3, 'S');
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...red);
    doc.text('BELUM LUNAS', cX, y + 4, { align: 'center' });
    y += 16;
  }

  // ===== SIGNATURE =====
  y += 4;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(...grayText);
  doc.text('Tanda Tangan Admin', mR - 5, y, { align: 'right' });
  y += 20;
  doc.setLineWidth(0.3);
  doc.setDrawColor(...lightGray);
  doc.line(mR - 55, y, mR, y);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text('Petugas Pamsimas Dusun Pilang', mR - 5, y + 5, { align: 'right' });

  // ===== BOTTOM WAVE FOOTER =====
  const footerStartY = pageH - 42;

  // Decorative wave shapes
  doc.setFillColor(...softBlue);
  for (let x = -10; x <= pageW + 10; x += 30) {
    doc.ellipse(x, footerStartY + 4, 22, 10, 'F');
  }

  doc.setFillColor(...lightBlue);
  for (let x = -5; x <= pageW + 5; x += 28) {
    doc.ellipse(x, footerStartY + 10, 20, 8, 'F');
  }

  doc.setFillColor(...medBlue);
  doc.rect(0, footerStartY + 12, pageW, pageH - footerStartY - 12, 'F');

  doc.setFillColor(...deepBlue);
  doc.rect(0, footerStartY + 18, pageW, pageH - footerStartY - 18, 'F');

  // Decorative seaweed/coral shapes (simple vertical ellipses)
  doc.setFillColor(...medBlue);
  doc.ellipse(25, footerStartY + 8, 3, 12, 'F');
  doc.ellipse(32, footerStartY + 10, 2.5, 10, 'F');
  doc.ellipse(pageW - 30, footerStartY + 6, 3, 14, 'F');
  doc.ellipse(pageW - 22, footerStartY + 9, 2.5, 11, 'F');
  doc.ellipse(pageW - 38, footerStartY + 11, 2, 8, 'F');

  // Footer text
  const footY = pageH - 14;
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(200, 220, 240);

  // Left: email
  doc.text('pamsimas.pilang@gmail.com', mL + 5, footY);
  // Center: phone
  doc.text('+0812-xxxx-xxxx', cX, footY, { align: 'center' });
  // Right: address
  doc.text('Dusun Pilang, Wonoayu, Sidoarjo', mR - 5, footY, { align: 'right' });

  // Bottom line with icons (text based)
  doc.setFontSize(7);
  doc.setTextColor(180, 200, 225);
  doc.text(`Dicetak: ${new Date().toLocaleString('id-ID')}`, cX, footY + 7, { align: 'center' });
  doc.text('Pamsimas Dusun Pilang — Sistem Manajemen Air Bersih', cX, footY + 11, { align: 'center' });

  return doc;
}

/**
 * Open WhatsApp with a pre-filled message containing bill/receipt summary.
 * Uses wa.me deep-link.
 */
function sendViaWhatsApp(memberData, billData) {
  const waPhone = toWAPhone(memberData.phone);
  const period = `${monthName(billData.month)} ${billData.year}`;

  let statusText = billData.isPaid ? '✅ *LUNAS*' : '⏳ *BELUM LUNAS*';

  let message = '';
  if (billData.isPaid) {
    message = `Assalamu'alaikum Bpk/Ibu *${memberData.fullName}*,\n\n`;
    message += `Terima kasih, pembayaran Pamsimas Dusun Pilang untuk bulan *${period}* telah kami terima.\n\n`;
    message += `📋 *Ringkasan Kwitansi:*\n`;
    message += `├ ID Pelanggan: ${memberData.id}\n`;
    message += `├ Pemakaian: ${billData.volume} m³\n`;
    message += `├ Biaya Air: ${formatRp(billData.biayaAir)}\n`;
    message += `├ Beban: ${formatRp(billData.biayaBeban)}\n`;
    if (billData.biayaCicilan > 0) {
      message += `├ Cicilan: ${formatRp(billData.biayaCicilan)}\n`;
    }
    message += `└ *Total Bayar: ${formatRp(billData.total)}*\n\n`;
    message += `Status: ${statusText}\n\n`;
    message += `Terima kasih atas partisipasi Bapak/Ibu dalam membangun dusun kita! 🙏\n`;
    message += `— _Admin Pamsimas Pilang_`;
  } else {
    message = `Assalamu'alaikum Bpk/Ibu *${memberData.fullName}*,\n\n`;
    message += `Berikut tagihan Pamsimas Dusun Pilang untuk bulan *${period}*:\n\n`;
    message += `📋 *Rincian Tagihan:*\n`;
    message += `├ ID Pelanggan: ${memberData.id}\n`;
    message += `├ Pemakaian: ${billData.volume} m³\n`;
    message += `├ Biaya Air: ${formatRp(billData.biayaAir)}\n`;
    message += `├ Beban: ${formatRp(billData.biayaBeban)}\n`;
    if (billData.biayaCicilan > 0) {
      message += `├ Cicilan: ${formatRp(billData.biayaCicilan)}\n`;
    }
    message += `└ *TOTAL: ${formatRp(billData.total)}*\n\n`;
    message += `Mohon segera lakukan pembayaran kepada petugas kami.\n`;
    message += `Terima kasih 🙏\n`;
    message += `— _Admin Pamsimas Pilang_`;
  }

  const url = `https://wa.me/${waPhone}?text=${encodeURIComponent(message)}`;
  window.open(url, '_blank');
}


// --- 2. ROUTER & CONTROLLER ---

// Hash based routing
function handleRoute() {
  const hash = window.location.hash || '#';
  const session = getSession();

  if (!session) {
    if (hash === '#portal') return renderPublicPortal();
    return renderLogin();
  }

  // Authenticated routing
  const role = session.role; // 'admin' atau 'petugas'

  // Default routes based on role
  if (hash === '#' || hash === '') {
    window.location.hash = role === 'admin' ? '#dashboard' : '#tugas';
    return;
  }

  // Render main layout wrapper first if needed
  let contentArea = document.getElementById('main-content-area');
  if (!contentArea) {
    renderAppLayout(session);
    contentArea = document.getElementById('main-content-area');
  }

  // Update active sidebar link
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const activeLink = document.querySelector(`.nav-item[href="${hash}"]`);
  if (activeLink) activeLink.classList.add('active');

  // Routes switch
  contentArea.innerHTML = ''; // clear area

  if (role === 'admin') {
    switch (hash) {
      case '#dashboard': renderAdminDashboard(contentArea); break;
      case '#pelanggan': renderAdminPelanggan(contentArea); break;
      case '#pemasangan': renderAdminPemasangan(contentArea); break;
      case '#pencatatan': renderAdminPencatatan(contentArea); break;
      case '#tagihan': renderAdminTagihan(contentArea); break;
      case '#laporan': renderAdminLaporan(contentArea); break;
      case '#petugas': renderAdminPetugas(contentArea); break;
      case '#pengaturan': renderAdminPengaturan(contentArea); break;
      default: renderAdminDashboard(contentArea);
    }
  } else if (role === 'petugas') {
    switch (hash) {
      case '#tugas': renderPetugasTugas(contentArea); break;
      case '#pasang': renderPetugasPasang(contentArea); break;
      case '#riwayat': renderPetugasRiwayat(contentArea); break;
      default: renderPetugasTugas(contentArea);
    }
  }
}

// --- 3. VIEWS: LOGIN & PORTAL ---

function renderLogin() {
  appRoot.innerHTML = `
    <div class="auth-page">
      <div class="auth-bg-shapes">
        <div class="shape-1"></div>
        <div class="shape-2"></div>
      </div>
      
      <div class="auth-container animate-slide-up">
        <div class="auth-card">
          <div class="auth-logo">
            <i class="fas fa-hand-holding-water"></i>
            <h2>PAMSIMAS</h2>
            <p style="margin:0; font-size:0.9rem;">Sistem Informasi Air Bersih Dusun Pilang</p>
          </div>
          
          <form id="loginForm">
            <div class="form-group">
              <label>Username</label>
              <div style="position:relative;">
                <i class="fas fa-user" style="position:absolute; left:14px; top:14px; color:var(--text-muted)"></i>
                <input id="loginUsername" type="text" required style="padding-left:40px;" placeholder="Masukkan username" />
              </div>
            </div>
            
            <div class="form-group">
              <label>Password</label>
              <div style="position:relative;">
                <i class="fas fa-lock" style="position:absolute; left:14px; top:14px; color:var(--text-muted)"></i>
                <input id="loginPassword" type="password" required style="padding-left:40px;" placeholder="Masukkan password" />
                <i class="fas fa-eye" id="togglePassword" style="position:absolute; right:14px; top:14px; color:var(--text-muted); cursor:pointer;"></i>
              </div>
            </div>
            
            <button type="submit" class="btn btn-primary w-full" style="padding:12px; font-size:1rem; margin-top:10px;">
              Masuk Sistem <i class="fas fa-arrow-right"></i>
            </button>
          </form>
        </div>
        
        <div class="public-portal-card cursor-pointer" id="btnToPortal">
          <h3 style="margin-bottom:5px; color:var(--text-primary);"><i class="fas fa-search me-2"></i> Cek Tagihan Warga</h3>
          <p style="margin:0; font-size:0.85rem;">Lihat tagihan dan riwayat pemakaian tanpa login</p>
        </div>
      </div>
    </div>
  `;

  // Logic Login
  document.getElementById('togglePassword').onclick = (e) => {
    const inp = document.getElementById('loginPassword');
    inp.type = inp.type === 'password' ? 'text' : 'password';
    e.target.className = inp.type === 'password' ? 'fas fa-eye' : 'fas fa-eye-slash';
  };

  document.getElementById('btnToPortal').onclick = () => {
    window.location.hash = '#portal';
  };

  document.getElementById('loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const u = e.target.loginUsername.value.trim();
    const p = e.target.loginPassword.value;

    // Disable button to prevent double submit
    btn.disabled = true;
    const oldText = btn.innerHTML;
    btn.innerHTML = 'Memproses... <i class="fas fa-spinner fa-spin"></i>';

    // Try API login first, fall back to localStorage if server is unavailable
    let loggedIn = false;

    try {
      const res = await apiLogin(u, p);
      if (res && res.user) {
        setSession({
          username: res.user.username,
          email: res.user.email,
          role: res.user.role,
          name: res.user.name
        });
        loggedIn = true;
      }
    } catch (err) {
      // API unavailable — try localStorage fallback
      const admin = JSON.parse(localStorage.getItem(STORAGE.admin));
      const users = getDB(STORAGE.users);

      if (admin && u === admin.username && p === admin.password) {
        setSession({ username: admin.username, role: admin.role, name: admin.name });
        loggedIn = true;
      } else {
        const petugas = users.find(x => x.username === u && x.password === p);
        if (petugas) {
          setSession({ username: petugas.username, role: petugas.role, name: petugas.name });
          loggedIn = true;
        }
      }
    }

    if (loggedIn) {
      const session = getSession();
      showToast(`Login berhasil sebagai ${session.role === 'admin' ? 'Admin' : 'Petugas'}`);
      window.location.hash = session.role === 'admin' ? '#dashboard' : '#tugas';
      handleRoute();
    } else {
      showToast('Login gagal, periksa username dan password!', 'error');
    }

    btn.disabled = false;
    btn.innerHTML = oldText;
  };
}

function renderPublicPortal() {
  appRoot.innerHTML = `
    <div class="auth-page">
      <div class="auth-bg-shapes">
        <div class="shape-1"></div>
      </div>
      
      <div class="auth-container animate-slide-up" style="max-width: 600px;">
        <button class="btn btn-icon mb-4" id="btnBackLogin" style="background:var(--surface);">
          <i class="fas fa-arrow-left"></i>
        </button>
        
        <div class="card text-center">
          <i class="fas fa-tint text-info mb-4" style="font-size: 3rem;"></i>
          <h2>Portal Warga Pamsimas</h2>
          <p>Cek tagihan, riwayat pemakaian, dan status cicilan Anda secara transparan.</p>
          
          <div class="form-group mt-6 text-left">
            <label>Pencarian berdasarkan Nomor Pelanggan (ID)</label>
            <div class="flex gap-2">
              <input id="portalSearchId" placeholder="Contoh: P-001" style="flex:1;" />
              <button id="btnSearchPortal" class="btn btn-primary"><i class="fas fa-search"></i> Cek</button>
            </div>
          </div>
          
          <div class="divider" style="margin:20px 0; border-bottom:1px solid var(--border); position:relative;">
             <span style="position:absolute; top:-10px; left:50%; transform:translateX(-50%); background:var(--bg-glass); padding:0 10px; font-size:0.8rem; color:var(--text-muted);">atau</span>
          </div>
          
          <div class="form-group text-left" style="margin-top: 30px;">
            <label>Pencarian berdasarkan Nama Pendaftar</label>
            <div class="flex gap-2">
              <input id="portalSearchName" placeholder="Ketik nama Anda..." style="flex:1;" />
              <button id="btnSearchNamePortal" class="btn btn-outline"><i class="fas fa-search"></i> Cari</button>
            </div>
          </div>
        </div>
        
        <div id="portalResultArea"></div>
      </div>
    </div>
  `;

  document.getElementById('btnBackLogin').onclick = () => {
    window.location.hash = '#';
  };

  const search = () => {
    const id = document.getElementById('portalSearchId').value.trim();
    if (!id) return;
    renderPortalResult(id);
  };

  const searchName = () => {
    const name = document.getElementById('portalSearchName').value.trim().toLowerCase();
    if (!name) return;
    const members = getDB(STORAGE.members);
    const matches = members.filter(m => m.fullName.toLowerCase().includes(name));

    const res = document.getElementById('portalResultArea');
    if (matches.length === 0) {
      res.innerHTML = `<div class="card mt-4 text-center border-danger text-danger"><i class="fas fa-exclamation-triangle"></i> Data tidak ditemukan.</div>`;
      return;
    }

    if (matches.length === 1) {
      renderPortalResult(matches[0].id);
      return;
    }

    // Multiple matches
    let html = `<div class="card mt-4"><h3>Ditemukan ${matches.length} pelanggan:</h3><ul style="list-style:none; padding:0; margin-top:10px;">`;
    matches.forEach(m => {
      html += `<li style="padding:10px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">
          <div><b style="color:var(--accent-info)">${m.id}</b> - ${m.fullName}<br><small>${m.zone}</small></div>
          <button class="btn btn-outline btn-select-member" data-id="${m.id}">Lihat Detail</button>
        </li>`;
    });
    html += `</ul></div>`;
    res.innerHTML = html;

    res.querySelectorAll('.btn-select-member').forEach(btn => {
      btn.onclick = (e) => renderPortalResult(e.target.dataset.id);
    });
  };

  document.getElementById('btnSearchPortal').onclick = search;
  document.getElementById('btnSearchNamePortal').onclick = searchName;
}

function renderPortalResult(memberId) {
  const members = getDB(STORAGE.members);
  const member = members.find(m => m.id === memberId);
  const res = document.getElementById('portalResultArea');

  if (!member) {
    res.innerHTML = `<div class="card mt-4 text-center text-danger"><i class="fas fa-times-circle" style="font-size:2rem; margin-bottom:10px;"></i><br>Nomor Pelanggan tidak ditemukan.</div>`;
    return;
  }

  // Calculate current bill
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // current month

  const usage = getDB(STORAGE.usage).find(u => u.memberId === memberId && u.year === year && u.month === month);
  const payment = getDB(STORAGE.payments).find(p => p.memberId === memberId && p.year === year && p.month === month);
  const installment = getDB(STORAGE.installments).find(i => i.memberId === memberId && i.status === 'active');

  const rate = Number(localStorage.getItem(STORAGE.rate)) || 2100;
  const adminFee = Number(localStorage.getItem(STORAGE.adminFee)) || 500;

  let billAir = 0;
  let cicilanBulanIni = 0;
  let hasCicilan = false;
  let cicilanProgress = 0;
  let cicilanBulanKe = 0;

  if (usage) {
    billAir = usage.volume * rate;
  }

  if (installment) {
    const start = new Date(installment.startYear, installment.startMonth - 1, 1);
    const current = new Date(year, month - 1, 1);
    const diffMonths = (current.getFullYear() - start.getFullYear()) * 12 + (current.getMonth() - start.getMonth());

    if (diffMonths >= 0 && diffMonths < installment.tenure) {
      hasCicilan = true;
      cicilanBulanIni = installment.monthlyAmount;
      cicilanBulanKe = diffMonths + 1;
      cicilanProgress = (cicilanBulanKe / installment.tenure) * 100;
    }
  }

  const isBilled = usage != null;
  const totalDue = isBilled ? (billAir + adminFee + cicilanBulanIni) : 0;
  const isPaid = payment != null;

  let statusHTML = ``;
  if (!isBilled) {
    statusHTML = `<div class="badge badge-warning" style="font-size:1rem; padding:8px 16px;"><i class="fas fa-clock"></i> Belum Dicatat</div>`;
  } else if (isPaid) {
    statusHTML = `<div class="badge badge-success" style="font-size:1rem; padding:8px 16px;"><i class="fas fa-check-circle"></i> Lunas</div>
                    <p style="font-size:0.8rem; margin-top:5px; color:var(--accent-success)">Dibayar: ${formatDate(payment.paidAt)}</p>`;
  } else {
    statusHTML = `<div class="badge badge-danger" style="font-size:1rem; padding:8px 16px;"><i class="fas fa-exclamation-circle"></i> Belum Lunas</div>`;
  }

  res.innerHTML = `
    <div class="card mt-4 animate-slide-up" style="border-top: 4px solid var(--accent-primary)">
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div>
          <h2 style="margin-bottom:5px; color:var(--text-primary);"><i class="fas fa-user-circle text-info"></i> ${member.fullName}</h2>
          <p style="margin:0;"><span class="badge badge-info">${member.id}</span> | ${member.zone}</p>
        </div>
        <div style="text-align:right">
          <small class="text-muted">Periode Tagihan</small><br>
          <b style="font-size:1.1rem; color:var(--accent-primary)">${new Date(0, month - 1).toLocaleString('id-ID', { month: 'long' })} ${year}</b>
        </div>
      </div>
      
      <div class="divider" style="margin:20px 0; border-bottom:1px solid var(--border);"></div>
      
      <div style="text-align:center; margin-bottom: 20px;">
         <p class="text-muted" style="margin-bottom:5px;">Status Pembayaran</p>
         ${statusHTML}
      </div>
      
      ${isBilled ? `
      <div style="background:var(--surface); padding:15px; border-radius:var(--radius-md); margin-bottom:20px;">
        <div class="flex justify-between mb-2">
          <span class="text-secondary">Pemakaian Air (${usage.volume} m³)</span>
          <span class="font-semibold">${formatRp(billAir)}</span>
        </div>
        <div class="flex justify-between mb-2">
          <span class="text-secondary">Biaya Beban</span>
          <span class="font-semibold">${formatRp(adminFee)}</span>
        </div>
        ${hasCicilan ? `
        <div class="flex justify-between mb-2">
          <span class="text-secondary">Cicilan Pemasangan (Bulan ${cicilanBulanKe}/${installment.tenure})</span>
          <span class="font-semibold text-warning">${formatRp(cicilanBulanIni)}</span>
        </div>
        ` : ''}
        <div class="divider" style="margin:10px 0; border-bottom:1px dashed var(--border);"></div>
        <div class="flex justify-between">
          <span class="font-bold text-primary" style="font-size:1.1rem">Total Tagihan</span>
          <span class="font-bold text-primary" style="font-size:1.2rem">${formatRp(totalDue)}</span>
        </div>
      </div>
      
      ${hasCicilan ? `
      <div style="margin-bottom:20px;">
         <label><i class="fas fa-tools text-warning"></i> Progress Cicilan Pemasangan</label>
         <div class="progress-container">
            <div class="progress-bar" style="width: ${cicilanProgress}%; background:var(--accent-warning)"></div>
         </div>
         <small class="flex justify-between text-muted"><span>0%</span><span>Bulan ke-${cicilanBulanKe} dari ${installment.tenure}</span></small>
      </div>
      ` : ''}
      
      ${usage.photoData ? `
       <div style="margin-bottom:20px;">
         <label><i class="fas fa-camera text-info"></i> Bukti Meteran Bulan Ini (Angka: ${usage.currentReading})</label>
         <div style="background:#000; padding:10px; border-radius:10px; text-align:center;">
            <img src="${usage.photoData}" style="max-width:100%; max-height:200px; border-radius:6px;"/>
         </div>
       </div>
      ` : `
       <div style="margin-bottom:20px;">
         <label><i class="fas fa-camera text-muted"></i> Bukti Meteran</label>
         <div style="background:var(--surface); padding:15px; border-radius:10px; text-align:center; color:var(--text-muted); font-style:italic;">
            (Tidak ada foto dilampirkan oleh petugas)
         </div>
       </div>
      `}
      ` : `
       <div style="background:rgba(59, 130, 246, 0.1); padding:20px; text-align:center; border-radius:var(--radius-md); border:1px dashed var(--accent-primary);">
         <i class="fas fa-hourglass-half text-info mb-2" style="font-size:2rem;"></i>
         <p style="margin:0; color:var(--text-primary);">Data meteran Anda untuk bulan ini belum dicatat oleh petugas kami. Harap bersabar.</p>
       </div>
      `}
    </div>
  `;
}

// --- 4. VIEWS: MASTER LAYOUT ---
function renderAppLayout(session) {
  const isAdmin = session.role === 'admin';

  appRoot.innerHTML = `
    <div class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <div class="sidebar-logo"><i class="fas fa-tint"></i></div>
        <div class="sidebar-title">PAMSIMAS</div>
      </div>
      
      <div class="sidebar-nav">
        ${isAdmin ? `
          <div class="nav-label">Main Menu</div>
          <a class="nav-item active" href="#dashboard"><i class="fas fa-chart-pie"></i> Dashboard</a>
          <a class="nav-item" href="#pelanggan"><i class="fas fa-users"></i> Pelanggan</a>
          <a class="nav-item" href="#pemasangan"><i class="fas fa-tools"></i> Pemasangan</a>
          
          <div class="nav-label">Operasional</div>
          <a class="nav-item" href="#pencatatan"><i class="fas fa-clipboard-list"></i> Pencatatan</a>
          <a class="nav-item" href="#tagihan"><i class="fas fa-file-invoice-dollar"></i> Tagihan</a>
          
          <div class="nav-label">Sistem</div>
          <a class="nav-item" href="#laporan"><i class="fas fa-chart-bar"></i> Laporan</a>
          <a class="nav-item" href="#petugas"><i class="fas fa-user-tie"></i> Petugas</a>
          <a class="nav-item" href="#pengaturan"><i class="fas fa-cog"></i> Pengaturan</a>
        ` : `
          <div class="nav-label">Tugas Lapangan</div>
          <a class="nav-item active" href="#tugas"><i class="fas fa-clipboard-list"></i> Tugas Hari Ini</a>
          <a class="nav-item" href="#pasang"><i class="fas fa-tools"></i> Pemasangan Baru</a>
          
          <div class="nav-label">Personal</div>
          <a class="nav-item" href="#riwayat"><i class="fas fa-history"></i> Riwayat Tugas</a>
        `}
      </div>
      
      <div class="sidebar-footer">
        <button id="btnLogout" class="btn btn-outline w-full text-danger border-danger"><i class="fas fa-sign-out-alt"></i> Keluar</button>
      </div>
    </div>
    
    <div class="main-wrapper" id="main-wrapper">
      <div class="topbar">
        <div class="flex items-center gap-3">
          <button class="mobile-menu-btn" id="btnToggleSidebar"><i class="fas fa-bars"></i></button>
          <div id="topbar-title">
            <h2 style="margin:0; font-size:1.25rem;">Dashboard</h2>
            <small class="text-muted" id="topbar-date">Loading date...</small>
          </div>
        </div>
        
        <div class="user-profile">
          <div class="text-right" style="display:flex; flex-direction:column;">
            <b style="font-size:0.9rem;">${session.name}</b>
            <small class="text-muted" style="text-transform:capitalize;">${session.role}</small>
          </div>
          <div class="avatar"><i class="fas ${isAdmin ? 'fa-user-shield' : 'fa-user'}"></i></div>
        </div>
      </div>
      
      <div class="main-content" id="main-content-area">
        <!-- Content injected here -->
      </div>
    </div>
  `;

  // Logic Layout
  document.getElementById('btnLogout').onclick = async () => {
    try { await apiLogout(); } catch (e) { console.error('Logout error:', e); }
    logAction('logout', 'User logged out');
    clearSession();
    window.location.hash = '#';
  };

  // Mobile sidebar toggle
  const sidebar = document.getElementById('sidebar');
  document.getElementById('btnToggleSidebar').onclick = () => {
    sidebar.classList.toggle('open');
  };

  // Update Real-time date
  const updateDate = () => {
    const el = document.getElementById('topbar-date');
    if (el) {
      const d = new Date();
      el.innerText = d.toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }) + ' - ' + d.toLocaleTimeString('id-ID');
    }
  };
  updateDate();
  setInterval(updateDate, 1000);
}

function updateTopbarTitle(title) {
  const el = document.getElementById('topbar-title');
  if (el) {
    el.querySelector('h2').innerText = title;
  }
}

// --- 5. VIEWS: ADMIN ---

function renderAdminDashboard(container) {
  updateTopbarTitle('Dashboard Utama');

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const monthNameStr = new Date(0, month - 1).toLocaleString('id-ID', { month: 'short' });

  container.innerHTML = `
    <div id="dashboardLoading" class="text-center py-10">
      <i class="fas fa-spinner fa-spin fa-2x text-primary"></i>
      <p class="mt-4 text-muted">Memuat data dashboard...</p>
    </div>
    <div id="dashboardContent" style="display:none;"></div>
  `;

  const loadDashboard = async () => {
    // Compute KPIs from localStorage
    const members = getDB(STORAGE.members);
    const usages = getDB(STORAGE.usage);
    const payments = getDB(STORAGE.payments);
    const installments = getDB(STORAGE.installments);
    const rate = Number(localStorage.getItem(STORAGE.rate)) || 2100;
    const adminFee = Number(localStorage.getItem(STORAGE.adminFee)) || 500;

    const activeMembers = members.filter(m => m.status !== 'nonaktif');
    const monthUsages = usages.filter(u => u.year === year && u.month === month);
    const monthPayments = payments.filter(p => p.year === year && p.month === month);

    // Revenue this month
    let revenueTotal = 0;
    monthPayments.forEach(p => { revenueTotal += (p.total || 0); });

    // Arrears (previous month)
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const prevUsages = usages.filter(u => u.year === prevYear && u.month === prevMonth);
    const prevPayments = payments.filter(p => p.year === prevYear && p.month === prevMonth);
    const arrearsCount = prevUsages.length - prevPayments.length;
    const arrearsRate = prevUsages.length > 0 ? Math.round((arrearsCount / prevUsages.length) * 100) : 0;

    // Recording rate
    const recordedCount = monthUsages.length;
    const recordingRate = activeMembers.length > 0 ? Math.round((recordedCount / activeMembers.length) * 100) : 0;

    // Installments
    const activeInstallments = installments.filter(i => i.status === 'active');
    let outstandingDebt = 0;
    activeInstallments.forEach(inst => {
      const remaining = inst.totalAmount - (inst.monthsPaid * inst.monthlyAmount);
      outstandingDebt += Math.max(0, remaining);
    });

    // Chart data (last 6 months)
    const chartLabels = [];
    const chartValues = [];
    for (let i = 5; i >= 0; i--) {
      let cm = month - i;
      let cy = year;
      if (cm <= 0) { cm += 12; cy--; }
      chartLabels.push(new Date(0, cm - 1).toLocaleString('id-ID', { month: 'short' }) + ' ' + cy);
      const mPayments = payments.filter(p => p.year === cy && p.month === cm);
      let mTotal = 0;
      mPayments.forEach(p => { mTotal += (p.total || 0); });
      chartValues.push(mTotal);
    }

    const kpi = {
      revenue: { total: revenueTotal },
      members: { active: activeMembers.length, total: members.length },
      arrears: { rate: arrearsRate < 0 ? 0 : arrearsRate, count: arrearsCount < 0 ? 0 : arrearsCount },
      recording: { rate: recordingRate, recorded: recordedCount, total: activeMembers.length },
      installments: { activeCount: activeInstallments.length, outstandingDebt }
    };
    const chartData = { labels: chartLabels, data: chartValues };

    const content = document.getElementById('dashboardContent');
    const loader = document.getElementById('dashboardLoading');

    content.innerHTML = `
      <div class="kpi-grid animate-fade-in">
        <div class="card kpi-card">
          <i class="fas fa-wallet kpi-icon text-success"></i>
          <div class="kpi-title">Pendapatan Bulan Ini</div>
          <div class="kpi-value">${formatRp(kpi.revenue.total)}</div>
          <div class="kpi-trend text-success"><i class="fas fa-arrow-up"></i> <span>Data realtime</span></div>
        </div>
        <div class="card kpi-card">
          <i class="fas fa-users kpi-icon text-info"></i>
          <div class="kpi-title">Pelanggan Aktif</div>
          <div class="kpi-value">${kpi.members.active}</div>
          <div class="kpi-trend text-muted"><span>Total ${kpi.members.total} terdaftar</span></div>
        </div>
        <div class="card kpi-card">
          <i class="fas fa-exclamation-triangle kpi-icon text-danger"></i>
          <div class="kpi-title">Tunggakan (Bulan Lalu)</div>
          <div class="kpi-value text-danger">${kpi.arrears.rate}%</div>
          <div class="kpi-trend text-danger"><i class="fas fa-circle"></i> <span>${kpi.arrears.count} warga belum lunas</span></div>
        </div>
        <div class="card kpi-card">
          <i class="fas fa-tasks kpi-icon text-primary"></i>
          <div class="kpi-title">Rasio Pencatatan (${monthNameStr})</div>
          <div class="kpi-value">${kpi.recording.rate}%</div>
          <div class="kpi-trend text-primary"><span>${kpi.recording.recorded} dari ${kpi.recording.total} dicatat</span></div>
        </div>
      </div>
      
      <div class="flex flex-col lg:flex-row gap-6 animate-slide-up" style="display:grid; grid-template-columns: 2fr 1fr; gap:1.5rem;">
        <div class="card">
          <div class="card-header">
            <h3><i class="fas fa-chart-area text-info"></i> Grafik Pendapatan & Pemakaian (6 Bulan)</h3>
          </div>
          <canvas id="dashboardChart" height="120"></canvas>
        </div>
        
        <div class="card">
           <div class="card-header">
            <h3><i class="fas fa-bolt text-warning"></i> Aktivitas Terbaru</h3>
          </div>
          <div id="activityFeed" style="display:flex; flex-direction:column; gap:15px; max-height:300px; overflow-y:auto; padding-right:10px;">
            <!-- feed -->
          </div>
        </div>
      </div>
      
      <div class="card mt-6 animate-slide-up">
         <div class="card-header">
            <h3><i class="fas fa-handshake text-primary"></i> Ringkasan Cicilan Pemasangan</h3>
          </div>
          <div class="flex items-center justify-between">
             <div>
                <p style="margin:0" class="text-secondary">Warga dengan Cicilan Aktif</p>
                <h2 style="margin:5px 0 0 0" class="text-primary">${kpi.installments.activeCount} Orang</h2>
             </div>
             <div style="text-align:right">
                <p style="margin:0" class="text-secondary">Estimasi Piutang Sisa</p>
                <h2 style="margin:5px 0 0 0" class="text-warning">${formatRp(kpi.installments.outstandingDebt)}</h2>
             </div>
          </div>
      </div>
    `;

    loader.style.display = 'none';
    content.style.display = 'block';

    // Render Chart
    const ctx = document.getElementById('dashboardChart');
    if (ctx) {
      new Chart(ctx, {
        type: 'bar',
        data: {
          labels: chartData.labels,
          datasets: [
            { label: 'Total Pendapatan (Rp)', data: chartData.data, backgroundColor: 'rgba(59, 130, 246, 0.8)', borderRadius: 4 }
          ]
        },
        options: { responsive: true, plugins: { legend: { display: false } } }
      });
    }

    // Render Activity Feed
    const logs = getDB(STORAGE.logs).slice(0, 10);
    const feed = document.getElementById('activityFeed');
    let feedHTML = '';

    if (logs.length === 0) feedHTML = '<p class="text-muted text-center pt-4">Belum ada aktivitas.</p>';

    logs.forEach(log => {
      let icon = 'fa-info-circle';
      let color = 'text-primary';

      if (log.action === 'login') { icon = 'fa-sign-in-alt'; color = 'text-success'; }
      if (log.action === 'bayar') { icon = 'fa-money-bill-wave'; color = 'text-success'; }
      if (log.action === 'catat') { icon = 'fa-check'; color = 'text-info'; }
      if (log.action === 'pasang') { icon = 'fa-tools'; color = 'text-warning'; }

      feedHTML += `
          <div style="display:flex; gap:12px; align-items:flex-start; border-bottom:1px solid var(--border); padding-bottom:10px;">
             <div style="width:32px; height:32px; border-radius:16px; background:var(--surface); display:grid; place-items:center;" class="${color}">
               <i class="fas ${icon}"></i>
             </div>
             <div>
               <b style="font-size:0.9rem; color:var(--text-primary)">${log.username}</b>
               <p style="margin:2px 0 0 0; font-size:0.85rem; color:var(--text-secondary)">${log.details}</p>
               <span style="font-size:0.75rem; color:var(--text-muted)">${formatDate(log.timestamp)}</span>
             </div>
          </div>
        `;
    });
    feed.innerHTML = feedHTML;
  };

  loadDashboard();
}


function renderAdminPelanggan(container) {
  updateTopbarTitle('Manajemen Pelanggan');
  const members = getDB(STORAGE.members);

  container.innerHTML = `
    <div class="card animate-fade-in">
      <div class="flex justify-between items-center mb-4" style="flex-wrap:wrap; gap:10px;">
        <div class="flex gap-2" style="flex:1; min-width:300px;">
          <input type="text" id="searchMember" placeholder="Cari nama, ID, blok..." style="max-width:300px;" />
          <select id="filterZone" style="max-width:150px;">
            <option value="">Semua Blok</option>
            ${[...new Set(members.map(m => m.zone))].filter(Boolean).map(z => `<option value="${z}">${z}</option>`).join('')}
          </select>
        </div>
        <button class="btn btn-primary" id="btnAddMember"><i class="fas fa-plus"></i> Tambah Warga</button>
      </div>
      
      <div class="table-container">
        <table class="spreadsheet-table" id="memberTable">
          <thead>
            <tr>
              <th>ID</th>
              <th>Nama Lengkap</th>
              <th>Alamat</th>
              <th>Blok/Zona</th>
              <th>No. HP</th>
              <th>Status</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody id="memberTbody">
             <!-- Rendered by JS -->
          </tbody>
        </table>
      </div>
      <p class="text-muted" style="font-size:0.85rem;" id="memberCount"></p>
    </div>
    
    <!-- Modal Tambah/Edit -->
    <div id="memberModal" style="display:none; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); z-index:999; align-items:center; justify-content:center; padding:20px;">
      <div class="card" style="width:100%; max-width:500px; animation: fadeSlideUp 0.3s ease;">
        <div class="flex justify-between items-center mb-4">
          <h3 style="margin:0" id="modalTitle">Tambah Warga Baru</h3>
          <button class="btn-icon" id="btnCloseModal"><i class="fas fa-times"></i></button>
        </div>
        <form id="memberForm">
          <input type="hidden" id="editMemberId" />
          <div class="form-group">
            <label>ID Pelanggan (Otomatis jika kosong)</label>
            <input type="text" id="mId" placeholder="Misal: P-001" />
          </div>
          <div class="form-group">
            <label>Nama Lengkap*</label>
            <input type="text" id="mName" required />
          </div>
          <div class="form-group">
            <label>Alamat*</label>
            <input type="text" id="mAddress" required />
          </div>
          <div class="flex gap-4">
            <div class="form-group" style="flex:1">
              <label>Blok/Zona*</label>
              <input type="text" id="mZone" placeholder="Cth: Blok A" required />
            </div>
            <div class="form-group" style="flex:1">
              <label>No. WhatsApp*</label>
              <input type="text" id="mPhone" required />
            </div>
          </div>
          <div class="form-group">
            <label>Status</label>
            <select id="mStatus">
              <option value="aktif">Aktif (Ditagih bulanan)</option>
              <option value="nonaktif">Nonaktif (Berhenti langganan)</option>
            </select>
          </div>
          <div class="flex justify-between mt-4">
            <button type="button" class="btn btn-outline" id="btnCancelModal">Batal</button>
            <button type="submit" class="btn btn-primary">Simpan Data</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const tbody = document.getElementById('memberTbody');
  const countEl = document.getElementById('memberCount');

  const renderTable = () => {
    const search = document.getElementById('searchMember').value.toLowerCase();
    const zone = document.getElementById('filterZone').value;

    const filtered = getDB(STORAGE.members).filter(m => {
      const textMatch = [m.id, m.fullName, m.address, m.phone].join(' ').toLowerCase().includes(search);
      const zoneMatch = !zone || m.zone === zone;
      return textMatch && zoneMatch;
    });

    countEl.innerText = `Menampilkan ${filtered.length} riwayat`;

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">Tidak ada data pelanggan.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(m => `
        <tr>
          <td data-label="ID"><span class="badge badge-info">${m.id}</span></td>
          <td data-label="Nama Lengkap" class="font-semibold">${m.fullName}</td>
          <td data-label="Alamat">${m.address}</td>
          <td data-label="Blok">${m.zone}</td>
          <td data-label="No. HP">${m.phone}</td>
          <td data-label="Status">${m.status === 'aktif' ? '<span class="badge badge-success">Aktif</span>' : '<span class="badge badge-danger">Nonaktif</span>'}</td>
          <td data-label="Aksi" style="white-space:nowrap;">
            <button class="btn btn-outline btn-sm" style="padding:4px 8px; font-size:0.8rem;" onclick="editMember('${m.id}')"><i class="fas fa-edit"></i></button>
            <button class="btn btn-danger btn-sm" style="padding:4px 8px; font-size:0.8rem; border:none; background:transparent;" onclick="deleteMember('${m.id}')"><i class="fas fa-trash"></i></button>
          </td>
        </tr>
     `).join('');
  };

  document.getElementById('searchMember').addEventListener('input', renderTable);
  document.getElementById('filterZone').addEventListener('change', renderTable);

  const modal = document.getElementById('memberModal');
  const form = document.getElementById('memberForm');

  const openModal = (isEdit = false) => {
    modal.style.display = 'flex';
    document.getElementById('modalTitle').innerText = isEdit ? 'Edit Warga' : 'Tambah Warga Baru';
  };
  const closeModal = () => {
    modal.style.display = 'none';
    form.reset();
    document.getElementById('editMemberId').value = '';
  };

  document.getElementById('btnAddMember').onclick = () => openModal(false);
  document.getElementById('btnCloseModal').onclick = closeModal;
  document.getElementById('btnCancelModal').onclick = closeModal;

  window.editMember = (id) => {
    const m = getDB(STORAGE.members).find(x => x.id === id);
    if (!m) return;
    document.getElementById('editMemberId').value = m.id;
    document.getElementById('mId').value = m.id;
    document.getElementById('mId').readOnly = true;
    document.getElementById('mName').value = m.fullName;
    document.getElementById('mAddress').value = m.address;
    document.getElementById('mZone').value = m.zone;
    document.getElementById('mPhone').value = m.phone;
    document.getElementById('mStatus').value = m.status || 'aktif';
    openModal(true);
  };

  window.deleteMember = (id) => {
    if (confirm(`Yakin ingin menghapus pelanggan ${id}? Data pemakaian mungkin akan yatim.`)) {
      const members = getDB(STORAGE.members).filter(x => x.id !== id);
      saveDB(STORAGE.members, members);
      logAction('hapus_warga', `Menghapus warga ID: ${id}`);
      showToast('Data warga dihapus');
      renderTable();
    }
  };

  form.onsubmit = (e) => {
    e.preventDefault();
    const editId = document.getElementById('editMemberId').value;
    const members = getDB(STORAGE.members);

    let generatedId = document.getElementById('mId').value.trim();
    if (!generatedId) {
      const max = members.length > 0 ? Math.max(...members.map(m => parseInt(m.id.replace(/\D/g, '')) || 0)) : 0;
      generatedId = `P-${String(max + 1).padStart(3, '0')}`;
    }

    const data = {
      id: editId || generatedId,
      fullName: document.getElementById('mName').value.trim(),
      address: document.getElementById('mAddress').value.trim(),
      zone: document.getElementById('mZone').value.trim(),
      phone: document.getElementById('mPhone').value.trim(),
      status: document.getElementById('mStatus').value
    };

    if (editId) {
      const idx = members.findIndex(x => x.id === editId);
      members[idx] = data;
      logAction('edit_warga', `Mengedit warga ID: ${editId}`);
    } else {
      if (members.find(x => x.id === data.id)) {
        showToast('ID sudah digunakan!', 'error');
        return;
      }
      members.push(data);
      logAction('tambah_warga', `Menambah warga baru: ${data.fullName}`);
    }

    saveDB(STORAGE.members, members);
    showToast(editId ? 'Perubahan disimpan' : 'Warga baru ditambahkan');
    closeModal();

    // Refresh filter
    const filterZone = document.getElementById('filterZone');
    const currentZones = [...new Set(members.map(m => m.zone))].filter(Boolean);
    filterZone.innerHTML = `<option value="">Semua Blok</option>` + currentZones.map(z => `<option value="${z}">${z}</option>`).join('');

    renderTable();
  };

  renderTable();
}

function renderAdminPemasangan(container) {
  updateTopbarTitle('Pemasangan Baru');

  container.innerHTML = `
    <div class="card animate-fade-in">
       <div class="stepper">
          <div class="step active" id="step1">
             <div class="step-circle">1</div>
             <div class="step-label">Data Warga</div>
          </div>
          <div class="step" id="step2">
             <div class="step-circle">2</div>
             <div class="step-label">Biaya</div>
          </div>
          <div class="step" id="step3">
             <div class="step-circle">3</div>
             <div class="step-label">Pembayaran</div>
          </div>
          <div class="step" id="step4">
             <div class="step-circle">4</div>
             <div class="step-label">Selesai (SPK)</div>
          </div>
       </div>
       
       <div id="wizardContent" style="min-height:300px;">
          <!-- Content Wizard -->
       </div>
    </div>
  `;

  let currentStep = 1;
  const state = { memberId: '', biaya: 2500000, metode: 'cash', tenor: 0, petugasId: '' };

  const updateWizard = () => {
    document.querySelectorAll('.step').forEach((el, idx) => {
      if (idx + 1 < currentStep) {
        el.className = 'step completed';
        el.querySelector('.step-circle').innerHTML = '<i class="fas fa-check"></i>';
      } else if (idx + 1 === currentStep) {
        el.className = 'step active';
        el.querySelector('.step-circle').innerHTML = (idx + 1).toString();
      } else {
        el.className = 'step';
        el.querySelector('.step-circle').innerHTML = (idx + 1).toString();
      }
    });

    const content = document.getElementById('wizardContent');

    if (currentStep === 1) {
      const members = getDB(STORAGE.members).filter(m => !getDB(STORAGE.spk).find(s => s.memberId === m.id));
      content.innerHTML = `
             <h3 class="text-center mb-6">Pilih Warga untuk Pemasangan Baru</h3>
             <div class="form-group" style="max-width:400px; margin:0 auto;">
                <label>Pilih Data Warga (Yang belum punya SPK)</label>
                <select id="wzMember" required style="margin-bottom:20px;">
                   <option value="">-- Pilih Warga --</option>
                   ${members.map(m => `<option value="${m.id}" ${state.memberId === m.id ? 'selected' : ''}>${m.id} - ${m.fullName}</option>`).join('')}
                </select>
                <div class="flex justify-between">
                   <button class="btn btn-outline" onclick="window.location.hash='#pelanggan'">+ Ke Menu Pelanggan</button>
                   <button class="btn btn-primary" id="btnNext1">Lanjut <i class="fas fa-arrow-right"></i></button>
                </div>
             </div>
          `;
      document.getElementById('btnNext1').onclick = () => {
        const v = document.getElementById('wzMember').value;
        if (!v) return showToast('Pilih warga terlebih dahulu', 'error');
        state.memberId = v;
        currentStep++;
        updateWizard();
      };
    }
    else if (currentStep === 2) {
      content.innerHTML = `
             <h3 class="text-center mb-6">Penetapan Biaya Instalasi</h3>
             <div class="form-group" style="max-width:400px; margin:0 auto;">
                <label>Total Biaya Pemasangan (Rp)</label>
                <input type="number" id="wzBiaya" value="${state.biaya}" min="0" step="50000" style="font-size:1.5rem; font-weight:bold; color:var(--accent-primary)"/>
                <small class="text-muted mt-2 block">Dapat diubah sesuai RAB lapangan.</small>
                
                <div class="flex justify-between mt-6">
                   <button class="btn btn-outline" id="btnPrev2"><i class="fas fa-arrow-left"></i> Kembali</button>
                   <button class="btn btn-primary" id="btnNext2">Lanjut <i class="fas fa-arrow-right"></i></button>
                </div>
             </div>
          `;
      document.getElementById('btnPrev2').onclick = () => { currentStep--; updateWizard(); };
      document.getElementById('btnNext2').onclick = () => {
        const v = Number(document.getElementById('wzBiaya').value);
        if (v <= 0) return showToast('Biaya tidak valid', 'error');
        state.biaya = v;
        currentStep++;
        updateWizard();
      };
    }
    else if (currentStep === 3) {
      content.innerHTML = `
             <h3 class="text-center mb-6">Pilih Metode Pembayaran</h3>
             <div style="max-width:600px; margin:0 auto;">
                <div class="selection-grid">
                   <div class="selection-card ${state.metode === 'cash' ? 'selected' : ''}" id="cardCash">
                      <i class="fas fa-money-bill-wave"></i>
                      <h4>LUNAS / CASH</h4>
                      <p class="text-muted" style="font-size:0.8rem;">Bayar penuh 1x: <br><b>${formatRp(state.biaya)}</b></p>
                   </div>
                   <div class="selection-card ${state.metode === 'cicilan' ? 'selected' : ''}" id="cardCicilan">
                      <i class="fas fa-calendar-alt"></i>
                      <h4>CICILAN</h4>
                      <p class="text-muted" style="font-size:0.8rem;">Dibayar bersama tagihan air bulanan</p>
                   </div>
                </div>
                
                <div id="cicilanOptions" style="display:${state.metode === 'cicilan' ? 'block' : 'none'}; background:var(--surface); padding:15px; border-radius:var(--radius-md); margin-bottom:20px;">
                    <label>Pilih Tenor Cicilan:</label>
                    <div class="flex gap-2 mb-4 mt-2" style="flex-wrap:wrap">
                       ${[3, 6, 9, 12].map(t => `<button class="btn ${state.tenor === t ? 'btn-primary' : 'btn-outline'} btnTenor" data-val="${t}">${t} Bulan</button>`).join('')}
                    </div>
                    ${state.tenor > 0 ? `
                        <div class="flex justify-between items-center" style="border-top:1px dashed var(--border); padding-top:10px;">
                           <span class="text-muted">Cicilan per bulan:</span>
                           <h3 class="text-warning m-0">${formatRp(Math.ceil(state.biaya / state.tenor))}</h3>
                        </div>
                    ` : ''}
                </div>
                
                <div class="flex justify-between mt-6">
                   <button class="btn btn-outline" id="btnPrev3"><i class="fas fa-arrow-left"></i> Kembali</button>
                   <button class="btn btn-primary" id="btnNext3">Simpan & Buat SPK <i class="fas fa-check"></i></button>
                </div>
             </div>
          `;

      document.getElementById('cardCash').onclick = () => { state.metode = 'cash'; updateWizard(); };
      document.getElementById('cardCicilan').onclick = () => { state.metode = 'cicilan'; if (state.tenor === 0) state.tenor = 6; updateWizard(); };

      document.querySelectorAll('.btnTenor').forEach(btn => {
        btn.onclick = (e) => { state.tenor = Number(e.target.dataset.val); updateWizard(); }
      });

      document.getElementById('btnPrev3').onclick = () => { currentStep--; updateWizard(); };
      document.getElementById('btnNext3').onclick = () => {
        if (state.metode === 'cicilan' && state.tenor === 0) return showToast('Pilih tenor cicilan!', 'error');

        // Process Saving
        const spkDB = getDB(STORAGE.spk);
        const installmentDB = getDB(STORAGE.installments);
        const spkId = `SPK-${Date.now().toString().slice(-6)}`;

        const m = getDB(STORAGE.members).find(x => x.id === state.memberId);

        // Save Cicilan if any
        if (state.metode === 'cicilan') {
          const now = new Date();
          installmentDB.push({
            id: `CIL-${m.id}`,
            memberId: m.id,
            totalAmount: state.biaya,
            tenure: state.tenor,
            monthlyAmount: Math.ceil(state.biaya / state.tenor),
            monthsPaid: 0,
            startYear: now.getFullYear(),
            startMonth: now.getMonth() + 1, // Will start billing this/next month depending on logic
            status: 'active'
          });
          saveDB(STORAGE.installments, installmentDB);
        }

        // Save SPK
        spkDB.push({
          id: spkId,
          memberId: m.id,
          fee: state.biaya,
          method: state.metode,
          status: 'pending',
          createdAt: new Date().toISOString()
        });
        saveDB(STORAGE.spk, spkDB);

        logAction('buat_spk', `Menerbitkan SPK pemasangan utk ${m.fullName}`);

        state.spkIdResult = spkId;
        currentStep++;
        updateWizard();
      };
    }
    else if (currentStep === 4) {
      const m = getDB(STORAGE.members).find(x => x.id === state.memberId);
      content.innerHTML = `
             <div class="text-center" style="max-width:500px; margin: 0 auto; padding: 20px;">
                <div style="width:80px; height:80px; background:var(--accent-success); border-radius:50%; color:white; font-size:3rem; display:grid; place-items:center; margin:0 auto 20px auto; animation: fadeSlideUp 0.5s ease;">
                   <i class="fas fa-check"></i>
                </div>
                <h2>SPK Berhasil Diterbitkan!</h2>
                <p class="text-muted">Petugas lapangan sudah dapat melihat tugas pemasangan ini di aplikasi mereka.</p>
                
                <div class="card" style="text-align:left; background:var(--surface); margin-top:30px;">
                   <div class="flex justify-between mb-2">
                     <span class="text-muted">Nomor SPK</span>
                     <span class="font-bold text-primary">${state.spkIdResult}</span>
                   </div>
                   <div class="flex justify-between mb-2">
                     <span class="text-muted">Nama Warga</span>
                     <span class="font-semibold">${m.fullName} (${m.id})</span>
                   </div>
                   <div class="flex justify-between mb-2">
                     <span class="text-muted">Alamat</span>
                     <span class="font-semibold">${m.address} - ${m.zone}</span>
                   </div>
                   <div class="divider" style="margin:10px 0; border-bottom:1px dashed var(--border);"></div>
                   <div class="flex justify-between">
                     <span class="text-muted">Total & Metode</span>
                     <span class="font-bold text-warning">${formatRp(state.biaya)} (${state.metode.toUpperCase()})</span>
                   </div>
                </div>
                
                <div class="flex justify-center gap-4 mt-6">
                   <button class="btn btn-outline" onclick="window.print()"><i class="fas fa-print"></i> Cetak SPK</button>
                   <button class="btn btn-primary" id="btnFinish"><i class="fas fa-home"></i> Selesai</button>
                </div>
             </div>
          `;
      document.getElementById('btnFinish').onclick = () => { window.location.hash = '#dashboard'; };
    }
  };

  updateWizard();
}

function renderAdminPencatatan(container) {
  updateTopbarTitle('Review Pencatatan');

  const now = new Date();
  const state = { month: now.getMonth() + 1, year: now.getFullYear() };

  container.innerHTML = `
    <div class="card animate-fade-in">
       <div class="flex gap-4 mb-4" style="align-items:flex-end;">
          <div class="form-group mb-0" style="width:150px;">
             <label>Bulan (Pencatatan)</label>
             <select id="fltMonth">
                ${[...Array(12).keys()].map(i => `<option value="${i + 1}" ${state.month === i + 1 ? 'selected' : ''}>${new Date(0, i).toLocaleString('id-ID', { month: 'long' })}</option>`).join('')}
             </select>
          </div>
          <div class="form-group mb-0" style="width:120px;">
             <label>Tahun</label>
             <input type="number" id="fltYear" value="${state.year}" />
          </div>
          <button class="btn btn-primary" id="btnFilterCatat"><i class="fas fa-filter"></i> Tampilkan</button>
       </div>
       
       <div class="table-container">
          <table class="spreadsheet-table">
             <thead>
                <tr>
                   <th>Pelanggan</th>
                   <th>Bulan Lalu</th>
                   <th>Bulan Ini</th>
                   <th>Pemakaian</th>
                   <th>Foto Bukti</th>
                   <th>Status</th>
                </tr>
             </thead>
             <tbody id="catatTbody"></tbody>
          </table>
       </div>
    </div>
  `;

  const loadData = () => {
    const tbody = document.getElementById('catatTbody');
    const members = getDB(STORAGE.members).filter(m => m.status !== 'nonaktif');
    const usages = getDB(STORAGE.usage);

    if (members.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">Belum ada pelanggan terdaftar</td></tr>`;
      return;
    }

    let html = '';
    members.forEach(m => {
      const u = usages.find(x => x.memberId === m.id && x.year === state.year && x.month === state.month);

      if (u) {
        html += `
                  <tr>
                     <td data-label="Pelanggan"><b>${m.fullName}</b><br><small class="text-muted">${m.id} - ${m.zone}</small></td>
                     <td data-label="Bulan Lalu">${u.prevReading} m³</td>
                     <td data-label="Bulan Ini" class="font-bold text-primary">${u.currentReading} m³</td>
                     <td data-label="Beban" class="text-warning">${u.volume} m³</td>
                     <td data-label="Foto">
                       ${u.photoData ? `<img src="${u.photoData}" style="width:50px; height:50px; object-fit:cover; border-radius:6px; cursor:pointer;" onclick="window.open(this.src)"/>` : '<span class="text-muted text-sm">--</span>'}
                     </td>
                     <td data-label="Status"><span class="badge badge-success"><i class="fas fa-check"></i> Selesai</span></td>
                  </tr>
                `;
      } else {
        html += `
                  <tr>
                     <td data-label="Pelanggan"><b>${m.fullName}</b><br><small class="text-muted">${m.id} - ${m.zone}</small></td>
                     <td data-label="Bulan Lalu" class="text-muted">--</td>
                     <td data-label="Bulan Ini" class="text-muted">--</td>
                     <td data-label="Beban" class="text-muted">--</td>
                     <td data-label="Foto"><span class="text-muted">--</span></td>
                     <td data-label="Status"><span class="badge badge-warning"><i class="fas fa-clock"></i> Belum</span></td>
                  </tr>
                `;
      }
    });

    tbody.innerHTML = html || `<tr><td colspan="6" class="text-center">Tidak ada data aktif</td></tr>`;
  };

  document.getElementById('btnFilterCatat').onclick = () => {
    state.month = Number(document.getElementById('fltMonth').value);
    state.year = Number(document.getElementById('fltYear').value);
    loadData();
  };

  loadData();
}

function renderAdminTagihan(container) {
  updateTopbarTitle('Generate & Kelola Tagihan');
  const now = new Date();
  const state = { month: now.getMonth() + 1, year: now.getFullYear() };

  container.innerHTML = `
    <div class="card animate-fade-in mb-4 text-center" style="background:var(--surface);">
       <h3 class="mb-2">Periode Tagihan Aktif</h3>
       <div class="flex justify-center gap-2 items-center" style="flex-wrap:wrap;">
          <select id="tghMonth" style="width:150px;">
              ${[...Array(12).keys()].map(i => `<option value="${i + 1}" ${state.month === i + 1 ? 'selected' : ''}>${new Date(0, i).toLocaleString('id-ID', { month: 'long' })}</option>`).join('')}
          </select>
          <input type="number" id="tghYear" value="${state.year}" style="width:100px;" />
          <button class="btn btn-primary" id="btnRefreshTgh"><i class="fas fa-sync"></i> Refresh</button>
       </div>
    </div>
    
    <div class="card animate-slide-up">
       <div class="flex justify-between items-center mb-4" style="flex-wrap:wrap; gap:10px;">
          <h3 style="margin:0;">Daftar Tagihan Warga</h3>
          <div class="flex gap-2" style="flex-wrap:wrap;">
             <button class="btn-wa-bulk" id="btnBulkSendWA">
               <i class="fab fa-whatsapp"></i> Kirim Tagihan Bulan Ini via WA
             </button>
          </div>
       </div>
       
       <div class="table-container">
          <table class="spreadsheet-table">
             <thead>
                <tr>
                   <th>Pelanggan</th>
                   <th>Biaya Air</th>
                   <th>Cicilan</th>
                   <th>Beban</th>
                   <th>Total Tagihan</th>
                   <th>Status</th>
                   <th>Aksi</th>
                </tr>
             </thead>
             <tbody id="tagihanTbody"></tbody>
          </table>
       </div>
       
       <div class="flex justify-between mt-4" style="flex-wrap:wrap; gap:8px;">
          <div class="text-muted" style="font-size:0.85rem;"><i class="fas fa-info-circle"></i> 📄 Unduh PDF &nbsp;|&nbsp; ✏️ Edit Tagihan &nbsp;|&nbsp; 💬 Kirim via WhatsApp &nbsp;|&nbsp; Klik 'Bayar' untuk konfirmasi</div>
          <div id="tagihanSummary" class="text-muted" style="font-size:0.85rem;"></div>
       </div>
    </div>

    <!-- Modal Edit Tagihan -->
    <div id="editBillModal" style="display:none; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.6); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); z-index:1000; align-items:center; justify-content:center; padding:20px;">
      <div class="card edit-bill-card" style="width:100%; max-width:520px; animation: fadeSlideUp 0.3s ease; position:relative; overflow:visible;">
        <div class="flex justify-between items-center mb-4">
          <h3 style="margin:0; display:flex; align-items:center; gap:8px;"><i class="fas fa-edit text-info"></i> Koreksi Tagihan</h3>
          <button class="btn-icon" id="btnCloseEditBill" style="background:var(--surface); border:1px solid var(--border); border-radius:50%; width:32px; height:32px; display:grid; place-items:center; cursor:pointer; color:var(--text-secondary); transition:all 0.2s;"><i class="fas fa-times"></i></button>
        </div>

        <div id="editBillMemberInfo" style="background:var(--surface); padding:12px 16px; border-radius:var(--radius-md); margin-bottom:16px; border-left:4px solid var(--accent-primary);">
          <!-- Filled dynamically -->
        </div>

        <form id="editBillForm">
          <input type="hidden" id="editBillMemberId" />
          
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
            <div class="form-group">
              <label><i class="fas fa-tachometer-alt text-muted"></i> Meteran Awal (m³)</label>
              <input type="number" id="editPrevReading" min="0" step="1" required class="edit-bill-input" />
            </div>
            <div class="form-group">
              <label><i class="fas fa-tachometer-alt text-info"></i> Meteran Akhir (m³)</label>
              <input type="number" id="editCurrentReading" min="0" step="1" required class="edit-bill-input" />
            </div>
          </div>

          <div id="editBillPreview" style="background:linear-gradient(135deg, rgba(59,130,246,0.08), rgba(6,182,212,0.08)); padding:16px; border-radius:var(--radius-md); margin:12px 0 20px 0; border:1px solid rgba(59,130,246,0.15);">
            <!-- Live preview filled by JS -->
          </div>

          <div class="flex justify-between" style="gap:10px;">
            <button type="button" class="btn btn-outline" id="btnCancelEditBill" style="flex:1;"><i class="fas fa-times"></i> Batal</button>
            <button type="submit" class="btn btn-primary" style="flex:1;"><i class="fas fa-save"></i> Simpan Koreksi</button>
          </div>
        </form>
      </div>
    </div>
  `;

  // Cache the computed billing data for reuse by PDF/WA buttons
  let billingCache = [];

  const loadTagihan = () => {
    const tbody = document.getElementById('tagihanTbody');
    const members = getDB(STORAGE.members).filter(m => m.status !== 'nonaktif');
    const usages = getDB(STORAGE.usage);
    const paymentsDB = getDB(STORAGE.payments);
    const installmentsDB = getDB(STORAGE.installments);
    const rate = Number(localStorage.getItem(STORAGE.rate)) || 2100;
    const beban = Number(localStorage.getItem(STORAGE.adminFee)) || 500;

    if (members.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center">Belum ada pelanggan aktif.</td></tr>`;
      return;
    }

    billingCache = [];
    let html = '';
    let totalPaid = 0;
    let totalUnpaid = 0;
    let totalBilled = 0;

    members.forEach(m => {
      const usage = usages.find(u => u.memberId === m.id && u.year === state.year && u.month === state.month);
      const payment = paymentsDB.find(p => p.memberId === m.id && p.year === state.year && p.month === state.month);
      const installment = installmentsDB.find(i => i.memberId === m.id && i.status === 'active');

      const isBilled = !!usage;
      const isPaid = !!payment;

      if (!isBilled) {
        html += `
                 <tr>
                   <td data-label="Pelanggan"><b>${m.fullName}</b><small class="block text-muted">${m.id}</small></td>
                   <td colspan="4" class="text-center text-muted" style="font-style:italic">Menunggu petugas mencatat meteran...</td>
                   <td data-label="Status"><span class="badge badge-warning">Pending</span></td>
                   <td data-label="Aksi">-</td>
                 </tr>
               `;
        return;
      }

      totalBilled++;
      const biayaAir = usage.volume * rate;
      let biayaCicilan = 0;
      let cicilanInfo = null;

      if (installment) {
        const start = new Date(installment.startYear, installment.startMonth - 1, 1);
        const current = new Date(state.year, state.month - 1, 1);
        const diffMonths = (current.getFullYear() - start.getFullYear()) * 12 + (current.getMonth() - start.getMonth());
        if (diffMonths >= 0 && diffMonths < installment.tenure) {
          biayaCicilan = installment.monthlyAmount;
          cicilanInfo = { bulanKe: diffMonths + 1, tenure: installment.tenure };
        }
      }

      const total = biayaAir + beban + biayaCicilan;

      const billEntry = {
        member: m,
        invoiceId: isPaid ? (payment.id || `PAY-${m.id}`) : `INV-${m.id}-${state.year}-${state.month}`,
        month: state.month,
        year: state.year,
        prevReading: usage.prevReading,
        currentReading: usage.currentReading,
        volume: usage.volume,
        biayaAir,
        biayaBeban: beban,
        biayaCicilan,
        total,
        isPaid,
        paidAt: isPaid ? payment.paidAt : null,
        cicilanInfo
      };
      billingCache.push(billEntry);

      if (isPaid) totalPaid++;
      else totalUnpaid++;

      const actionBtns = `
              <div class="action-btns">
                <button class="btn-action btn-edit" title="Edit / Koreksi Tagihan" onclick="editBill('${m.id}')"><i class="fas fa-edit"></i></button>
                <button class="btn-action btn-pdf" title="Unduh PDF" onclick="downloadStruk('${m.id}')"><i class="fas fa-file-pdf"></i></button>
                <button class="btn-action btn-wa" title="Kirim via WhatsApp" onclick="sendWA('${m.id}')"><i class="fab fa-whatsapp"></i></button>
                ${!isPaid ? `<button class="btn btn-success btn-sm" style="padding:4px 10px; font-size:0.8rem;" onclick="terimaBayar('${m.id}', ${biayaAir}, ${biayaCicilan}, ${beban}, ${total})"><i class="fas fa-check"></i> Bayar</button>` : ''}
              </div>
            `;

      if (isPaid) {
        html += `
                 <tr>
                   <td data-label="Pelanggan"><b>${m.fullName}</b><small class="block text-muted">${m.id}</small></td>
                   <td data-label="Biaya Air">${formatRp(biayaAir)}</td>
                   <td data-label="Cicilan">${biayaCicilan ? formatRp(biayaCicilan) : '--'}</td>
                   <td data-label="Beban">${formatRp(beban)}</td>
                   <td data-label="Total"><b class="text-success">${formatRp(total)}</b></td>
                   <td data-label="Status"><span class="badge badge-success">LUNAS</span><br><small>${formatDate(payment.paidAt)}</small></td>
                   <td data-label="Aksi">${actionBtns}</td>
                 </tr>
               `;
      } else {
        html += `
                 <tr>
                   <td data-label="Pelanggan"><b>${m.fullName}</b><small class="block text-muted">${m.id}</small></td>
                   <td data-label="Biaya Air">${formatRp(biayaAir)}</td>
                   <td data-label="Cicilan" class="${biayaCicilan ? 'text-warning' : ''}">${biayaCicilan ? formatRp(biayaCicilan) : '--'}</td>
                   <td data-label="Beban">${formatRp(beban)}</td>
                   <td data-label="Total"><b class="text-danger">${formatRp(total)}</b></td>
                   <td data-label="Status"><span class="badge badge-danger">BELUM BAYAR</span></td>
                   <td data-label="Aksi">${actionBtns}</td>
                 </tr>
               `;
      }
    });

    tbody.innerHTML = html;

    const summaryEl = document.getElementById('tagihanSummary');
    if (summaryEl) {
      summaryEl.innerHTML = `<span class="text-success">${totalPaid} lunas</span> · <span class="text-danger">${totalUnpaid} belum bayar</span> · <span>${totalBilled} tertagih</span>`;
    }
  };

  document.getElementById('btnRefreshTgh').onclick = () => {
    state.month = Number(document.getElementById('tghMonth').value);
    state.year = Number(document.getElementById('tghYear').value);
    loadTagihan();
  };

  // --- Download PDF Receipt (via PyMuPDF backend) ---
  window.downloadStruk = async (memberId) => {
    const entry = billingCache.find(b => b.member.id === memberId);
    if (!entry) return showToast('Data tagihan tidak ditemukan', 'error');

    const payload = {
      invoiceId: entry.invoiceId,
      memberName: entry.member.fullName,
      memberId: entry.member.id,
      zone: entry.member.zone,
      address: entry.member.address,
      phone: entry.member.phone || '-',
      month: entry.month,
      year: entry.year,
      prevReading: entry.prevReading,
      currentReading: entry.currentReading,
      volume: entry.volume,
      rate: Number(localStorage.getItem(STORAGE.rate)) || 2100,
      biayaAir: entry.biayaAir,
      biayaBeban: entry.biayaBeban,
      biayaCicilan: entry.biayaCicilan,
      total: entry.total,
      isPaid: entry.isPaid,
      paidAt: entry.paidAt,
      cicilanInfo: entry.cicilanInfo
    };

    const filename = `Invoice_${entry.member.id}_${monthName(entry.month)}_${entry.year}.pdf`;

    try {
      // Client-side PDF generation using jsPDF
      const doc = generateReceiptPDF(payload);
      doc.save(filename);
      showToast(`PDF berhasil diunduh: ${filename}`);
    } catch (e) {
      console.error('PDF generation failed:', e);
      showToast('Gagal membuat PDF.', 'error');
      return;
    }

    logAction('pdf', `Download PDF ${entry.member.fullName} (${monthName(entry.month)} ${entry.year})`);
  };

  // --- Send via WhatsApp ---
  window.sendWA = (memberId) => {
    const entry = billingCache.find(b => b.member.id === memberId);
    if (!entry) return showToast('Data tagihan tidak ditemukan', 'error');

    if (!entry.member.phone) {
      return showToast('Nomor HP warga belum diisi!', 'error');
    }

    sendViaWhatsApp(entry.member, {
      month: entry.month,
      year: entry.year,
      volume: entry.volume,
      biayaAir: entry.biayaAir,
      biayaBeban: entry.biayaBeban,
      biayaCicilan: entry.biayaCicilan,
      total: entry.total,
      isPaid: entry.isPaid
    });

    showToast(`WhatsApp dibuka untuk ${entry.member.fullName}`);
    logAction('wa_send', `Kirim WA ke ${entry.member.fullName} (${monthName(entry.month)} ${entry.year})`);
  };

  // --- Terima Bayar ---
  window.terimaBayar = (memberId, bAir, bCicilan, bBeban, total) => {
    if (!confirm(`Terima pembayaran dari ${memberId} sejumlah ${formatRp(total)}?`)) return;

    const paymentsDB = getDB(STORAGE.payments);
    paymentsDB.push({
      id: `PAY-${Date.now().toString().slice(-8)}`,
      memberId,
      year: state.year,
      month: state.month,
      amountAir: bAir,
      amountBeban: bBeban,
      amountCicilan: bCicilan,
      total: total,
      paidAt: new Date().toISOString()
    });
    saveDB(STORAGE.payments, paymentsDB);

    // Update installment monthsPaid if applicable
    if (bCicilan > 0) {
      const installmentsDB = getDB(STORAGE.installments);
      const inst = installmentsDB.find(i => i.memberId === memberId && i.status === 'active');
      if (inst) {
        inst.monthsPaid = (inst.monthsPaid || 0) + 1;
        if (inst.monthsPaid >= inst.tenure) inst.status = 'completed';
        saveDB(STORAGE.installments, installmentsDB);
      }
    }

    logAction('bayar', `Menerima pembayaran ${memberId} sebesar ${formatRp(total)}`);
    showToast('Pembayaran berhasil diproses!');
    loadTagihan();
  };

  // --- Edit Bill Modal ---
  const editBillModal = document.getElementById('editBillModal');
  const editBillForm = document.getElementById('editBillForm');

  const openEditBillModal = () => { editBillModal.style.display = 'flex'; };
  const closeEditBillModal = () => { editBillModal.style.display = 'none'; editBillForm.reset(); };

  document.getElementById('btnCloseEditBill').onclick = closeEditBillModal;
  document.getElementById('btnCancelEditBill').onclick = closeEditBillModal;

  // Close on backdrop click
  editBillModal.onclick = (e) => { if (e.target === editBillModal) closeEditBillModal(); };

  // Live preview updater
  const updateEditBillPreview = () => {
    const prev = Number(document.getElementById('editPrevReading').value) || 0;
    const curr = Number(document.getElementById('editCurrentReading').value) || 0;
    const vol = Math.max(0, curr - prev);
    const rate = Number(localStorage.getItem(STORAGE.rate)) || 2100;
    const beban = Number(localStorage.getItem(STORAGE.adminFee)) || 500;
    const memberId = document.getElementById('editBillMemberId').value;

    let biayaCicilan = 0;
    const installmentsDB = getDB(STORAGE.installments);
    const installment = installmentsDB.find(i => i.memberId === memberId && i.status === 'active');
    if (installment) {
      const start = new Date(installment.startYear, installment.startMonth - 1, 1);
      const current = new Date(state.year, state.month - 1, 1);
      const diffMonths = (current.getFullYear() - start.getFullYear()) * 12 + (current.getMonth() - start.getMonth());
      if (diffMonths >= 0 && diffMonths < installment.tenure) {
        biayaCicilan = installment.monthlyAmount;
      }
    }

    const biayaAir = vol * rate;
    const total = biayaAir + beban + biayaCicilan;

    const previewEl = document.getElementById('editBillPreview');
    previewEl.innerHTML = `
      <div style="font-size:0.8rem; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; color:var(--accent-info); margin-bottom:10px;"><i class="fas fa-calculator"></i> Kalkulasi Otomatis</div>
      <div class="flex justify-between mb-2" style="font-size:0.9rem;">
        <span class="text-secondary">Pemakaian</span>
        <span class="font-semibold ${vol < 0 ? 'text-danger' : ''}">${vol} m³</span>
      </div>
      <div class="flex justify-between mb-2" style="font-size:0.9rem;">
        <span class="text-secondary">Biaya Air (${vol} × ${formatRp(rate)})</span>
        <span class="font-semibold">${formatRp(biayaAir)}</span>
      </div>
      <div class="flex justify-between mb-2" style="font-size:0.9rem;">
        <span class="text-secondary">Beban/Perawatan</span>
        <span class="font-semibold">${formatRp(beban)}</span>
      </div>
      ${biayaCicilan > 0 ? `
      <div class="flex justify-between mb-2" style="font-size:0.9rem;">
        <span class="text-secondary">Cicilan Pemasangan</span>
        <span class="font-semibold text-warning">${formatRp(biayaCicilan)}</span>
      </div>` : ''}
      <div style="border-top:1px dashed var(--border); margin:8px 0; padding-top:8px;" class="flex justify-between">
        <span class="font-bold" style="font-size:1rem; color:var(--text-primary);">Total Tagihan</span>
        <span class="font-bold" style="font-size:1.1rem; color:var(--accent-primary);">${formatRp(total)}</span>
      </div>
    `;
  };

  document.getElementById('editPrevReading').addEventListener('input', updateEditBillPreview);
  document.getElementById('editCurrentReading').addEventListener('input', updateEditBillPreview);

  window.editBill = (memberId) => {
    const entry = billingCache.find(b => b.member.id === memberId);
    if (!entry) return showToast('Data tagihan tidak ditemukan', 'error');

    // Fill member info
    document.getElementById('editBillMemberInfo').innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
        <div>
          <div style="font-weight:700; font-size:1rem; color:var(--text-primary);">${entry.member.fullName}</div>
          <div style="font-size:0.85rem; color:var(--text-muted);">${entry.member.id} — ${entry.member.zone}</div>
        </div>
        <div style="text-align:right;">
          <span class="badge badge-info" style="font-size:0.8rem;">${monthName(state.month)} ${state.year}</span>
          ${entry.isPaid ? '<br><span class="badge badge-success" style="margin-top:4px; font-size:0.75rem;">LUNAS</span>' : ''}
        </div>
      </div>
    `;

    // Fill form values
    document.getElementById('editBillMemberId').value = memberId;
    document.getElementById('editPrevReading').value = entry.prevReading;
    document.getElementById('editCurrentReading').value = entry.currentReading;

    // Update preview
    updateEditBillPreview();

    // Open modal
    openEditBillModal();
  };

  editBillForm.onsubmit = (e) => {
    e.preventDefault();
    const memberId = document.getElementById('editBillMemberId').value;
    const newPrev = Number(document.getElementById('editPrevReading').value);
    const newCurr = Number(document.getElementById('editCurrentReading').value);

    if (newCurr < newPrev) {
      return showToast('Meteran akhir tidak boleh lebih kecil dari meteran awal!', 'error');
    }

    const newVolume = newCurr - newPrev;
    const rate = Number(localStorage.getItem(STORAGE.rate)) || 2100;
    const beban = Number(localStorage.getItem(STORAGE.adminFee)) || 500;

    // Update usage record
    const usages = getDB(STORAGE.usage);
    const usageIdx = usages.findIndex(u => u.memberId === memberId && u.year === state.year && u.month === state.month);
    if (usageIdx === -1) {
      return showToast('Data pencatatan tidak ditemukan!', 'error');
    }

    const oldUsage = usages[usageIdx];
    usages[usageIdx] = { ...oldUsage, prevReading: newPrev, currentReading: newCurr, volume: newVolume };
    saveDB(STORAGE.usage, usages);

    // If already paid, also update the payment record totals
    const paymentsDB = getDB(STORAGE.payments);
    const paymentIdx = paymentsDB.findIndex(p => p.memberId === memberId && p.year === state.year && p.month === state.month);
    if (paymentIdx !== -1) {
      const newBiayaAir = newVolume * rate;
      const installmentsDB = getDB(STORAGE.installments);
      const installment = installmentsDB.find(i => i.memberId === memberId && i.status === 'active');
      let biayaCicilan = 0;
      if (installment) {
        const start = new Date(installment.startYear, installment.startMonth - 1, 1);
        const current = new Date(state.year, state.month - 1, 1);
        const diffMonths = (current.getFullYear() - start.getFullYear()) * 12 + (current.getMonth() - start.getMonth());
        if (diffMonths >= 0 && diffMonths < installment.tenure) {
          biayaCicilan = installment.monthlyAmount;
        }
      }
      const newTotal = newBiayaAir + beban + biayaCicilan;
      paymentsDB[paymentIdx] = { ...paymentsDB[paymentIdx], amountAir: newBiayaAir, amountBeban: beban, amountCicilan: biayaCicilan, total: newTotal };
      saveDB(STORAGE.payments, paymentsDB);
    }

    logAction('edit_tagihan', `Koreksi tagihan ${memberId}: meteran ${oldUsage.prevReading}→${newPrev} / ${oldUsage.currentReading}→${newCurr}, vol ${oldUsage.volume}→${newVolume} m³`);
    showToast('Tagihan berhasil dikoreksi!');
    closeEditBillModal();
    loadTagihan();
  };

  // --- Bulk Send via WhatsApp ---
  document.getElementById('btnBulkSendWA').onclick = () => {
    // Get unpaid entries that have phone numbers
    const targets = billingCache.filter(b => !b.isPaid && b.member.phone);

    if (targets.length === 0) {
      return showToast('Tidak ada tagihan belum bayar yang bisa dikirim (atau nomor HP kosong).', 'error');
    }

    const confirmed = confirm(
      `Kirim tagihan via WhatsApp ke ${targets.length} warga yang belum bayar?\n\n` +
      `Masing-masing akan membuka tab WhatsApp baru. ` +
      `Pastikan pop-up browser tidak diblokir.\n\n` +
      `Lanjutkan?`
    );

    if (!confirmed) return;

    // Show progress overlay
    const overlay = document.createElement('div');
    overlay.className = 'bulk-send-overlay';
    overlay.id = 'bulkSendOverlay';
    overlay.innerHTML = `
        <div class="bulk-send-card">
           <div class="spinner"></div>
           <h3 style="margin-bottom:5px;">Mengirim Tagihan via WhatsApp</h3>
           <p class="text-muted" style="font-size:0.9rem;">Membuka WhatsApp satu per satu...</p>
           <div class="progress-container" style="margin:15px 0;">
             <div class="progress-bar" id="bulkProgress" style="width:0%; background: linear-gradient(135deg, #25d366, #128c7e);"></div>
           </div>
           <p id="bulkCounter" style="color:var(--accent-info); font-weight:600;">0 / ${targets.length}</p>
           <div class="bulk-send-log" id="bulkLog"></div>
           <button class="btn btn-outline mt-4" id="btnCloseBulk" style="display:none;"><i class="fas fa-times"></i> Tutup</button>
        </div>
      `;
    document.body.appendChild(overlay);

    const progressBar = document.getElementById('bulkProgress');
    const counter = document.getElementById('bulkCounter');
    const log = document.getElementById('bulkLog');
    const closeBtn = document.getElementById('btnCloseBulk');

    let idx = 0;

    const sendNext = () => {
      if (idx >= targets.length) {
        // Done!
        const spinner = overlay.querySelector('.spinner');
        if (spinner) spinner.style.display = 'none';
        counter.innerHTML = `<span class="text-success"><i class="fas fa-check-circle"></i> Selesai! ${targets.length} pesan dikirim.</span>`;
        closeBtn.style.display = 'inline-flex';
        closeBtn.onclick = () => overlay.remove();
        logAction('wa_bulk', `Kirim bulk WA ke ${targets.length} warga (${monthName(state.month)} ${state.year})`);
        return;
      }

      const entry = targets[idx];

      // Open WhatsApp
      sendViaWhatsApp(entry.member, {
        month: entry.month,
        year: entry.year,
        volume: entry.volume,
        biayaAir: entry.biayaAir,
        biayaBeban: entry.biayaBeban,
        biayaCicilan: entry.biayaCicilan,
        total: entry.total,
        isPaid: false
      });

      idx++;

      // Update progress
      const pct = Math.round((idx / targets.length) * 100);
      progressBar.style.width = pct + '%';
      counter.innerText = `${idx} / ${targets.length}`;

      log.innerHTML += `<div class="log-item log-success"><i class="fas fa-check-circle"></i> ${entry.member.fullName} (${entry.member.phone})</div>`;
      log.scrollTop = log.scrollHeight;

      // Delay 3s before next (to avoid WA rate limit / popup block)
      if (idx < targets.length) {
        setTimeout(sendNext, 3000);
      } else {
        sendNext(); // Final call to show completed state
      }
    };

    // Start sending
    setTimeout(sendNext, 500);
  };

  loadTagihan();
}

function renderAdminLaporan(container) {
  updateTopbarTitle('Laporan Keuangan');
  const now = new Date();
  const state = { year: now.getFullYear() };

  container.innerHTML = `
     <div class="flex justify-between items-center mb-4">
        <div class="flex gap-2 items-center">
           <label class="m-0 text-muted">Tahun Anggaran:</label>
           <input type="number" id="lapYear" value="${state.year}" style="width:100px;" />
           <button class="btn btn-primary" id="btnLapRefresh"><i class="fas fa-sync"></i></button>
        </div>
        <div>
           <button class="btn btn-outline"><i class="fas fa-download"></i> Unduh CSV</button>
        </div>
     </div>
     
     <div class="kpi-grid mb-6" id="lapSummaryCards">
        <!-- Rendered by JS -->
     </div>
     
     <div class="card overflow-x-auto">
        <table class="spreadsheet-table text-right text-sm">
           <thead>
              <tr>
                 <th class="text-left">Bulan</th>
                 <th>Pendapatan Air</th>
                 <th>Biaya Beban</th>
                 <th>Cicilan Masuk</th>
                 <th>Total Diterima</th>
                 <th>Estimasi Piutang/Tunggakan</th>
              </tr>
           </thead>
           <tbody id="lapTbody"></tbody>
           <tfoot id="lapTfoot" style="background:var(--surface); font-weight:bold; color:var(--text-primary)"></tfoot>
        </table>
     </div>
  `;

  const loadLaporan = () => {
    const year = state.year;
    const tbody = document.getElementById('lapTbody');
    const paymentsDB = getDB(STORAGE.payments);
    const usages = getDB(STORAGE.usage);
    const members = getDB(STORAGE.members).filter(m => m.status !== 'nonaktif');
    const rate = Number(localStorage.getItem(STORAGE.rate)) || 2100;
    const adminFee = Number(localStorage.getItem(STORAGE.adminFee)) || 500;

    const totals = { air: 0, beban: 0, cicilan: 0, grandTotal: 0 };

    let html = '';
    for (let i = 1; i <= 12; i++) {
      const mPayments = paymentsDB.filter(p => p.year === year && p.month === i);
      const mUsages = usages.filter(u => u.year === year && u.month === i);

      let mAir = 0, mBeban = 0, mCicilan = 0;
      mPayments.forEach(p => {
        mAir += (p.amountAir || 0);
        mBeban += (p.amountBeban || 0);
        mCicilan += (p.amountCicilan || 0);
      });

      // Piutang = billed but unpaid members
      const billedCount = mUsages.length;
      const paidCount = mPayments.length;
      const unpaidCount = billedCount - paidCount;
      const avgBill = billedCount > 0 ? (mUsages.reduce((s, u) => s + u.volume, 0) / billedCount) * rate + adminFee : 0;
      const piutang = unpaidCount > 0 ? unpaidCount * avgBill : 0;

      const tot = mAir + mBeban + mCicilan;
      totals.air += mAir;
      totals.beban += mBeban;
      totals.cicilan += mCicilan;
      totals.grandTotal += tot;

      html += `
             <tr>
               <td class="text-left">${new Date(0, i - 1).toLocaleString('id-ID', { month: 'long' })}</td>
               <td>${formatRp(mAir)}</td>
               <td>${formatRp(mBeban)}</td>
               <td class="text-info">${formatRp(mCicilan)}</td>
               <td class="text-success font-bold">${formatRp(tot)}</td>
               <td class="text-danger">${formatRp(piutang)}</td>
             </tr>
           `;
    }
    tbody.innerHTML = html;

    document.getElementById('lapTfoot').innerHTML = `
           <tr>
              <td class="text-left">TOTAL ${year}</td>
              <td>${formatRp(totals.air)}</td>
              <td>${formatRp(totals.beban)}</td>
              <td class="text-info">${formatRp(totals.cicilan)}</td>
              <td class="text-success font-bold text-lg">${formatRp(totals.grandTotal)}</td>
              <td>-</td>
           </tr>
        `;

    document.getElementById('lapSummaryCards').innerHTML = `
            <div class="card kpi-card">
                <div class="kpi-title">Total Pendapatan (Air + Beban)</div>
                <div class="kpi-value">${formatRp(totals.air + totals.beban)}</div>
            </div>
            <div class="card kpi-card border-info">
                <div class="kpi-title text-info">Total Cicilan Diterima</div>
                <div class="kpi-value text-info">${formatRp(totals.cicilan)}</div>
            </div>
            <div class="card kpi-card" style="background:var(--gradient-brand)">
                <div class="kpi-title text-white">GRAND TOTAL KAS MASUK</div>
                <div class="kpi-value text-white">${formatRp(totals.grandTotal)}</div>
            </div>
        `;
  };

  document.getElementById('btnLapRefresh').onclick = () => {
    state.year = Number(document.getElementById('lapYear').value);
    loadLaporan();
  };

  loadLaporan();
}

function renderAdminPetugas(container) {
  updateTopbarTitle('Manajemen Petugas Lapangan');
  const users = getDB(STORAGE.users);

  container.innerHTML = `
    <div class="card animate-fade-in">
       <div class="flex justify-between items-center mb-4">
          <h3>Daftar Petugas Lapangan</h3>
          <button class="btn btn-primary" id="btnAdminAddPetugas"><i class="fas fa-plus"></i> Tambah Petugas</button>
       </div>
       
       <div class="table-container">
          <table class="spreadsheet-table">
             <thead>
                <tr>
                   <th>Username</th>
                   <th>Nama Lengkap</th>
                   <th>Role</th>
                   <th>Aksi</th>
                </tr>
             </thead>
             <tbody id="petugasTbody"></tbody>
          </table>
       </div>
    </div>
  `;

  const loadPetugas = () => {
    const tbody = document.getElementById('petugasTbody');
    if (users.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">Belum ada akun petugas dibuat.</td></tr>`;
      return;
    }

    tbody.innerHTML = users.map(u => `
         <tr>
            <td><span class="badge badge-info">${u.username}</span></td>
            <td class="font-bold">${u.name}</td>
            <td><span class="badge ${u.role === 'admin' ? 'badge-warning' : 'badge-success'}">${u.role.toUpperCase()}</span></td>
            <td>
               <button class="btn btn-danger btn-sm" onclick="deletePetugas('${u.username}')"><i class="fas fa-trash"></i> Hapus</button>
            </td>
         </tr>
      `).join('');
  };

  document.getElementById('btnAdminAddPetugas').onclick = () => {
    const name = prompt('Masukkan Nama Lengkap Petugas:');
    if (!name) return;
    const username = prompt('Masukkan Username untuk Login:');
    if (!username) return;
    if (users.find(u => u.username === username)) return showToast('Username sudah dipakai!', 'error');

    const password = prompt('Masukkan Password:');
    if (!password) return;

    users.push({ username, name, password, role: 'petugas' });
    saveDB(STORAGE.users, users);

    logAction('tambah_petugas', `Menambahkan petugas baru: ${name}`);
    showToast('Petugas berhasil ditambahkan');
    loadPetugas();
  };

  window.deletePetugas = (username) => {
    if (username === 'admin') return showToast('Tidak dapat menghapus super admin', 'error');
    if (!confirm(`Hapus akses login untuk ${username}?`)) return;

    const newUsers = getDB(STORAGE.users).filter(u => u.username !== username);
    saveDB(STORAGE.users, newUsers);

    logAction('hapus_petugas', `Menghapus petugas: ${username}`);
    showToast('Petugas dihapus');
    renderAdminPetugas(container); // reload
  };

  loadPetugas();
}

function renderAdminPengaturan(container) {
  updateTopbarTitle('Pengaturan Sistem');

  const rate = Number(localStorage.getItem(STORAGE.rate)) || 2100;
  const adminFee = Number(localStorage.getItem(STORAGE.adminFee)) || 500;

  container.innerHTML = `
    <div class="card animate-fade-in" style="max-width:600px;">
       <h3 class="mb-4"><i class="fas fa-cog text-info"></i> Pengaturan Harga & Biaya</h3>
       
       <div class="form-group">
          <label>Harga Air per Kubik (Rp/m³)</label>
          <input type="number" id="setRate" value="${rate}" min="0" step="50" style="font-size:1.2rem; font-weight:bold; color:var(--accent-primary)"/>
       </div>
       
       <div class="form-group">
          <label>Biaya Beban Perawatan (Rp/Bulan)</label>
          <input type="number" id="setBeban" value="${adminFee}" min="0" step="100" style="font-size:1.2rem; font-weight:bold; color:var(--accent-warning)"/>
       </div>
       
       <div class="form-group mt-6">
          <button class="btn btn-primary w-full" id="btnSaveSetting"><i class="fas fa-save"></i> Simpan Perubahan</button>
       </div>
       
       <div class="divider mt-6 mb-4" style="border-bottom:1px solid var(--border)"></div>
       
       <h3 class="text-danger"><i class="fas fa-exclamation-triangle"></i> Pengaturan Berbahaya</h3>
       <button class="btn btn-outline text-danger border-danger mt-2" onclick="if(confirm('Yakin reset semua riwayat data? Aksi ini permanen.')) { localStorage.clear(); window.location.reload(); }"><i class="fas fa-trash"></i> Hapus Semua Data Sistem</button>
    </div>
  `;

  document.getElementById('btnSaveSetting').onclick = () => {
    const nr = Number(document.getElementById('setRate').value);
    const nb = Number(document.getElementById('setBeban').value);

    if (nr < 0 || nb < 0) return showToast('Nilai tidak boleh negatif', 'error');

    localStorage.setItem(STORAGE.rate, nr);
    localStorage.setItem(STORAGE.adminFee, nb);

    logAction('setting', `Update Harga Air: ${nr}, Beban: ${nb}`);
    showToast('Pengaturan berhasil disimpan');
  };
}


// --- 6. VIEWS: PETUGAS LAPANGAN ---

function renderPetugasTugas(container) {
  updateTopbarTitle('Daftar Tugas Hari Ini');

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const members = getDB(STORAGE.members).filter(m => m.status !== 'nonaktif');
  const usages = getDB(STORAGE.usage).filter(u => u.year === year && u.month === month);

  const membersToRead = members.map(m => {
    const hasRead = usages.find(u => u.memberId === m.id);
    return { ...m, isDone: !!hasRead, readData: hasRead };
  });

  const doneCount = membersToRead.filter(m => m.isDone).length;
  const progress = members.length ? Math.round((doneCount / members.length) * 100) : 0;

  container.innerHTML = `
      <div class="card p-4 animate-fade-in" style="background:var(--surface);">
         <div class="flex justify-between items-center mb-2">
            <h3 class="m-0"><i class="fas fa-clipboard-check text-info"></i> Progress Pencatatan</h3>
            <b class="text-primary" style="font-size:1.2rem;">${doneCount}/${members.length} ✅</b>
         </div>
         <div class="progress-container">
            <div class="progress-bar" style="width:${progress}%; background:var(--gradient-brand);"></div>
         </div>
         <p class="text-muted text-right m-0 mt-1" style="font-size:0.8rem;">Bulan ${now.toLocaleString('id-ID', { month: 'long' })} ${year}</p>
      </div>
      
      <div class="flex gap-2 mb-4">
         <div class="form-group" style="flex:1; margin:0;">
            <input type="text" id="ptgSearch" placeholder="Cari nama atau blok target..." style="padding:10px 15px; border-radius:var(--radius-full);"/>
         </div>
         <select id="ptgFilterStatus" style="width:120px; border-radius:var(--radius-full);">
            <option value="semua">Semua</option>
            <option value="belum" selected>Belum ⬜</option>
            <option value="selesai">Selesai ✅</option>
         </select>
      </div>
      
      <div id="ptgList" style="display:flex; flex-direction:column; gap:12px;"></div>
   `;

  const renderList = () => {
    const search = document.getElementById('ptgSearch').value.toLowerCase();
    const fStatus = document.getElementById('ptgFilterStatus').value;

    let filtered = membersToRead.filter(m => {
      const matchesSearch = (m.fullName + ' ' + m.id + ' ' + m.zone).toLowerCase().includes(search);
      let matchesStatus = true;
      if (fStatus === 'belum') matchesStatus = !m.isDone;
      if (fStatus === 'selesai') matchesStatus = m.isDone;
      return matchesSearch && matchesStatus;
    });

    const list = document.getElementById('ptgList');
    if (filtered.length === 0) {
      list.innerHTML = `<div class="card text-center text-muted p-4">Semua tugas pada kategori ini sudah selesai! 🎉</div>`;
      return;
    }

    list.innerHTML = filtered.map(m => `
           <div class="card" style="padding:15px; border-left:4px solid ${m.isDone ? 'var(--accent-success)' : 'var(--accent-primary)'}; margin-bottom:0;">
              <div class="flex justify-between items-center mb-2">
                 <span class="badge badge-info">${m.id}</span>
                 ${m.isDone ? `<span class="badge badge-success"><i class="fas fa-check"></i> Selesai</span>` : `<span class="badge badge-warning"><i class="fas fa-clock"></i> Belum</span>`}
              </div>
              <h3 style="margin:0 0 5px 0; font-size:1.1rem;">${m.fullName}</h3>
              <p class="text-muted m-0"><i class="fas fa-map-marker-alt"></i> ${m.zone} - ${m.address}</p>
              
              <div class="mt-3">
                 ${m.isDone
        ? `<div class="flex justify-between items-center" style="background:var(--surface); padding:10px; border-radius:6px;">
                        <span>Angka Meteran:</span>
                        <b class="text-success">${m.readData.currentReading} m³</b>
                      </div>`
        : `<button class="btn btn-primary w-full" onclick="window.location.hash='#formcatat-${m.id}'"><i class="fas fa-edit"></i> Catat Sekarang</button>`
      }
              </div>
           </div>
       `).join('');
  };

  document.getElementById('ptgSearch').addEventListener('input', renderList);
  document.getElementById('ptgFilterStatus').addEventListener('change', renderList);

  renderList();
}

// Special Route specifically for the input form
function renderPetugasFormCatat(container, memberId) {
  updateTopbarTitle('Form Pencatatan Meteran');
  const member = getDB(STORAGE.members).find(m => m.id === memberId);
  if (!member) return window.location.hash = '#tugas';

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  // Calculate previous usage
  const usages = getDB(STORAGE.usage).filter(u => u.memberId === memberId).sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    return a.month - b.month;
  });

  const lastUsage = usages.length > 0 ? usages[usages.length - 1] : null;
  const prevReading = lastUsage ? lastUsage.currentReading : 0;

  container.innerHTML = `
      <div style="max-width:500px; margin: 0 auto;">
         <button class="btn btn-outline mb-4" onclick="window.location.hash='#tugas'"><i class="fas fa-arrow-left"></i> Kembali</button>
         
         <div class="card" style="border-top:4px solid var(--accent-primary)">
            <p class="text-muted m-0 mb-1">ID: ${member.id} | ${member.zone}</p>
            <h2 class="m-0">${member.fullName}</h2>
         </div>
         
         <div class="card mt-4">
            <div class="flex justify-between items-center mb-4" style="background:var(--surface); padding:12px; border-radius:var(--radius-md);">
               <span class="text-muted">Angka Sebelumnya (Bulan Lalu)</span>
               <b class="text-lg">${prevReading} m³</b>
            </div>
            
            <form id="formCatatMeteran">
               <div class="form-group">
                  <label>Angka Meteran Saat Ini (m³)*</label>
                  <input type="number" id="inpCurrent" class="big-input" step="1" min="${prevReading}" required />
                  <small class="text-warning mt-2 block" id="volumeWarning" style="display:none;"><i class="fas fa-exclamation-triangle"></i> Peringatan: Angka ini lebih kecil dari angka sebelumnya!</small>
               </div>
               
               <div class="form-group mt-4">
                  <label>Foto Bukti Meteran</label>
                  <label class="photo-capture" id="photoArea">
                     <i class="fas fa-camera"></i>
                     <span>Ketuk untuk memotret meteran<br><small>(atau pilih dari galeri)</small></span>
                     <input type="file" id="inpPhoto" accept="image/*" capture="environment" style="display:none;" />
                     <img id="imgPreview" class="photo-preview mt-2" />
                  </label>
               </div>
               
               <div class="flex justify-between items-center mt-6" style="padding:15px; border:1px solid var(--border-highlight); border-radius:var(--radius-md); background:rgba(6, 182, 212, 0.1);">
                  <span class="text-info font-semibold">Estimasi Pemakaian:</span>
                  <b id="txtEstPemakaian" class="text-info text-lg" style="font-size:1.5rem;">0 m³</b>
               </div>
               
               <button type="submit" class="btn btn-primary w-full mt-6" style="padding:15px; font-size:1.1rem;" id="btnSimpanCatat">
                   <i class="fas fa-save"></i> Kirim Data Meteran
               </button>
            </form>
         </div>
      </div>
   `;

  let base64Photo = null;

  // Logic estimation
  document.getElementById('inpCurrent').addEventListener('input', (e) => {
    const cur = Number(e.target.value);
    const warn = document.getElementById('volumeWarning');
    const est = document.getElementById('txtEstPemakaian');

    if (cur < prevReading) {
      warn.style.display = 'block';
      est.innerText = '0 m³';
      est.classList.remove('text-info');
      est.classList.add('text-danger');
    } else {
      warn.style.display = 'none';
      est.innerText = (cur - prevReading) + ' m³';
      est.classList.add('text-info');
      est.classList.remove('text-danger');
    }
  });

  // Handle Photo
  document.getElementById('inpPhoto').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      base64Photo = event.target.result;
      const img = document.getElementById('imgPreview');
      img.src = base64Photo;
      img.style.display = 'block';
      document.querySelector('#photoArea i').style.display = 'none';
      document.querySelector('#photoArea span').style.display = 'none';
    };
    reader.readAsDataURL(file);
  });

  // Submit handling
  document.getElementById('formCatatMeteran').onsubmit = (e) => {
    e.preventDefault();
    const cur = Number(document.getElementById('inpCurrent').value);
    if (cur < prevReading) return showToast('Angka saat ini tidak boleh kurang dari angka bulan lalu!', 'error');

    const vol = cur - prevReading;

    const usageDB = getDB(STORAGE.usage);
    usageDB.push({
      id: `${memberId}-${year}-${month}`,
      memberId: memberId,
      year: year,
      month: month,
      prevReading: prevReading,
      currentReading: cur,
      volume: vol,
      photoData: base64Photo, // Base64 string
      officerId: getSession().username,
      timestamp: new Date().toISOString()
    });

    saveDB(STORAGE.usage, usageDB);
    logAction('catat', `Mencatat meteran ${memberId} (${vol} m³)`);
    showToast('Data pencatatan berhasil disimpan!');
    window.location.hash = '#tugas';
  };
}

// Override routing temporarily for the special dynamic route #formcatat-XXX
const originalHandleRoute = handleRoute;
window.handleRoute = function () {
  const hash = window.location.hash;
  const session = getSession();
  if (session && session.role === 'petugas' && hash.startsWith('#formcatat-')) {
    let contentArea = document.getElementById('main-content-area');
    if (!contentArea) {
      renderAppLayout(session);
      contentArea = document.getElementById('main-content-area');
    }
    const memberId = hash.replace('#formcatat-', '');
    renderPetugasFormCatat(contentArea, memberId);
  } else {
    originalHandleRoute();
  }
};

function renderPetugasPasang(container) {
  updateTopbarTitle('Tugas Pemasangan Baru (SPK)');

  const spks = getDB(STORAGE.spk).filter(s => s.status === 'pending');
  const members = getDB(STORAGE.members);

  if (spks.length === 0) {
    container.innerHTML = `<div class="card animate-fade-in text-center p-6"><i class="fas fa-check-circle text-success" style="font-size:3rem; margin-bottom:15px;"></i><h3>Tidak ada tugas pemasangan</h3><p class="text-muted">Semua SPK sudah diselesaikan.</p></div>`;
    return;
  }

  container.innerHTML = `
      <div class="animate-fade-in" style="display:grid; gap:15px;" id="listSpk">
         ${spks.map(s => {
    const m = members.find(x => x.id === s.memberId);
    return `
               <div class="card" style="border-left:4px solid var(--accent-warning);">
                  <div class="flex justify-between mb-2">
                     <span class="badge badge-warning">SPK Baru</span>
                     <b class="text-primary">${s.id}</b>
                  </div>
                  <h3 class="m-0">${m ? m.fullName : 'Unknown'} (${s.memberId})</h3>
                  <p class="text-muted mt-1 mb-4"><i class="fas fa-map-marker-alt"></i> ${m ? m.address : '-'} - ${m ? m.zone : '-'}</p>
                  
                  <div style="background:var(--surface); padding:15px; border-radius:var(--radius-md);">
                     <p class="font-bold text-sm mb-2"><i class="fas fa-wrench"></i> Input Data Penyelesaian</p>
                     <div class="form-group mb-2">
                        <input type="text" id="sn-${s.id}" placeholder="Nomor Seri / ID Meteran (Wajib)*" required style="border-color:var(--border-highlight)"/>
                     </div>
                     <button class="btn btn-success w-full mt-2" onclick="selesaikanSpk('${s.id}')"><i class="fas fa-check"></i> Selesaikan Pemasangan</button>
                  </div>
               </div>
             `;
  }).join('')}
      </div>
   `;

  window.selesaikanSpk = (spkId) => {
    const sn = document.getElementById(`sn-${spkId}`).value.trim();
    if (!sn) return showToast('Nomor seri meteran wajib diisi!', 'error');

    if (!confirm('Konfirmasi pemasangan telah selesai dan meteran sudah berjalan?')) return;

    const spkDB = getDB(STORAGE.spk);
    const idx = spkDB.findIndex(x => x.id === spkId);
    if (idx > -1) {
      spkDB[idx].status = 'installed';
      spkDB[idx].serialNumber = sn;
      spkDB[idx].installedAt = new Date().toISOString();
      spkDB[idx].officerId = getSession().username;
      saveDB(STORAGE.spk, spkDB);

      logAction('pasang', `Menyelesaikan SPK ${spkId} (SN: ${sn})`);
      showToast('SPK berhasil diselesaikan!');
      renderPetugasPasang(container); // reload
    }
  };
}

function renderPetugasRiwayat(container) {
  updateTopbarTitle('Riwayat Tugas Saya');
  const myUsername = getSession().username;

  const usages = getDB(STORAGE.usage).filter(u => u.officerId === myUsername).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const spks = getDB(STORAGE.spk).filter(s => s.officerId === myUsername).sort((a, b) => new Date(b.installedAt) - new Date(a.installedAt));

  container.innerHTML = `
      <div class="kpi-grid animate-fade-in mb-6">
         <div class="card kpi-card">
            <div class="kpi-title">Total Mencatat Meteran</div>
            <div class="kpi-value text-info">${usages.length}</div>
         </div>
         <div class="card kpi-card">
            <div class="kpi-title">Total Pemasangan Baru</div>
            <div class="kpi-value text-success">${spks.length}</div>
         </div>
      </div>
      
      <div class="card animate-slide-up">
         <h3>Tugas Terakhir</h3>
         <div style="display:flex; flex-direction:column; gap:10px;">
            ${usages.slice(0, 10).map(u => `
               <div style="padding:10px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">
                  <div>
                     <b><i class="fas fa-check-circle text-info"></i> Mencatat Meteran</b>
                     <p class="m-0 mt-1 text-sm text-muted">ID: ${u.memberId} | Hasil: ${u.currentReading} m³</p>
                  </div>
                  <small class="text-muted">${formatDate(u.timestamp)}</small>
               </div>
            `).join('')}
            
            ${spks.slice(0, 5).map(s => `
               <div style="padding:10px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">
                  <div>
                     <b><i class="fas fa-wrench text-warning"></i> Pasang Baru (SPK)</b>
                     <p class="m-0 mt-1 text-sm text-muted">ID: ${s.memberId} | SN: ${s.serialNumber}</p>
                  </div>
                  <small class="text-muted">${formatDate(s.installedAt)}</small>
               </div>
            `).join('')}
            
            ${usages.length === 0 && spks.length === 0 ? '<p class="text-center text-muted">Belum ada riwayat tugas.</p>' : ''}
         </div>
      </div>
   `;
}

// --- INIT APP LAUNCHER ---
window.addEventListener('hashchange', handleRoute);
window.addEventListener('DOMContentLoaded', async () => {
  initStorage();
  const s = await apiGetSession();
  if (s && s.user) {
    setSession({
      username: s.user.username,
      email: s.user.email,
      role: s.user.role,
      name: s.user.name
    });
  } else {
    clearSession();
  }
  handleRoute();
});
