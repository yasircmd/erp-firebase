# Onboarding a client corporate

Before the first client, rehearse it on a spare project:
[ONBOARDING_DRY_RUN.md](ONBOARDING_DRY_RUN.md).

The checklist for a new client (docs/modules/MULTI_CORPORATE.md §6 and M4;
owner, 2026-10-23, decisions 258–265). The client's data, sign-in and
documents are in the client's own Firebase project. The firm's app reaches
them through two grants, with no key.

## A. The client (its IT, with the firm on a call)

1. **Create a Firebase project** on the client's own Google account
   (console.firebase.google.com → Add project). Analytics are not needed.
2. **Choose the plan** (decision 264, the client's choice):
   - **Blaze (pay as you go), recommended.** Set a budget alert (Google
     Cloud console → Billing → Budgets & alerts). An ERP of this size
     usually costs a few dollars a month.
   - **Spark (free).** It allows 50,000 Firestore reads a day. A working
     ERP passes that, and then **stops for this client until the next
     day**. It can be changed to Blaze at any time.
3. **Turn on**, all in location **us-central1**:
   - Build → **Realtime Database** → Create database → locked mode;
   - Build → **Firestore Database** → Create database → native mode,
     production rules;
   - Build → **Authentication** → Get started → **Email/Password**:
     enable.
4. **Authentication → Settings → Authorized domains:** add
   `erp1-8f4cd.web.app` and `erp1-8f4cd.firebaseapp.com`.
5. **Project settings → Your apps → Add app → Web.** Send the firm the
   config: `apiKey`, `authDomain`, `projectId`, `appId`, and the database
   URL (from Realtime Database, e.g. `https://<project>-default-rtdb.firebaseio.com`).
   These values are not secrets.
6. **Grant the firm's two accounts their roles.** In Google Cloud console →
   IAM & Admin → IAM → Grant access, or in Cloud Shell (replace
   `CLIENT_PROJECT`, and `THE-FIRMS-DEPLOY-ACCOUNT` with the email the
   firm sends the client separately; it is kept out of this public
   repository, owner 2026-10-23). Both accounts were confirmed in the
   Cloud console by the owner on 2026-10-23:

   ```bash
   P=CLIENT_PROJECT
   APP=serviceAccount:303168627971-compute@developer.gserviceaccount.com   # the ERP's functions
   DEPLOY=serviceAccount:THE-FIRMS-DEPLOY-ACCOUNT                          # the firm's releases
   for R in roles/firebasedatabase.admin roles/datastore.user roles/firebaseauth.admin; do
     gcloud projects add-iam-policy-binding "$P" --member="$APP" --role="$R"
   done
   for R in roles/firebaserules.admin roles/firebasedatabase.admin roles/datastore.indexAdmin roles/firebase.viewer; do
     gcloud projects add-iam-policy-binding "$P" --member="$DEPLOY" --role="$R"
   done
   ```

   - **The ERP's functions** read and write the client's data (Realtime
     Database and Firestore) and manage its users (Authentication: User
     Management and the Employee Portal, decision 258).
   - **The firm's releases** deploy the security rules (deny-all) and the
     database indexes (Realtime Database and Firestore) with every
     release.

   **Who can see what.** Every use of these grants shows in the client's
   own audit logs (IAM & Admin → Audit Logs). The client can withdraw them
   at any time, which stops the ERP for it at once. Nobody at the firm gets
   console access: the firm's staff work through the app, as users the
   client's Admin creates.

## B. The firm

Done by a Corporate 100 user with the Developer module (Developer → the
corporate → Set up shows each step):

1. **Add the corporate** (Developer → Add corporate):
   - Corporate ID, name, the project ID, the database URL and the web
     config;
   - **Status: Inactive** until the end;
   - its **group**, if it is in one.
2. **Test connection.** All three parts (Realtime Database, Firestore,
   Authentication) must pass. If one fails, a grant is missing (A.6).
3. **Rules:** GitHub → Actions → **Deploy** → `database rules` (from
   `main`). It deploys to this project and then to every client corporate
   that is Active.
   - The new corporate is still Inactive, so set it Active just for this
     run, or wait until step 7 and run it then. Nobody can sign in before
     there is an Admin anyway.
   - Set up shows "deployed with release …" once it has run.
4. **Menu:** Tree → **Back to the main tree**.
5. **Chart headings:** Set up → **Copy the chart headings**
   (decision 261). This copies Corporate 100's current headings, with no
   posting accounts and no balances. The client's Admin then adds the
   accounts, or imports them with Master Import.
6. **First Admin:** Set up → the Admin's name and email → **Create the
   first Admin** (decision 260). The client's own Authentication sends
   them the email to set their password.
7. **Modules:** tick what the client has bought. A later module comes
   from its group (Groups) or is ticked here. Then set the corporate
   **Active** (Connection → Status → Save).
8. **Tell the client's Admin** their Corporate ID. They sign in at
   https://erp1-8f4cd.web.app with that Corporate ID and their email, then:
   - set up the companies (Company Master), the chart's accounts and the
     users;
   - connect their own Google Drive in Document Storage (with their own
     OAuth client).

## C. Each release

The `database rules` task runs this project's rules, then
tools/release-corporates.js, which:
- deploys the rules and the indexes (firestore.indexes.json) to every
  Active corporate. One it cannot reach is reported, and the others go on.
  A new Firestore index takes a few minutes to build;
- brings the corporates that follow the main tree up to date, and offers
  new modules to those with their own layout (decisions 255, 263);
- deletes what the firm holds about a corporate that has been Inactive
  for 90 days (decision 265).

## D. A client leaving

1. Developer → the corporate → **Status: Inactive**. Nobody can sign in
   through the app from then on.
2. The client withdraws the grants (IAM). Its data stays in its project,
   as it always was.
3. 90 days after step 1, the next release deletes the firm's copies: the
   Support issues and their files, and the internal notes. The directory
   entry stays, marked as deleted.
