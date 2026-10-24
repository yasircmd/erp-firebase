# Onboarding dry run

A rehearsal of [ONBOARDING.md](ONBOARDING.md) on a spare project of the
firm's own, before the first real client (owner, 2026-10-23). The firm plays
both sides: the client's IT (part A) and the firm (part B). Every step says
what to expect. Note anything else under **Found**: that is what the dry run
is for. Fix the guide or the app, then onboard the client.

**Time:** about 1½ hours, most of it part A.
**Cost:** nothing on the Spark plan, which the dry run uses on purpose: the
client's project only holds data; the functions run in the firm's project.

## Before starting

| # | Step | Expect | ✓ |
|---|---|---|---|
| 0.1 | Use a **different Google account** from the one that owns `erp1-8f4cd` (a new Gmail is fine). | A client never has the firm's rights. With the firm's own account, a missing grant can go unnoticed. | |
| 0.2 | Choose a test Corporate ID and name, e.g. **900**, "Dry Run Trading". | Not used in Developer → the directory. | |
| 0.3 | Have the deploy account's email ready (sent separately, not in the repository). | | |
| 0.4 | Note the time you start: the Audit Logs check (A.8) looks from then. | | |

## A. As the client's IT (signed in with the test Google account)

| # | Step (ONBOARDING.md) | Expect | ✓ |
|---|---|---|---|
| A.1 | Create the Firebase project (A.1). Note its **project ID**. | The project opens. | |
| A.2 | Plan: stay on **Spark** (A.2). | No billing prompt. | |
| A.3 | Realtime Database, locked mode, **us-central1** (A.3). | The database URL shows, `https://<project>-default-rtdb.firebaseio.com`. | |
| A.4 | Firestore, native mode, production rules, **us-central1** (A.3). | An empty database. | |
| A.5 | Authentication → Email/Password on (A.3). | | |
| A.6 | Authorized domains: add `erp1-8f4cd.web.app` and `erp1-8f4cd.firebaseapp.com` (A.4). | Both listed with `localhost` and the project's own. | |
| A.7 | Add a Web app and copy its config, plus the database URL (A.5). | `apiKey`, `authDomain`, `projectId`, `appId`. | |
| A.8 | The grants (A.6), in the test project's Cloud Shell, the deploy account's email put in. | Nine "OK" lines (four app, five deploy). "STOP: DEPLOY must be …" means the email is not a full service-account email. | |

## B. As the firm (Corporate 100, Developer)

| # | Step (ONBOARDING.md) | Expect | ✓ |
|---|---|---|---|
| B.1 | Developer → **Add corporate**: 900, the name, project ID, database URL, web config; **Status Inactive** (B.1). | Saved; 900 in the list. | |
| B.2 | **Test connection** (B.2). | Realtime Database "reachable, no ERP users yet", Firestore "reachable", Authentication "reachable, password sign-in on". The result stays on screen. **If one fails**, its grant is missing: Realtime Database and Firestore are the functions' account's first two roles, Authentication its third. | |
| B.3 | The corporate's own **Tree** tab → **Back to the main tree** (B.4). | Tree status "follows the main tree"; Set up step 3 "given the main tree" at once. | |
| B.4 | Set up → **Copy the chart headings** (B.5). | "N headings copied". Run it again: refused, "chart has accounts already". | |
| B.5 | Set up → first Admin: a name and an email **you can read** → **Create the first Admin** (B.6). | "Created. … has been sent the email to set a password." (If it says to use Forgot Password instead, the email was not sent: note it, then do that.) The email comes **from the test project** (its name in the sender), not from the ERP's. Run it again: refused, "has an Admin already". | |
| B.6 | Modules: tick a few (e.g. the Finance ones) → Save; then **Status Active** → Save (B.7). | Saved. Set up shows modules and Active ticked. | |
| B.7 | GitHub → Actions → **Deploy** → `database rules` (B.3). | The log shows "Rules deployed to: 900 (<project>)" and the tree line. Set up shows "deployed with release …". **Watch:** "RULES NOT DEPLOYED: 900 … permission" means the deploy account's grant (A.8) is missing or wrong; the message names what is missing. | |

**Do B.7 before anyone signs in.** The rules deploy carries the Realtime
Database indexes (`.indexOn`). Without them the Home page's queries are
refused ("Index not defined"). It also creates the Firestore index
(firestore.indexes.json): in the test project, Firestore → Indexes shows
`journalEntries` building, then Enabled after a few minutes.

## C. As the client's Admin

