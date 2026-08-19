# Setting this up (one time, ~15 minutes)

After this, the site updates itself. You edit the spreadsheet; the map follows.

**Step 1 is the same for everyone. Then follow either the GitHub or the GitLab section —
whichever your Cloudflare Pages project is connected to.** You can check which by opening
your Pages project in Cloudflare and looking at **Settings → Builds & deployments**; it
names the connected repo.

Both config files are included. Each platform ignores the other's, so leaving both in
place is harmless.

---

## Step 1 — Publish the sheet as CSV

1. Open your spreadsheet.
2. **File → Share → Publish to web**.
3. In the dialog: pick the **sheet tab** on the left, and **Comma-separated values (.csv)**
   on the right.
4. Click **Publish**, confirm, and **copy the URL** it gives you.

It looks something like:

    https://docs.google.com/spreadsheets/d/e/2PACX-1vXXXXXXXX/pub?gid=0&single=true&output=csv

Keep that URL handy for step 3.

> This makes the sheet's contents readable to anyone with that link. The places, notes and
> prices are going on a public website anyway, so nothing new is exposed — but don't put
> anything private in this sheet from here on.

---

## ── GitHub route ──

## Step 2 — Put these files in your GitHub repo

You need the repo that Cloudflare Pages is connected to.

1. On GitHub, open the repo → **Add file → Upload files**.
2. Drag in **everything from this folder at once** — including the `.github` and `build`
   folders. GitHub keeps the folder structure when you drag folders in.
3. Scroll down, click **Commit changes**.

The layout should end up as:

    index.html                          <- the site itself
    build/build.mjs                     <- the rebuild script
    build/template.html                 <- the design, with __DATA__ where places go
    build/coords.json                   <- remembers where each place is
    build/config.json                   <- the one file you edit
    .github/workflows/update-map.yml    <- the weekly schedule

> If you don't see the `.github` folder after uploading, your file browser hid it because
> the name starts with a dot. On macOS press **Cmd+Shift+.** in Finder to show hidden
> files, then drag it in separately.

---

## Step 3 — Paste in your CSV URL

1. In the repo, open **`build/config.json`**.
2. Click the **pencil icon** to edit.
3. Replace `PASTE_YOUR_PUBLISHED_CSV_URL_HERE` with the URL from step 1. Keep the quotes.
4. **Commit changes**.

---

## Step 4 — Let the Action write to the repo

1. Repo → **Settings** → **Actions** → **General**.
2. Scroll to **Workflow permissions**.
3. Select **Read and write permissions** → **Save**.

Without this the rebuild runs but can't commit its result.

---

## Step 5 — Run it once by hand

1. Repo → **Actions** tab.
2. Click **Update map from spreadsheet** in the left sidebar.
3. **Run workflow** → **Run workflow**.

Give it a minute, then click into the run to watch the log. You should see something like:

    Built index.html with 143 places.
      cache: 143 -> 143
    No changes — the sheet matches what's already published.

That "no changes" line is the correct result on the first run, because the `index.html`
you uploaded already matches the sheet.

To prove the whole loop works: add a junk row to your sheet, run the workflow again, and
watch it commit. Cloudflare will deploy within a minute or two. Then delete the junk row
and run it once more.

---

## ── GitLab route ──

Skip this whole section if you're on GitHub. Step 1 (publishing the CSV) still applies.

### G2 — Put these files in your GitLab repo

Repo → **the `+` button above the file list** → **Upload file**. GitLab's uploader takes
one file at a time, so it's easiest to clone the repo, copy the files in, and push. If
you'd rather stay in the browser, upload them one by one, recreating the paths:

    index.html
    .gitlab-ci.yml
    build/build.mjs
    build/template.html
    build/coords.json
    build/config.json
    build/unpinned.txt

(You can ignore `.github/` on GitLab.)

### G3 — Paste in your CSV URL

Open **`build/config.json`** → **Edit** → replace `PASTE_YOUR_PUBLISHED_CSV_URL_HERE`
with the URL from step 1, keeping the quotes → **Commit changes**.

