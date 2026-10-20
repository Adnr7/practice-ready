"use client";

export const GUIDELINES_VERSION = "2026-10-20";
export const GUIDELINES_TITLE = "Booking & equipment guidelines";
export const GUIDELINES_AGREEMENT = "I have read and agree to follow the booking and equipment guidelines.";

const sections = [
  {title:"Booking a room",items:[
    "Use your Vijaybhoomi university email (@vijaybhoomi.edu.in) to sign up. In this demo, the email address is not verified.",
    "Choose an available start within the next hour. You can also choose the current half-hour while it is still in progress; only its remaining time is available.",
    "Book up to 3 hours using consecutive half-hour slots. The one-hour rule limits the start time, not the end of your session. It applies continuously across midnight and 6 AM.",
    "Periods with no eligible start show ‘Not open’. Individual slots show when they open. Booked slots cannot be selected; availability is checked again when you confirm."
  ]},
  {title:"Managing your reservation",items:[
    "Check your room, date and time before confirming. Use My Reservations to view upcoming, active and past sessions.",
    "Cancel or reschedule an upcoming reservation if your plans change. A reschedule keeps the original booking until the replacement is confirmed. The new booking must meet the current booking rules.",
    "You can end an active session early. Ending or cancelling a session does not record the return of any equipment you moved."
  ]},
  {title:"Equipment locations and moves",items:[
    "Check the equipment’s current location and working condition before practice. Reference photos may differ from the actual unit.",
    "Record a move only after the equipment has physically moved. Check the correct item, destination, purpose and expected return time.",
    "For a linked reservation, recording a move opens 30 minutes before the session starts and remains available during the session. Its return deadline cannot exceed the session end or the form’s 3-hour limit.",
    "For other moves, follow the return deadline shown in the form. Return equipment to its default location by the recorded deadline and record the return after physically returning it. Late returns remain marked in the history.",
    "If FTS reschedules your reservation, review any linked equipment moves and their destination and return time. Recording a reservation change does not physically move equipment."
  ]},
  {title:"Handle equipment with care",items:[
    "Handle equipment gently and keep food, drinks and other liquids away. Keep cables tidy and walkways clear.",
    "Do not force plugs, pull cables by their wires, or change unfamiliar wiring or settings. Ask FTS for help with heavy equipment, power connections or unfamiliar setups.",
    "Leave the room and equipment clean and ready for the next person. Return accessories with the correct equipment."
  ]},
  {title:"Report a problem",items:[
    "Stop using equipment that appears unsafe. Contact FTS for assistance rather than attempting repairs.",
    "Report missing, damaged or faulty equipment, and room problems, through Reports & Support. Give the correct location and item, describe the issue clearly and add a relevant photo if helpful.",
    "FTS must verify an issue before equipment availability or condition is changed. Check My reports for progress and responses."
  ]},
  {title:"What FTS can see",items:[
    "The FTS interface shows your name, university email and phone number so the team can contact you about facilities, reservations and reported issues.",
    "FTS can view reservation details and history, equipment movement and return records, and submitted reports or saved messages, including descriptions and attached photos. Only include information relevant to the issue in a report or photo."
  ]},
  {title:"What FTS can do",items:[
    "FTS can view room schedules, reschedule or cancel reservations, and end active sessions. FTS rescheduling follows a 3-hour session limit; student advance-booking restrictions do not determine FTS access.",
    "FTS can record equipment moves and returns, correct movement records with a reason, and record a move or return on a student’s behalf. The records distinguish who moved equipment from who recorded its return.",
    "FTS can add or edit equipment information, locations, photos and working condition, and archive or restore equipment in the directory.",
    "FTS can review reports, add responses and change their status to Open, In progress or Resolved. FTS actions are attributed in the relevant records or update history. Review any FTS changes affecting your session."
  ]},
  {title:"Privacy and this demo",items:[
    "The FTS interface does not show your password and has no view of your personal practice-journal notes or photos.",
    "This is a local prototype: account details, the agreement, reservations, reports and movement records are saved in this browser. Student and FTS demo views on this browser use those local records; data is not shared across devices or delivered to the real FTS team automatically.",
    "Use the Email or Call options in Reports & Support to contact the real team. The current demo does not send verification or password-reset emails. Access controls and email verification will need to be enforced by the backend before live use."
  ]}
];

export default function BookingGuidelines(){
 return <article aria-label={GUIDELINES_TITLE} className="space-y-5 text-sm leading-6 text-slate-700 dark:text-slate-200">
  <p>Read how booking works, how to care for shared equipment, and what Facilities &amp; Technical Support (FTS) can see and manage.</p>
  {sections.map(section=><section key={section.title} className="rounded-2xl border border-violet-200 bg-white/80 p-4 dark:border-[#30384D] dark:bg-[#1B2133]"><h3 className="text-base font-semibold text-slate-900 dark:text-white">{section.title}</h3><ul className="mt-2 list-disc space-y-2 pl-5">{section.items.map(item=><li key={item}>{item}</li>)}</ul></section>)}
  <p className="text-xs text-slate-500 dark:text-slate-400">Version {GUIDELINES_VERSION} · You can revisit these guidelines in Reports &amp; Support.</p>
 </article>;
}
