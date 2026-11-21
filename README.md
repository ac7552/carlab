# carlab

See what a car would look like with new paint, a wrap, paint protection film and different wheels, in 3D, in one
web page. Paste a link to a car's listing or add photos of a car: carlab finds the car's outline in the side photo
and builds a 3D body to that shape (its proportions, roofline, glass and wheels), in the listing's color. Then
change it:

- **Paint**: any color, in gloss, metallic, pearl or matte.
- **Wrap**: the whole car, the roof and pillars, the hood, the mirrors, or panels you click on the car; gloss,
  satin, matte, chrome, color shift or carbon fiber; racing stripes on top.
- **Paint protection film**: partial front, full front, a track pack, the full body, or panels you click. Gloss or
  matte (stealth) film, and a "show film" view that tints where it goes.
- **Wheels**: six spoke styles, 17" to 22" rims (the tire stays the same size, so the sidewall gets thinner), the
  finish, caliper color, lowering and wheel spacers.
- **Build**: a rough cost of everything, from a price list you can change, and builds saved with a picture.

The server is Python (standard library only). The page is plain ES modules with three.js, served as they are: no
build step, nothing loaded from anywhere else, and no AI anywhere. The outline comes from the photo's pixels
(color clustering, a flood fill of the background, the silhouette's shape, the tires' rings), with handles over the
photo to fix it by hand.

carlab draws the body's shape and outline, not a maker's design: no badges, logos or real models' details. The
built-in car with no photo is an original sport sedan.

## Run it

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install -e ".[test]"
python -m carlab            # http://127.0.0.1:8100/  (--host, --port to change)
```

The three sample listings under "No link handy? Try one of ours" work with no network: the server reads its own
sample pages from disk. Reading another site's listing needs the network, and only reaches public addresses.
Saved builds go in `data/carlab.sqlite3` (`CARLAB_DATA` to put them elsewhere); nothing else is kept, and the
server's log has a request's method, path and status, never a pasted link.

`App` in `carlab/server.py` is a plain WSGI application, if you'd rather mount it under another server.

## Getting a good shape

- **The side photo** gives the shape: the whole car, straight from the side, wheels on the ground. A plain
  background helps; a busy one, a car cut off at the edge or a car the same color as the wall needs the handles.
- **A front photo** gives the width. Photos at an angle are kept for looking at.
- **The length** sets the size, because a photo has no scale. carlab works it out from the tires (they come in a
  narrow range of sizes) and keeps it near the body style's usual length. Type the real one if you know it.
- **Swap front and back** if it guessed the wrong end; **Find again** starts the outline over.

## Tests

```sh
pytest tests/python                       # the server: the API, saved builds, reading listings, the fetcher
node --test tests/javascript/*.test.mjs   # the page's modules: the body, the wheels, finding the outline (npm test)
pytest tests/browser                      # the page in Chrome: every change, listings, photos, saving (needs Playwright)
```

The browser tests need `pip install playwright` and Google Chrome (or `playwright install chromium`). They run
offline: a request that would leave this computer fails the test.

## How it fits together

| Where | What |
|---|---|
| `carlab/server.py` | The WSGI app: the page, its files, the JSON API |
| `carlab/listing.py` | A listing page read for its car: year, make, model, trim, body style, color, photos (JSON-LD, Open Graph, the title) |
| `carlab/fetcher.py` | Fetches one page or photo: public addresses only, every redirect checked, sizes capped |
| `carlab/builds.py` | Saved builds, in SQLite |
| `carlab/data/catalog.json` | The price list for the estimate (made up; put your own shop's prices here) |
| `carlab/static/js/lib/profile.js` | A car's shape as numbers: size, wheels, the side outline and where the glass starts and ends |
| `carlab/static/js/lib/car.js` | The 3D body built from a shape: lofted slices cut into panels (hood, doors, rockers, roof…), glass, lights, grille, mirrors |
| `carlab/static/js/lib/wheels.js` | Wheels and tires: spoke styles, rim sizes, calipers |
| `carlab/static/js/lib/materials.js` | Paint, wraps, stripes, film, wheel finishes |
| `carlab/static/js/lib/outline.js` | Finding the car in a photo and turning its outline into a shape |
| `carlab/static/js/lib/outline_editor.js` | The outline over the photo, with handles |
| `carlab/static/js/lib/stage.js` | The 3D view: studio light, floor, camera, views, clicking panels, pictures |
| `carlab/static/js/lib/build.js` | A build (the car and everything on it), checked, and its cost |
| `carlab/static/js/app.js` | The page |
| `carlab/static/samples/` | The sample listings and their photos |
| `scripts/make_samples.py` | Makes the sample listings' photos (renders of `scripts/sample_cars.json`) |

### The API

| | |
|---|---|
| `GET /api/v1/catalog` | The price list |
| `GET /api/v1/samples` | The sample listings |
| `GET`, `POST /api/v1/builds` | Saved builds (names and pictures), or save one: `{ name, build, thumbnail }` |
| `GET`, `PUT`, `DELETE /api/v1/builds/:id` | One saved build |
| `POST /api/v1/listings` | A listing's car from `{ url }` |
| `GET /api/v1/listings/photo?url=` | A listing's photo passed through, so the page can read its pixels |

Changes are only taken from carlab's own page (a request from another site is refused).

### Settings

| Variable | |
|---|---|
| `CARLAB_DATA` | Where saved builds are kept (default `./data`) |
| `CARLAB_ALLOW_PRIVATE_HOSTS=1` | Let a pasted link reach this machine or a private network (for a listing site running locally) |

## Credits and licences

The code is MIT (see `LICENSE`). What it ships with:

- three.js r170 and its OrbitControls and RoomEnvironment addons (MIT): `carlab/static/js/vendor/`, with its licence.
- Inter Tight, under the SIL Open Font License (`carlab/static/fonts/`).
- The sample listings are made up: the makes (Halvard, Ostra, Vallon), models, dealer, prices and colors are
  invented, and their photos are carlab's own renders of shapes made for it (`scripts/sample_cars.json`), not
  photos of real cars.
