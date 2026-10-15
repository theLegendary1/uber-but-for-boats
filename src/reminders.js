// Texts that go out on their own, checked every few minutes: the reminder the evening before a wash, one nudge to a
// cleaner who hasn't answered, and a heads-up to the manager while a service in the next two days still has open spots.
// Never in quiet hours, and each goes out once (re-asking a cleaner starts their reminder and nudge over).
import * as db from './db.js';
import * as notify from './notify.js';
import { localDay, localHour, addDays } from './dates.js';

const QUIET_UNTIL = 8;      // nothing before 8 AM...
const QUIET_FROM = 21;      // ...or from 9 PM
const REMIND_FROM = 17;     // the day-before reminder, from 5 PM
const DIRECTOR_FROM = 9;    // the manager's heads-up, from 9 AM
const NUDGE_AFTER = 4;      // hours a request can sit unanswered before the nudge

/** `today` and `hour` are for tests; normally it's now. */
export function run({ today = localDay(), hour = localHour() } = {}) {
  if (hour < QUIET_UNTIL || hour >= QUIET_FROM) return;
  if (hour >= REMIND_FROM) {
    for (const r of db.dueReminders(addDays(today, 1))) {
      db.markReminded(r.request_id);   // marked first: a text missed beats a text sent twice
      notify.reminder(r.request_id);
    }
  }
  for (const r of db.dueNudges(today, NUDGE_AFTER)) {
    db.markNudged(r.request_id);
    notify.nudge(r.request_id);
  }
  if (hour >= DIRECTOR_FROM) {
    for (const s of db.openServicesToNudge([addDays(today, 1), addDays(today, 2)], today)) {
      db.markManagerNudged(s.id, today);
      notify.managerNudge(s);
    }
  }
}
