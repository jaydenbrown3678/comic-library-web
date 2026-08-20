# Buddha's Comic Library — Web

A web version of the iOS app, built in plain HTML/CSS/JavaScript (no
build step, no framework, no server needed). Mirrors the iOS app's
architecture and bold comic book theme, feature for feature:

- Category browsing with nested subcategory tiles (e.g. Winnie the
  Pooh → Tigger)
- Favorites, Continue Reading (with mark-complete / remove actions),
  and History — all persisted via `localStorage` instead of SwiftData
- Full-screen swipeable reader with an info card and favorite toggle
- Search across title/author/category/subcategory
- Settings with System/Light/Dark appearance modes
- The same launch animation (starburst + book) as the iOS app

## Running it locally

Since browsers block `fetch()` on local files for security reasons,
you need a tiny local server rather than double-clicking `index.html`.

**If you have Python installed** (Mac/Linux come with it):
```bash
cd comic-library-web
python3 -m http.server 8000
```
Then open `http://localhost:8000` in your browser.

**If you have Node.js installed**, `npx serve` works the same way.

## Hosting it for free (so it works from any device, any URL)

**Easiest: GitHub Pages**
1. Create a new GitHub repository, push these files to it
2. Go to the repo's Settings → Pages
3. Under "Source," choose the `main` branch
4. Your site will be live at `https://yourusername.github.io/repo-name`
   within a minute or two

**Alternative: Netlify or Vercel**
Both let you drag-and-drop this whole folder onto their website and
get a live URL instantly — no git required. Free tier is more than
enough for a project like this.

## File structure

```
comic-library-web/
├── index.html          # App shell — nav bar, search, content mount point
├── css/
│   └── styles.css      # Theme (light/dark CSS variables), all component styles
├── js/
│   ├── app.js           # Main logic — data, rendering, routing, all screens
│   ├── storage.js        # localStorage wrapper (mirrors ReadingProgressStore)
│   └── icons.js          # SVG icon definitions + starburst generator
└── data/
    └── comics.json       # Comic manifest — same schema as the iOS app's comics.json
```

## Adding more comics

Edit `data/comics.json` — same fields as the iOS app's manifest
(`category`, `subcategory`, `categoryColor`, `isSubcategoryCover`,
etc.), minus the page-image-specific fields (`pageRanges`,
`coverImageName`) since this version uses text-placeholder covers
instead of real scanned images. If you want real cover art, add an
`coverImageURL` field per comic and swap the `coverArtHTML()`
function in `app.js` to render an `<img>` tag instead of the text
placeholder.

## Known simplifications vs. the iOS app

- **No real comic page images** — the reader shows placeholder
  "Page N" cards instead of actual scanned artwork, since none were
  provided for this web build. Swap in real images by editing
  `openReader()` in `app.js`.
- **No custom app icon file** — the favicon isn't set up; add a
  `<link rel="icon">` tag in `index.html` pointing to a PNG if wanted.
