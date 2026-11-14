# Wireframe review kit

Figma-style comments for the SPARC dashboards. Reviewers open the review link, turn on comment
mode, click anything and leave a comment. Others reply and change its status. Everything is saved
to a Google Sheet you own. Reviewers need no login or Google account: they type their name once
and it's remembered on their device.

The kit only exists on the `wireframe-review` branch. The live site (`main`) has none of it.

## Files

| File | What it is |
|---|---|
| `review-kit.js` | The comment overlay. Plain JavaScript, no build step; all UI is inside a Shadow DOM. |
| `sparc-adapter.js` | **The endpoint URL goes here.** Also tells the kit which dashboard and page are showing. |
| `apps-script/Code.gs` | Google Apps Script backend that writes to the sheet. |
| `dev/mock_server.py` | Local stand-in for the Apps Script, for testing without Google (macOS). |

Each dashboard HTML file loads the two scripts (branch only):

```html
<script src="review-kit/sparc-adapter.js" defer></script>
<script src="review-kit/review-kit.js" defer></script>
```

## 1. Set up the Google Sheet and Apps Script

1. Create a new Google Sheet, e.g. **SPARC review comments**.
2. In the sheet, open **Extensions → Apps Script**.
3. Delete the sample code, paste in the whole of `apps-script/Code.gs`, and click **Save**.
4. Open **Project Settings** (gear icon) and set **Time zone** to *(GMT+05:30) India Standard Time*.
   Comment times use this zone.
5. Click **Deploy → New deployment**. Next to *Select type*, click the gear and choose **Web app**.
   - Description: `Review kit`
   - **Execute as: Me**
   - **Who has access: Anyone**
6. Click **Deploy**, then **Authorize access** and pick your Google account.
   Google shows **"Google hasn't verified this app"**. That's expected for your own script:
   click **Advanced → Go to (project name) (unsafe) → Allow**.
7. Copy the **Web app URL** (it ends in `/exec`). Open it in a browser: you should see
   *Review kit endpoint is running.*
8. Paste the URL into `review-kit/sparc-adapter.js`:

   ```js
   window.reviewKitConfig = {
     endpoint: 'https://script.google.com/macros/s/…/exec',
     project: 'sparc',
   };
   ```

   Commit and push that change to the `wireframe-review` branch.

The **Log** and **Review** tabs are created automatically when the first comment is posted.

- **Log**: one row per event (comment, reply, status change, priority change). Never edited.
- **Review**: one row per comment, rebuilt from Log after every change, with the latest status,
  who resolved it, the history, every reply, and an *Open in prototype* link.

Don't edit or sort the Log tab by hand; Review is rebuilt from it.

### Updating the script later

Edit the code, then **Deploy → Manage deployments → ✏️ (edit) → Version: New version → Deploy**.
This keeps the same `/exec` URL. Choosing **New deployment** instead creates a new URL, which you'd
then have to paste into `sparc-adapter.js` again.

## 2. Netlify branch deploy

1. In Netlify open your project, then **Project configuration → Build & deploy → Continuous
   deployment → Branches and deploy contexts → Configure**.
2. Under **Branch deploys**, choose **Let me add individual branches** and add `wireframe-review`.
   Save.
3. Push the branch. Netlify publishes it at
   `https://wireframe-review--<your-project-name>.netlify.app`. Share that link with reviewers.

Your main URL keeps serving `main`, without the kit. Netlify's own preview toolbar is hidden on the
review link so it doesn't cover the comment buttons.

## Reviewer actions

| To… | Do this |
|---|---|
| Turn comment mode on or off | Click 💬 (bottom right) or press **C**. Press **Esc** to leave. |
| Comment on something | In comment mode, click (or right-click, or tap) it. Write, choose a priority, **Post comment**. |
| Set your name | You're asked the first time you post. Change it later in ☰ → **Change name**. |
| Read or reply to a comment | Click its numbered pin. |
| Change status | In the thread, click **Open**, **In progress** or **Resolved** (resolving asks for an optional note). |
| Change priority | Use the **Priority** menu in the thread. |
| See every comment | Click ☰. Filter by page, author, status, priority or text. Click a comment to jump to it. |
| Show resolved comments | ☰ → tick **Show resolved pins**. |
| Hide all pins | Click 👁. |
| Export | ☰ → **Download CSV** (same columns as the Review tab). |
| Share one comment | Copy its *Open in prototype* link from the sheet (`…#review=sparc-12`). |

While comment mode is off, the dashboards behave exactly as normal.

If a comment's element can't be found any more (the layout changed or the filters hide it), the
list shows **Not visible now**, and opening the thread shows a grey pin at its last known position.

## Security notes

- **Names are not verified.** Anyone can type any name, so treat the Author column as self-reported.
- **Anyone with the review link can read and add comments.** The endpoint URL is visible in the page
  source. Don't put confidential information in comments.
- The script runs as you but only reads and writes the sheet it's attached to.
- Every field has a length limit (name 60, comment 2,000, note 500 characters) and only known actions
  and values are accepted. Writes are limited to 120 a minute across all reviewers.
- Every cell is written as plain text, and values starting with `=`, `+`, `-` or `@` are escaped, so
  a comment can never run as a formula, in the sheet or in the CSV.
- All comment text is shown with `textContent`, never as HTML.
- To switch commenting off, go to **Deploy → Manage deployments → Archive**. The review link keeps
  working but comments stop loading and saving.
- Netlify also serves the `review-kit/` folder itself, including `Code.gs`. It contains no secrets.

## Local development

Needs macOS (the mock runs `Code.gs` in the built-in JavaScriptCore engine) and Python 3.

```sh
# terminal 1: fake Apps Script endpoint at http://localhost:8787/exec
python3 review-kit/dev/mock_server.py            # add --reset to start with an empty sheet

# terminal 2: serve the dashboards
python3 -m http.server 8000
```

Open <http://localhost:8000/SPARC_State_Dashboard_New.html>. On `localhost` the kit always uses the
mock server, even after the real URL is in `sparc-adapter.js`, so local testing never touches the real
sheet. See the fake sheet's tabs at <http://localhost:8787/sheet>.

## Page keys

`sparc-adapter.js` names each screen `<dashboard>:<page>`, for example `state:coverage` or
`coach:todo`, and labels it like *State Dashboard › Teacher Coverage*. If you add a page to a
dashboard, add it to the matching `pages` list there so comments on it get the right label.
