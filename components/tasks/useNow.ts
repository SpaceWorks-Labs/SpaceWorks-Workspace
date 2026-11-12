"use client";

import { useEffect, useState } from "react";

const minute = () => {
  const date = new Date();
  date.setSeconds(0, 0);
  return date;
};

/**
 * "Now" for due-date maths, refreshed every minute so overdue and today
 * groupings do not freeze while a page stays open. Rounded down to the minute
 * so server and client renders agree except across a minute boundary.
 */
export function useNow(): Date {
  const [now, setNow] = useState(minute);
  useEffect(() => {
    const id = setInterval(() => setNow(minute()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}
