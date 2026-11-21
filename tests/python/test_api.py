"""The server: the page and its files, the JSON API, and what it refuses."""

from pathlib import Path

SAMPLES = Path(__file__).resolve().parents[2] / "carlab" / "static" / "samples"


def test_the_page_loads_with_a_strict_content_policy(client):
    r = client.get("/")
    assert r.status == 200 and r.headers["Content-Type"].startswith("text/html")
    assert b'<canvas id="view"' in r.body
    policy = r.headers["Content-Security-Policy"]
    assert "default-src 'self'" in policy and "script-src 'self'" in policy
    assert r.headers["X-Content-Type-Options"] == "nosniff"


def test_static_files_but_nothing_outside_them(client):
    assert client.get("/static/js/app.js").headers["Content-Type"] == "text/javascript"
    assert client.get("/static/js/vendor/three.module.js").headers["Cache-Control"].startswith("public")
    for path in ["/static/../server.py", "/static/%2e%2e/server.py", "/static/../../pyproject.toml", "/static/nope.js", "/elsewhere"]:
        assert client.get(path).status == 404, path


def test_the_price_list_and_samples(client):
    catalog = client.get("/api/v1/catalog").json()
    assert catalog["currency"] and catalog["paint"] and catalog["wheels"]
    samples = client.get("/api/v1/samples").json()["samples"]
    assert {s["url"] for s in samples} == {f"/static/samples/{p.name}" for p in SAMPLES.glob("*.html")}
    assert all(s["name"] for s in samples)


def test_saving_opening_changing_and_deleting_a_build(client):
    made = client.post("/api/v1/builds", {"name": "Daily", "build": {"paint": {"color": "#24503a"}}})
    assert made.status == 201
    build_id = made.json()["id"]
    assert [b["name"] for b in client.get("/api/v1/builds").json()["builds"]] == ["Daily"]
    assert client.get(f"/api/v1/builds/{build_id}").json()["build"]["paint"]["color"] == "#24503a"
    changed = client.call("PUT", f"/api/v1/builds/{build_id}", {"name": "Daily 2", "build": {}})
    assert changed.status == 200 and changed.json()["name"] == "Daily 2"
    assert client.call("DELETE", f"/api/v1/builds/{build_id}").status == 204
    assert client.get(f"/api/v1/builds/{build_id}").status == 404
    assert client.call("DELETE", f"/api/v1/builds/{build_id}").status == 404


def test_bad_builds_are_refused_with_why(client):
    r = client.post("/api/v1/builds", {"name": "x"})
    assert r.status == 422 and "no build" in r.json()["error"]
    r = client.post("/api/v1/builds", raw=b"{nope")
    assert r.status == 400 and "JSON" in r.json()["error"]
    r = client.post("/api/v1/builds", raw=b"[1, 2]")
    assert r.status == 400


def test_changes_from_another_site_are_refused(client):
    r = client.post("/api/v1/builds", {"build": {}}, origin="https://evil.example")
    assert r.status == 403
    assert client.call("DELETE", "/api/v1/builds/1", origin="null").status == 403
    assert client.get("/api/v1/builds").json()["builds"] == []
    # A request with no Origin at all (curl, a script on this computer) is fine.
    assert client.post("/api/v1/builds", {"build": {}}, origin=None).status == 201


def test_a_sample_listing_is_read_from_disk_not_fetched(client, fetched):
    for url in ["/static/samples/ostra-kestrel-touring.html", "http://127.0.0.1:8100/static/samples/ostra-kestrel-touring.html"]:
        r = client.post("/api/v1/listings", {"url": url})
        assert r.status == 200, r.body
        car = r.json()["listing"]
        assert (car["make"], car["model"], car["body_style"]) == ("Ostra", "Kestrel", "wagon")
        assert car["photos"][0] == "/static/samples/ostra-kestrel-touring-side.jpg"
    assert fetched["asked"] == []
    photo = client.get("/api/v1/listings/photo?url=/static/samples/ostra-kestrel-touring-side.jpg")
    assert photo.status == 200 and photo.headers["Content-Type"] == "image/jpeg"
    assert fetched["asked"] == []


def test_another_sites_listing_and_photos_come_through_the_fetcher(client, fetched):
    url = "https://dealer.example/cars/42"
    fetched["pages"][url] = ('<script type="application/ld+json">{"@type":"Car","brand":"Rowan","model":"Atlas",'
                             '"image":"https://cdn.dealer.example/42-side.jpg"}</script>')
    car = client.post("/api/v1/listings", {"url": url}).json()["listing"]
    assert car["make"] == "Rowan" and car["photos"] == ["https://cdn.dealer.example/42-side.jpg"]
    fetched["images"]["https://cdn.dealer.example/42-side.jpg"] = b"\xff\xd8 a photo"
    r = client.get("/api/v1/listings/photo?url=https%3A%2F%2Fcdn.dealer.example%2F42-side.jpg")
    assert r.status == 200 and r.body == b"\xff\xd8 a photo" and r.headers["Cache-Control"].startswith("private")


def test_listing_problems_are_said_plainly(client, fetched):
    assert client.post("/api/v1/listings", {"url": ""}).json()["error"] == "Paste a link to a car listing."
    r = client.post("/api/v1/listings", {"url": "https://offline.example/x"})
    assert r.status == 422 and "online" in r.json()["error"]
    fetched["pages"]["https://blog.example/post"] = "<html><title>Ten tips for spring</title></html>"
    r = client.post("/api/v1/listings", {"url": "https://blog.example/post"})
    assert r.status == 422 and "Couldn't find a car" in r.json()["error"]
    # A sample name that isn't there is not read from disk, nor anything beside the samples.
    r = client.post("/api/v1/listings", {"url": "/static/samples/../index.html"})
    assert r.status == 422
    r = client.get("/api/v1/listings/photo?url=https%3A%2F%2Fcdn.example%2Fnot-a-photo")
    assert r.status == 422 and r.json()["error"] == "That isn't a photo."


def test_the_log_never_has_a_pasted_link(capsys):
    from carlab.__main__ import QuietHandler

    handler = QuietHandler.__new__(QuietHandler)
    handler.requestline = "GET /api/v1/listings/photo?url=https%3A%2F%2Fprivate.example%2Fsecret HTTP/1.1"
    handler.log_message('"%s" %s %s', handler.requestline, "200", "-")
    out = capsys.readouterr().out
    assert out.strip() == "GET /api/v1/listings/photo 200"