| # | Step | Expect | ✓ |
|---|---|---|---|
| C.1 | Open the email from B.5 and set a password. | The page is the test project's (`<project>.firebaseapp.com`). | |
| C.2 | https://erp1-8f4cd.web.app → Corporate ID **900**, the email, the password. | Home opens with the main tree, only the modules ticked in B.6. No Developer item. | |
| C.3 | Company Master: add a company (made-up details). | Saved. | |
| C.4 | Chart of Accounts: the headings from B.4, and add a posting account under one. | Headings shown; the account saves under its heading. | |
| C.5 | User Management: add a second user. | Saved. The new user can sign in with Corporate ID 900. | |
| C.6 | Post one Journal Entry, then open the JV list. | Posted; listed. **Watch:** in the firm's Cloud console → Logging, a warning "journalListPage_: falling back to a full read" means the Firestore index (B.7) is not built yet, or was not deployed. Once it is Enabled the warning stops; if it persists, note it under Found. | |
| C.7 | Support: send an issue with a small file. | Sent after the warning. In Corporate 100's Developer → Support queue, it shows as from 900, with the file. Answer it; the answer shows in 900. | |
| C.8 | Sign out, then sign in with Corporate ID **100**, using the 900 Admin's email. | Refused: the 900 Admin is not a user of Corporate 100. | |

## D. The client's side of the grants

| # | Step | Expect | ✓ |
|---|---|---|---|
| D.1 | In the test project (as the client): IAM & Admin → **Audit Logs** / Logs Explorer, from the start time. | The firm's accounts' calls are visible to the client. | |
| D.2 | Nobody at the firm has a role in the test project except the two service accounts. | IAM lists only the test account (Owner) and the two service accounts. | |

## E. Leaving (ONBOARDING.md D)

| # | Step | Expect | ✓ |
|---|---|---|---|
| E.1 | Developer → 900 → **Status Inactive** → Save. | Signing in with 900 is refused at once. | |
| E.2 | As the client: remove the grants (IAM → the two service accounts → delete). Then Developer → **Test connection**. | All three fail: the client cut access itself. | |
| E.3 | Delete the test project (Project settings → Delete), or keep it for the next rehearsal. | | |

The 90-day deletion (decision 265) is not waited for: the emulator tests
cover it, and the next release would delete 900's Support issue and notes
after 90 days. Keep 900 Inactive in the directory, or note its ID so
nobody reuses it.

## Found

Write each finding here: the step, what happened, and what was expected.
Then decide for each: fix the guide, fix the app, or accept it.

**First run, 2026-10-23** (owner; project `dry-run-trading`, a separate
Google account, Corporate 900). Every part passed once these were dealt
with; all ten fixed on branch `dry-run-fixes` (the steps above are
updated to match).

| # | Step | What happened | Decision |
|---|---|---|---|
| 1 | A.8 | The guide's `THE-FIRMS-DEPLOY-ACCOUNT` gave no idea of the email's form: "Invalid service account (erp1-8f4cd)" | Guide: the form shown; the commands stop on a value that is not a service-account email |
| 2 | B.2 | Test connection's result vanished at once (the reload after it) | App: it stays on screen |
| 3 | B.2 | Authentication failed: the functions' account also needs **Service Usage Consumer** | Guide: added to the grants (blocking for every client) |
| 4 | B.7 | Rules not deployed, same reason, for the deploy account | Guide: added to the grants (blocking for every client) |
| 5 | B.7 | "Rules: not deployed" full of colour codes and cut before the error | App: colours stripped, the reason from the CLI's "Error:" line |
| 6 | B.3 | Set up still said "Menu: not yet" after Back to the main tree | App: the corporate reloads too |
| 7 | B.3 | "Update corporates that follow the main tree" skipped a corporate with no menu ("None was behind") | App: it, and each release, give the main tree to an Active corporate with no menu, and say so |
| 8 | C.1 | The password link from B.5 had expired (one hour) | App: Set up → Send the password email again; guide: the hour said |
| 9 | C.1 | Email/Password had not been switched on; Test connection passed; the link failed as "expired or already used" (`PASSWORD_LOGIN_DISABLED`) | App: Test connection checks password sign-in (and the API key), so the corporate cannot go Active; guide: A.3 spelt out (blocking) |
| 10 | C.2 | The company name stayed off Home's title until a reload after the company was assigned | App: refreshed on returning to Home |

**Second run, 2026-10-24** (owner; test client C101, `client-test-1-4eb19`,
made before the grant list was settled, so with no grants at all). Test
connection named each part that failed; after the grants (ONBOARDING.md
A.6) it passed, the corporate went Active, the rules release reached it,
and its first Admin signed in. Two findings, both dealt with:

| # | Step | What happened | Decision |
|---|---|---|---|
| 11 | B.2 | Authentication's failure showed Google's whole raw response (JSON) | App: one sentence, the response's own message (PR #165) |
| 12 | A.8 | "THE-FIRMS-DEPLOY-ACCOUNT" was not understood as the deploy account's email | Message: step 6 says what each account is, with the commands (PR #164); keep the email at hand for each client |
