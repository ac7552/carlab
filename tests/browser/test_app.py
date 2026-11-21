"""The page in a real browser (Chrome, through Playwright): the car, every kind of change, a car from a listing and
from a photo, saving and reopening a build. Offline: any request that would leave this computer fails the test.

    pip install playwright pytest && python -m pytest tests/browser
"""

from __future__ import annotations

import re
import threading
from pathlib import Path
from wsgiref.simple_server import WSGIRequestHandler, make_server

import pytest

playwright = pytest.importorskip("playwright.sync_api")
from playwright.sync_api import expect, sync_playwright  # noqa: E402

from carlab.builds import Store  # noqa: E402
from carlab.fetcher import Error as FetchError  # noqa: E402
from carlab.server import App  # noqa: E402

SAMPLES = Path(__file__).resolve().parents[2] / "carlab" / "static" / "samples"


class _Quiet(WSGIRequestHandler):
    def log_message(self, *args):
        pass


def _offline(url):
    raise FetchError("Couldn't find that website. Is this computer online?")


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    app = App(Store(tmp_path_factory.mktemp("data") / "carlab.sqlite3"), fetch_page=_offline, fetch_image=_offline)
    httpd = make_server("127.0.0.1", 0, app, handler_class=_Quiet)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_port}"
    httpd.shutdown()


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as p:
        try:
            b = p.chromium.launch(channel="chrome", args=["--no-sandbox"])
        except Exception:  # noqa: BLE001 - no Chrome here: use Playwright's own Chromium
            b = p.chromium.launch(args=["--no-sandbox"])
        yield b
        b.close()


@pytest.fixture
def page(browser, server):
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()
    problems, outside = [], []
    page.on("console", lambda m: problems.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: problems.append(str(e)))

    def only_here(route):
        if route.request.url.startswith(server):
            route.continue_()
        else:
            outside.append(route.request.url)
            route.abort()

    page.route("**/*", only_here)
    page.problems = problems  # a test that expects an error takes it off this list
    page.goto(server)
    expect(page.locator("body")).to_have_attribute("data-ready", "true", timeout=30_000)
    yield page
    context.close()
    assert outside == [], f"the page tried to reach {outside}"
    assert problems == [], f"errors in the page: {problems}"


def build(page):
    return page.evaluate("() => window.carlab.build")


def tab(page, name):
    page.click(f".tabs button[data-tab={name}]")


def chip(page, group, label):
    page.locator(f"#{group} button", has_text=re.compile(rf"^{re.escape(label)}")).first.click()


def view(page, label):
    page.locator("#views button", has_text=re.compile(rf"^{re.escape(label)}$")).click()
    page.wait_for_timeout(250)


def test_the_built_in_car_is_drawn(page):
    meshes = page.evaluate("() => window.carlab.stage.body.meshes.length")
    assert meshes >= 4
    assert page.text_content("#car-title") == "Sport sedan"
    # The view isn't blank: the car's pixels differ from the backdrop's.
    colors = page.evaluate("""() => {
      const url = window.carlab.stage.picture({ width: 200 })
      return new Promise((done) => {
        const img = new Image()
        img.onload = () => {
          const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
          const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0)
          const d = ctx.getImageData(0, 0, c.width, c.height).data
          const seen = new Set()
          for (let i = 0; i < d.length; i += 16) seen.add((d[i] >> 4) * 256 + (d[i + 1] >> 4) * 16 + (d[i + 2] >> 4))
          done(seen.size)
        }
        img.src = url
      })
    }""")
    assert colors > 40


