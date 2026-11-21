import io
import json
import socket

import pytest

from carlab.builds import Store
from carlab.server import App

_connect = socket.create_connection


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """Nothing in the tests reaches another machine: only this one's own test servers answer."""

    def only_here(address, *args, **kwargs):
        if address[0] != "127.0.0.1":
            raise ConnectionRefusedError("the tests don't use the network")
        return _connect(address, *args, **kwargs)

    monkeypatch.setattr(socket, "create_connection", only_here)


class Client:
    """Calls the WSGI app the way a server would, as if from carlab's own page on 127.0.0.1:8100."""

    def __init__(self, app):
        self.app = app

    def call(self, method, path, body=None, origin="http://127.0.0.1:8100", raw=None):
        path, _, query = path.partition("?")
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else b"")
        environ = {
            "REQUEST_METHOD": method, "PATH_INFO": path, "QUERY_STRING": query, "HTTP_HOST": "127.0.0.1:8100",
            "SERVER_NAME": "127.0.0.1", "SERVER_PORT": "8100", "CONTENT_LENGTH": str(len(data)),
            "CONTENT_TYPE": "application/json", "wsgi.input": io.BytesIO(data), "wsgi.url_scheme": "http",
        }
        if origin:
            environ["HTTP_ORIGIN"] = origin
        seen = {}

        def start_response(status, headers):
            seen["status"] = int(status.split()[0])
            seen["headers"] = dict(headers)

        out = b"".join(self.app(environ, start_response))
        return Response(seen["status"], seen["headers"], out)

    def get(self, path, **kw):
        return self.call("GET", path, origin=None, **kw)

    def post(self, path, body=None, **kw):
        return self.call("POST", path, body, **kw)


class Response:
    def __init__(self, status, headers, body):
        self.status, self.headers, self.body = status, headers, body

    def json(self):
        return json.loads(self.body) if self.body else None


@pytest.fixture
def fetched():
    """What the app asked the internet for (nothing leaves: the tests answer)."""
    return {"pages": {}, "images": {}, "asked": []}


@pytest.fixture
def client(fetched):
    from carlab import fetcher

    def fetch_page(url):
        fetched["asked"].append(url)
        if url not in fetched["pages"]:
            raise fetcher.Error("Couldn't find that website. Is this computer online?")
        return fetched["pages"][url]

    def fetch_image(url):
        fetched["asked"].append(url)
        if url not in fetched["images"]:
            raise fetcher.Error("That isn't a photo.")
        return fetched["images"][url], "image/jpeg"

    return Client(App(Store(":memory:"), fetch_page=fetch_page, fetch_image=fetch_image))
