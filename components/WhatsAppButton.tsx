import { WHATSAPP, waLink } from "@/lib/util";

export default function WhatsAppButton() {
  return (
    <a className="order" href={waLink(WHATSAPP, "Hi Florenti, I’d like to order some wax melts.")} target="_blank" rel="noopener" aria-label="Message Florenti on WhatsApp to order">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 20.5l1.7-5.4A8.5 8.5 0 1 1 21 11.5z" /></svg>
      Message to order
    </a>
  );
}
