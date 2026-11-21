"""Makes the sample listings in carlab/static/samples: a page for each made-up car in sample_cars.json, with photos of it.

The photos are carlab's own renders of those cars (side, front, and front three-quarter) in a light studio, so the
samples work offline and carry no one else's pictures. Run it again after changing a car or the renderer:

    python scripts/make_samples.py

It needs Playwright and Google Chrome (pip install playwright).
"""

from __future__ import annotations

import base64
import html
import json
import sys
import tempfile
import threading
from pathlib import Path
from wsgiref.simple_server import WSGIRequestHandler, make_server

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from carlab.builds import Store  # noqa: E402
from carlab.server import App  # noqa: E402

OUT = ROOT / "carlab" / "static" / "samples"
CARS = json.loads((Path(__file__).parent / "sample_cars.json").read_text())["cars"]

# Each photo: the camera's place (meters from the car's middle), how much it sees, and the picture's size.
SHOTS = {
    "side": {"position": [0, 0.8, 26], "fov": 5.6, "size": [1600, 680]},
    "front": {"position": [24, 1.0, 0], "fov": 5.2, "size": [1000, 760]},
    "three-quarter": {"position": [9.4, 2.0, 7.6], "fov": 15, "size": [1400, 900]},
}

STUDIO = """async ({ build, shots }) => {
  const { stage } = window.carlab
  window.carlab.set(build)
  stage.scene.background.set("#e8e9eb")
  const floor = stage.scene.getObjectByName("floor")
  floor.material.color.set("#d9dadd")
  floor.scale.setScalar(4)
  stage.controls.maxDistance = 60
  stage.controls.enableDamping = false
  const out = {}
  for (const [name, shot] of Object.entries(shots)) {
    const [w, h] = shot.size
    stage.renderer.setPixelRatio(1)
    stage.renderer.setSize(w, h, false)
    stage.camera.fov = shot.fov
    stage.camera.aspect = w / h
    stage.camera.far = 200
    stage.camera.updateProjectionMatrix()
    stage.camera.position.set(...shot.position)
    stage.controls.target.set(0, 0.68, 0)
    stage.controls.update()
    stage.renderer.render(stage.scene, stage.camera)
    out[name] = stage.canvas.toDataURL("image/jpeg", 0.86)
  }
  return out
}"""


class Quiet(WSGIRequestHandler):
    def log_message(self, *args):
        pass


def serve():
    store = Store(Path(tempfile.mkdtemp()) / "samples.sqlite3")
    httpd = make_server("127.0.0.1", 0, App(store), handler_class=Quiet)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def build_of(car):
    return {
        "name": f"{car['make']} {car['model']}",
        "car": {"year": car["year"], "make": car["make"], "model": car["model"], "trim": car["trim"], "spec": car["spec"]},
        "paint": {"color": car["color"]["hex"], "finish": car["color"]["finish"]},
        "wheels": car["wheels"],
    }


def page_of(car, photos):
    title = f"{car['year']} {car['make']} {car['model']} {car['trim']}"
    data = {
        "@context": "https://schema.org",
        "@type": "Car",
        "name": title,
        "brand": {"@type": "Brand", "name": car["make"]},
        "model": car["model"],
        "vehicleModelDate": car["year"],
        "vehicleConfiguration": car["trim"],
        "bodyType": car["body"],
        "color": car["color"]["name"],
        "mileageFromOdometer": {"@type": "QuantitativeValue", "value": car["miles"], "unitCode": "SMI"},
        "image": photos,
        "offers": {"@type": "Offer", "price": car["price"], "priceCurrency": "USD"},
    }
    e = html.escape
    figures = "\n".join(f'      <img src="{e(p)}" alt="{e(title)}, photo {i + 1}">' for i, p in enumerate(photos))
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{e(title)} · Northline Motors (sample)</title>
  <meta property="og:title" content="{e(title)}">
  <meta property="og:description" content="{e(car['color']['name'])} {e(car['body'].lower())}, {car['miles']:,} miles.">
  <meta property="og:image" content="{e(photos[0])}">
  <link rel="stylesheet" href="listing.css">
  <script type="application/ld+json">
{json.dumps(data, indent=2)}
  </script>
</head>
<body>
  <p class="banner">A made-up listing that comes with carlab, for trying it out. The car, the dealer and the price aren't real.</p>
  <main>
    <h1>{e(title)}</h1>
    <p class="price">${car['price']:,} · {car['miles']:,} miles · {e(car['city'])}</p>
    <div class="photos">
{figures}
    </div>
    <dl>
      <dt>Exterior</dt><dd>{e(car['color']['name'])}</dd>
      <dt>Body</dt><dd>{e(car['body'])}</dd>
      <dt>Trim</dt><dd>{e(car['trim'])}</dd>
    </dl>
  </main>
</body>
</html>
"""


def main():
    from playwright.sync_api import sync_playwright

    OUT.mkdir(parents=True, exist_ok=True)
    httpd = serve()
    base = f"http://127.0.0.1:{httpd.server_port}/"
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="chrome", args=["--no-sandbox"])
            page = browser.new_page(viewport={"width": 1200, "height": 800})
            page.goto(base)
            page.wait_for_selector("body[data-ready=true]", timeout=60_000)
            for car in CARS:
                pictures = page.evaluate(STUDIO, {"build": build_of(car), "shots": SHOTS})
                photos = []
                for name, url in pictures.items():
                    path = OUT / f"{car['slug']}-{name}.jpg"
                    path.write_bytes(base64.b64decode(url.split(",", 1)[1]))
                    photos.append(path.name)
                (OUT / f"{car['slug']}.html").write_text(page_of(car, photos))
                print(f"{car['slug']}: {', '.join(photos)}")
            browser.close()
    finally:
        httpd.shutdown()


if __name__ == "__main__":
    main()
