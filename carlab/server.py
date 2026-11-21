"""carlab's web server: the page, its files, and a small JSON API (saved builds, the price list, reading a listing),
as one WSGI application.

    from carlab.server import App
    app = App()            # a WSGI application: mount it under any WSGI server
    python -m carlab       # or run this one (see __main__.py)

It answers only on this computer unless you start it otherwise, and refuses changes sent from other sites. A pasted
link is used for one answer and dropped; the log has a request's method, path and status, never its query or body.
"""

from __future__ import annotations

import json
import mimetypes
import os
import re
import traceback
from http import HTTPStatus
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from . import fetcher, listing
from .builds import BuildError, Store

HERE = Path(__file__).parent
STATIC = HERE / "static"
CATALOG = HERE / "data" / "catalog.json"
MAX_BODY = 2 * 1024 * 1024
TYPES = {".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html; charset=utf-8",
         ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon",
         ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8"}
SECURITY = [
    ("X-Content-Type-Options", "nosniff"), ("X-Frame-Options", "SAMEORIGIN"), ("Referrer-Policy", "no-referrer"),
    # The page loads nothing from anywhere else; listing photos come through /api/v1/listings/photo.
    ("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; "
                                "connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"),
]
SAMPLE = re.compile(r"\A/static/samples/([a-z0-9-]+)\.html\Z")


def data_dir() -> Path:
    return Path(os.environ.get("CARLAB_DATA") or "data")


class Request:
    def __init__(self, environ):
        self.environ = environ
        self.method = environ.get("REQUEST_METHOD", "GET").upper()
        self.path = environ.get("PATH_INFO", "/") or "/"
        self.query = {k: v[-1] for k, v in parse_qs(environ.get("QUERY_STRING", ""), keep_blank_values=True).items()}
        self.host = environ.get("HTTP_HOST") or environ.get("SERVER_NAME", "")

    def json(self):
        try:
            length = int(self.environ.get("CONTENT_LENGTH") or 0)
        except ValueError:
            length = 0
        if length > MAX_BODY:
            raise ValueError("That's too much to send.")
        raw = self.environ["wsgi.input"].read(length) if length > 0 else b""
        if not raw.strip():
            return {}
        try:
            value = json.loads(raw)
        except ValueError:
            raise ValueError("That wasn't valid JSON.") from None
        if not isinstance(value, dict):
            raise ValueError("Send a JSON object.")
        return value

    def same_site(self) -> bool:
        """Changes may only come from this page: a browser names the page that sent a request in Origin."""
        origin = self.environ.get("HTTP_ORIGIN")
        if not origin or origin == "null":
            return origin is None
        return urlsplit(origin).netloc == self.host


class Response:
    def __init__(self, status=200, body=b"", content_type="application/json", headers=()):
        self.status, self.body, self.content_type, self.headers = status, body, content_type, list(headers)

    @classmethod
    def json(cls, value, status=200):
        return cls(status, json.dumps(value).encode())

    @classmethod
    def error(cls, message, status=400):
        return cls.json({"error": message}, status)


class App:
    def __init__(self, store: Store | None = None, fetch_page=None, fetch_image=None):
        self.store = store or Store(data_dir() / "carlab.sqlite3")
        self.fetch_page = fetch_page or fetcher.get_page
        self.fetch_image = fetch_image or fetcher.get_image

    def __call__(self, environ, start_response):
        request = Request(environ)
        try:
            response = self.route(request)
        except ValueError as error:
            response = Response.error(str(error))
        except Exception:  # noqa: BLE001 - one bad request shouldn't stop the server
            traceback.print_exc()
            response = Response.error("Something went wrong on our side.", 500)
        status = f"{response.status} {HTTPStatus(response.status).phrase}"
        headers = [("Content-Type", response.content_type), ("Content-Length", str(len(response.body))), *SECURITY, *response.headers]
        start_response(status, headers)
        return [response.body] if request.method != "HEAD" else [b""]

    def route(self, r: Request) -> Response:
        path = r.path.rstrip("/") or "/"
        if path.startswith("/api/"):
            if r.method not in ("GET", "HEAD") and not r.same_site():
                return Response.error("Changes have to come from carlab's own page.", 403)
            return self.api(r, path)
        if r.method not in ("GET", "HEAD"):
            return Response.error("Not here.", 405)
        if path == "/":
            return self.file(STATIC / "index.html")
        if path.startswith("/static/"):
            return self.file(STATIC / path.removeprefix("/static/"))
        return Response.error("There's nothing here.", 404)

    def file(self, path: Path) -> Response:
        try:
            resolved = path.resolve()
            resolved.relative_to(STATIC.resolve())
        except (ValueError, OSError):
            return Response.error("There's nothing here.", 404)
        if not resolved.is_file():
            return Response.error("There's nothing here.", 404)
        kind = TYPES.get(resolved.suffix) or mimetypes.guess_type(resolved.name)[0] or "application/octet-stream"
        cache = "public, max-age=86400" if "/vendor/" in str(resolved) else "no-cache"
        return Response(200, resolved.read_bytes(), kind, [("Cache-Control", cache)])

    # --- The API ---------------------------------------------------------------------------------------------

    def api(self, r: Request, path: str) -> Response:
        parts = path.split("/")[3:]  # /api/v1/<parts...>
        if parts == ["catalog"] and r.method == "GET":
            return Response.json(json.loads(CATALOG.read_text()))
        if parts == ["samples"] and r.method == "GET":
            return Response.json({"samples": self.samples()})
        if parts == ["builds"]:
            if r.method == "GET":
                return Response.json({"builds": self.store.all()})
            if r.method == "POST":
                try:
                    return Response.json(self.store.create(r.json()), 201)
                except BuildError as error:
                    return Response.error(str(error), 422)
        if len(parts) == 2 and parts[0] == "builds" and parts[1].isdigit():
            build_id = int(parts[1])
            if r.method == "GET":
                found = self.store.get(build_id)
                return Response.json(found) if found else Response.error("That build isn't saved here.", 404)
            if r.method == "PUT":
                try:
                    found = self.store.update(build_id, r.json())
                except BuildError as error:
                    return Response.error(str(error), 422)
                return Response.json(found) if found else Response.error("That build isn't saved here.", 404)
            if r.method == "DELETE":
                return Response(204) if self.store.delete(build_id) else Response.error("That build isn't saved here.", 404)
        if parts == ["listings"] and r.method == "POST":
            return self.read_listing(r)
        if parts == ["listings", "photo"] and r.method == "GET":
            return self.listing_photo(r)
        return Response.error("There's nothing here.", 404)

    def samples(self) -> list[dict]:
        out = []
        for page in sorted((STATIC / "samples").glob("*.html")):
            facts = listing.read(page.read_text(), f"/static/samples/{page.name}")
            out.append({"url": f"/static/samples/{page.name}", "name": facts["name"]})
        return out

    def read_listing(self, r: Request) -> Response:
        body = r.json()
        url = str(body.get("url") or "").strip()
        if not url:
            return Response.error("Paste a link to a car listing.")
        sample = self.sample_page(r, url)
        try:
            html = sample if sample is not None else self.fetch_page(url)
        except fetcher.Error as error:
            return Response.error(str(error), 422)
        facts = listing.read(html, url if sample is None else urlsplit(url).path)
        if not (facts["make"] or facts["model"] or facts["photos"]):
            return Response.error("Couldn't find a car on that page. Save a photo of the car from it instead.", 422)
        return Response.json({"listing": facts})

    def sample_page(self, r: Request, url: str) -> str | None:
        """This server's own sample listings are read from disk, not fetched (they work offline)."""
        parts = urlsplit(url)
        if parts.netloc and parts.netloc != r.host:
            return None
        found = SAMPLE.match(parts.path)
        if not found:
            return None
        page = STATIC / "samples" / f"{found.group(1)}.html"
        return page.read_text() if page.is_file() else None

    def listing_photo(self, r: Request) -> Response:
        """A listing's photo passed through, so the page can read its pixels to find the car's outline."""
        url = r.query.get("url", "")
        parts = urlsplit(url)
        if parts.path.startswith("/static/samples/") and (not parts.netloc or parts.netloc == r.host):
            return self.file(STATIC / parts.path.removeprefix("/static/"))
        try:
            data, kind = self.fetch_image(url)
        except fetcher.Error as error:
            return Response.error(str(error), 422)
        return Response(200, data, kind, [("Cache-Control", "private, max-age=600")])
