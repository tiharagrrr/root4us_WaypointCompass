# Departures from the design

Where a built screen deliberately differs from its Figma frame, and why. `/fidelity <frame>` adds a
row for every intended difference; anything else that differs is a bug.

| Screen | Designed | Built | Why |
| --- | --- | --- | --- |
| A0 Sign in | "Forgot password?" link | "Forgot password? Ask your admin." as plain text | No password-reset route exists yet (open question in specs/identity/spec.md) |
| A0 Sign in | "Email or phone" signs in with either | Email or username with a password; a phone number gets a pointer to the driver app | Drivers sign in with an SMS code (D0a, D0b), never a password |
| A1 Users | Invitations interleaved with users; Edit on an INVITE SENT row | Open invitations listed above the paged users; a pending one offers Revoke, an expired one Resend invite | Users and invitations are two resources (one paged list each); an invitation has no edit endpoint |
| A1 Users | Counts beside Outlets, Depots and Vehicles | Only Users has a count | Master data and fleet have no list endpoints yet |
| A1, A6 | Bell with an unread count | Bell without a count | Notifications (ROO-26) are not built |
| A2 Invite user | "Send invite by" is a free Email/SMS choice | It follows the contact: an email gets an email, a phone number an SMS; clicking it focuses the contact field | Email roles sign in with email and password and drivers with a phone code, so the contact decides the channel |
| A6 Settings | "Split chilled orders" and "Style delivery day" toggles | Not shown | Neither is a setting in the registry (specs/identity/spec.md, Model) and nothing reads them |
| A6 Settings | "Repeat-skip warning: 7 days" | "Repeat-skip warning" in runs | planning.repeatSkipLookbackRuns counts runs (default 1), not days |
| A6 Settings | Planning, Notifications and Security panes undrawn | Planning, notification and loading settings; dock tablets under Security; a Demo section (time travel, reset) in demo mode | The spec puts dock tablets, time travel and the demo reset on A6; the frame draws only Ordering and Deferrals |
| A6 Settings | Section list undrawn as a control | The section list scrolls to its section and follows the scrolling | The frame shows the list beside one long pane; this keeps that and makes it usable |
| A6 Settings | No dock-tablet rows drawn | Ten devices a page, each showing its depot picker only while being changed | A picker on every row cost ~0.9 s per click on A6 with 111 devices registered |
| A6 Settings | Reason chips without controls | × turns a hand-added reason off and ↺ back on; engine reasons have neither | Engine reasons always stay active (AC-IDN-57) |
| Admin header | No frame for the demo-time badge | "DEMO TIME Thu 15:55" chip in the warning tone, only while the clock is shifted | AC-IDN-53 and 55 need it; it uses the chip tokens |
| /invite/:token | No frame | A0's card, with the fields the invited role accepts with (password, phone code or dock PIN) | The landing has no frame; it reuses the sign-in look |
| M1 New order | Delivery "Wed 30 Sep · 07:00–09:00" on a frame whose cutoff is the same day at 4 PM | Whatever the order carries: `deliveryDate`, its window, and `editableUntil` for the countdown | The cutoff is 16:00 on the operating day before delivery (specs/ordering/spec.md); the screen shows the server's dates rather than re-deriving them |
| M1 New order | A row per line, with no way to take one off | Quantities are edited in place; an item is removed in M1a by stepping its quantity below 1 | The frame draws no remove control on a row, and M1a already owns the quantity |
| M1 New order | "Load a saved preset" in the header, with no state drawn for it | It opens the "Preset for this order" picker in the left column | Both load a preset; one picker is enough, and no second frame exists |
| M1 New order | "Save as preset" with no naming step drawn | A Compass dialog asking for the name | A preset needs a unique name per outlet (AC-ORD-27) and the frame draws no way to give one |
| M1 New order | Five lines always present | Empty state "No items yet" when the order has none | specs/frontend/screens.md lists M1 among the screens that need an empty state; Figma has no frame for it |
| M1 New order | The day's orders already open | Empty state when the day has none, naming the day | The store can reach the screen before the day's drafts exist |
| M1a Add item | "2 selected · 8 cases · 83 kg" | The same line, with "packs" when the chosen items are packed differently | "Cases" is right only while every chosen item comes in cases |
| M1a Add item | A full list | Empty state when a search or category matches nothing | screens.md lists M1a among the screens that need one; Figma has no frame for it |
| Store sidebar | "Receipts" between Deferrals and Item catalog | The nav item is there and routes to a placeholder | No receipts list has a frame; M5 is one order's receipt (open question in specs/frontend/screens.md) |
| Store sidebar | Counts beside Orders, Deferrals, Receipts and Item catalog | Only Orders and Item catalog carry one | Receipt and planning have no list endpoints yet |
| Admin and store sidebars | Account card is a plain block of name and role | It is a menu: Sign out, and in demo mode the other seeded users to switch to | Nothing in the desktop frames signs you out; D13 is the driver's own frame. The menu uses the Select popover's styles |
| 01, 19, 19a alerts | Severity carried by the dot's colour alone | The severity word (CRITICAL, WARNING, INFORMATION) under each alert, beside the dot | specs/alerts/spec.md, Non-functional: severity shows as text as well as colour, so status is never colour alone |
| 01, 19, 19a alerts | Red dots on some severity-2 alerts and grey on others | The tone follows the server's severity: 1 red, 2 orange, 3 slate, resolved green | The frames' dot colours do not map onto a single field; tying the tone to `severity` keeps the colour and the word beside it from disagreeing |
| 01, 19 alerts | Headings read "Late risk · REF-07" | The alert's kind alone ("Late risk"); 19a passes the trip in | An alert points at its trip by id with no foreign key and alerts joins no other module (specs/alerts/spec.md, Model), so it does not know the vehicle code |
| 19 Alerts column | The open alert's footnote reads "Driver and store manager are notified. Deferrals need a reason." | "Closes itself when the flag is decided." | That notice is about notifications and deferrals, neither of which alerts owns; what alerts can tell the dispatcher is that they usually need not resolve it by hand |
| 19 Alerts column | Four fix buttons on the open alert (Re-sequence, Reassign, Update ETA, Defer stop) | Only the fixes the server sent for that alert type, and only those the viewer may take | The affordance rule (AC-ALR-07): a fix link appears only with the matching permission, so the button set is per alert and per viewer, not fixed |
| 19 Alerts column | Every fix button is pressable | A fix whose screen is not built yet is disabled and names the screen it waits on | The server correctly says the dispatcher may take the action; hiding the button would misreport what they can do, and L3b, 19b, 19c and the issue view are not built |
| 01 Dashboard, 19, 19a | Full frames | Only the alert regions are built; the KPI row, today's runs, tomorrow's cutoff, the trip list, the map and the stop timeline are dashed placeholders naming their module | Those regions belong to planning, ordering and execution (specs/frontend/screens.md lists 01 under alerts and planning, 19 and 19a under execution and alerts); ROO-50 is the alerts half |
| D1 Today's trip | "WP CBA-1234" beside the REEFER chip | The vehicle code (REF-07) | The offline bundle carries `vehicle.code` and its temperature class, not the plate |
| D1 Today's trip | Departs "05:45 · Peliyagoda" | "05:45 · PLG" | The bundle carries `depotId`, not the depot's name |
| D1 Today's trip | Load "Fresh · chilled + dry" | The trip's temperature class ("Chilled") | A trip has one `tempClass` and the bundle carries no brand, so "chilled + dry" has no source |
| D1 Today's trip | Stops listed by area ("Wattala", "Kandana") | The outlet's name ("Fresh Kadawatha") | The bundle names the outlet and puts the district on the trip; there is no per-stop area name |
| D1 Today's trip | A leaf on each chilled stop | The leaf follows the trip's temperature class | Nothing per stop in the bundle says chilled; the trip is chilled or it is not |
| D1 Today's trip | No empty state drawn | Compass empty state when `/me/trips` returns nothing | D14 No trip (247:924) is its own frame and its own issue; this is a stand-in, not a guess at that design |
| D2 Download failed | Retry and the red card | The same, plus "Last saved 03:05" | AC-EXE-05 asks for the last successful download time; the frame does not draw it |
| D2 Download failed | Start trip drawn as a normal button | Start trip disabled until the bundle is saved | A trip the phone does not hold cannot be run; the frame marks the state but not the control |
| D3 Next stop | A route map with the driver and the stop on tiles | The panel, its ROUTE MAP chip and the stop's pin, with no tiles | No map tiles or tile provider are in the app yet; the frame's own map is a flat stand-in |
| D3 Next stop | ETA 07:18 | The planned arrival from `GET /stops/{id}`, or "—" with no signal | ETA is tracking's, and tracking reads need `tracking:read`, which a driver does not hold |
| D3 Next stop | "Mall window 06:30–09:30" | Not shown | The mall window is on the outlet; the offline bundle does not carry it |
| D3 Next stop | Street address under the outlet | Not shown | `CachedStop` holds no address, so it is not on the phone |
| D3 Next stop | "Then" rows show a planned time (07:41) | They show the stop's delivery window | The planned arrival is not in the bundle; the window is, and it is what decides lateness |
| D4 Record stop | "Fresh Ja-Ela · Order #WF-0171" | The outlet's name alone | The bundle's stop has no order number on the phone |
| D4 Record stop | A tick per line and nothing else | Unticking a line opens its quantity stepper | screens.md asks for quantities per line (AC-EXE-11); the frame draws the full-delivery case only |
| D4 Record stop | No note field | A note appears as soon as a line is short | The server refuses a PARTIAL without one ("Say what was short and why") |
| D5 Exception | Four outcomes, no receiver field | A receiver name appears when Partial is chosen | PARTIAL is a delivery: the server requires the name of whoever took it |
| D5 Exception | Per-line condition implied by the outcome | Lines carry the quantity handed over, condition `ok` | D5 has no per-line reason control; guessing between damaged and refused would put a claim in the record that nobody made |
| D8 Can't run this trip | "Tihara Egodage reassigns the trip or the vehicle." | "The dispatcher reassigns the trip or the vehicle." | The phone's bundle does not say who is on dispatch today |
| D9 Dock & access | Four typed sections: Entrance, Parking, Gate, Chilled | One "Access notes" block | `outlets.accessNotes` is a single free-text field (specs/master-data), not four |
| D9 Dock & access | "Chathura · store staff" and "Added by the store manager · updated 12 Sep" | The contact's name and number alone | The bundle carries the contact's name and phone; the role and `accessNotesUpdatedAt` are not in it |
| D9 Dock & access | A full screen with a back button | A bottom sheet over D3 | specs/frontend/screens.md lists D9 as a sheet on the stop |
| D3 to D5 | Tab bar drawn on every frame | Hidden from D3 onwards | The Tab bar component's own note in Figma (243:743): home-level screens only, hidden during a live trip |
