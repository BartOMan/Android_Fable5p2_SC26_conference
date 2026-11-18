# SC26 Atlas

An Android companion app for SC26, the International Conference for High
Performance Computing, Networking, Storage, and Analysis (Chicago, 15–20
November 2026). It bundles the whole public technical program and works
without a connection.

## Download

**[Download SC26-Atlas-v1.0.0.apk](https://github.com/BartOMan/Android_Fable5p2_SC26_conference/raw/main/SC26-Atlas-v1.0.0.apk)** (3.3 MB)

The same file, `SC26-Atlas-v1.0.0.apk`, is in the file list at the top of this
repository. One APK runs on any Android phone or tablet with Android 8.0 or
newer; it is not specific to a phone model.

To install it:

1. Open this page in the phone's browser, signed in to GitHub (the repository
   is private), and tap the download link above.
2. Open the downloaded file. Android asks once to allow installs from the
   browser; allow it and tap Install.

## What it does

| Area | What you get |
|---|---|
| Today | Live clock in conference time, what is running now, what starts soon, the next item in your plan with the room and a walking estimate |
| Schedule | Each day as a list grouped by start time, or as a room-by-time grid. Filter by format, research theme, official tag, "live now" or "my plan" |
| Search | Titles, abstracts, speakers, organizations, rooms and topics, ranked, offline |
| Details | Abstract, authors with roles, room with map link, parallel sessions, related work by text similarity, notes, reminders, calendar export |
| Schedule builder | Pick themes, tags, keywords, days and formats. The app scores every session and talk and lays out the best conflict-free route through each day, with alternatives to swap in |
| My Plan | Starred items as a day agenda with overlap warnings, gaps and walking hints; share as text or export to a calendar file |
| Topic galaxy | Every talk and poster as a dot on a zoomable map where similar work sits together |
| Themes and charts | 36 research themes, topics by day, formats, the hour-by-hour pulse of the week, buzzwords |
| People | Most active contributors, SC veterans (earlier SC papers per author), people matched to your interests with where to find them next, profiles with conversation starters |
| World and organizations | A globe of contributor countries, organization leaderboard by sector, the co-author network |
| Venue map | Floor plans of McCormick Place with every session room, what is on in each room, and walking estimates between rooms |
| Posters | Gallery of research, student and art posters with filters |

## Repository layout

| Path | Contents |
|---|---|
| `scraper/` | Python scripts that download the public program and build the app's data |
| `data/program.json` | The normalized program (output of `scraper/parse.py`) |
| `app/web/www/` | The app itself: plain HTML, CSS and JavaScript modules, plus the bundled data |
| `app/web/tests/` | Browser tests (Playwright) |
| `app/web/DEV_NOTES.md` | Architecture, data model and conventions of the web app |
| `app/android/` | The Android shell (a WebView with a small native bridge) and its build files |
| `SC26-Atlas-v1.0.0.apk` | The built, signed app |

## Rebuild the data

```bash
# Python environment with the libraries the scripts need
python3 -m venv /tmp/sc26build/venv
/tmp/sc26build/venv/bin/pip install beautifulsoup4 lxml pillow numpy scikit-learn

# 1. download the public program into data/raw (cached, resumable, one request at a time)
/tmp/sc26build/venv/bin/python -I scraper/fetch.py --raw data/raw
# 2. earlier SC papers per author from OpenAlex (about 14 requests)
/tmp/sc26build/venv/bin/python -I scraper/fetch_openalex.py --out data/raw/openalex
# 3. HTML pages -> data/program.json
/tmp/sc26build/venv/bin/python -I scraper/parse.py --raw data/raw --out data/program.json
# 4. analysis -> app/web/www/data, img and map
/tmp/sc26build/venv/bin/python -I scraper/analyze.py --program data/program.json --raw data/raw --web app/web/www
```

## Build the APK

See `app/android/README.md` for the Android toolchain and emulator commands.

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
cd app/android && ./gradlew assembleRelease
```

## Where the numbers come from

- Sessions, talks, abstracts, contributors, photos and floor plans come from the
  public SC26 schedule at <https://sc26.conference-program.com/>.
- "Earlier SC papers" per author come from [OpenAlex](https://openalex.org)
  (papers indexed under the SC conference, 2010–2025) and are matched by name.
  They are estimates; namesakes can inflate a count.
- Research themes are assigned by keyword rules in `scraper/themes.py`.
  "Related work" and the galaxy layout use TF-IDF text similarity.
- Organization sector, activity ranking and walking times are computed by the
  app and are estimates.
- The app shows the program as captured on the date in Settings. Room or time
  changes made after that date are not reflected.

SC26 Atlas is an independent companion and not an official SC26 product.
