# Round TUIT: project brief

Version 1, 24 November 2026. Owner: Mark. Maker: Mark 1 Apps Ltd.

## What it is
A jobs list for two people that puts itself in a sensible order, so the quick jobs get done and the dated jobs are not forgotten. The name is the old joke: you will do it when you get a round tuit.

## Who uses it
Two people in one home, each on their own iPhone: one iPhone Duo (the foldable) and one iPhone 16 Plus. Mobile only.

## What it must do
1. Each person has their own list. Either can add to the other's. A third list, "Either of us", holds jobs for whoever gets there first.
2. The list arranges itself. Quick jobs come before long ones. A job with a date climbs as the date gets close, and a long job starts climbing earlier than a short one.
3. Adding a job is fast: one sentence, typed or spoken ("Ring the plumber by 3 today, for Sam"), fills in the job, the time and whose list.
4. Reminders give the job's title. Three levels per job: Quiet (once), Nudge (every 15 minutes), Buzzer (keeps going until the job is ticked; Silence only pauses it for 10 minutes).
5. Jobs can carry a colour. Colours are named in Settings and given to jobs by hand.
6. It looks and feels premium, in the Daybook look: plum, apricot and cream, Fraunces and Inter.

## Decisions made
| Date | Decision |
| --- | --- |
| 24 Nov 2026 | Name: Round TUIT. Mark: a circle followed by TUIT, and TUIT inside a circle for the icon. |
| 24 Nov 2026 | Daybook colours and type, by Mark's choice, although the brand guide gives future apps their own palette. |
| 24 Nov 2026 | Vanilla HTML, CSS and JS with no build step, the same as Daybook, so it can be wrapped with Capacitor for TestFlight later. |
| 24 Nov 2026 | No chips for choosing values. Time and size are set by sliding; other choices are plain rows. |
| 24 Nov 2026 | Colours are a setting, given to jobs by hand to begin with. |
| 24 Nov 2026 | A job's size may be guessed by AI. Until that is wired up, a simple word list makes the guess and one slide corrects it. |
| 24 Nov 2026 | All twelve UX ideas accepted (see below), with the chips replaced. |
| 24 Nov 2026 | Sharing follows Daybook: email and password sign-in, one shared list for two people, joined by a one-use code. Its own Firebase project, not Daybook's. |
| 24 Nov 2026 | A reminder sounds on the phone of the person the job is for; "Either of us" jobs sound on both. |
| 24 Nov 2026 | TestFlight is available (Daybook uses it), so stage 5 will reuse Daybook's workflow with a new bundle id. |
| 24 Nov 2026 | Closed-app reminders are web push sent by the bridge every minute. The bridge makes and keeps its own push key, so there is no key to set up by hand. Background notifications cannot be silenced from the banner on iPhone: Silence is on the buzzer screen. |
| 24 Nov 2026 | Work goes straight to `main`, which GitHub Pages publishes. |

## How the order works
Every job has a size (5 minutes up to a big job) and may have a date.
- **Now**: overdue, or due within the hour. Soonest first.
- **Next up**: due today, or its start-by time has arrived. A 5 minute job starts climbing an hour before it is due; half a day's work climbs two days before; a big job five days before. Soonest first.
- **When you get a round tuit**: everything else, quickest first.
A big job with steps counts as a short job while it has a next step, so it does not sit at the bottom for ever.

## Stages
| Stage | What | State |
| --- | --- | --- |
| 1 | The app on one phone: lists, capture by sentence and speech, ordering, colours, steps, repeats, "I have 10 minutes", the in-app buzzer, the Duo layout | Built, this version |
| 2 | Sharing between the two phones and sign-in, in Daybook's pattern: Firebase sign-in and Firestore, with a Cloudflare Worker bridge that alone writes who belongs | Built and tested on the emulator. Needs `docs/SETUP-SHARING.md` done before it is live |
| 3 | Reminders when the app is closed: the bridge checks every minute and sends web push, with Quiet, Nudge and Buzzer repeats, Silence and quiet hours | Built and tested on the emulator. Live once sharing is set up; needs the Home Screen app and notifications allowed |
| 4 | AI size guesses; add from Siri or the Action Button; morning summary | Needs stage 2 |
| 5 | Capacitor wrap and TestFlight, for a buzzer that can sound through silent mode | After stage 3 is judged on the real phones |

## The twelve ideas
1 one-sentence capture; 2 quick times (by slider, not chips); 3 a size on every job; 4 start-by ordering; 5 colours, named in Settings; 6 three reminder levels with quiet hours; 7 the "Either of us" list; 8 "I have 10 minutes"; 9 steps for big jobs; 10 add without opening the app; 11 repeating jobs and a morning summary; 12 "Still want these?" after a fortnight.

## Standards
- The Daybook brand guide for colour, type, voice and accessibility (WCAG 2.2 AA, 48 px targets, body text 17 px or more, nothing by colour alone).
- `docs/IPHONE-DUO.md` for layout. `docs/SPEECH-TO-TEXT.md` for Tap to speak.
- The repository is public: no real names, no personal details, no keys.

## Still to decide
- Whether the web buzzer is strong enough, or the TestFlight build is needed (stage 5).
- Measured screen sizes from the real Duo, folded and unfolded, from `device.html`.
