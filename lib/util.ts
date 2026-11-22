export const TAGS = ["Designer", "Aftershave", "Perfume", "Xmas", "Fresh", "Laundry", "Floral", "Fruity", "Sweet", "Woody & Spice"];
export const WHATSAPP = (process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || "447511831375").replace(/\D/g, "");

export const norm = (s: string) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const pounds = (pence: number) => "£" + (pence / 100).toFixed(pence % 100 === 0 ? 0 : 2);
export const waLink = (number: string, text: string) => `https://wa.me/${number}?text=${encodeURIComponent(text)}`;

/** Turn a UK-style phone number into the international digits WhatsApp wants. */
export function waNumber(phone: string) {
  let d = (phone || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = "44" + d.slice(1);
  return d;
}

export function friendlyError(e: any): string {
  const m = (e?.message || "").toString();
  const detail = e?.details ? ` (${e.details})` : "";
  const map: Record<string, string> = {
    insufficient_stock: "Not enough stock",
    scent_unavailable: "That scent is not available",
    wrong_bar_count: "The box needs exactly the right number of bars",
    offer_unavailable: "There is no offer running right now",
    not_authorised: "You are not allowed to do that",
    stock_must_use_function: "Stock can only be changed with the stock tools",
    order_cancelled: "Cancelled orders cannot be changed",
    invalid_amount: "Enter an amount above zero",
  };
  return (map[m] || m || "Something went wrong") + detail;
}

export function downloadCsv(filename: string, rows: (string | number | boolean | null | undefined)[][]) {
  const esc = (v: any) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
