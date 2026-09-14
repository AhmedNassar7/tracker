import { useEffect, useState } from "react";
import { disableNotifications, enableNotifications, isNotifyEnabled, notificationsSupported } from "../lib/notifications";

// A single explicit tap, no settings panel — permission is requested only
// here, matching the "ask only on an explicit turn-on" rule (Lane C7).
export default function NotificationToggle() {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [justDenied, setJustDenied] = useState(false);

  useEffect(() => {
    setSupported(notificationsSupported());
    setEnabled(isNotifyEnabled() && notificationsSupported() && Notification.permission === "granted");
  }, []);

  if (!supported) return null;

  const handleClick = async () => {
    if (enabled) {
      disableNotifications();
      setEnabled(false);
      return;
    }
    const ok = await enableNotifications();
    setEnabled(ok);
    setJustDenied(!ok);
  };

  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        onClick={handleClick}
        title={
          enabled
            ? "Alerts on — checked when you visit: new saved-search matches, and bookmarked deadlines within 48h"
            : "Get a browser notification for new saved-search matches and bookmarked deadlines within 48h"
        }
        className={
          "inline-flex items-center gap-1 rounded-full border px-3 py-0.5 text-sm font-medium " +
          (enabled
            ? "border-teal-700 bg-teal-700 text-white dark:border-teal-600 dark:bg-teal-600"
            : "border-dashed border-slate-300 text-slate-500 hover:border-teal-500 hover:text-teal-700 dark:border-slate-700 dark:text-slate-400 dark:hover:border-teal-600 dark:hover:text-teal-400")
        }
      >
        🔔 {enabled ? "Alerts on" : "Turn on alerts"}
      </button>
      {justDenied && (
        <span className="mt-1 text-xs text-slate-400 dark:text-slate-500">
          Blocked — allow notifications for this site in your browser settings to turn this on.
        </span>
      )}
    </span>
  );
}
