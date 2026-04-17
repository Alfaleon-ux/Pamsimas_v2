"""
Pamsimas Dusun Pilang — Invoice PDF Generator
Uses PyMuPDF (fitz) to create professional water-bill invoices.
Served via a minimal Flask API so the Vanilla-JS frontend can request PDFs.

Run:
    python3 invoice_server.py
Then the frontend POSTs billing JSON to http://localhost:5050/api/invoice
and receives the PDF as a downloadable blob.
"""

import fitz  # PyMuPDF
import math
import io
import json
import os
from datetime import datetime
from flask import Flask, request, send_file, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

MONTH_NAMES_ID = [
    "", "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember",
]


def format_rupiah(amount):
    """Format number to Indonesian Rupiah string."""
    if amount is None:
        amount = 0
    amount = int(amount)
    neg = amount < 0
    amount = abs(amount)
    s = f"{amount:,}".replace(",", ".")
    return f"-Rp{s}" if neg else f"Rp{s}"


def month_name(m):
    """Return Indonesian month name for 1-based month number."""
    return MONTH_NAMES_ID[int(m)] if 1 <= int(m) <= 12 else "-"


# ---------------------------------------------------------------------------
# Color palette  (RGB tuples 0-1 for PyMuPDF)
# ---------------------------------------------------------------------------

C_DEEP_BLUE    = (0.102, 0.212, 0.365)   # #1a365d
C_MED_BLUE     = (0.173, 0.322, 0.510)   # #2c5282
C_BRAND_BLUE   = (0.231, 0.510, 0.965)   # #3b82f6
C_LIGHT_BLUE   = (0.259, 0.600, 0.882)   # #4299e1
C_SOFT_BLUE    = (0.745, 0.890, 0.973)   # #bee3f8
C_PALE_BLUE    = (0.922, 0.973, 1.000)   # #ebf8ff
C_WHITE        = (1.0, 1.0, 1.0)
C_OFF_WHITE    = (0.969, 0.980, 0.988)
C_DARK_TEXT    = (0.102, 0.125, 0.173)   # #1a202c
C_GRAY_TEXT    = (0.443, 0.502, 0.588)   # #718096
C_LIGHT_GRAY   = (0.886, 0.910, 0.941)   # #e2e8f0
C_GREEN        = (0.220, 0.631, 0.412)   # #38a169
C_RED          = (0.898, 0.243, 0.243)   # #e53e3e
C_FOOTER_TEXT  = (0.784, 0.863, 0.941)


def fitz_color(rgb_tuple):
    """Ensure a colour tuple is in 0-1 range for fitz."""
    return rgb_tuple


# ---------------------------------------------------------------------------
# Wave drawing helpers
# ---------------------------------------------------------------------------

def draw_wave_band(page, y_center, amplitude, wavelength, page_width, fill_color,
                   y_bottom=None, segments=200):
    """
    Draw a filled wave shape from x=0..page_width.
    The top edge follows a sine curve; the bottom edge is y_bottom (flat).
    """
    if y_bottom is None:
        y_bottom = y_center + amplitude + 10

    shape = page.new_shape()
    # Start at bottom-left
    shape.draw_line(fitz.Point(0, y_bottom), fitz.Point(0, y_center))

    # Sine wave across the top
    for i in range(segments + 1):
        x = (i / segments) * page_width
        y = y_center + amplitude * math.sin(2 * math.pi * x / wavelength)
        if i == 0:
            shape.draw_line(fitz.Point(0, y_center), fitz.Point(x, y))
        else:
            shape.draw_line(shape.last_point, fitz.Point(x, y))

    # Close: down to bottom-right, across bottom
    shape.draw_line(shape.last_point, fitz.Point(page_width, y_bottom))
    shape.draw_line(shape.last_point, fitz.Point(0, y_bottom))

    shape.finish(fill=fitz_color(fill_color), color=fitz_color(fill_color))
    shape.commit()


# ---------------------------------------------------------------------------
# Main PDF builder
# ---------------------------------------------------------------------------

