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
