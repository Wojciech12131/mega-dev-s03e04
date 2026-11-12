// R5 / SCHED-4514: times in the viewer's own zone and order. No locale or time zone is forced: the browser's
// languages decide the order (en-US mm/dd, en-GB/de-DE/pl-PL dd/mm), and its zone decides the hour.
export function formatLocal(iso, locales = navigator.languages) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return new Intl.DateTimeFormat(locales, {
    day: '2-digit',
    month: '2-digit',
    // 'numeric', not '2-digit': on 12-hour locales a padded "04:03 pm" reads as 04:03 at a glance.
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(d);
}
