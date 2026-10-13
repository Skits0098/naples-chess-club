# RSVP backend setup

About ten minutes, once. No server, no hosting bill, no credit card.

Every RSVP lands as a row in a Google Sheet **you own**. That sheet is your
mailing list. Export it to CSV any time and load it into any email tool.

```
RSVP form  ->  Apps Script web app  ->  your Google Sheet
                       |
                       +-> confirmation email to the guest
                       +-> notification email to you
```

---

## 1. Make the sheet

1. Go to <https://sheets.new>. A blank spreadsheet opens.
2. Name it something like **Naples Chess Club RSVPs**.

That is all. The script creates the tab and column headers itself.

## 2. Add the script

1. In that spreadsheet: **Extensions → Apps Script**. An editor opens in a new tab.
2. Delete whatever is in `Code.gs`.
3. Open `backend/Code.gs` from this project, copy all of it, and paste it in.
4. Near the top, set your notification address:

   ```js
   var NOTIFY_EMAIL = '';        // <- put your email here
   var SEND_CONFIRMATION = true; // email the guest a confirmation
   ```

   This is deliberately blank in the repo so your address is not scraped
   from public GitHub. The Apps Script editor is private, so the real
   address only ever lives there. Leave it blank to turn notifications off.

5. Click the **save** icon.

## 3. Check it works before deploying

1. In the function dropdown at the top, pick **testSetup**, then click **Run**.
2. Google will ask for permission the first time. Click **Review permissions**,
   pick your account, then **Advanced → Go to (project name) → Allow**.

   The "Google hasn't verified this app" screen is expected. It is your own
   script, running in your own account, on your own spreadsheet.

3. Check the execution log. You should see the sheet name, the headers, and
   your remaining email quota. Switch to the spreadsheet and you will find a new
   **RSVPs** tab with column headers.

If that worked, the hard part is done.

## 4. Deploy it as a web app

1. Top right: **Deploy → New deployment**.
2. Click the gear next to "Select type" and choose **Web app**.
3. Set:
   - **Description**: anything, for example `RSVP v1`
   - **Execute as**: **Me**
   - **Who has access**: **Anyone**
4. Click **Deploy**, then authorise again if asked.
5. Copy the **Web app URL**. It looks like:

   ```
   https://script.google.com/macros/s/AKfy...long.../exec
   ```

> **"Who has access: Anyone" sounds alarming, but it is correct.** It means
> anyone can *submit the form*, which is the entire point of a public RSVP.
> It does not give anyone access to your spreadsheet. The script runs as you,
> and only ever appends a row.

## 5. Put the URL in the site

Open `assets/js/main.js`. Line 15:

```js
var RSVP_ENDPOINT = '';
```

Paste your URL between the quotes:

```js
var RSVP_ENDPOINT = 'https://script.google.com/macros/s/AKfy.../exec';
```

Save, commit, push.

**Until that line is filled in the RSVP form hides itself** and the page falls
back to "text us instead", so the site never shows a broken form.

## 6. Test it for real

Open the live site, fill in the form with your own email, and submit. Within a
few seconds you should get:

- A new row in the spreadsheet
- A confirmation email at the address you used
- A notification email at `NOTIFY_EMAIL`

---

## Changing the script later

Edits do **not** go live until you redeploy:

**Deploy → Manage deployments → pencil icon → Version: New version → Deploy**

The URL stays the same, so you do not need to touch the site again.

## What you get in the sheet

| Submitted | Event date | Name | Email | Guests | Source | Subscribed |
|---|---|---|---|---|---|---|
| 2026-10-12 14:03 | 2026-10-14 | Jane Doe | jane@example.com | 2 | website | yes |

One row per person per date. If somebody RSVPs twice for the same night the
script updates their existing row instead of adding a duplicate, so your
headcount stays honest.

## Emailing your members later

Sort or filter the sheet by Email, copy the column, and paste it into whatever
you send from. For anything beyond a plain group email, export as CSV and import
into Mailchimp (free up to 500 contacts), Buttondown, or similar.

**Two things to keep you on the right side of CAN-SPAM:**

1. The form already tells people they will get occasional club updates, which is
   the consent you need. Do not import these addresses into unrelated lists.
2. Every bulk email needs a working way to opt out. The confirmation email tells
   people to reply with "unsubscribe". If you move to a real email tool it will
   handle this for you.

## Limits worth knowing

| Thing | Free limit | Realistically |
|---|---|---|
| Form submissions | No meaningful cap | Fine |
| Emails sent per day | 100 from a free Gmail account, 1,500 on Workspace | 100 RSVPs in one day would be a very good week |
| Script runtime | 6 min per execution | Each RSVP takes well under a second |

If you ever outgrow the email quota, set `SEND_CONFIRMATION = false` and the
RSVPs will still be recorded.

## If something goes wrong

**Form says "We could not save that just now"**

- The URL in `main.js` is wrong, or missing `/exec` at the end
- The deployment is not set to **Who has access: Anyone**
- You edited the script but did not redeploy a **new version**

Open the browser console on the live site and check the network request to
`script.google.com` for the actual status.

**No confirmation email arrives**

- Check spam
- Run `testSetup` again and look at the remaining quota in the log
- Confirm `SEND_CONFIRMATION` is `true`

**Execution logs** live under **Executions** in the left sidebar of the Apps
Script editor. Every submission appears there with any error.