def test_paint_wrap_stripes_film_and_wheels(page):
    tab(page, "paint")
    page.click("#paint-swatches button[title=Red]")
    chip(page, "paint-finish", "Pearl")
    assert build(page)["paint"] == {"color": "#a3121c", "finish": "pearl"}

    tab(page, "wrap")
    chip(page, "wrap-zone", "Roof and pillars")
    chip(page, "wrap-finish", "Carbon fiber")
    page.check("#stripes-on")
    b = build(page)
    assert (b["wrap"]["zone"], b["wrap"]["finish"], b["stripes"]["on"]) == ("roof", "carbon", True)

    tab(page, "film")
    page.locator("#ppf-coverage button", has_text=re.compile("^Full front")).click()
    chip(page, "ppf-finish", "Matte")
    page.check("#show-film-2")
    assert build(page)["ppf"]["coverage"] == "front" and build(page)["ppf"]["finish"] == "matte"
    assert page.is_checked("#show-film"), "both film switches agree"

    tab(page, "wheels")
    chip(page, "wheel-style", "Deep dish")
    chip(page, "wheel-size", '21"')
    chip(page, "wheel-finish", "Bronze")
    page.click("#caliper-swatches button[title=Yellow]")
    page.fill("#lowering", "30")
    page.fill("#spacer", "15")
    w = build(page)["wheels"]
    assert (w["style"], w["inches"], w["finish"], w["caliper"], w["lowering"], w["spacer"]) == ("dish", 21, "bronze", "#e3b505", 30, 15)
    assert page.text_content("#lowering-out") == "30 mm"
    assert "mm of tire sidewall" in page.text_content("#sidewall")
    assert page.evaluate("() => window.carlab.stage.body.group.position.y") == pytest.approx(-0.03)

    tab(page, "build")
    rows = page.locator("#sheet tr")
    assert rows.count() >= 5
    assert page.locator("#sheet tr.total").count() == 1


def test_picking_panels_on_the_car(page):
    view(page, "Front")  # straight at the nose: the middle of the view is the front bumper and grille
    tab(page, "film")
    page.locator("#ppf-coverage button", has_text=re.compile("^Panels I pick")).click()
    expect(page.locator("#pick-hint")).to_be_visible()
    box = page.locator("#view").bounding_box()
    # Click the hood, a little above the middle of the car's front.
    target = page.evaluate("""() => {
      const s = window.carlab.stage
      for (let y = 0.3; y < 0.7; y += 0.01) {
        const r = s.canvas.getBoundingClientRect()
        const panel = s.panelAt(r.left + r.width / 2 + 40, r.top + r.height * y)
        if (panel === 'hood' || panel === 'hoodFront') return y
      }
      return null
    }""")
    assert target is not None, "found the hood in the view"
    page.mouse.click(box["x"] + box["width"] / 2 + 40, box["y"] + box["height"] * target)
    ppf = build(page)["ppf"]
    assert ppf["coverage"] == "custom" and set(ppf["panels"]) & {"hood", "hoodFront"}
    # Glass can't take film: clicking the windshield says so and changes nothing.
    glass = page.evaluate("""() => {
      const s = window.carlab.stage, r = s.canvas.getBoundingClientRect()
      for (let y = 0.15; y < 0.6; y += 0.01) if (s.panelAt(r.left + r.width / 2 + 40, r.top + r.height * y) === 'windshield') return y
      return null
    }""")
    if glass is not None:
        before = build(page)["ppf"]["panels"]
        page.mouse.click(box["x"] + box["width"] / 2 + 40, box["y"] + box["height"] * glass)
        assert build(page)["ppf"]["panels"] == before
        expect(page.locator("#pick-hint")).to_contain_text("can't take film")
    page.click("#pick-hint")
    expect(page.locator("#pick-hint")).to_be_hidden()