### G4 — Give the job permission to push

GitLab's built-in job token can't write to the repo, so you need to make one token. You
create it in GitLab and paste it into GitLab — it never goes anywhere else.

1. Repo → **Settings → Access tokens** → **Add new token**.
   - Name: `map-bot`
   - Role: **Maintainer**
   - Scopes: tick **`write_repository`**
   - Create it and **copy the token** — GitLab shows it only once.

   *If your plan doesn't offer project access tokens*, use a personal one instead:
   your avatar → **Edit profile → Access tokens** → same `write_repository` scope.

2. Repo → **Settings → CI/CD → Variables** → **Add variable**.
   - Key: `GIT_PUSH_TOKEN`
   - Value: the token you just copied
   - Tick **Masked**, and leave **Protected** unticked
   - **Add variable**

### G5 — Create the weekly schedule

GitLab sets schedules in the UI rather than in the file.

1. Repo → **Build → Pipeline schedules** → **New schedule**.
2. Description: `Weekly map rebuild`
3. Interval pattern: **Custom** → `0 15 * * 1`
4. Cron timezone: **UTC** (that's 8am Pacific)
5. Target branch: your default branch
6. **Create pipeline schedule**

### G6 — Run it once by hand

On the Pipeline schedules page, click the **▶ play button** next to your new schedule.
Then **Build → Pipelines** to watch it. You're looking for:

    Built index.html with 143 places.
    No changes — the sheet matches what's already published.

That "no changes" result is correct on the first run, because the `index.html` you
uploaded already matches the sheet. To prove the loop end to end, add a junk row to the
sheet, run it again, watch it commit, then delete the row and run once more.

> The job is deliberately set to run **only** on a schedule or a manual "Run pipeline" —
> never on push. That's what stops its own commit from kicking off another pipeline.

---

## That's it

From now on:

- **Every Monday at 8am Pacific** the job reads your sheet, rebuilds, and commits.
  Cloudflare deploys automatically.
- **Want it immediately?** GitHub: Actions tab → Run workflow.
  GitLab: Pipeline schedules → play button.
- **Nothing changed?** It commits nothing, so no pointless deploys.

---

## What happens when you add a place

The script looks up new places in Mapbox automatically and checks the result is actually
near the neighborhood you wrote, because business-name geocoding gets branches wrong
constantly. If it can't find a place confidently, it **leaves it off the map rather than
pinning it somewhere wrong**, and writes the name into `build/unpinned.txt`.

If something lands there, you have two options:

- Check how the business is actually listed and match that spelling in your sheet
  (this fixes most cases), or
- Add it by hand to `build/coords.json`:

      "Place Name": [-122.34567, 47.65432, "1234 Some St, Seattle"]

  Longitude first, then latitude. Once it's in that file it's never looked up again.

**Deleting a row** from the sheet removes it from the map on the next run.
**Editing a note, price, type or neighborhood** takes effect with no lookup at all.

---

## Things worth knowing

**Categories.** New places are sorted into the filter pills by their `type` column. The
script knows the types already in your sheet plus common variants, and falls back to
**Eat** for anything unrecognised, since the sheet is mostly food. If something lands in
the wrong bucket, tell me the type and I'll add it to the mapping.

**Renaming a place** in the sheet reads as "old one deleted, new one added" — so it gets
looked up again. Harmless, just slower.

**Changing the design** means editing `build/template.html`, not `index.html` — `index.html`
is regenerated every run and any hand edits to it will be overwritten. Easier: ask me and
I'll send you a new template.

**Lock your Mapbox token** once the site is live: account.mapbox.com → Tokens → your token
→ URL restrictions → add `https://documentarychat.org/*` and `https://*.pages.dev/*`.
The Action's own lookups are unaffected by URL restrictions.

**If a run fails**, GitHub or GitLab emails you. Open the run to see the log — the script
says plainly what went wrong. It refuses to write anything if the sheet returns fewer than
20 places, so a broken or unpublished sheet can never wipe the map.
