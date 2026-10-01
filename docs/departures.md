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