def generate_invoice_pdf(data: dict) -> bytes:
    """
    Generate a professional A4 invoice PDF and return the raw bytes.

    Expected *data* keys (all optional have defaults):
        invoiceId, memberName, memberId, zone, address, phone,
        month, year, prevReading, currentReading, volume,
        rate, biayaAir, biayaBeban, biayaCicilan, total,
        isPaid (bool), paidAt (ISO str or None),
        cicilanInfo: {bulanKe, tenure} or None
    """
    # --- Unpack with defaults ---
    invoice_id     = data.get("invoiceId", "-")
    member_name    = data.get("memberName", "-")
    member_id      = data.get("memberId", "-")
    zone           = data.get("zone", "-")
    address        = data.get("address", "-")
    phone          = data.get("phone", "-")
    m              = int(data.get("month", datetime.now().month))
    yr             = int(data.get("year", datetime.now().year))
    prev_reading   = data.get("prevReading", 0)
    curr_reading   = data.get("currentReading", 0)
    volume         = data.get("volume", 0)
    rate           = data.get("rate", 2100)
    biaya_air      = data.get("biayaAir", 0)
    biaya_beban    = data.get("biayaBeban", 500)
    biaya_cicilan  = data.get("biayaCicilan", 0)
    total          = data.get("total", 0)
    is_paid        = data.get("isPaid", False)
    paid_at        = data.get("paidAt", None)
    cicilan_info   = data.get("cicilanInfo", None)

    # --- Document setup (A4 portrait) ---
    W, H = fitz.paper_size("a4")  # 595.28 x 841.89 pts
    doc = fitz.open()
    page = doc.new_page(width=W, height=H)

    ML = 50       # left margin
    MR = W - 50   # right margin x
    CX = W / 2    # centre x
    CW = MR - ML  # content width

    # =====================================================================
    #  BACKGROUND
    # =====================================================================
    page.draw_rect(fitz.Rect(0, 0, W, H), fill=C_WHITE, color=C_WHITE)

    # =====================================================================
    #  TOP HEADER — deep blue rectangle + wave edges
    # =====================================================================
    header_h = 150
    page.draw_rect(fitz.Rect(0, 0, W, header_h), fill=C_DEEP_BLUE, color=C_DEEP_BLUE)

    # Medium-blue wave layer
    draw_wave_band(page, y_center=header_h - 5, amplitude=12, wavelength=120,
                   page_width=W, fill_color=C_MED_BLUE, y_bottom=header_h + 20)

    # Soft-blue wave highlight
    draw_wave_band(page, y_center=header_h + 6, amplitude=8, wavelength=100,
                   page_width=W, fill_color=C_SOFT_BLUE, y_bottom=header_h + 22)

    # White cleanup strip below waves
    page.draw_rect(fitz.Rect(0, header_h + 18, W, header_h + 40),
                   fill=C_WHITE, color=C_WHITE)

    # --- Logo: water drop circle ---
    logo_cx, logo_cy = 90, 55
    page.draw_circle(fitz.Point(logo_cx, logo_cy), 28, fill=C_LIGHT_BLUE, color=C_LIGHT_BLUE)
    page.draw_circle(fitz.Point(logo_cx, logo_cy), 21, fill=C_WHITE, color=C_WHITE)
    # Inner droplet
    page.draw_circle(fitz.Point(logo_cx, logo_cy - 3), 9, fill=C_LIGHT_BLUE, color=C_LIGHT_BLUE)
    page.draw_circle(fitz.Point(logo_cx, logo_cy - 5), 5, fill=C_WHITE, color=C_WHITE)

    # --- Organisation text ---
    page.insert_text(fitz.Point(65, 100), "PAMSIMAS",
                     fontsize=13, fontname="helv", color=C_WHITE)
    page.insert_text(fitz.Point(58, 118), "DUSUN PILANG",
                     fontsize=11, fontname="hebo", color=C_WHITE)

    # --- "INVOICE" title (right-aligned) ---
    page.insert_text(fitz.Point(MR - 195, 70), "INVOICE",
                     fontsize=38, fontname="hebo", color=C_SOFT_BLUE)

    # --- Invoice metadata ---
    meta_x = MR - 210
    page.insert_text(fitz.Point(meta_x, 92),
                     f"Invoice No : {invoice_id}",
                     fontsize=9, fontname="helv", color=C_WHITE)
    
    invoice_date = paid_at if (is_paid and paid_at) else datetime.now().strftime("%d %B %Y")
    if isinstance(invoice_date, str) and "T" in invoice_date:
        try:
            dt = datetime.fromisoformat(invoice_date.replace("Z", "+00:00"))
            invoice_date = dt.strftime("%d %B %Y")
        except Exception:
            pass

    page.insert_text(fitz.Point(meta_x, 106),
                     f"Invoice Date : {invoice_date}",
                     fontsize=9, fontname="helv", color=C_WHITE)
    page.insert_text(fitz.Point(meta_x, 120),
                     f"Periode : {month_name(m)} {yr}",
                     fontsize=9, fontname="helv", color=C_WHITE)

    # =====================================================================
    #  INVOICE TABLE
    # =====================================================================
    table_top = header_h + 45
    col_desc  = ML
    col_price = ML + CW * 0.48
    col_qty   = ML + CW * 0.66
    col_total = ML + CW * 0.82
    row_h     = 42  # each data row height
    hdr_h     = 28  # header row height

    # -- Header row --
    page.draw_rect(fitz.Rect(ML, table_top, MR, table_top + hdr_h),
                   fill=C_DEEP_BLUE, color=C_DEEP_BLUE)

    hdr_y = table_top + 18
    page.insert_text(fitz.Point(col_desc + 10, hdr_y), "Deskripsi Tagihan",
                     fontsize=9.5, fontname="hebo", color=C_WHITE)
    page.insert_text(fitz.Point(col_price + 5, hdr_y), "Harga",
                     fontsize=9.5, fontname="hebo", color=C_WHITE)
    page.insert_text(fitz.Point(col_qty + 8, hdr_y), "Vol.",
                     fontsize=9.5, fontname="hebo", color=C_WHITE)
    page.insert_text(fitz.Point(col_total + 5, hdr_y), "Total",
                     fontsize=9.5, fontname="hebo", color=C_WHITE)

    # -- Build row data --
    rows = [
        {
            "desc": "Pemakaian Air Bersih",
            "detail": f"Meteran: {prev_reading} → {curr_reading} m³",
            "price": f"{format_rupiah(rate)}/m³",
            "qty": f"{volume} m³",
            "total": format_rupiah(biaya_air),
        },
        {
            "desc": "Biaya Beban / Perawatan",
            "detail": "Biaya tetap bulanan",
            "price": format_rupiah(biaya_beban),
            "qty": "1",
            "total": format_rupiah(biaya_beban),
        },
    ]

    if biaya_cicilan and biaya_cicilan > 0 and cicilan_info:
        bk = cicilan_info.get("bulanKe", "?")
        tn = cicilan_info.get("tenure", "?")
        rows.append({
            "desc": "Cicilan Pemasangan",
            "detail": f"Angsuran ke-{bk} dari {tn} bulan",
            "price": format_rupiah(biaya_cicilan),
            "qty": "1",
            "total": format_rupiah(biaya_cicilan),
        })

    # Pad to at least 6 rows for visual consistency (like reference)
    while len(rows) < 6:
        rows.append(None)  # empty row

    y = table_top + hdr_h
    for idx, row in enumerate(rows):
        # Zebra stripe
        if idx % 2 == 0:
            page.draw_rect(fitz.Rect(ML, y, MR, y + row_h),
                           fill=C_PALE_BLUE, color=C_PALE_BLUE)

        # Horizontal separator
        shape = page.new_shape()
        shape.draw_line(fitz.Point(ML, y + row_h), fitz.Point(MR, y + row_h))
        shape.finish(color=C_LIGHT_GRAY, width=0.5)
        shape.commit()

        if row:
            # Description
            page.insert_text(fitz.Point(col_desc + 10, y + 18), row["desc"],
                             fontsize=9.5, fontname="helv", color=C_DARK_TEXT)
            page.insert_text(fitz.Point(col_desc + 10, y + 32), row["detail"],
                             fontsize=7.5, fontname="helv", color=C_GRAY_TEXT)
            # Price
            page.insert_text(fitz.Point(col_price + 5, y + 22), row["price"],
                             fontsize=9.5, fontname="helv", color=C_DARK_TEXT)
            # Qty
            page.insert_text(fitz.Point(col_qty + 8, y + 22), row["qty"],
                             fontsize=9.5, fontname="helv", color=C_DARK_TEXT)
            # Total
            page.insert_text(fitz.Point(col_total + 5, y + 22), row["total"],
                             fontsize=9.5, fontname="hebo", color=C_DARK_TEXT)

        y += row_h

    # Bottom table border
    shape = page.new_shape()
    shape.draw_line(fitz.Point(ML, y), fitz.Point(MR, y))
    shape.finish(color=C_DEEP_BLUE, width=1.2)
    shape.commit()

    # =====================================================================
    #  INVOICE-TO  &  TOTALS  (side by side below table)
    # =====================================================================
    sec_y = y + 20

    # -- Left: Invoice To --
    page.insert_text(fitz.Point(ML, sec_y + 5), "Tagihan untuk:",
                     fontsize=13, fontname="hebo", color=C_DEEP_BLUE)
    page.insert_text(fitz.Point(ML, sec_y + 22), member_name,
                     fontsize=11, fontname="hebo", color=C_DARK_TEXT)
    page.insert_text(fitz.Point(ML, sec_y + 36), f"ID Pelanggan: {member_id}",
                     fontsize=9, fontname="helv", color=C_GRAY_TEXT)
    page.insert_text(fitz.Point(ML, sec_y + 50), f"Zona: {zone}",
                     fontsize=9, fontname="helv", color=C_GRAY_TEXT)
    addr_display = address if len(address) <= 45 else address[:45] + "..."
    page.insert_text(fitz.Point(ML, sec_y + 64), addr_display,
                     fontsize=9, fontname="helv", color=C_GRAY_TEXT)
    if phone and phone != "-":
        page.insert_text(fitz.Point(ML, sec_y + 78), f"HP: {phone}",
                         fontsize=9, fontname="helv", color=C_GRAY_TEXT)

    # -- Right: Totals --
    tot_x_label = MR - 200
    tot_x_val   = MR - 5

    def right_text(px, py, text, **kw):
        tw = fitz.get_text_length(text, fontname=kw.get("fontname", "helv"),
                                  fontsize=kw.get("fontsize", 9.5))
        page.insert_text(fitz.Point(px - tw, py), text, **kw)

    # Subtotal
    page.insert_text(fitz.Point(tot_x_label, sec_y + 8), "Subtotal",
                     fontsize=9.5, fontname="helv", color=C_GRAY_TEXT)
    right_text(tot_x_val, sec_y + 8, format_rupiah(biaya_air),
               fontsize=10, fontname="hebo", color=C_DARK_TEXT)

    # Beban
    page.insert_text(fitz.Point(tot_x_label, sec_y + 26), "Biaya Beban",
                     fontsize=9.5, fontname="helv", color=C_GRAY_TEXT)
    right_text(tot_x_val, sec_y + 26, format_rupiah(biaya_beban),
               fontsize=10, fontname="helv", color=C_DARK_TEXT)

    next_line = sec_y + 44
    if biaya_cicilan and biaya_cicilan > 0:
        page.insert_text(fitz.Point(tot_x_label, next_line), "Cicilan",
                         fontsize=9.5, fontname="helv", color=C_GRAY_TEXT)
        right_text(tot_x_val, next_line, format_rupiah(biaya_cicilan),
                   fontsize=10, fontname="helv", color=C_DARK_TEXT)
        next_line += 18

    # Separator
    next_line += 4
    shape = page.new_shape()
    shape.draw_line(fitz.Point(tot_x_label, next_line), fitz.Point(MR, next_line))
    shape.finish(color=C_LIGHT_GRAY, width=0.6)
    shape.commit()

    # TOTAL box
    total_box_y = next_line + 6
    total_box = fitz.Rect(tot_x_label - 5, total_box_y,
                          MR + 5, total_box_y + 36)
    page.draw_rect(total_box, fill=C_DEEP_BLUE, color=C_DEEP_BLUE,
                   width=0, radius=0.12)

    page.insert_text(fitz.Point(tot_x_label + 12, total_box_y + 24), "TOTAL",
                     fontsize=13, fontname="hebo", color=C_WHITE)
    right_text(MR - 2, total_box_y + 24, format_rupiah(total),
               fontsize=16, fontname="hebo", color=C_WHITE)

    # =====================================================================
    #  PAYMENT STATUS STAMP
    # =====================================================================
    stamp_y = total_box_y + 60

    if is_paid:
        stamp_rect = fitz.Rect(CX - 75, stamp_y, CX + 75, stamp_y + 44)
        page.draw_rect(stamp_rect, color=C_GREEN, width=3,
                       radius=0.15)
        tw = fitz.get_text_length("LUNAS", fontname="hebo", fontsize=26)
        page.insert_text(fitz.Point(CX - tw / 2, stamp_y + 30), "LUNAS",
                         fontsize=26, fontname="hebo", color=C_GREEN)

        # Paid date
        if paid_at:
            try:
                dt = datetime.fromisoformat(paid_at.replace("Z", "+00:00"))
                paid_str = dt.strftime("%d %b %Y, %H:%M")
            except Exception:
                paid_str = str(paid_at)
        else:
            paid_str = "-"
        paid_label = f"Dibayar: {paid_str}"
        tw2 = fitz.get_text_length(paid_label, fontname="helv", fontsize=8)
        page.insert_text(fitz.Point(CX - tw2 / 2, stamp_y + 56), paid_label,
                         fontsize=8, fontname="helv", color=C_GRAY_TEXT)
    else:
        stamp_rect = fitz.Rect(CX - 90, stamp_y, CX + 90, stamp_y + 44)
        page.draw_rect(stamp_rect, color=C_RED, width=3,
                       radius=0.15)
        label = "BELUM LUNAS"
        tw = fitz.get_text_length(label, fontname="hebo", fontsize=22)
        page.insert_text(fitz.Point(CX - tw / 2, stamp_y + 30), label,
                         fontsize=22, fontname="hebo", color=C_RED)

    # =====================================================================
    #  SIGNATURE AREA
    # =====================================================================
    sig_y = stamp_y + 70
    right_text(MR, sig_y, "Tanda Tangan Admin",
               fontsize=9, fontname="hebi", color=C_GRAY_TEXT)

    sig_y += 45
    shape = page.new_shape()
    shape.draw_line(fitz.Point(MR - 150, sig_y), fitz.Point(MR, sig_y))
    shape.finish(color=C_LIGHT_GRAY, width=0.5)
    shape.commit()

    right_text(MR, sig_y + 14, "Petugas Pamsimas Dusun Pilang",
               fontsize=8, fontname="helv", color=C_GRAY_TEXT)

    # =====================================================================
    #  BOTTOM WAVE FOOTER
    # =====================================================================
    footer_start = H - 110

    # Soft blue wave
    draw_wave_band(page, y_center=footer_start, amplitude=10, wavelength=110,
                   page_width=W, fill_color=C_SOFT_BLUE, y_bottom=footer_start + 25)

    # Light blue wave
    draw_wave_band(page, y_center=footer_start + 14, amplitude=8, wavelength=95,
                   page_width=W, fill_color=C_LIGHT_BLUE, y_bottom=footer_start + 35)

    # Medium blue solid band
    page.draw_rect(fitz.Rect(0, footer_start + 28, W, H),
                   fill=C_MED_BLUE, color=C_MED_BLUE)

    # Deep blue bottom band
    page.draw_rect(fitz.Rect(0, footer_start + 45, W, H),
                   fill=C_DEEP_BLUE, color=C_DEEP_BLUE)

    # Decorative "seaweed" ellipses
    for cx, cy, rx, ry in [
        (70, footer_start + 18, 8, 30),
        (95, footer_start + 22, 6, 24),
        (W - 85, footer_start + 14, 8, 34),
        (W - 60, footer_start + 20, 7, 26),
        (W - 115, footer_start + 24, 5, 18),
    ]:
        r = fitz.Rect(cx - rx, cy - ry, cx + rx, cy + ry)
        page.draw_oval(r, fill=C_MED_BLUE, color=C_MED_BLUE)

    # Footer text
    foot_y = H - 38
    page.insert_text(fitz.Point(ML + 10, foot_y), "pamsimas.pilang@gmail.com",
                     fontsize=8, fontname="helv", color=C_FOOTER_TEXT)

    phone_txt = "+0812-xxxx-xxxx"
    tw = fitz.get_text_length(phone_txt, fontname="helv", fontsize=8)
    page.insert_text(fitz.Point(CX - tw / 2, foot_y), phone_txt,
                     fontsize=8, fontname="helv", color=C_FOOTER_TEXT)

    addr_txt = "Dusun Pilang, Desa Boja, Kendal"
    right_text(MR - 10, foot_y, addr_txt,
               fontsize=8, fontname="helv", color=C_FOOTER_TEXT)

    # Printed timestamp
    ts_txt = f"Dicetak: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}"
    tw = fitz.get_text_length(ts_txt, fontname="helv", fontsize=7)
    page.insert_text(fitz.Point(CX - tw / 2, foot_y + 14), ts_txt,
                     fontsize=7, fontname="helv", color=C_FOOTER_TEXT)

    sys_txt = "Pamsimas Dusun Pilang — Sistem Manajemen Air Bersih"
    tw = fitz.get_text_length(sys_txt, fontname="helv", fontsize=7)
    page.insert_text(fitz.Point(CX - tw / 2, foot_y + 26), sys_txt,
                     fontsize=7, fontname="helv", color=C_FOOTER_TEXT)

    # =====================================================================
    #  Finish — return bytes
    # =====================================================================
    pdf_bytes = doc.tobytes(deflate=True, garbage=4)
    doc.close()
    return pdf_bytes


