# Onboarding: the covering message to the client

The message the firm sends a new client's IT with Part A of
[ONBOARDING.md](ONBOARDING.md) (owner, 2026-10-24). Replace each
**[bracketed]** item. Keep it in step with ONBOARDING.md: a change to Part
A (a step, a role, the number of "OK" lines) changes this message too.

Before sending:
- **[DEPLOY ACCOUNT EMAIL]** every time: the form
  `name@erp1-8f4cd.iam.gserviceaccount.com`. It is kept out of this public
  repository; a wrong one fails as "Invalid service account".
- Attach **Part A only** of ONBOARDING.md (Parts B–D are the firm's own).
- The cost figure is the guide's; adjust it if the client is quoted
  otherwise.

---

**Subject:** Setting up your ERP: what we need from your IT team (about 30 minutes)

Dear [Name],

Thank you for choosing [Firm name]'s ERP. Your company's data, user sign-in
and documents will be kept in **your own Google Firebase project**, under
your own Google account. We never hold a copy of your data. Our
application reaches it through two access grants that you give and can
withdraw at any time.

To prepare your system, we need your IT team to complete one short set-up,
which takes about **30 minutes**. The attached guide (Part A) describes
each step. In outline:

1. **Create a Firebase project** with a Google account your company owns
   and controls.
2. **Choose the plan:**
   - **Blaze (pay as you go), which we recommend.** For a business of your
     size it usually costs a few US dollars a month. Please set a budget
     alert.
   - **Spark (free).** It allows 50,000 database reads a day. A busy day
     can exceed that, and the ERP then stops for you until the next day.
     You can move to Blaze at any time.
3. **Turn on** the Realtime Database, Firestore and Authentication, all in
   the **us-central1** location.
4. **Enable Email/Password sign-in.** In Authentication → Sign-in method →
   Email/Password, switch on the **first** switch, then click **Save**. The
   list must then show it as **Enabled**. This step is easy to miss, and
   without it your staff cannot set their passwords.
5. **Add our two web addresses** to Authentication's authorised domains:
   `erp1-8f4cd.web.app` and `erp1-8f4cd.firebaseapp.com`.
6. **Grant our two service accounts their roles**, using the commands in
   the guide:
   - our application: `303168627971-compute@developer.gserviceaccount.com`
   - our release service: **[DEPLOY ACCOUNT EMAIL]**

   The commands should print nine "OK" lines.

**Please then send us:**
- your project ID;
- the Realtime Database URL, e.g.
  `https://your-project-default-rtdb.firebaseio.com`;
- the web app configuration: `apiKey`, `authDomain`, `projectId` and
  `appId`;
- the name and email address of the person who will be your ERP
  **Administrator**.

None of these values is secret, and email is fine for them. **Please do
not send passwords, or any service-account keys or JSON files.** We never
need them.

**What happens next:**
1. We connect to your project and run a connection test. If anything is
   missing, we tell you exactly what.
2. We prepare your menu and the headings of your chart of accounts.
3. Your Administrator receives an email from your own project to set a
   password. **The link is valid for one hour.** If it expires, we can send
   another, or they can use "Forgot Password" on the sign-in page.
4. We send your **Corporate ID**. Your Administrator signs in at
   https://erp1-8f4cd.web.app, sets up your companies and users, and you
   can begin.

**Your control:** everything our accounts do in your project appears in
your own audit logs (Google Cloud console → Logging). You can remove our
access at any time in IAM, and your data stays in your project.

If it helps, we're happy to join a short call while your IT team completes
the set-up.

Kind regards,
[Your name]
[Firm name] · [Contact details]