def test_a_car_from_a_sample_listing(page):
    tab(page, "car")
    page.locator("#samples button", has_text="Ostra Kestrel").click()
    expect(page.locator("#car-status")).to_have_text(re.compile("^Built from the outline"), timeout=30_000)
    b = build(page)
    assert (b["car"]["year"], b["car"]["make"], b["car"]["model"]) == ("2023", "Ostra", "Kestrel")
    assert b["paint"]["color"] == "#24503a" and b["paint"]["finish"] == "pearl"
    assert b["car"]["source"]["kind"] == "sample"
    spec = b["car"]["spec"]
    # Its shape is the wagon's, from the photo: long roof, the rear glass near the tail, about the right size.
    assert 4.4 < spec["length"] < 5.2 and 2.6 < spec["wheelbase"] < 3.1
    assert spec["roofRearX"] < -1.8 and spec["deckX"] < -2.0
    expect(page.locator("#photos button")).to_have_count(3)
    assert page.locator("#photos .tag", has_text="front").count() == 1
    assert page.text_content("#car-title") == "2023 Ostra Kestrel Touring"

    # Moving the length rebuilds the car at that size.
    page.fill("#trace-length", "5.00")
    page.dispatch_event("#trace-length", "change")
    assert build(page)["car"]["spec"]["length"] == pytest.approx(5.0)


def test_a_car_from_a_photo(page):
    tab(page, "car")
    page.set_input_files("#photo-input", str(SAMPLES / "halvard-strand-gt-side.jpg"))
    expect(page.locator("#car-status")).to_have_text(re.compile("^Built from the outline"), timeout=30_000)
    spec = build(page)["car"]["spec"]
    assert spec["top"] != page.evaluate("() => window.carlab.shapeOf({}).spec.top")
    assert max(y for _, y in spec["top"]) < 1.5, "a low coupe stays low"
    assert build(page)["paint"]["color"] != "#1f3f73", "the color comes from the photo"
    page.click("#default-car")
    assert build(page)["car"]["spec"] is None


def test_a_listing_link_that_cant_be_read_says_why(page):
    tab(page, "car")
    page.fill("#listing-url", "https://dealer.example/cars/1")
    page.click("#listing-read")
    expect(page.locator("#car-status")).to_have_text("Couldn't find that website. Is this computer online?")
    expect(page.locator("#car-status")).to_have_class(re.compile("error"))
    # The browser logs the refused request itself; that one is expected.
    page.problems[:] = [p for p in page.problems if "status of 422" not in p]


def test_saving_and_reopening_a_build(page, server):
    tab(page, "paint")
    page.click("#paint-swatches button[title=Green]")
    tab(page, "wheels")
    chip(page, "wheel-size", '20"')
    tab(page, "build")
    page.fill("#build-name", "Green on 20s")
    page.click("#save-build")
    expect(page.locator("#save-status")).to_have_text("Saved “Green on 20s”.")
    expect(page.locator("#build-state")).to_have_text("Green on 20s · saved")
    expect(page.locator("#saved li", has_text="Green on 20s")).to_have_count(1)
    assert page.locator("#saved li img").first.get_attribute("src").startswith("data:image/jpeg")

    # A change shows as unsaved; reopening the saved build brings it back.
    tab(page, "paint")
    page.click("#paint-swatches button[title=Orange]")
    expect(page.locator("#build-state")).to_have_text("Green on 20s · changed")
    tab(page, "build")
    page.locator("#saved li", has_text="Green on 20s").get_by_role("button", name="Open").click()
    expect(page.locator("#save-status")).to_have_text("Opened “Green on 20s”.")
    assert build(page)["paint"]["color"] == "#24503a" and build(page)["wheels"]["inches"] == 20

    # The tab keeps the build across a reload.
    page.reload()
    expect(page.locator("body")).to_have_attribute("data-ready", "true", timeout=30_000)
    assert build(page)["wheels"]["inches"] == 20

    # Deleting asks once more.
    tab(page, "build")
    item = page.locator("#saved li", has_text="Green on 20s")
    item.get_by_role("button", name="Delete").click()
    expect(item.get_by_role("button", name="Sure?")).to_be_visible()
    item.get_by_role("button", name="Sure?").click()
    expect(page.locator("#saved li", has_text="Green on 20s")).to_have_count(0)