# ---------------------------------------------------------------------------
# Flask routes
# ---------------------------------------------------------------------------

@app.route("/api/invoice", methods=["POST"])
def api_invoice():
    """
    Receive billing JSON, return a downloadable PDF.
    The frontend should POST the same data object used by downloadStruk().
    """
    data = request.get_json(force=True)
    if not data:
        return jsonify({"error": "No JSON body"}), 400

    try:
        pdf_bytes = generate_invoice_pdf(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    member_id = data.get("memberId", "X")
    month_val = data.get("month", 0)
    year_val  = data.get("year", 0)
    filename  = f"Invoice_{member_id}_{month_name(month_val)}_{year_val}.pdf"

    return send_file(
        io.BytesIO(pdf_bytes),
        mimetype="application/pdf",
        as_attachment=True,
        download_name=filename,
    )


@app.route("/api/invoice/preview", methods=["POST"])
def api_invoice_preview():
    """Same as /api/invoice but returns inline (for iframe preview)."""
    data = request.get_json(force=True)
    if not data:
        return jsonify({"error": "No JSON body"}), 400

    try:
        pdf_bytes = generate_invoice_pdf(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    return send_file(
        io.BytesIO(pdf_bytes),
        mimetype="application/pdf",
        as_attachment=False,
    )


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "Pamsimas Invoice Generator"})


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    port = int(os.environ.get("INVOICE_PORT", 5050))
    print(f"\n🧾 Pamsimas Invoice Server running on http://localhost:{port}")
    print(f"   POST /api/invoice        → download PDF")
    print(f"   POST /api/invoice/preview → inline PDF")
    print(f"   GET  /health             → health check\n")
    app.run(host="0.0.0.0", port=port, debug=True)
