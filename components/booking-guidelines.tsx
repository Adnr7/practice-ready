"use client";

export const GUIDELINES_VERSION = "2026-10-20";
export const GUIDELINES_TITLE = "Booking & equipment guidelines";
export const GUIDELINES_AGREEMENT = "I have read and agree to follow the booking and equipment guidelines.";

const sections = [
  {title:"Booking a room",items:[
    "Sign up with your university email (@vijaybhoomi.edu.in). Email verification is not enabled in this demo.",
    "Choose an available start within the next hour, or the remaining time in the current half-hour.",
    "Book a maximum of 3 hours in consecutive half-hour slots. The one-hour rule applies to your start, not your end, including across midnight and 6 AM.",
    "‘Not open’ periods have no eligible start. Slots show when booking opens. Booked slots are unavailable; availability is checked again at confirmation."
  ]},
  {title:"Managing your reservation",items:[
    "Check the room, date and time before confirming. Find upcoming, active and past sessions in My Reservations.",
    "Cancel or reschedule upcoming sessions if plans change. Your original booking stays reserved until a reschedule is confirmed. The replacement must meet the booking rules.",
    "You can end an active session early. Ending or cancelling a session does not record equipment returns."
  ]},
  {title:"Equipment locations and moves",items:[
    "Check current location and working condition before practice. Reference photos may differ from the actual equipment.",
    "Record a move only after physically moving the equipment. Check the item, destination, purpose and return time.",
    "Linked-session moves open 30 minutes before your session and remain available during it. Return equipment by the session end or the form’s 3-hour limit, whichever is earlier.",
    "For other moves, follow the form’s deadline. Return equipment to its default location by the recorded deadline, then record its return. Late returns stay marked in history.",
    "After an FTS reschedule, review linked moves, destinations and return times. A reservation change does not physically move equipment."
  ]},
  {title:"Handle equipment with care",items:[
    "Handle equipment gently and keep food, drinks and other liquids away. Keep cables tidy and walkways clear.",
    "Do not force plugs, pull cables by their wires or change unfamiliar settings. Ask FTS for help with heavy equipment, power connections or unfamiliar setups.",
    "Leave the room and equipment clean and ready for the next person. Return accessories with the correct equipment."
  ]},
  {title:"Report a problem",items:[
    "Stop using equipment that appears unsafe. Contact FTS for assistance rather than attempting repairs.",
    "Report missing, damaged or faulty equipment and room problems in Reports & Support. Give the location, item and a clear description; add a relevant photo if helpful.",
    "FTS verifies issues before changing equipment availability or condition. Check My reports for updates."
  ]},
  {title:"What FTS can see",items:[
    "FTS can see your name, university email and phone number for contact about facilities, reservations and reports.",
    "FTS can see reservation history, equipment moves and returns, and submitted reports or saved messages, including descriptions and photos. Include only relevant information in reports and photos."
  ]},
  {title:"What FTS can do",items:[
    "FTS can view schedules, reschedule or cancel reservations, and end active sessions. FTS rescheduling has a 3-hour limit but can reschedule starts beyond the next hour.",
    "FTS can record moves and returns on your behalf and correct movement records with a reason. Records distinguish who moved equipment from who recorded its return.",
    "FTS can add or edit equipment details, locations, photos and working condition, and archive or restore equipment.",
    "FTS can respond to reports and mark them Open, In progress or Resolved. FTS actions are attributed in records or update history. Review changes affecting your session."
  ]},
  {title:"Privacy and this demo",items:[
    "The FTS interface does not show your password or personal practice-journal notes and photos.",
    "This demo saves your account, agreement, reservations, reports and moves in this browser. Its student and FTS views use those local records. Nothing syncs across devices or reaches the real team automatically.",
    "To contact the real team, use Email or Call in Reports & Support. This demo does not send verification or password-reset emails."
  ]}
];

export default function BookingGuidelines(){
 return <article aria-label={GUIDELINES_TITLE} className="space-y-5 text-sm leading-6 text-slate-700 dark:text-slate-200">
  <p><span className="sm:hidden">Booking rules, equipment care and what FTS can see and do.</span><span className="hidden sm:inline">Read how booking works, how to care for shared equipment, and what Facilities &amp; Technical Support (FTS) can see and manage.</span></p>
  {sections.map(section=><section key={section.title} className="rounded-2xl border border-violet-200 bg-white/80 p-4 dark:border-[#30384D] dark:bg-[#1B2133]"><h3 className="text-base font-semibold text-slate-900 dark:text-white">{section.title}</h3><ul className="mt-2 list-disc space-y-1.5 pl-5 sm:space-y-2">{section.items.map(item=><li key={item}>{item.split(/(start within the next hour|maximum of 3 hours|30 minutes before|by the recorded deadline|default location|can reschedule starts beyond the next hour)/gi).map((part,index)=>index%2?<strong key={index} className="font-semibold text-slate-900 dark:text-white">{part}</strong>:part)}</li>)}</ul></section>)}
  <p className="text-xs text-slate-500 dark:text-slate-400">Version {GUIDELINES_VERSION} · You can revisit these guidelines in Reports &amp; Support.</p>
 </article>;
}
